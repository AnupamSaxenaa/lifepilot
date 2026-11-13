// ─── Hustlers Manager ────────────────────────────────────
// The data API for friends ("hustlers") and leaderboards. Screens must never
// touch Supabase directly — they call this.
//
// Rules honoured:
//  • Reads are cache-first: cached rows render instantly, fresh data arrives
//    silently after. A failed/offline refresh keeps the cache intact.
//  • Cross-user stats come ONLY from the get_hustler_directory RPC, which
//    verifies an accepted friendship server-side.
//  • Social writes (request/accept/remove) require connectivity on purpose:
//    optimistically "accepting" a friendship would fake access to another
//    user's data, exactly like invitation acceptance in collaboration.
// ─────────────────────────────────────────────────────────
import { countOnline, getPresence } from '../utils/presence';
import { Storage } from '../utils/storage';
import { supabase } from './supabase';
import { getSyncState } from './syncQueue';

const HUSTLERS_KEY = (userId) => `hustlers_${userId}`;
const REQUESTS_KEY = (userId) => `hustler_requests_${userId}`;
const BOARD_KEY = (period, key) => `leaderboard_${period}_${key}`;

export const PERIODS = ['daily', 'monthly', 'yearly'];

export const SORTS = [
  { id: 'level', label: 'Level' },
  { id: 'presence', label: 'Online' },
  { id: 'hustle_today', label: 'Hustled today' },
  { id: 'hustle_month', label: 'Monthly hustle' },
  { id: 'hustle_year', label: 'Yearly hustle' },
  { id: 'tasks_today', label: 'Tasks today' },
  { id: 'streak', label: 'Streak' },
  { id: 'name', label: 'Name' },
  { id: 'recent', label: 'Recently added' },
];

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Normalize an RPC/cached row so the UI never has to defend against nulls. */
export const normalizeHustler = (row) => {
  if (!row || typeof row !== 'object') return null;
  // Accept both raw RPC rows and our canonical cached/UI shape. This makes a
  // cache round-trip safe after local removals instead of dropping every row.
  const id = row.user_id ?? row.userId ?? row.id;
  if (id == null) return null;
  return {
    userId: String(id),
    username: row.username || '',
    displayName: row.display_name ?? row.displayName ?? row.username ?? 'Hustler',
    avatarUrl: row.avatar_url ?? row.avatarUrl ?? null,
    status: row.hustle_status ?? row.status ?? null,
    level: Math.max(1, num(row.level) || 1),
    streak: Math.max(0, num(row.streak)),
    focusToday: Math.max(0, num(row.focus_seconds_today ?? row.focusToday)),
    focusMonth: Math.max(0, num(row.focus_seconds_month ?? row.focusMonth)),
    focusYear: Math.max(0, num(row.focus_seconds_year ?? row.focusYear)),
    tasksToday: Math.max(0, num(row.tasks_completed_today ?? row.tasksToday)),
    friendsSince: row.friends_since ?? row.friendsSince ?? null,
    lastSeenAt: row.last_seen_at ?? row.lastSeenAt ?? null,
  };
};

const normalizeList = (rows) => (Array.isArray(rows)
  ? rows.map(normalizeHustler).filter(Boolean)
  : []);

/**
 * Pure sort + search. Kept separate from the screen so the ordering rules are
 * testable and so re-sorting never triggers a network read.
 */
export const sortHustlers = (list, sortId = 'level', query = '') => {
  const rows = Array.isArray(list) ? [...list] : [];
  const q = String(query || '').trim().toLowerCase();

  const filtered = q
    ? rows.filter((h) => h.displayName.toLowerCase().includes(q)
      || h.username.toLowerCase().includes(q))
    : rows;

  const byName = (a, b) => a.displayName.localeCompare(b.displayName);
  // Every numeric sort falls back to name, so equal values (very common at 0)
  // produce a stable, predictable order instead of shuffling between renders.
  const desc = (pick) => (a, b) => (pick(b) - pick(a)) || byName(a, b);

  const comparators = {
    // Present first (online → idle → away → offline), then the strongest
    // hustler within each bucket, so the row you can actually poke is on top.
    presence: (a, b) => (getPresence(a.lastSeenAt).rank - getPresence(b.lastSeenAt).rank)
      || (b.focusToday - a.focusToday)
      || byName(a, b),
    hustle_today: desc((h) => h.focusToday),
    hustle_month: desc((h) => h.focusMonth),
    hustle_year: desc((h) => h.focusYear),
    tasks_today: desc((h) => h.tasksToday),
    streak: desc((h) => h.streak),
    level: desc((h) => h.level),
    name: byName,
    recent: (a, b) => new Date(b.friendsSince || 0) - new Date(a.friendsSince || 0) || byName(a, b),
  };

  return filtered.sort(comparators[sortId] || comparators.level);
};

/** Squad average vs you — more motivating than an unreachable global rank. */
export const getSquadPulse = (list, myFocusToday = 0) => {
  const rows = Array.isArray(list) ? list : [];
  if (rows.length === 0) return { average: 0, ahead: 0, total: 0, beatsAverage: false };
  const total = rows.reduce((sum, h) => sum + h.focusToday, 0);
  const average = Math.round(total / rows.length);
  return {
    average,
    total,
    ahead: rows.filter((h) => h.focusToday > myFocusToday).length,
    beatsAverage: myFocusToday >= average,
  };
};

/** Cache-first friends list. `onFresh` fires only on a successful refresh. */
export const loadHustlers = async (userId, onFresh, { refresh = true } = {}) => {
  if (!userId) return [];
  const cached = normalizeList(await Storage.get(HUSTLERS_KEY(userId)));

  if (refresh) {
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_hustler_directory');
        if (error) return;
        const fresh = normalizeList(data);
        await Storage.set(HUSTLERS_KEY(userId), data || []);
        if (onFresh) onFresh(fresh);
      } catch {
        // Offline or migration not applied yet — cache stays authoritative.
      }
    })();
  }

  return cached;
};

/** Incoming pending requests (cache-first, same contract). */
export const loadRequests = async (userId, onFresh, { refresh = true } = {}) => {
  if (!userId) return [];
  const stored = await Storage.get(REQUESTS_KEY(userId));
  const cached = Array.isArray(stored) ? stored : [];

  if (refresh) {
    (async () => {
      try {
        // requester_id references auth.users, not public.profiles, so PostgREST
        // cannot embed profiles through that FK. Fetch the authorization row
        // first, then enrich names separately; a profile failure must never
        // hide a real pending request or its badge count.
        const { data, error } = await supabase
          .from('friendships')
          .select('id, requester_id, created_at')
          .eq('addressee_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        if (error) {
          if (__DEV__) console.warn('[Hustlers] Request refresh failed:', error.message);
          return;
        }

        const baseRows = Array.isArray(data) ? data : [];
        const requesterIds = [...new Set(baseRows.map((row) => row.requester_id).filter(Boolean))];
        let profileById = new Map();
        if (requesterIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, username, display_name, avatar_url')
            .in('id', requesterIds);
          if (!profileError && Array.isArray(profiles)) {
            profileById = new Map(profiles.map((profile) => [String(profile.id), profile]));
          } else if (profileError && __DEV__) {
            console.warn('[Hustlers] Request profile enrichment failed:', profileError.message);
          }
        }

        const rows = baseRows.map((row) => ({
          ...row,
          profiles: profileById.get(String(row.requester_id)) || null,
        }));
        await Storage.set(REQUESTS_KEY(userId), rows);
        if (onFresh) onFresh(rows);
      } catch (error) {
        if (__DEV__) console.warn('[Hustlers] Request refresh exception:', error?.message || error);
      }
    })();
  }

  return cached;
};

const summarizeBadges = (hustlers, requests) => ({
  pendingCount: Array.isArray(requests) ? requests.length : 0,
  onlineCount: countOnline(hustlers),
});

/** Cache-first summary used by the Dashboard friends icon. */
export const loadHustlerBadges = async (userId, onFresh, { refresh = true } = {}) => {
  if (!userId) return { pendingCount: 0, onlineCount: 0 };
  let [hustlers, requests] = await Promise.all([
    loadHustlers(userId, null, { refresh: false }),
    loadRequests(userId, null, { refresh: false }),
  ]);
  const cached = summarizeBadges(hustlers, requests);

  if (refresh) {
    loadHustlers(userId, (fresh) => {
      hustlers = fresh;
      onFresh?.(summarizeBadges(hustlers, requests));
    }).catch(() => {});
    loadRequests(userId, (fresh) => {
      requests = fresh;
      onFresh?.(summarizeBadges(hustlers, requests));
    }).catch(() => {});
  }

  return cached;
};

/** Realtime is an accelerator; focus + polling remain the fallback. */
export const subscribeToHustlerChanges = (userId, onChange) => {
  if (!userId) return () => {};
  let notifyTimer = null;
  const notify = () => {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      onChange?.();
    }, 100);
  };

  try {
    const channel = supabase
      .channel(`hustlers-live-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, notify)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presence_sessions' }, notify)
      .subscribe();
    return () => {
      if (notifyTimer) clearTimeout(notifyTimer);
      supabase.removeChannel(channel);
    };
  } catch {
    if (notifyTimer) clearTimeout(notifyTimer);
    return () => {};
  }
};

/** Find someone to add. Never returns the caller. */
export const searchUsers = async (query, selfId) => {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .ilike('username', `%${q}%`)
    .limit(20);
  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .filter((row) => String(row.id) !== String(selfId))
    .map((row) => ({
      userId: String(row.id),
      username: row.username || '',
      displayName: row.display_name || row.username || 'Hustler',
      avatarUrl: row.avatar_url || null,
    }));
};

const requireOnline = () => {
  if (getSyncState().online) return;
  const error = new Error('offline');
  error.code = 'OFFLINE';
  throw error;
};

export const sendHustlerRequest = async (userId, targetId) => {
  requireOnline();
  const { error } = await supabase.from('friendships').insert({
    requester_id: userId,
    addressee_id: targetId,
    status: 'pending',
  });
  // The pair-unique index rejects a duplicate/reciprocal request; surface that
  // as a clear state rather than a raw Postgres error.
  if (error?.code === '23505' || error?.code === '23P01') {
    const conflict = new Error('already_connected');
    conflict.code = 'ALREADY_CONNECTED';
    throw conflict;
  }
  if (error) throw error;
};

export const respondToRequest = async (userId, requestId, accept) => {
  requireOnline();
  const { error } = await supabase
    .from('friendships')
    .update({
      status: accept ? 'accepted' : 'blocked',
      responded_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('addressee_id', userId);
  if (error) throw error;

  // The authorization decision has succeeded remotely; now remove the request
  // from the local cache so an offline reopen cannot briefly resurrect it.
  const stored = await Storage.get(REQUESTS_KEY(userId));
  const cached = Array.isArray(stored) ? stored : [];
  await Storage.set(
    REQUESTS_KEY(userId),
    cached.filter((request) => String(request?.id) !== String(requestId)),
  );
};

export const removeHustler = async (userId, friendId) => {
  requireOnline();
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(`and(requester_id.eq.${userId},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${userId})`);
  if (error) throw error;

  const cached = normalizeList(await Storage.get(HUSTLERS_KEY(userId)));
  await Storage.set(
    HUSTLERS_KEY(userId),
    cached.filter((h) => h.userId !== String(friendId)),
  );
};

/** The period key the snapshot table is indexed by. */
export const periodKey = (period, now = new Date()) => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  if (period === 'yearly') return `${y}`;
  if (period === 'monthly') return `${y}-${m}`;
  return `${y}-${m}-${d}`;
};

/**
 * Cache-first leaderboard page. Reads precomputed snapshots ordered by stored
 * rank, so this is an index scan rather than a global aggregate.
 */
export const loadLeaderboard = async (period, onFresh, { limit = 50, now = new Date() } = {}) => {
  const safePeriod = PERIODS.includes(period) ? period : 'daily';
  const key = periodKey(safePeriod, now);
  const cacheKey = BOARD_KEY(safePeriod, key);
  const cached = Array.isArray(await Storage.get(cacheKey)) ? await Storage.get(cacheKey) : [];

  {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('leaderboard_snapshots')
          .select('user_id, focus_seconds, tasks_completed, rank, profiles(username, display_name, avatar_url)')
          .eq('period', safePeriod)
          .eq('period_key', key)
          .order('rank', { ascending: true })
          .limit(limit);
        if (error) return;
        const rows = Array.isArray(data) ? data : [];
        await Storage.set(cacheKey, rows);
        if (onFresh) onFresh(rows);
      } catch {
        // Cached board stays on screen.
      }
    })();
  }

  return cached;
};

/**
 * Live ranking, computed at read time by the `live_leaderboard` RPC, so it
 * reflects sessions that landed seconds ago instead of waiting for the cron
 * snapshot. Cached per period so the board paints instantly on open.
 */
export const loadLiveLeaderboard = async (period, onFresh, { limit = 50 } = {}) => {
  const safePeriod = PERIODS.includes(period) ? period : 'daily';
  const cacheKey = `leaderboard_live_${safePeriod}`;
  const cached = Array.isArray(await Storage.get(cacheKey)) ? await Storage.get(cacheKey) : [];

  {
    (async () => {
      try {
        const { data, error } = await supabase.rpc('live_leaderboard', {
          p_period: safePeriod,
          p_limit: limit,
        });
        if (error) return;
        const rows = Array.isArray(data) ? data : [];
        await Storage.set(cacheKey, rows);
        if (onFresh) onFresh(rows);
      } catch {
        // Fall back to the cached board, then to snapshots.
      }
    })();
  }

  return cached;
};

/** Your standing even when you are outside the visible top N. */
export const loadMyRank = async (period) => {
  const safePeriod = PERIODS.includes(period) ? period : 'daily';
  try {
    const { data, error } = await supabase.rpc('my_leaderboard_rank', { p_period: safePeriod });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { rank: row.rank, focusSeconds: row.focus_seconds, totalRanked: row.total_ranked } : null;
  } catch {
    return null;
  }
};

/**
 * Re-read the board whenever any user's daily stats change. Realtime replaces
 * timer polling: no wasted requests when nothing is happening, and an update
 * within a moment of a session landing when something is.
 */
export const subscribeToLeaderboard = (onChange) => {
  try {
    const channel = supabase
      .channel('leaderboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_daily_stats' }, () => {
        onChange?.();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  } catch {
    return () => {};
  }
};

/**
 * Overlay the signed-in user's OWN numbers from local device state onto a
 * server-fetched board, then re-rank.
 *
 * Why: a round trip plus a Realtime notification is hundreds of milliseconds at
 * best. The device already knows its own totals the instant a task is ticked, so
 * the user's row is corrected locally and immediately — completing shows 1,
 * un-completing shows 0 — while everyone else's rows come from the server. When
 * the server catches up it agrees, so there is no flicker back and forth.
 *
 * Local values are authoritative for your row precisely because they can go
 * DOWN: taking `max()` would make an un-complete impossible to display.
 */
export const applySelfStats = (rows, self) => {
  const list = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  if (!self || !self.userId) return list;

  const focus = Math.max(0, Number(self.focusSeconds) || 0);
  const tasks = Math.max(0, Number(self.tasksCompleted) || 0);
  const index = list.findIndex((r) => String(r.user_id) === String(self.userId));

  if (index >= 0) {
    list[index] = { ...list[index], focus_seconds: focus, tasks_completed: tasks, is_me: true };
  } else if (focus > 0) {
    // Not in the fetched page yet (first session, or below the cut) — show the
    // user immediately rather than making them wait for the next refresh.
    list.push({
      user_id: self.userId,
      username: self.username || '',
      display_name: self.displayName || 'You',
      avatar_url: self.avatarUrl || null,
      focus_seconds: focus,
      tasks_completed: tasks,
      is_me: true,
    });
  }

  // Re-rank after the overlay: ties resolve by tasks, then name, so the order is
  // stable instead of jittering between refreshes.
  list.sort((a, b) => (b.focus_seconds - a.focus_seconds)
    || (b.tasks_completed - a.tasks_completed)
    || String(a.display_name || '').localeCompare(String(b.display_name || '')));

  let lastScore = null;
  let lastRank = 0;
  return list.map((row, i) => {
    if (row.focus_seconds !== lastScore) {
      lastRank = i + 1;
      lastScore = row.focus_seconds;
    }
    return { ...row, rank: lastRank };
  });
};

/** Publish a custom status ("deep work", "in class"). Server trims to 60 chars. */
export const setHustleStatus = async (status) => {
  requireOnline();
  const { error } = await supabase.rpc('set_hustle_status', { p_status: status ?? null });
  if (error) throw error;
};

// ─── Focus Sessions ──────────────────────────────────────
// The data source for "hours hustled".
//
// Before this existed, Focus Mode counted work time in component state only —
// nothing was persisted, so the moment the screen unmounted the time was gone.
// Friends stats and leaderboards would have shown zeros forever.
//
// Offline-first, per the architecture rules:
//   1. Append to the local session log + bump the local daily rollup FIRST.
//   2. Queue the Supabase insert through SyncQueue (replays when online).
// Every session carries a stable `client_session_id`, so a replay after a crash
// or reconnect can never double-count a user's hours.
// ─────────────────────────────────────────────────────────
import { drainSyncQueue, syncToSupabase } from '../lib/syncQueue';
import { Storage } from './storage';

// Server enforces these too; clamping here keeps the local cache honest so the
// UI never shows a figure the server will later reject.
export const MIN_SESSION_SECONDS = 60;
export const MAX_SESSION_SECONDS = 4 * 60 * 60;      // one sitting
export const MAX_DAY_SECONDS = 16 * 60 * 60;         // per local day
const MAX_LOG_ENTRIES = 400;

export const localDayKey = (value = new Date()) => {
  if (value === null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const logKey = (userId) => `focus_log_${userId}`;
const rollupKey = (userId) => `focus_rollup_${userId}`;

const makeSessionId = () => {
  const rand = Math.random().toString(36).slice(2, 10);
  return `fs_${Date.now().toString(36)}_${rand}`;
};

export const normalizeRollup = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  Object.entries(value).forEach(([day, seconds]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const n = Math.max(0, Math.min(MAX_DAY_SECONDS, Math.floor(Number(seconds) || 0)));
    if (n > 0) out[day] = n;
  });
  return out;
};

/**
 * Record one completed focus sitting.
 * Returns the applied session (or null when it was too short to count).
 */
export const recordFocusSession = async (userId, {
  seconds,
  startedAt,
  endedAt,
  taskId = null,
  clientSessionId = null,
} = {}) => {
  if (!userId) return null;

  const raw = Math.floor(Number(seconds) || 0);
  // Sub-minute sittings are noise, not hustle. Silently ignored.
  if (raw < MIN_SESSION_SECONDS) return null;

  const end = endedAt ? new Date(endedAt) : new Date();
  const start = startedAt ? new Date(startedAt) : new Date(end.getTime() - raw * 1000);
  const day = localDayKey(end);
  if (!day) return null;

  const clamped = Math.min(raw, MAX_SESSION_SECONDS);

  const [existingLog, existingRollup] = await Promise.all([
    Storage.get(logKey(userId)),
    Storage.get(rollupKey(userId)),
  ]);

  const log = Array.isArray(existingLog) ? existingLog : [];
  const stableSessionId = clientSessionId ? String(clientSessionId) : makeSessionId();
  // Completion recovery can call this more than once. Keep the local rollup as
  // idempotent as the server's (user_id, client_session_id) unique constraint.
  const existing = log.find((entry) => entry?.client_session_id === stableSessionId);
  if (existing) return existing;

  const rollup = normalizeRollup(existingRollup);
  const alreadyToday = rollup[day] || 0;
  // Never let a local total exceed what the server will accept for one day.
  const room = Math.max(0, MAX_DAY_SECONDS - alreadyToday);
  const credited = Math.min(clamped, room);
  if (credited <= 0) return null;

  const session = {
    client_session_id: stableSessionId,
    seconds: credited,
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    local_day: day,
    // Always a string: task IDs are bigint for server rows but UUID for
    // locally-created ones, and the column is text (migration 0018).
    task_id: taskId != null ? String(taskId) : null,
    kind: 'focus',
  };

  const nextLog = [...log, session].slice(-MAX_LOG_ENTRIES);
  const nextRollup = { ...rollup, [day]: alreadyToday + credited };

  // Local first — one batched write, so the UI is correct even fully offline.
  await Storage.setBatch([
    [logKey(userId), nextLog],
    [rollupKey(userId), nextRollup],
  ]);

  // Then durable sync. Queued when offline, replayed on reconnect; the unique
  // (user_id, client_session_id) index makes a duplicate replay a no-op.
  // Enqueue, then force a drain. SyncQueue's persistAndExecute deliberately
  // skips execution unless connectivity is VERIFIED (`_isOnline === true`);
  // an unverified `null` counts as not-online, so a freshly banked session sat
  // in the queue until some later foreground event. Draining here delivers it
  // now when we are actually online, and is a no-op when we are not.
  syncToSupabase(
    'focus_sessions',
    'upsert',
    { ...session, user_id: userId },
    { column: 'user_id,client_session_id' },
    { actorUserId: userId, entityId: stableSessionId },
  )
    .then((result) => {
      if (result) return null;
      return drainSyncQueue();
    })
    .catch(() => drainSyncQueue().catch(() => {}));

  return session;
};

/** Seconds hustled on a given local day (cache-only, instant). */
export const getFocusSecondsForDay = async (userId, day = localDayKey()) => {
  if (!userId || !day) return 0;
  const rollup = normalizeRollup(await Storage.get(rollupKey(userId)));
  return rollup[day] || 0;
};

/**
 * Totals for the three leaderboard periods, computed from the local rollup so
 * the user's own figures render with no network round-trip.
 */
export const getFocusTotals = async (userId, now = new Date()) => {
  const empty = { today: 0, week: 0, month: 0, year: 0, allTime: 0 };
  if (!userId) return empty;

  const rollup = normalizeRollup(await Storage.get(rollupKey(userId)));
  const today = localDayKey(now);
  const monthPrefix = today.slice(0, 7);
  const yearPrefix = today.slice(0, 4);

  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);

  return Object.entries(rollup).reduce((acc, [day, seconds]) => {
    acc.allTime += seconds;
    if (day === today) acc.today += seconds;
    if (day.startsWith(monthPrefix)) acc.month += seconds;
    if (day.startsWith(yearPrefix)) acc.year += seconds;
    if (new Date(`${day}T00:00:00`) >= weekStart) acc.week += seconds;
    return acc;
  }, { ...empty });
};

/** "3h 42m" / "42m" — the one format used everywhere hours are shown. */
export const formatHustle = (totalSeconds) => {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '0m';
};

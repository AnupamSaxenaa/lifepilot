// ─── Presence ────────────────────────────────────────────
// Presence is derived from a last-seen timestamp, never stored as a flag.
// A stored "online" boolean goes stale the instant an app is force-killed or
// loses signal — the user would appear online forever. A timestamp decays on its
// own, so a dead client correctly falls to offline with no cleanup job.
// ─────────────────────────────────────────────────────────

const MINUTE = 60 * 1000;

export const PRESENCE = {
  online: { id: 'online', label: 'Online', color: '#4ADE80', rank: 0 },
  idle: { id: 'idle', label: 'Idle', color: '#FBBF24', rank: 1 },
  away: { id: 'away', label: 'Away', color: '#A78BFA', rank: 2 },
  offline: { id: 'offline', label: 'Offline', color: '#52525B', rank: 3 },
};

// Generous by design: a user reading a task list is still "here", and a phone
// that slept for five minutes has not gone away.
const ONLINE_WITHIN = 2 * MINUTE;
const IDLE_WITHIN = 10 * MINUTE;
const AWAY_WITHIN = 45 * MINUTE;

export const getPresence = (lastSeenAt, now = Date.now()) => {
  if (!lastSeenAt) return PRESENCE.offline;
  const seen = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(seen)) return PRESENCE.offline;

  // Clock skew between device and server can put "seen" slightly in the future;
  // treat that as online rather than as a bogus negative age.
  const age = Math.max(0, now - seen);
  if (age < ONLINE_WITHIN) return PRESENCE.online;
  if (age < IDLE_WITHIN) return PRESENCE.idle;
  if (age < AWAY_WITHIN) return PRESENCE.away;
  return PRESENCE.offline;
};

/** "online", "idle 4m", "away 20m", "last seen 3d" — compact enough for a row. */
export const getPresenceLabel = (lastSeenAt, now = Date.now()) => {
  const state = getPresence(lastSeenAt, now);
  if (state.id === 'online') return 'online';
  if (!lastSeenAt) return 'offline';

  const seen = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(seen)) return 'offline';

  const minutes = Math.floor(Math.max(0, now - seen) / MINUTE);
  if (state.id === 'idle') return `idle ${minutes}m`;
  if (state.id === 'away') return `away ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last seen ${Math.max(1, hours)}h`;
  return `last seen ${Math.floor(hours / 24)}d`;
};

/** Only genuinely live users count toward the "ONLINE 4/10" header. */
export const countOnline = (people, now = Date.now()) => {
  if (!Array.isArray(people)) return 0;
  return people.reduce((total, person) => (
    getPresence(person?.lastSeenAt, now).id === 'online' ? total + 1 : total
  ), 0);
};

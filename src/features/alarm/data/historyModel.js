/**
 * LifePilot — Alarm History Stats Derivation
 * ------------------------------------------------------------------
 * Pure functions that turn the raw `alarm_history` record list (see
 * `dataManager.loadAlarmHistory`/`recordWakeSession`) into the aggregate
 * stats shown on the alarm dashboard and insights screen. No side effects,
 * no native imports — safe to unit test and reuse anywhere.
 */

const DAY_MS = 86400000;

const toDate = (iso) => (iso ? new Date(iso) : null);

/** Overall completion rate: dismissed / (dismissed + missed + skipped). */
export const computeCompletionRate = (history) => {
  if (!history || !history.length) return 0;
  const decided = history.filter((h) => ['dismissed', 'missed', 'skipped'].includes(h.outcome));
  if (!decided.length) return 0;
  const dismissed = decided.filter((h) => h.outcome === 'dismissed').length;
  return dismissed / decided.length;
};

/** Average snooze count across all recorded sessions. */
export const computeAverageSnoozeCount = (history) => {
  if (!history || !history.length) return 0;
  const total = history.reduce((sum, h) => sum + (h.snooze_count || 0), 0);
  return total / history.length;
};

/** Average wake time-of-day (as "HH:mm") across dismissed sessions. */
export const computeAverageWakeTime = (history) => {
  const dismissed = (history || []).filter((h) => h.outcome === 'dismissed' && h.triggered_at);
  if (!dismissed.length) return null;
  const totalMinutes = dismissed.reduce((sum, h) => {
    const d = toDate(h.triggered_at);
    return sum + d.getHours() * 60 + d.getMinutes();
  }, 0);
  const avgMinutes = Math.round(totalMinutes / dismissed.length);
  const hh = Math.floor(avgMinutes / 60) % 24;
  const mm = avgMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

/**
 * Wake consistency: 1 - (stddev of wake-time-in-minutes / 720), clamped to
 * [0,1]. Higher = more consistent wake times. 720 min (12h) is used as the
 * normalization ceiling since that's the max possible stddev for a wrapped
 * 24h clock in practice for real alarm data.
 */
export const computeWakeConsistency = (history) => {
  const dismissed = (history || []).filter((h) => h.outcome === 'dismissed' && h.triggered_at);
  if (dismissed.length < 2) return dismissed.length === 1 ? 1 : 0;
  const minutes = dismissed.map((h) => {
    const d = toDate(h.triggered_at);
    return d.getHours() * 60 + d.getMinutes();
  });
  const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const variance = minutes.reduce((sum, m) => sum + (m - mean) ** 2, 0) / minutes.length;
  const stddev = Math.sqrt(variance);
  return Math.max(0, Math.min(1, 1 - stddev / 720));
};

/** Longest consecutive-day dismiss streak (no missed days with a triggered alarm). */
export const computeLongestStreak = (history) => {
  if (!history || !history.length) return 0;
  const byDay = new Map(); // 'YYYY-MM-DD' -> outcome ('dismissed' wins if any dismiss that day)
  for (const h of history) {
    if (!h.triggered_at) continue;
    const day = h.triggered_at.slice(0, 10);
    const existing = byDay.get(day);
    if (h.outcome === 'dismissed' || existing !== 'dismissed') {
      byDay.set(day, h.outcome === 'dismissed' ? 'dismissed' : (existing || h.outcome));
    }
  }
  const days = [...byDay.keys()].sort();
  let longest = 0;
  let current = 0;
  let prevDay = null;
  for (const day of days) {
    const isSuccess = byDay.get(day) === 'dismissed';
    if (!isSuccess) { current = 0; prevDay = day; continue; }
    if (prevDay) {
      const gapDays = Math.round((new Date(day) - new Date(prevDay)) / DAY_MS);
      current = gapDays === 1 ? current + 1 : 1;
    } else {
      current = 1;
    }
    longest = Math.max(longest, current);
    prevDay = day;
  }
  return longest;
};

/** Which alarm_id has the most snoozes, and how many. */
export const computeMostSnoozedAlarm = (history) => {
  const totals = new Map();
  for (const h of history || []) {
    if (!h.alarm_id) continue;
    totals.set(h.alarm_id, (totals.get(h.alarm_id) || 0) + (h.snooze_count || 0));
  }
  let best = null;
  for (const [alarmId, count] of totals) {
    if (!best || count > best.count) best = { alarmId, count };
  }
  return best;
};

/** Which challenge id shows up most often on MISSED sessions (proxy for "most difficult"). */
export const computeMostDifficultChallenge = (history) => {
  const counts = new Map();
  for (const h of history || []) {
    if (h.outcome !== 'missed' || !Array.isArray(h.challenge_ids)) continue;
    for (const id of h.challenge_ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  let best = null;
  for (const [id, count] of counts) {
    if (!best || count > best.count) best = { id, count };
  }
  return best;
};

/** Day-of-week (0=Sun..6=Sat) success rates, for "best/worst days" insights. */
export const computeDayOfWeekSuccessRates = (history) => {
  const buckets = Array.from({ length: 7 }, () => ({ total: 0, dismissed: 0 }));
  for (const h of history || []) {
    if (!h.triggered_at || !['dismissed', 'missed', 'skipped'].includes(h.outcome)) continue;
    const dow = new Date(h.triggered_at).getDay();
    buckets[dow].total += 1;
    if (h.outcome === 'dismissed') buckets[dow].dismissed += 1;
  }
  return buckets.map((b, dow) => ({ dow, rate: b.total ? b.dismissed / b.total : null, total: b.total }));
};

/**
 * Full stats bundle for the dashboard/insights screens.
 */
export const computeAlarmStats = (history) => ({
  completionRate: computeCompletionRate(history),
  wakeConsistency: computeWakeConsistency(history),
  averageWakeTime: computeAverageWakeTime(history),
  averageSnoozeCount: computeAverageSnoozeCount(history),
  longestStreak: computeLongestStreak(history),
  mostSnoozedAlarm: computeMostSnoozedAlarm(history),
  mostDifficultChallenge: computeMostDifficultChallenge(history),
  dayOfWeekSuccessRates: computeDayOfWeekSuccessRates(history),
  totalSessions: (history || []).length,
});

/** Group history entries into a simple monthly calendar map: 'YYYY-MM-DD' -> outcome. */
export const buildMonthlyOutcomeMap = (history, year, month /* 0-indexed */) => {
  const map = {};
  for (const h of history || []) {
    if (!h.triggered_at) continue;
    const d = new Date(h.triggered_at);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = h.triggered_at.slice(0, 10);
    // dismissed takes priority for display if multiple alarms that day.
    if (h.outcome === 'dismissed' || map[key] !== 'dismissed') {
      map[key] = h.outcome;
    }
  }
  return map;
};

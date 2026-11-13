/**
 * LifePilot — Smart Suggestions
 * ------------------------------------------------------------------
 * Derives gentle, non-intrusive nudges from the alarm history log (repeated
 * snoozing, late/inconsistent wakes, low completion rate) using the same
 * pure stat functions the insights screen uses. Presentational-agnostic:
 * returns a list of `{ key, params }` the UI maps to localized strings.
 */
import { computeAlarmStats } from './data/historyModel';

const RECENT_WINDOW_DAYS = 14;

const withinRecentWindow = (history) => {
  const cutoff = Date.now() - RECENT_WINDOW_DAYS * 86400000;
  return (history || []).filter((h) => h.triggered_at && new Date(h.triggered_at).getTime() >= cutoff);
};

/**
 * @param {Array} history  raw alarm_history records
 * @returns {Array<{ key: string, params?: object }>} ordered by relevance
 */
export const getSmartSuggestions = (history) => {
  const recent = withinRecentWindow(history);
  if (recent.length < 3) return []; // not enough data yet to say anything useful

  const stats = computeAlarmStats(recent);
  const suggestions = [];

  // Repeated snoozing -> suggest an earlier bedtime / stronger challenge.
  if (stats.averageSnoozeCount >= 2) {
    suggestions.push({ key: 'alarmSuggestions.reduceSnooze', params: { count: Math.round(stats.averageSnoozeCount) } });
    suggestions.push({ key: 'alarmSuggestions.strongerChallenge' });
  } else if (stats.averageSnoozeCount >= 1) {
    suggestions.push({ key: 'alarmSuggestions.reduceSnoozeMild' });
  }

  // Low wake consistency -> suggest an earlier/consistent bedtime.
  if (stats.wakeConsistency < 0.5) {
    suggestions.push({ key: 'alarmSuggestions.earlierBedtime' });
  }

  // Low completion rate -> suggest changing the alarm / ringtone.
  if (stats.completionRate < 0.6) {
    suggestions.push({ key: 'alarmSuggestions.changeAlarm' });
    suggestions.push({ key: 'alarmSuggestions.differentRingtone' });
  }

  // A specific alarm gets snoozed a lot -> call it out by id (UI resolves title).
  if (stats.mostSnoozedAlarm && stats.mostSnoozedAlarm.count >= 5) {
    suggestions.push({ key: 'alarmSuggestions.specificAlarmSnoozed', params: { alarmId: stats.mostSnoozedAlarm.alarmId, count: stats.mostSnoozedAlarm.count } });
  }

  // Everything looking healthy -> encouragement, not just silence.
  if (suggestions.length === 0 && stats.completionRate >= 0.85 && stats.averageSnoozeCount < 0.5) {
    suggestions.push({ key: 'alarmSuggestions.healthyRoutine' });
  }

  return suggestions;
};

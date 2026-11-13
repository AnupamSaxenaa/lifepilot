/**
 * LifePilot — Recurrence label formatter
 * ------------------------------------------------------------------
 * Turns a recurrence rule into a localized, human-readable string for the
 * alarm list / edit UI. Weekday names come from the device locale via Intl so
 * they localize automatically even before per-locale strings are filled in.
 */

// monIndex: 0=Mon … 6=Sun. 2024-01-01 was a Monday, so offset from it.
export const weekdayShortName = (monIndex) => {
  const ref = new Date(2024, 0, 1 + monIndex);
  try {
    return ref.toLocaleDateString(undefined, { weekday: 'short' });
  } catch {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][monIndex] || '';
  }
};

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * @param {object} rule  recurrence rule (see alarmModel.js)
 * @param {(key, params) => string} t  i18next translate function
 */
export const formatRecurrence = (rule, t) => {
  if (!rule || typeof rule !== 'object') return t('alarmRecurrence.once');
  switch (rule.mode) {
    case 'once': return t('alarmRecurrence.once');
    case 'daily': return t('alarmRecurrence.daily');
    case 'weekdays': return t('alarmRecurrence.weekdays');
    case 'weekends': return t('alarmRecurrence.weekends');
    case 'weekly': {
      const days = Array.isArray(rule.daysOfWeek) ? rule.daysOfWeek : [];
      const names = days.map((on, i) => (on ? weekdayShortName(i) : null)).filter(Boolean);
      if (!names.length) return t('alarmRecurrence.weekly');
      return t('alarmRecurrence.weeklyOn', { days: names.join(', ') });
    }
    case 'everyNDays': return t('alarmRecurrence.everyNDays', { interval: rule.interval || 2 });
    case 'monthly': return t('alarmRecurrence.monthly', { dayOfMonth: rule.dayOfMonth || 1 });
    case 'yearly': return t('alarmRecurrence.yearly', { month: rule.month || 1, day: rule.day || 1 });
    case 'nthWeekday':
      return t('alarmRecurrence.nthWeekday', { nth: ordinal(rule.nth || 1), weekday: weekdayShortName(rule.weekday || 0) });
    case 'lastWeekday':
      return t('alarmRecurrence.lastWeekday', { weekday: weekdayShortName(rule.weekday || 0) });
    case 'odd': return t('alarmRecurrence.odd');
    case 'even': return t('alarmRecurrence.even');
    default: return t('alarmRecurrence.once');
  }
};

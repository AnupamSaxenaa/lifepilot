/**
 * LifePilot — Recurrence Engine (pure, unit-testable, OTA-safe)
 * ------------------------------------------------------------------
 * Given a structured recurrence `rule` (see alarmModel.js), computes the next
 * future occurrences as local wall-clock `Date`s. No native/Supabase imports,
 * no timers, no side effects — the scheduler layer turns these Dates into
 * Notifee triggers.
 *
 * Weekday indexing inside a rule is Monday-based: 0=Mon … 6=Sun. JavaScript's
 * `Date.getDay()` is Sunday-based (0=Sun … 6=Sat); conversions are localized
 * to this module.
 *
 * DST-safety: day arithmetic uses `Date.UTC(y, m, d)` (calendar days, immune to
 * DST), while the final occurrence Date is built with local `new Date(y,m,d,hh,mm)`
 * so it lands on the correct local wall-clock time.
 */
import { isValidTimeStr } from '../data/alarmModel';

const MS_PER_DAY = 86400000;
const MAX_SCAN_DAYS = 366 * 5; // safety cap (~5 years) to avoid infinite loops

// Calendar day number (DST-immune). Days since 1970-01-01 in UTC terms.
const dayNumber = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);

const daysInMonth = (year, monthIdx) => new Date(year, monthIdx + 1, 0).getDate();

const toISODate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Parse an ISO 'YYYY-MM-DD' into a local midnight Date (avoids TZ shifting).
const parseISODateLocal = (iso) => {
  if (!iso || typeof iso !== 'string') return null;
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

const anchorDayNumber = (rule) => {
  const parsed = rule && rule.anchorDate ? parseISODateLocal(rule.anchorDate) : null;
  return parsed ? dayNumber(parsed) : 0; // default anchor: epoch (deterministic)
};

/**
 * Does the rule produce an occurrence on the given calendar `date`?
 * (Time-of-day is irrelevant here; callers combine with rule.time.)
 */
export const isOccurrenceOn = (rule, date) => {
  if (!rule || typeof rule !== 'object') return false;

  // Suppression: explicitly skipped dates.
  const isoDate = toISODate(date);
  if (Array.isArray(rule.skipDates) && rule.skipDates.includes(isoDate)) return false;

  // Public holidays are generated separately from manual skips so changing a
  // country never leaves stale dates behind or erases user-selected skips.
  if (rule.skipPublicHolidays &&
      Array.isArray(rule.holidayDates) &&
      rule.holidayDates.includes(isoDate)) return false;

  // Suppression: paused/vacation until a resume date (strictly before -> off).
  if (rule.pausedUntil) {
    const resume = parseISODateLocal(rule.pausedUntil);
    if (resume && dayNumber(date) < dayNumber(resume)) return false;
  }

  const jsDow = date.getDay();          // 0=Sun..6=Sat
  const monDow = (jsDow + 6) % 7;        // 0=Mon..6=Sun

  switch (rule.mode) {
    case 'once': {
      const onceDate = rule.onceDate || rule.anchorDate;
      return onceDate ? toISODate(date) === onceDate : true;
    }
    case 'daily':
      return true;
    case 'weekdays':
      return monDow <= 4;
    case 'weekends':
      return monDow >= 5;
    case 'weekly': {
      const days = rule.daysOfWeek;
      if (!(Array.isArray(days) && days[monDow])) return false;
      const interval = rule.interval && rule.interval > 1 ? rule.interval : 1;
      if (interval === 1) return true;
      const weeks = Math.floor((dayNumber(date) - anchorDayNumber(rule)) / 7);
      return ((weeks % interval) + interval) % interval === 0;
    }
    case 'everyNDays': {
      const interval = rule.interval && rule.interval >= 1 ? rule.interval : 1;
      const diff = dayNumber(date) - anchorDayNumber(rule);
      return ((diff % interval) + interval) % interval === 0;
    }
    case 'monthly': {
      const dom = rule.dayOfMonth;
      if (!(dom >= 1 && dom <= 31)) return false;
      const target = Math.min(dom, daysInMonth(date.getFullYear(), date.getMonth()));
      return date.getDate() === target;
    }
    case 'yearly': {
      if (!(rule.month >= 1 && rule.month <= 12 && rule.day >= 1 && rule.day <= 31)) return false;
      if (date.getMonth() !== rule.month - 1) return false;
      const target = Math.min(rule.day, daysInMonth(date.getFullYear(), rule.month - 1));
      return date.getDate() === target;
    }
    case 'nthWeekday': {
      if (!(rule.nth >= 1 && rule.nth <= 5 && rule.weekday >= 0 && rule.weekday <= 6)) return false;
      const targetJs = (rule.weekday + 1) % 7; // Mon(0)->1 … Sun(6)->0
      if (jsDow !== targetJs) return false;
      const occurrenceIndex = Math.floor((date.getDate() - 1) / 7) + 1;
      return occurrenceIndex === rule.nth;
    }
    case 'lastWeekday': {
      if (!(rule.weekday >= 0 && rule.weekday <= 6)) return false;
      const targetJs = (rule.weekday + 1) % 7;
      if (jsDow !== targetJs) return false;
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
      return next.getMonth() !== date.getMonth(); // no same weekday later this month
    }
    case 'odd':
      return date.getDate() % 2 === 1;
    case 'even':
      return date.getDate() % 2 === 0;
    default:
      return false;
  }
};

/**
 * Compute the next `count` future occurrences of `rule`, strictly after
 * `fromDate`. Returns ascending local `Date`s. For mode 'once' returns at most
 * one (empty if it has already passed).
 */
export const nextOccurrences = (rule, fromDate, count = 1) => {
  const results = [];
  if (!rule || !isValidTimeStr(rule.time) || count < 1) return results;

  const [hh, mm] = rule.time.split(':').map((n) => parseInt(n, 10));
  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const baseYear = from.getFullYear();
  const baseMonth = from.getMonth();
  const baseDate = from.getDate();

  for (let i = 0; i < MAX_SCAN_DAYS && results.length < count; i++) {
    const day = new Date(baseYear, baseMonth, baseDate + i, 0, 0, 0, 0);
    if (isOccurrenceOn(rule, day)) {
      const occ = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0);
      if (occ.getTime() > from.getTime()) {
        results.push(occ);
        if (rule.mode === 'once') break;
      }
    }
  }
  return results;
};

/**
 * Describe a rule for the UI as a stable i18n key + params. The UI layer maps
 * the key to a localized string across the 21 locales.
 */
export const describeRule = (rule) => {
  if (!rule || typeof rule !== 'object') return { key: 'alarm.recurrence.once' };
  switch (rule.mode) {
    case 'once': return { key: 'alarm.recurrence.once' };
    case 'daily': return { key: 'alarm.recurrence.daily' };
    case 'weekdays': return { key: 'alarm.recurrence.weekdays' };
    case 'weekends': return { key: 'alarm.recurrence.weekends' };
    case 'weekly': return { key: 'alarm.recurrence.weekly', params: { daysOfWeek: rule.daysOfWeek, interval: rule.interval || 1 } };
    case 'everyNDays': return { key: 'alarm.recurrence.everyNDays', params: { interval: rule.interval || 2 } };
    case 'monthly': return { key: 'alarm.recurrence.monthly', params: { dayOfMonth: rule.dayOfMonth } };
    case 'yearly': return { key: 'alarm.recurrence.yearly', params: { month: rule.month, day: rule.day } };
    case 'nthWeekday': return { key: 'alarm.recurrence.nthWeekday', params: { nth: rule.nth, weekday: rule.weekday } };
    case 'lastWeekday': return { key: 'alarm.recurrence.lastWeekday', params: { weekday: rule.weekday } };
    case 'odd': return { key: 'alarm.recurrence.odd' };
    case 'even': return { key: 'alarm.recurrence.even' };
    default: return { key: 'alarm.recurrence.once' };
  }
};

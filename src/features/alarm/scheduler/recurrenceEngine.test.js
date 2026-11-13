import {
    deriveRecurrenceFromLegacy,
    legacyDaysFromRecurrence,
    normalizeAlarm,
} from '../data/alarmModel';
import { describeRule, isOccurrenceOn, nextOccurrences } from './recurrenceEngine';

// Helpers
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0);
const iso = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

describe('recurrenceEngine.nextOccurrences', () => {
  // Property 1: strictly-increasing, all > from, exactly `count`.
  test('returns exactly count strictly-increasing future dates (daily)', () => {
    const from = at(2026, 7, 13, 9, 0); // Monday 9:00
    const occ = nextOccurrences({ mode: 'daily', time: '07:00' }, from, 5);
    expect(occ).toHaveLength(5);
    for (let i = 0; i < occ.length; i++) {
      expect(occ[i].getTime()).toBeGreaterThan(from.getTime());
      if (i > 0) expect(occ[i].getTime()).toBeGreaterThan(occ[i - 1].getTime());
      expect(occ[i].getHours()).toBe(7);
      expect(occ[i].getMinutes()).toBe(0);
    }
  });

  test('daily: today is skipped if its time already passed', () => {
    const from = at(2026, 7, 13, 8, 0); // 08:00
    const occ = nextOccurrences({ mode: 'daily', time: '07:00' }, from, 1);
    expect(iso(occ[0])).toBe('2026-07-14'); // next day
  });

  test('daily: today is included if its time is still ahead', () => {
    const from = at(2026, 7, 13, 6, 0); // 06:00
    const occ = nextOccurrences({ mode: 'daily', time: '07:00' }, from, 1);
    expect(iso(occ[0])).toBe('2026-07-13');
  });

  test('once: returns a single next occurrence', () => {
    const from = at(2026, 7, 13, 8, 0);
    const occ = nextOccurrences({ mode: 'once', time: '07:00' }, from, 5);
    expect(occ).toHaveLength(1);
    expect(iso(occ[0])).toBe('2026-07-14');
  });

  test('weekly on specific days (Mon/Wed/Fri)', () => {
    // Mon..Sun booleans; Mon, Wed, Fri = indexes 0,2,4
    const rule = { mode: 'weekly', time: '07:00', daysOfWeek: [true, false, true, false, true, false, false] };
    const from = at(2026, 7, 13, 9, 0); // Monday, after 07:00
    const occ = nextOccurrences(rule, from, 3).map(iso);
    // Next should be Wed 15, Fri 17, Mon 20
    expect(occ).toEqual(['2026-07-15', '2026-07-17', '2026-07-20']);
  });

  test('weekdays excludes weekend, weekends excludes weekdays', () => {
    const from = at(2026, 7, 17, 9, 0); // Friday after time
    const wd = nextOccurrences({ mode: 'weekdays', time: '07:00' }, from, 1);
    expect(iso(wd[0])).toBe('2026-07-20'); // Monday
    const we = nextOccurrences({ mode: 'weekends', time: '07:00' }, from, 1);
    expect(iso(we[0])).toBe('2026-07-18'); // Saturday
  });

  test('everyNDays honors interval from anchor', () => {
    const rule = { mode: 'everyNDays', time: '07:00', interval: 3, anchorDate: '2026-07-13' };
    const from = at(2026, 7, 13, 9, 0);
    const occ = nextOccurrences(rule, from, 3).map(iso);
    expect(occ).toEqual(['2026-07-16', '2026-07-19', '2026-07-22']);
  });

  test('monthly clamps to last day for short months', () => {
    const rule = { mode: 'monthly', time: '07:00', dayOfMonth: 31 };
    const from = at(2026, 2, 1, 0, 0); // Feb 1, 2026 (non-leap)
    const occ = nextOccurrences(rule, from, 1);
    expect(iso(occ[0])).toBe('2026-02-28');
  });

  test('yearly fires on the given month/day', () => {
    const rule = { mode: 'yearly', time: '07:00', month: 12, day: 25 };
    const from = at(2026, 7, 13, 9, 0);
    const occ = nextOccurrences(rule, from, 2).map(iso);
    expect(occ).toEqual(['2026-12-25', '2027-12-25']);
  });

  test('nthWeekday: 2nd Monday of the month', () => {
    // weekday 0 = Monday, nth = 2
    const rule = { mode: 'nthWeekday', time: '07:00', nth: 2, weekday: 0 };
    const from = at(2026, 7, 1, 0, 0);
    const occ = nextOccurrences(rule, from, 1);
    // July 2026: Mondays are 6, 13, 20, 27 -> 2nd = 13
    expect(iso(occ[0])).toBe('2026-07-13');
  });

  test('lastWeekday: last Sunday of the month', () => {
    // weekday 6 = Sunday
    const rule = { mode: 'lastWeekday', time: '07:00', weekday: 6 };
    const from = at(2026, 7, 1, 0, 0);
    const occ = nextOccurrences(rule, from, 1);
    // July 2026: Sundays 5,12,19,26 -> last = 26
    expect(iso(occ[0])).toBe('2026-07-26');
  });

  test('odd and even day modes', () => {
    const from = at(2026, 7, 13, 9, 0); // 13th (odd), time passed
    const odd = nextOccurrences({ mode: 'odd', time: '07:00' }, from, 1);
    expect(iso(odd[0])).toBe('2026-07-15');
    const even = nextOccurrences({ mode: 'even', time: '07:00' }, from, 1);
    expect(iso(even[0])).toBe('2026-07-14');
  });
});

describe('recurrenceEngine suppression (Property 4: skip/pause)', () => {
  test('skipDates suppresses the listed date', () => {
    const rule = { mode: 'daily', time: '07:00', skipDates: ['2026-07-14'] };
    const from = at(2026, 7, 13, 9, 0);
    const occ = nextOccurrences(rule, from, 1);
    expect(iso(occ[0])).toBe('2026-07-15'); // 14 skipped
  });

  test('pausedUntil suppresses occurrences before the resume date', () => {
    const rule = { mode: 'daily', time: '07:00', pausedUntil: '2026-07-20' };
    const from = at(2026, 7, 13, 9, 0);
    const occ = nextOccurrences(rule, from, 1);
    expect(iso(occ[0])).toBe('2026-07-20'); // resumes on the 20th
  });

  test('isOccurrenceOn respects skip and pause', () => {
    const rule = { mode: 'daily', time: '07:00', skipDates: ['2026-07-14'], pausedUntil: null };
    expect(isOccurrenceOn(rule, at(2026, 7, 14))).toBe(false);
    expect(isOccurrenceOn(rule, at(2026, 7, 15))).toBe(true);
  });
});

describe('legacy <-> recurrence bridging (Property 9)', () => {
  test('deriveRecurrenceFromLegacy: no days -> once', () => {
    const r = deriveRecurrenceFromLegacy('06:30', [false, false, false, false, false, false, false]);
    expect(r.mode).toBe('once');
    expect(r.time).toBe('06:30');
  });

  test('deriveRecurrenceFromLegacy: some days -> weekly', () => {
    const r = deriveRecurrenceFromLegacy('06:30', [true, false, false, false, false, false, true]);
    expect(r.mode).toBe('weekly');
    expect(r.daysOfWeek).toEqual([true, false, false, false, false, false, true]);
  });

  test('legacyDaysFromRecurrence: daily -> all true, weekdays -> Mon-Fri', () => {
    expect(legacyDaysFromRecurrence({ mode: 'daily' })).toEqual([true, true, true, true, true, true, true]);
    expect(legacyDaysFromRecurrence({ mode: 'weekdays' })).toEqual([true, true, true, true, true, false, false]);
    expect(legacyDaysFromRecurrence({ mode: 'weekends' })).toEqual([false, false, false, false, false, true, true]);
  });

  test('a legacy alarm (only days_of_week) still schedules under the new engine', () => {
    const legacy = { time: '06:00', title: 'Legacy', days_of_week: [true, false, true, false, false, false, false] };
    const norm = normalizeAlarm(legacy);
    expect(norm.recurrence.mode).toBe('weekly');
    // days stay in sync
    expect(norm.days_of_week).toEqual([true, false, true, false, false, false, false]);
    const occ = nextOccurrences(norm.recurrence, at(2026, 7, 13, 9, 0), 2).map(iso);
    // Mon(13) passed -> next Wed(15) then Mon(20)
    expect(occ).toEqual(['2026-07-15', '2026-07-20']);
  });
});

describe('describeRule', () => {
  test('maps modes to stable i18n keys', () => {
    expect(describeRule({ mode: 'daily' }).key).toBe('alarm.recurrence.daily');
    expect(describeRule({ mode: 'nthWeekday', nth: 2, weekday: 0 })).toEqual({
      key: 'alarm.recurrence.nthWeekday',
      params: { nth: 2, weekday: 0 },
    });
  });
});

describe('single-shot and holiday exclusions', () => {
  test('onceDate anchors a one-time alarm to exactly one calendar date', () => {
    const rule = { mode: 'once', time: '07:00', onceDate: '2026-07-20' };
    expect(nextOccurrences(rule, at(2026, 7, 18, 8, 0), 3)).toEqual([at(2026, 7, 20, 7, 0)]);
    expect(nextOccurrences(rule, at(2026, 7, 20, 8, 0), 1)).toEqual([]);
  });

  test('public holidays are skipped without changing manual skip dates', () => {
    const rule = {
      mode: 'daily',
      time: '07:00',
      skipDates: ['2026-07-21'],
      skipPublicHolidays: true,
      holidayDates: ['2026-07-20'],
    };
    expect(nextOccurrences(rule, at(2026, 7, 19, 8, 0), 1)).toEqual([at(2026, 7, 22, 7, 0)]);
  });
});
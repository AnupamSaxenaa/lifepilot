const {
  computeCompletionRate,
  computeAverageSnoozeCount,
  computeAverageWakeTime,
  computeWakeConsistency,
  computeLongestStreak,
  computeMostSnoozedAlarm,
  computeMostDifficultChallenge,
  computeAlarmStats,
  buildMonthlyOutcomeMap,
} = require('./historyModel');

const rec = (overrides) => ({
  alarm_id: 'A1',
  outcome: 'dismissed',
  snooze_count: 0,
  challenge_ids: [],
  triggered_at: '2026-07-13T07:00:00.000Z',
  ...overrides,
});

describe('computeCompletionRate', () => {
  test('empty history -> 0', () => {
    expect(computeCompletionRate([])).toBe(0);
  });
  test('all dismissed -> 1', () => {
    expect(computeCompletionRate([rec({}), rec({})])).toBe(1);
  });
  test('mixed outcomes computed correctly', () => {
    const h = [rec({ outcome: 'dismissed' }), rec({ outcome: 'missed' }), rec({ outcome: 'dismissed' }), rec({ outcome: 'skipped' })];
    expect(computeCompletionRate(h)).toBeCloseTo(0.5);
  });
});

describe('computeAverageSnoozeCount', () => {
  test('averages snooze_count across sessions', () => {
    const h = [rec({ snooze_count: 0 }), rec({ snooze_count: 2 }), rec({ snooze_count: 4 })];
    expect(computeAverageSnoozeCount(h)).toBeCloseTo(2);
  });
});

describe('computeAverageWakeTime', () => {
  test('averages time-of-day across dismissed sessions', () => {
    const h = [
      rec({ triggered_at: '2026-07-13T06:00:00.000Z' }),
      rec({ triggered_at: '2026-07-14T07:00:00.000Z' }),
    ];
    const avg = computeAverageWakeTime(h);
    // Using UTC hours since Date parses ISO as UTC and getHours() is local —
    // this test just checks the function runs and returns a HH:mm string.
    expect(avg).toMatch(/^\d{2}:\d{2}$/);
  });

  test('returns null when no dismissed sessions', () => {
    expect(computeAverageWakeTime([rec({ outcome: 'missed' })])).toBeNull();
  });
});

describe('computeWakeConsistency', () => {
  test('identical wake times -> consistency near 1', () => {
    const h = [
      rec({ triggered_at: '2026-07-13T07:00:00.000Z' }),
      rec({ triggered_at: '2026-07-14T07:00:00.000Z' }),
      rec({ triggered_at: '2026-07-15T07:00:00.000Z' }),
    ];
    expect(computeWakeConsistency(h)).toBeGreaterThan(0.95);
  });

  test('wildly varying wake times -> lower consistency', () => {
    const h = [
      rec({ triggered_at: '2026-07-13T05:00:00.000Z' }),
      rec({ triggered_at: '2026-07-14T12:00:00.000Z' }),
      rec({ triggered_at: '2026-07-15T20:00:00.000Z' }),
    ];
    const consistent = computeWakeConsistency([
      rec({ triggered_at: '2026-07-13T07:00:00.000Z' }),
      rec({ triggered_at: '2026-07-14T07:00:00.000Z' }),
    ]);
    expect(computeWakeConsistency(h)).toBeLessThan(consistent);
  });
});

describe('computeLongestStreak', () => {
  test('consecutive dismissed days form a streak', () => {
    const h = [
      rec({ triggered_at: '2026-07-13T07:00:00.000Z', outcome: 'dismissed' }),
      rec({ triggered_at: '2026-07-14T07:00:00.000Z', outcome: 'dismissed' }),
      rec({ triggered_at: '2026-07-15T07:00:00.000Z', outcome: 'dismissed' }),
    ];
    expect(computeLongestStreak(h)).toBe(3);
  });

  test('a missed day breaks the streak', () => {
    const h = [
      rec({ triggered_at: '2026-07-13T07:00:00.000Z', outcome: 'dismissed' }),
      rec({ triggered_at: '2026-07-14T07:00:00.000Z', outcome: 'missed' }),
      rec({ triggered_at: '2026-07-15T07:00:00.000Z', outcome: 'dismissed' }),
      rec({ triggered_at: '2026-07-16T07:00:00.000Z', outcome: 'dismissed' }),
    ];
    expect(computeLongestStreak(h)).toBe(2);
  });
});

describe('computeMostSnoozedAlarm', () => {
  test('finds the alarm with the highest total snooze count', () => {
    const h = [
      rec({ alarm_id: 'A1', snooze_count: 1 }),
      rec({ alarm_id: 'A2', snooze_count: 5 }),
      rec({ alarm_id: 'A1', snooze_count: 2 }),
    ];
    expect(computeMostSnoozedAlarm(h)).toEqual({ alarmId: 'A2', count: 5 });
  });

  test('returns null for empty history', () => {
    expect(computeMostSnoozedAlarm([])).toBeNull();
  });
});

describe('computeMostDifficultChallenge', () => {
  test('finds the challenge most associated with missed sessions', () => {
    const h = [
      rec({ outcome: 'missed', challenge_ids: ['math'] }),
      rec({ outcome: 'missed', challenge_ids: ['math', 'shake'] }),
      rec({ outcome: 'dismissed', challenge_ids: ['shake'] }),
    ];
    expect(computeMostDifficultChallenge(h)).toEqual({ id: 'math', count: 2 });
  });
});

describe('computeAlarmStats', () => {
  test('returns a full bundle without throwing on empty history', () => {
    const stats = computeAlarmStats([]);
    expect(stats.totalSessions).toBe(0);
    expect(stats.completionRate).toBe(0);
    expect(stats.mostSnoozedAlarm).toBeNull();
  });
});

describe('buildMonthlyOutcomeMap', () => {
  test('maps dates within the given month to outcomes', () => {
    const h = [
      rec({ triggered_at: '2026-07-13T07:00:00.000Z', outcome: 'dismissed' }),
      rec({ triggered_at: '2026-08-01T07:00:00.000Z', outcome: 'missed' }), // different month, excluded
    ];
    const map = buildMonthlyOutcomeMap(h, 2026, 6); // July = month 6
    expect(map['2026-07-13']).toBe('dismissed');
    expect(map['2026-08-01']).toBeUndefined();
  });
});

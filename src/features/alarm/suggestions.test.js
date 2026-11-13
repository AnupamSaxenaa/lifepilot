const { getSmartSuggestions } = require('./suggestions');

const rec = (overrides) => ({
  alarm_id: 'A1',
  outcome: 'dismissed',
  snooze_count: 0,
  challenge_ids: [],
  triggered_at: new Date().toISOString(),
  ...overrides,
});

describe('getSmartSuggestions', () => {
  test('returns nothing with too little recent history', () => {
    expect(getSmartSuggestions([rec({}), rec({})])).toEqual([]);
  });

  test('suggests reducing snooze + stronger challenge for heavy snoozers', () => {
    const history = [rec({ snooze_count: 3 }), rec({ snooze_count: 2 }), rec({ snooze_count: 4 })];
    const suggestions = getSmartSuggestions(history).map((s) => s.key);
    expect(suggestions).toContain('alarmSuggestions.reduceSnooze');
    expect(suggestions).toContain('alarmSuggestions.strongerChallenge');
  });

  test('suggests earlier bedtime for inconsistent wake times', () => {
    const daysAgo = (n) => new Date(Date.now() - n * 86400000);
    const atHour = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0).toISOString();
    const history = [
      rec({ triggered_at: atHour(daysAgo(1), 5), snooze_count: 0 }),
      rec({ triggered_at: atHour(daysAgo(2), 11), snooze_count: 0 }),
      rec({ triggered_at: atHour(daysAgo(3), 20), snooze_count: 0 }),
    ];
    const suggestions = getSmartSuggestions(history).map((s) => s.key);
    expect(suggestions).toContain('alarmSuggestions.earlierBedtime');
  });

  test('suggests changing the alarm for low completion rate', () => {
    const history = [rec({ outcome: 'missed' }), rec({ outcome: 'missed' }), rec({ outcome: 'dismissed' })];
    const suggestions = getSmartSuggestions(history).map((s) => s.key);
    expect(suggestions).toContain('alarmSuggestions.changeAlarm');
  });

  test('a healthy routine gets encouragement, not silence', () => {
    const history = [rec({}), rec({}), rec({}), rec({})];
    const suggestions = getSmartSuggestions(history).map((s) => s.key);
    expect(suggestions).toContain('alarmSuggestions.healthyRoutine');
  });

  test('calls out a specific frequently-snoozed alarm', () => {
    const history = [
      rec({ alarm_id: 'A1', snooze_count: 3 }),
      rec({ alarm_id: 'A1', snooze_count: 3 }),
      rec({ alarm_id: 'A2', snooze_count: 1 }),
    ];
    const suggestion = getSmartSuggestions(history).find((s) => s.key === 'alarmSuggestions.specificAlarmSnoozed');
    expect(suggestion).toBeDefined();
    expect(suggestion.params.alarmId).toBe('A1');
    expect(suggestion.params.count).toBe(6);
  });
});

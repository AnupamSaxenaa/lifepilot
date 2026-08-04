/* global jest, describe, test, expect, beforeEach */
// Integration tests for alarmScheduler + recurrenceEngine.
// Notifee and react-native are mocked with an in-memory trigger store so we can
// assert scheduling behavior (Properties 2 & 3) in a pure Node environment.

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-application', () => ({ applicationId: 'com.anupam.lp' }));

jest.mock('@notifee/react-native', () => {
  const store = new Map();
  return {
    __esModule: true,
    __store: store,
    default: {
      createChannel: jest.fn(async () => {}),
      getTriggerNotificationIds: jest.fn(async () => Array.from(store.keys())),
      createTriggerNotification: jest.fn(async (notif, trigger) => {
        store.set(notif.id, { ...notif, __trigger: trigger });
      }),
      cancelTriggerNotifications: jest.fn(async (ids) => { (ids || []).forEach((id) => store.delete(id)); }),
    },
    AndroidCategory: { ALARM: 'alarm' },
    AndroidImportance: { DEFAULT: 3, HIGH: 4 },
    TriggerType: { TIMESTAMP: 0 },
  };
});

const { __store } = require('@notifee/react-native');
const {
  initAlarmChannel,
  rescheduleAlarm,
  scheduleSnooze,
  cancelAlarm,
  _internals,
} = require('./alarmScheduler');

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0);
const idsFor = (alarmId) => Array.from(__store.keys()).filter((id) => id.startsWith(`alarm_${alarmId}_`));

beforeEach(() => { __store.clear(); });

describe('alarmScheduler arming', () => {
  test('arms LOOK_AHEAD occurrences for a recurring alarm with deterministic ids', async () => {
    const alarm = { id: 'A1', is_active: true, recurrence: { mode: 'daily', time: '07:00' } };
    await rescheduleAlarm(alarm, at(2026, 7, 13, 9, 0));

    const ids = idsFor('A1');
    expect(ids).toHaveLength(_internals.LOOK_AHEAD);
    // deterministic id format alarm_<id>_<epoch>
    ids.forEach((id) => expect(id).toMatch(/^alarm_A1_\d+$/));
  });

  test('once alarm arms exactly one occurrence', async () => {
    const alarm = { id: 'A2', is_active: true, recurrence: { mode: 'once', time: '07:00' } };
    await rescheduleAlarm(alarm, at(2026, 7, 13, 9, 0));
    expect(idsFor('A2')).toHaveLength(1);
  });

  // Property 2: re-running is idempotent — no duplicates.
  test('rescheduling twice from the same time does not create duplicates', async () => {
    const alarm = { id: 'A3', is_active: true, recurrence: { mode: 'daily', time: '07:00' } };
    const from = at(2026, 7, 13, 9, 0);
    await rescheduleAlarm(alarm, from);
    const first = idsFor('A3').sort();
    await rescheduleAlarm(alarm, from);
    const second = idsFor('A3').sort();
    expect(second).toEqual(first);
    expect(second).toHaveLength(_internals.LOOK_AHEAD);
  });

  // Property 3: never runs dry — after the earliest fires, re-arming keeps >=1 future.
  test('re-arming after the first occurrence keeps future occurrences', async () => {
    const alarm = { id: 'A4', is_active: true, recurrence: { mode: 'daily', time: '07:00' } };
    await rescheduleAlarm(alarm, at(2026, 7, 13, 9, 0));
    const epochs = idsFor('A4').map((id) => parseInt(id.split('_')[2], 10)).sort((a, b) => a - b);
    const firstOcc = epochs[0];

    // Simulate that the first occurrence fired & was dismissed: re-arm from just after it.
    await rescheduleAlarm(alarm, new Date(firstOcc + 60 * 1000));
    const after = idsFor('A4').map((id) => parseInt(id.split('_')[2], 10));
    expect(after.length).toBeGreaterThanOrEqual(1);
    after.forEach((e) => expect(e).toBeGreaterThan(firstOcc));
  });

  test('inactive/archived alarm arms nothing and clears leftovers', async () => {
    const active = { id: 'A5', is_active: true, recurrence: { mode: 'daily', time: '07:00' } };
    await rescheduleAlarm(active, at(2026, 7, 13, 9, 0));
    expect(idsFor('A5').length).toBeGreaterThan(0);

    const archived = { id: 'A5', is_active: true, flags: { archived: true }, recurrence: { mode: 'daily', time: '07:00' } };
    await rescheduleAlarm(archived, at(2026, 7, 13, 9, 0));
    expect(idsFor('A5')).toHaveLength(0);
  });

  test('backupAlarm flag arms an extra backup trigger per occurrence (Req 17.2)', async () => {
    const alarm = { id: 'A8', is_active: true, flags: { backupAlarm: true }, recurrence: { mode: 'once', time: '07:00' } };
    await rescheduleAlarm(alarm, at(2026, 7, 13, 9, 0));
    const ids = idsFor('A8');
    // once -> 1 primary + 1 backup
    expect(ids).toHaveLength(2);
    expect(ids.some((id) => id.endsWith('_backup'))).toBe(true);
  });

  test('cancelAlarm removes only that alarm\'s triggers', async () => {
    await rescheduleAlarm({ id: 'A6', is_active: true, recurrence: { mode: 'daily', time: '07:00' } }, at(2026, 7, 13, 9, 0));
    await rescheduleAlarm({ id: 'A7', is_active: true, recurrence: { mode: 'daily', time: '08:00' } }, at(2026, 7, 13, 9, 0));
    await cancelAlarm('A6');
    expect(idsFor('A6')).toHaveLength(0);
    expect(idsFor('A7').length).toBeGreaterThan(0);
  });
});

describe('alarmScheduler required scheduling behavior', () => {
  test('uses the bundled custom_alert resource for the alarm channel', async () => {
    const notifee = require('@notifee/react-native').default;
    notifee.createChannel.mockClear();

    await initAlarmChannel();

    expect(notifee.createChannel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'alarm-channel-v3',
      sound: 'custom_alert',
    }));
  });

  test('surfaces primary occurrence scheduling failures', async () => {
    const notifee = require('@notifee/react-native').default;
    notifee.createTriggerNotification.mockRejectedValueOnce(new Error('primary unavailable'));
    const alarm = { id: 'A9', is_active: true, recurrence: { mode: 'once', time: '07:00' } };

    await expect(rescheduleAlarm(alarm, at(2026, 7, 13, 9, 0)))
      .rejects.toThrow('primary unavailable');
  });

  test('surfaces snooze scheduling failures', async () => {
    const notifee = require('@notifee/react-native').default;
    notifee.createTriggerNotification.mockRejectedValueOnce(new Error('snooze unavailable'));

    await expect(scheduleSnooze({ id: 'A10' }, 5, { wakeSessionId: 'wake-1' }))
      .rejects.toThrow('snooze unavailable');
  });
});


describe('alarmScheduler notification metadata', () => {
  test('serializes rich metadata for matching primary and ambient occurrences', async () => {
    const alarm = {
      id: 'META', user_id: 'user-1', is_active: true, title: 'Deep work',
      recurrence: { mode: 'once', time: '07:00', onceDate: '2099-01-02' },
      label: { text: 'Focus', color: '#123456' },
      visual_config: { clockStyle: 'glass', backgroundMode: 'dynamic', palette: 'tritanopia' },
      sound_config: { uri: 'aurora', volume: 72, fadeInMs: 4000 },
      vibration_pattern: 'wave', flags: { emergency: true },
      mission: [{ type: 'math', count: 2 }],
      snooze_config: { defaultMin: 10, presets: [5, 10, 20], maxCount: 2 },
      ambient: { enabled: true, leadMin: 12 },
    };
    await rescheduleAlarm(alarm, at(2099, 1, 1, 8, 0));

    const primary = Array.from(__store.entries()).find(([id]) => !id.endsWith('_ambient'))?.[1];
    const ambient = Array.from(__store.entries()).find(([id]) => id.endsWith('_ambient'))?.[1];
    expect(primary).toBeTruthy();
    expect(ambient).toBeTruthy();
    expect(primary.data).toMatchObject({
      alarmId: 'META', userId: 'user-1', soundUri: 'aurora', volume: '72',
      fadeInMs: '4000', vibrationPattern: 'wave', emergency: 'true', snoozeCount: '0',
    });
    expect(JSON.parse(primary.data.label)).toEqual(alarm.label);
    expect(JSON.parse(primary.data.visualConfig)).toEqual(alarm.visual_config);
    expect(JSON.parse(primary.data.mission)).toEqual(alarm.mission);
    expect(JSON.parse(primary.data.snoozeConfig)).toMatchObject({ defaultMin: 10, maxCount: 2 });
    expect(primary.data.wakeSessionId).toContain('META_');

    expect(ambient.data).toMatchObject({
      alarmId: 'META', ambient: 'true', leadMin: '12', occurrenceEpoch: primary.data.occurrenceEpoch,
      soundUri: 'aurora', volume: '72', vibrationPattern: 'wave', emergency: 'true',
    });
    expect(JSON.parse(ambient.data.visualConfig)).toEqual(alarm.visual_config);
    expect(JSON.parse(ambient.data.mission)).toEqual(alarm.mission);
    expect(ambient.__trigger.timestamp).toBe(primary.__trigger.timestamp - 12 * 60 * 1000);
  });
});


describe('alarmScheduler notification metadata', () => {
  const richAlarm = {
    id: 'META',
    user_id: 'user-1',
    title: 'Morning focus',
    description: 'Start well',
    recurrence: { mode: 'daily', time: '06:30' },
    label: { key: 'workout', color: '#123456' },
    visual_config: { clockStyle: 'glass', backgroundMode: 'dynamic', palette: 'tritanopia' },
    sound_config: { uri: 'calm', volume: 72, fadeInMs: 4000 },
    vibration_pattern: 'wave',
    mission: [{ id: 'math', difficulty: 'hard' }],
    snooze_config: { presets: [5, 30], defaultMin: 30, maxCount: 2 },
    flags: { emergency: true },
  };
  const occurrence = at(2026, 7, 20, 6, 30);

  test('serializes complete primary payload as Notifee string data', () => {
    const notification = _internals.buildNotification(richAlarm, occurrence, {
      sourceOccurrenceEpoch: occurrence.getTime(),
      wakeSessionId: 'wake-1',
      sessionStartedAt: occurrence.getTime() - 1000,
      snoozeCount: 1,
      lastSnoozeMinutes: 30,
    });

    expect(Object.values(notification.data).every((value) => typeof value === 'string')).toBe(true);
    expect(JSON.parse(notification.data.visualConfig)).toEqual(richAlarm.visual_config);
    expect(JSON.parse(notification.data.mission)).toEqual(richAlarm.mission);
    expect(JSON.parse(notification.data.snoozeConfig)).toEqual(richAlarm.snooze_config);
    expect(notification.data).toEqual(expect.objectContaining({
      alarmId: 'META', userId: 'user-1', wakeSessionId: 'wake-1',
      snoozeCount: '1', lastSnoozeMinutes: '30', emergency: 'true',
    }));
    expect(notification.android).toEqual(expect.objectContaining({
      category: 'alarm', ongoing: true,
      fullScreenAction: expect.objectContaining({ id: 'default', mainComponent: 'AlarmScreen' }),
    }));
  });

  test('serializes ambient occurrence identity and appearance metadata', () => {
    const notification = _internals.buildAmbientNotification(richAlarm, occurrence, 20);
    expect(notification.data).toEqual(expect.objectContaining({
      alarmId: 'META', ambient: 'true', leadMin: '20',
      occurrenceEpoch: String(occurrence.getTime()),
    }));
    expect(JSON.parse(notification.data.visualConfig)).toEqual(richAlarm.visual_config);
    expect(JSON.parse(notification.data.recurrence)).toEqual(richAlarm.recurrence);
    expect(Object.values(notification.data).every((value) => typeof value === 'string')).toBe(true);
  });

  test('uses exact timestamp triggers that may fire while idle', () => {
    expect(_internals.createTrigger(occurrence.getTime())).toEqual({
      type: 0,
      timestamp: occurrence.getTime(),
      alarmManager: { allowWhileIdle: true },
    });
  });
});
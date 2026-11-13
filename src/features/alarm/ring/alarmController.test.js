/* global jest, describe, test, expect */
// Unit tests for the wake-session controller (Properties 5 & 6).
// Mocks every side-effecting dependency so the state machine's logic is
// tested in isolation.

jest.mock('react-native', () => ({ Platform: { OS: 'android' }, Vibration: { vibrate: jest.fn(), cancel: jest.fn() } }));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn(), remove: jest.fn(), volume: 1, loop: false, playing: false })),
  setAudioModeAsync: jest.fn(async () => {}),
}));

jest.mock('./audioPlayer', () => ({
  forceMaxVolume: jest.fn(),
  startAlarmAudio: jest.fn(async () => {}),
  stopAlarmAudio: jest.fn(),
}));

jest.mock('./vibrationPlayer', () => ({
  startVibration: jest.fn(),
  stopVibration: jest.fn(),
}));

jest.mock('../../../lib/dataManager', () => ({
  disableAlarmAfterFire: jest.fn(async () => true),
  recordWakeSession: jest.fn(async () => []),
}));

jest.mock('../../../utils/gamification', () => ({
  Gamification: {
    xpForAlarm: jest.fn(({ snoozeCount }) => (snoozeCount === 0 ? 25 : 15)),
    addXP: jest.fn(async () => ({})),
  },
}));

jest.mock('../scheduler/alarmScheduler', () => ({
  rescheduleAlarm: jest.fn(async () => {}),
  scheduleSnooze: jest.fn(async () => {}),
  cancelAlarm: jest.fn(async () => {}),
  cancelCurrentNotification: jest.fn(async () => {}),
  cancelOccurrenceCompanions: jest.fn(async () => {}),
}));

const { createAlarmController, WAKE_STATES } = require('./alarmController');
const { recordWakeSession } = require('../../../lib/dataManager');
const { Gamification } = require('../../../utils/gamification');
const { scheduleSnooze } = require('../scheduler/alarmScheduler');

const baseAlarm = (overrides = {}) => ({
  id: 'A1',
  sound_config: { uri: 'default', volume: 100, fadeInMs: 0 },
  vibration_pattern: 'strong',
  snooze_config: { presets: [5, 10, 15], defaultMin: 5, maxCount: 2, progressive: false, disabled: false },
  mission: [],
  flags: {},
  ...overrides,
});

describe('alarmController dismiss gate (Property 5)', () => {
  test('dismiss succeeds immediately when there is no mission', async () => {
    const ctrl = createAlarmController(baseAlarm());
    const ok = await ctrl.dismiss('user1');
    expect(ok).toBe(true);
    expect(ctrl.getState()).toBe(WAKE_STATES.DISMISSED);
  });

  test('dismiss is blocked while mission is incomplete, succeeds after completion', async () => {
    const alarm = baseAlarm({ mission: [{ id: 'math', difficulty: 'easy' }, { id: 'shake', difficulty: 'easy' }] });
    const ctrl = createAlarmController(alarm);

    // No dismissal allowed before starting/completing the mission.
    expect(await ctrl.dismiss('user1')).toBe(false);

    ctrl.startMission();
    expect(ctrl.getState()).toBe(WAKE_STATES.MISSION_ACTIVE);
    expect(await ctrl.dismiss('user1')).toBe(false);

    // Complete first challenge — still one remaining.
    ctrl.advanceMission('math');
    expect(ctrl.isMissionComplete()).toBe(false);
    expect(await ctrl.dismiss('user1')).toBe(false);

    // Complete second challenge — mission now complete.
    ctrl.advanceMission('shake');
    expect(ctrl.isMissionComplete()).toBe(true);
    expect(await ctrl.dismiss('user1')).toBe(true);
    expect(ctrl.getState()).toBe(WAKE_STATES.DISMISSED);
  });

  test('recordWakeSession is called with the used challenge ids on dismiss', async () => {
    recordWakeSession.mockClear();
    const alarm = baseAlarm({ mission: [{ id: 'math' }] });
    const ctrl = createAlarmController(alarm);
    ctrl.startMission();
    ctrl.advanceMission('math');
    await ctrl.dismiss('user1');
    expect(recordWakeSession).toHaveBeenCalledWith('user1', expect.objectContaining({
      alarm_id: 'A1',
      outcome: 'dismissed',
      challenge_ids: ['math'],
    }));
  });
});

describe('alarmController gamification (Task 13.1)', () => {
  test('dismiss awards XP via Gamification.addXP', async () => {
    Gamification.addXP.mockClear();
    const ctrl = createAlarmController(baseAlarm());
    await ctrl.dismiss('user1');
    expect(Gamification.xpForAlarm).toHaveBeenCalledWith({ snoozeCount: 0 });
    expect(Gamification.addXP).toHaveBeenCalledWith('user1', 25);
  });

  test('a snoozed-then-dismissed session awards the lower (snoozed) XP amount', async () => {
    Gamification.addXP.mockClear();
    const ctrl = createAlarmController(baseAlarm());
    await ctrl.snooze('user1');
    await ctrl.dismiss('user1');
    expect(Gamification.xpForAlarm).toHaveBeenCalledWith({ snoozeCount: 1 });
    expect(Gamification.addXP).toHaveBeenCalledWith('user1', 15);
  });

  test('no XP is awarded without a userId', async () => {
    Gamification.addXP.mockClear();
    const ctrl = createAlarmController(baseAlarm());
    await ctrl.dismiss(null);
    expect(Gamification.addXP).not.toHaveBeenCalled();
  });
});

describe('alarmController snooze bounds (Property 6)', () => {
  test('snooze respects maxCount', async () => {
    const ctrl = createAlarmController(baseAlarm({ snooze_config: { presets: [5, 10], defaultMin: 5, maxCount: 2, progressive: false } }));
    const first = await ctrl.snooze('user1');
    expect(first.ok).toBe(true);
    const second = await ctrl.snooze('user1');
    expect(second.ok).toBe(true);
    const third = await ctrl.snooze('user1');
    expect(third.ok).toBe(false);
    expect(third.reason).toBe('max_reached');
    expect(ctrl.getSnoozeCount()).toBe(2);
  });

  test('snooze is blocked entirely when disabled', async () => {
    const ctrl = createAlarmController(baseAlarm({ snooze_config: { disabled: true, maxCount: 5 } }));
    const res = await ctrl.snooze('user1');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('disabled');
  });

  test('progressive snooze never increases the interval', async () => {
    const ctrl = createAlarmController(baseAlarm({
      snooze_config: { presets: [5, 10, 20], defaultMin: 5, maxCount: 3, progressive: true },
    }));
    const minutesUsed = [];
    for (let i = 0; i < 3; i++) {
      const res = await ctrl.snooze('user1');
      minutesUsed.push(res.minutes);
    }
    for (let i = 1; i < minutesUsed.length; i++) {
      expect(minutesUsed[i]).toBeLessThanOrEqual(minutesUsed[i - 1]);
    }
  });

  test('snooze schedules a one-off occurrence via the scheduler', async () => {
    scheduleSnooze.mockClear();
    const ctrl = createAlarmController(baseAlarm());
    await ctrl.snooze('user1');
    expect(scheduleSnooze).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'A1' }),
      expect.any(Number),
      expect.objectContaining({ snoozeCount: 1, wakeSessionId: expect.any(String) }),
    );
  });
});

describe('alarmController emergency mode (Req 17.1)', () => {
  test('an emergency alarm with no configured mission auto-injects one (never trivially dismissible)', async () => {
    const ctrl = createAlarmController(baseAlarm({ flags: { emergency: true }, mission: [] }));
    expect(ctrl.missionLength).toBeGreaterThan(0);
    expect(ctrl.isEmergency).toBe(true);
    expect(await ctrl.dismiss('user1')).toBe(false); // mission not started/completed yet
  });

  test('snooze is always rejected on an emergency alarm', async () => {
    const ctrl = createAlarmController(baseAlarm({ flags: { emergency: true } }));
    const res = await ctrl.snooze('user1');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('emergency');
  });

  test('a non-emergency alarm with no mission is trivially dismissible', async () => {
    const ctrl = createAlarmController(baseAlarm({ flags: { emergency: false }, mission: [] }));
    expect(ctrl.missionLength).toBe(0);
    expect(await ctrl.dismiss('user1')).toBe(true);
  });
});

describe('alarmController missed', () => {
  test('markMissed records outcome=missed and stops audio/vibration', async () => {
    recordWakeSession.mockClear();
    const ctrl = createAlarmController(baseAlarm());
    await ctrl.markMissed('user1');
    expect(ctrl.getState()).toBe(WAKE_STATES.MISSED);
    expect(recordWakeSession).toHaveBeenCalledWith('user1', expect.objectContaining({ outcome: 'missed' }));
  });
});

describe('alarmController persisted wake-session behavior', () => {
  test('honors the snooze preset selected on the ring screen', async () => {
    scheduleSnooze.mockClear();
    const ctrl = createAlarmController(baseAlarm());
    const result = await ctrl.snooze('user1', 15);
    expect(result).toEqual({ ok: true, minutes: 15 });
    expect(scheduleSnooze).toHaveBeenCalledWith(expect.any(Object), 15, expect.objectContaining({ snoozeCount: 1 }));
  });

  test('enforces max count after a snooze notification reconstructs the session', async () => {
    const ctrl = createAlarmController(baseAlarm({ snooze_config: { presets: [5], maxCount: 2 } }), {
      initialSnoozeCount: 2,
      wakeSessionId: 'session-1',
    });
    expect(await ctrl.snooze('user1', 5)).toEqual({ ok: false, reason: 'max_reached' });
  });

  test('one-time dismissal persists disabled state', async () => {
    const { disableAlarmAfterFire } = require('../../../lib/dataManager');
    disableAlarmAfterFire.mockClear();
    const ctrl = createAlarmController(baseAlarm({ recurrence: { mode: 'once', time: '07:00' } }));
    await ctrl.dismiss('user1');
    expect(disableAlarmAfterFire).toHaveBeenCalledWith('user1', 'A1');
  });
});

describe('alarmController scheduling correctness', () => {
  test('keeps or restores ringing without silencing when snooze scheduling fails', async () => {
    const { stopAlarmAudio } = require('./audioPlayer');
    const { cancelCurrentNotification, cancelOccurrenceCompanions } = require('../scheduler/alarmScheduler');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    scheduleSnooze.mockRejectedValueOnce(new Error('exact alarm unavailable'));
    recordWakeSession.mockClear();
    stopAlarmAudio.mockClear();
    cancelCurrentNotification.mockClear();
    cancelOccurrenceCompanions.mockClear();
    const ctrl = createAlarmController(baseAlarm({ mission: [{ id: 'math' }] }));
    ctrl.startMission();

    await expect(ctrl.snooze('user1', 10)).resolves.toEqual({
      ok: false,
      reason: 'schedule_failed',
    });

    expect(ctrl.getState()).toBe(WAKE_STATES.RINGING);
    expect(ctrl.getSnoozeCount()).toBe(0);
    expect(stopAlarmAudio).not.toHaveBeenCalled();
    expect(cancelCurrentNotification).not.toHaveBeenCalled();
    expect(cancelOccurrenceCompanions).not.toHaveBeenCalled();
    expect(recordWakeSession).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('records each successful snooze offline-first with wake-session details', async () => {
    recordWakeSession.mockClear();
    const ctrl = createAlarmController(baseAlarm(), {
      wakeSessionId: 'wake-session-42',
      initialSnoozeCount: 1,
    });

    await expect(ctrl.snooze('user1', 15)).resolves.toEqual({ ok: true, minutes: 15 });

    expect(recordWakeSession).toHaveBeenCalledWith('user1', expect.objectContaining({
      alarm_id: 'A1',
      outcome: 'snoozed',
      snooze_count: 2,
      notes: expect.stringContaining('wake_session_id=wake-session-42'),
    }));
    expect(recordWakeSession.mock.calls[0][1].notes).toContain('snooze_count=2');
    expect(recordWakeSession.mock.calls[0][1].notes).toContain('minutes=15');
  });

  test('does not report recurring dismissal success when next scheduling fails', async () => {
    const { rescheduleAlarm } = require('../scheduler/alarmScheduler');
    const { stopAlarmAudio } = require('./audioPlayer');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    rescheduleAlarm.mockRejectedValueOnce(new Error('cannot arm next'));
    recordWakeSession.mockClear();
    stopAlarmAudio.mockClear();
    const ctrl = createAlarmController(baseAlarm({ recurrence: { mode: 'daily', time: '07:00' } }));

    await expect(ctrl.dismiss('user1')).resolves.toBe(false);

    expect(ctrl.getState()).toBe(WAKE_STATES.RINGING);
    expect(stopAlarmAudio).not.toHaveBeenCalled();
    expect(recordWakeSession).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('does not report one-time dismissal success when native disabling fails', async () => {
    const { rescheduleAlarm } = require('../scheduler/alarmScheduler');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    rescheduleAlarm.mockRejectedValueOnce(new Error('cannot clear native alarm'));
    const ctrl = createAlarmController(baseAlarm({ recurrence: { mode: 'once', time: '07:00' } }));

    await expect(ctrl.dismiss('user1')).resolves.toBe(false);
    expect(ctrl.getState()).toBe(WAKE_STATES.RINGING);
    warn.mockRestore();
  });

  test('force dismiss remains a successful crash escape when scheduling fails', async () => {
    const { rescheduleAlarm } = require('../scheduler/alarmScheduler');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    rescheduleAlarm.mockRejectedValueOnce(new Error('cannot arm after crash'));
    const ctrl = createAlarmController(baseAlarm({ recurrence: { mode: 'daily', time: '07:00' } }));

    await expect(ctrl.forceDismiss('user1', 'render_error')).resolves.toBe(true);
    expect(ctrl.getState()).toBe(WAKE_STATES.DISMISSED);
    warn.mockRestore();
  });
});
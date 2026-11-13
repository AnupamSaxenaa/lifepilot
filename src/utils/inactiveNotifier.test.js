/**
 * Tests for the inactivity reminder cadence.
 *
 * The bug being locked down: the notifier used to queue ten hourly reminders under
 * ten different ids, so an unattended phone collected all ten in the notification
 * shade at once. These assert the replacement contract — at most one reminder
 * exists, an undismissed one is never joined by another, and clearing one arms the
 * next after a fixed cooldown.
 */

const mockNotifee = {
  createChannel: jest.fn(async () => 'reminders'),
  createTriggerNotification: jest.fn(async () => {}),
  cancelNotification: jest.fn(async () => {}),
  getDisplayedNotifications: jest.fn(async () => []),
};

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: mockNotifee,
  AndroidImportance: { HIGH: 4 },
  TriggerType: { TIMESTAMP: 0 },
}));

const mockStorage = { get: jest.fn(async () => []) };
jest.mock('./storage', () => ({ Storage: mockStorage }));

// The module requires the app icon for largeIcon; jest has no asset transformer
// configured for this path in isolation.
jest.mock('../../assets/images/icon.png', () => 'icon.png', { virtual: true });

const HOUR = 60 * 60 * 1000;

// A task due today keeps the "anything to nag about?" guard satisfied.
const activeTask = () => ({
  id: 't1',
  title: 'Write the thing',
  completed: false,
  due_date: new Date().toISOString(),
});

describe('inactivity reminder cadence', () => {
  let notifier;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.get.mockResolvedValue([activeTask()]);
    mockNotifee.getDisplayedNotifications.mockResolvedValue([]);
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      notifier = require('./InactiveNotifier');
    });
    // Pin to 10:00 local so the default 1h delay never lands in quiet hours and
    // the tests do not depend on when they are run.
    const at10am = new Date();
    at10am.setHours(10, 0, 0, 0);
    jest.useFakeTimers().setSystemTime(at10am);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules exactly one reminder, not a batch', async () => {
    await notifier.scheduleInactiveReminder('user-1');
    expect(mockNotifee.createTriggerNotification).toHaveBeenCalledTimes(1);
  });

  it('uses a single stable id so a new reminder replaces rather than stacks', async () => {
    await notifier.scheduleInactiveReminder('user-1');
    const [notification] = mockNotifee.createTriggerNotification.mock.calls[0];
    expect(notification.id).toBe(notifier.REMINDER_ID);
    expect(notification.id).not.toMatch(/-\d+$/); // the old fan-out suffix
  });

  it('does not schedule anything while a reminder is still on screen', async () => {
    mockNotifee.getDisplayedNotifications.mockResolvedValue([
      { id: notifier.REMINDER_ID },
    ]);
    await notifier.scheduleInactiveReminder('user-1');
    expect(mockNotifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  it('is not blocked by an unrelated notification sitting in the shade', async () => {
    mockNotifee.getDisplayedNotifications.mockResolvedValue([
      { id: 'hustle-room-42' },
    ]);
    await notifier.scheduleInactiveReminder('user-1');
    expect(mockNotifee.createTriggerNotification).toHaveBeenCalledTimes(1);
  });

  it('waits the cooldown after a dismissal instead of firing again immediately', async () => {
    await notifier.handleReminderDismissed('user-1');
    const [, trigger] = mockNotifee.createTriggerNotification.mock.calls[0];
    const delay = trigger.timestamp - Date.now();
    // 3h cooldown, allowing for the quiet-hours shift rounding to the hour.
    expect(delay).toBeGreaterThan(2.5 * HOUR);
  });

  it('schedules sooner than the cooldown for a first reminder', async () => {
    await notifier.scheduleInactiveReminder('user-1');
    const [, trigger] = mockNotifee.createTriggerNotification.mock.calls[0];
    const delay = trigger.timestamp - Date.now();
    expect(delay).toBeLessThanOrEqual(HOUR);
  });

  it('never fires during quiet overnight hours', async () => {
    const at11pm = new Date();
    at11pm.setHours(23, 0, 0, 0);
    jest.setSystemTime(at11pm);

    await notifier.scheduleInactiveReminder('user-1');
    const [, trigger] = mockNotifee.createTriggerNotification.mock.calls[0];
    const hour = new Date(trigger.timestamp).getHours();
    // Quiet window is 22:00–07:00; the reminder must land outside it rather than
    // being silently dropped as the old `continue` did.
    expect(hour).toBeGreaterThanOrEqual(7);
    expect(hour).toBeLessThan(22);
  });

  it('stays silent when there is nothing due today', async () => {
    mockStorage.get.mockResolvedValue([
      { id: 't2', title: 'Someday', completed: false },
    ]);
    await notifier.scheduleInactiveReminder('user-1');
    expect(mockNotifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  it('clears the old fan-out ids so upgrades stop seeing stacked reminders', async () => {
    await notifier.cancelInactiveReminder();
    const cancelled = mockNotifee.cancelNotification.mock.calls.map(([id]) => id);
    expect(cancelled).toContain(notifier.REMINDER_ID);
    expect(cancelled).toContain(`${notifier.REMINDER_ID}-0`);
    expect(cancelled).toContain(`${notifier.REMINDER_ID}-9`);
  });

  it('identifies its own notifications and ignores others', () => {
    expect(notifier.isInactiveReminder({ id: notifier.REMINDER_ID })).toBe(true);
    expect(notifier.isInactiveReminder({ id: 'alarm-1' })).toBe(false);
    expect(notifier.isInactiveReminder(null)).toBe(false);
  });
});

import notifee, { AndroidImportance, TriggerType } from '@notifee/react-native';
import { Storage } from './storage';

// ─── Reminder cadence ─────────────────────────────────────────────────────
// There is exactly ONE reminder in flight at any moment, under one fixed id.
//
// This replaced a fan-out that queued up to 10 hourly reminders, each under its
// own id (`inactive-reminder-0`, `-1`, ...). That was deliberate — the old comment
// described it as making reminders "recurring", so dismissing one would not stop
// the rest — but Android keeps every notification until it is dismissed
// individually, so an unattended phone accumulated all ten side by side in the
// shade. Leaving the app alone for a day buried the tray in LifePilot rows.
//
// The cadence is now driven by the user rather than by a fixed queue: one reminder
// is posted, nothing further is scheduled while it sits there undismissed, and the
// next is armed only once they clear it. Someone ignoring the reminder sees a
// single row instead of a growing stack, and someone who clears it is still
// nudged again later.
export const REMINDER_ID = 'inactive-reminder';
const ONE_HOUR_MS = 60 * 60 * 1000;

// Delay before the first reminder once the app goes inactive.
const FIRST_REMINDER_DELAY_MS = ONE_HOUR_MS;

// Fixed wait after the user dismisses one before the next is allowed.
const REMINDER_COOLDOWN_MS = 3 * ONE_HOUR_MS;

// Ids used by earlier versions. Cleaned up on upgrade so reminders already queued
// by the old fan-out cannot keep firing alongside the new single reminder.
const LEGACY_MAX_REMINDERS = 10;

// Don't fire reminders during these hours (24h). Avoids waking users overnight.
const QUIET_START_HOUR = 22; // 10 PM
const QUIET_END_HOUR = 7;    // 7 AM

// ─── 50+ Motivational Messages ───────────────────────────
// Placeholders: {count} = remaining task count, {task} = first task title.
const MOTIVATIONAL_MESSAGES = [
  "You have {count} tasks left today, including '{task}'. Jump back in and crush them!",
  "Your goals don't take days off. '{task}' is waiting for you.",
  "Momentum is everything. {count} tasks left to conquer today.",
  "Don't let today slip away. Take 5 minutes to tackle '{task}'.",
  "You're closer than you think. Finish your {count} remaining tasks!",
  "Future you is begging you to start '{task}' right now.",
  "Small steps beat standing still. One task. Let's go.",
  "'{task}' won't finish itself. You've got this.",
  "{count} tasks between you and a clear mind. Knock them out.",
  "Discipline is choosing what you want most over what you want now. Back to it.",
  "Progress, not perfection. Open '{task}' and take the first step.",
  "The hardest part is starting. So just start '{task}'.",
  "Your streak is watching. Don't break it — finish '{task}'.",
  "5 focused minutes now beats an hour of guilt later.",
  "You still have {count} tasks today. Let's turn intention into action.",
  "Champions show up even when they don't feel like it. Show up.",
  "That feeling of a finished task? It's one tap away.",
  "Stop scrolling, start doing. '{task}' is calling.",
  "You promised yourself you'd do this. Keep the promise — '{task}'.",
  "{count} left. Pick the easiest one and build momentum.",
  "Done is better than perfect. Go finish '{task}'.",
  "Your best work is still ahead of you today. Get back in.",
  "Tiny wins compound. Start with '{task}'.",
  "Don't negotiate with the resistance. Just open the app and go.",
  "The clock's ticking on today. {count} tasks still standing.",
  "Be the person who finishes what they start. '{task}' awaits.",
  "One task at a time is how everything great gets built.",
  "You'll feel amazing once '{task}' is off your plate.",
  "A little effort now saves a lot of stress later.",
  "Refocus. Reset. Restart with '{task}'.",
  "Your goals miss you. {count} tasks are still open.",
  "Motion creates emotion. Start moving on '{task}'.",
  "The dip is temporary. Push through and finish '{task}'.",
  "You don't need motivation, you need to begin. Begin now.",
  "Every task you finish is a vote for the person you want to become.",
  "Close the distractions. Open '{task}'. Win the hour.",
  "{count} tasks to go. Make your future self proud.",
  "Consistency is your superpower. Don't skip today.",
  "The work is waiting — and so is the reward. '{task}'.",
  "Reclaim your day. One task. Right now.",
  "You've done hard things before. '{task}' is nothing.",
  "Turn 'later' into 'done'. Start with '{task}'.",
  "A focused you is an unstoppable you. Get back in.",
  "Don't let '{task}' roll over to tomorrow again.",
  "Your energy is best spent finishing, not worrying. Go.",
  "{count} tasks left — that's {count} chances to win today.",
  "Show your goals you mean it. Open '{task}'.",
  "The secret to getting ahead is getting started.",
  "Deep work beats busy work. Dive into '{task}'.",
  "You're one task away from momentum. Grab it.",
  "Quiet the noise. Do the work. '{task}' first.",
  "Make today count — {count} tasks are still on the board.",
  "Finish strong. '{task}' is the next domino to fall.",
  "Your comeback starts with a single task. This one.",
  "Less thinking, more doing. '{task}', now.",
  "Great days are built from finished tasks. Build yours.",
];

// Pick N distinct random messages (falls back to repeats if list is short)
const pickMessages = (n) => {
  const pool = [...MOTIVATIONAL_MESSAGES];
  const chosen = [];
  for (let i = 0; i < n; i++) {
    if (pool.length === 0) pool.push(...MOTIVATIONAL_MESSAGES);
    const idx = Math.floor(Math.random() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen;
};

// Determine whether a task counts as an active "Today" task
const isActiveTodayTask = (t) => {
  if (t.is_completed) return false;
  if (t.added_to_today) return true;

  const todayStr = new Date().toDateString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (t.due_date) {
    const d = new Date(t.due_date);
    if (d < todayStart || d.toDateString() === todayStr) return true;
  }
  if (t.reminder_time) {
    const r = new Date(t.reminder_time);
    if (r < todayStart || r.toDateString() === todayStr) return true;
  }
  return false;
};

// Is the given Date within quiet hours (overnight)?
const isQuietHour = (date) => {
  const h = date.getHours();
  if (QUIET_START_HOUR > QUIET_END_HOUR) {
    // Window spans midnight (e.g. 22:00 -> 07:00)
    return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
  }
  return h >= QUIET_START_HOUR && h < QUIET_END_HOUR;
};

/**
 * Push a timestamp out of quiet hours rather than dropping it.
 *
 * The old loop did `if (isQuietHour(fireAt)) continue;`, which was survivable when
 * ten reminders were queued and some could be skipped. With a single reminder,
 * skipping means the user simply never hears from us again, so an overnight slot
 * is moved to the start of the next allowed hour instead.
 */
const shiftOutOfQuietHours = (date) => {
  const shifted = new Date(date);
  let guard = 0;
  while (isQuietHour(shifted) && guard < 24) {
    shifted.setHours(shifted.getHours() + 1, 0, 0, 0);
    guard += 1;
  }
  return shifted;
};

/** True when one of our reminders is currently sitting in the notification shade. */
const hasReminderOnScreen = async () => {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    return (displayed || []).some((entry) => {
      const id = entry?.id ?? entry?.notification?.id;
      return id === REMINDER_ID;
    });
  } catch {
    // If this cannot be determined, fall through to scheduling. A single
    // duplicate is a much smaller problem than silently stopping reminders.
    return false;
  }
};

export const isInactiveReminder = (notification) => notification?.id === REMINDER_ID;

/**
 * Arm the next reminder.
 *
 * @param userId
 * @param delayMs how far ahead to fire. Defaults to the first-reminder delay;
 *        the dismissal handler passes the longer cooldown.
 */
export const scheduleInactiveReminder = async (userId, delayMs = FIRST_REMINDER_DELAY_MS) => {
  if (!userId) return;

  try {
    // Leave an undismissed reminder alone. Replacing it would re-alert for
    // something the user has already seen and chosen not to act on, and posting
    // alongside it is what used to fill the shade.
    if (await hasReminderOnScreen()) {
      console.log('[InactiveNotifier] A reminder is still on screen — not scheduling another');
      return;
    }

    // Always clear any previously queued reminders first
    await cancelInactiveReminder();

    // 1. Fetch local tasks and filter active "today" tasks
    const tasks = (await Storage.get(`tasks_${userId}`)) || [];
    const activeTodayTasks = tasks.filter(isActiveTodayTask);

    // Only nag the user if they actually have active tasks for today
    if (activeTodayTasks.length === 0) return;

    const count = activeTodayTasks.length;
    const firstTask = activeTodayTasks[0]?.title || 'your next task';

    // 2. Create Android channel
    const channelId = await notifee.createChannel({
      id: 'reminders',
      name: 'Reminders',
      importance: AndroidImportance.HIGH,
    });

    // 3. Schedule exactly one reminder, moved past quiet hours if needed.
    const fireAt = shiftOutOfQuietHours(new Date(Date.now() + delayMs));
    const body = pickMessages(1)[0]
      .replace('{count}', String(count))
      .replace('{task}', firstTask);

    await notifee.createTriggerNotification(
      {
        id: REMINDER_ID,
        title: 'Keep up the momentum! 🔥',
        body,
        android: {
          channelId,
          smallIcon: 'notification_icon',
          largeIcon: require('../../assets/images/icon.png'),
          pressAction: { id: 'default' },
          // Clear on tap, and never re-alert for a notification already on
          // screen — belt and braces alongside the hasReminderOnScreen() check.
          autoCancel: true,
          onlyAlertOnce: true,
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: fireAt.getTime(),
      },
    );

    console.log(`[InactiveNotifier] One reminder armed for ${fireAt.toLocaleString()} (task: ${firstTask})`);
  } catch (error) {
    console.error('[InactiveNotifier] Error scheduling reminder:', error);
  }
};

/**
 * Called when the user swipes a reminder away: wait the fixed cooldown, then arm
 * the next one. This is what keeps reminders recurring now that they are no longer
 * pre-queued in a batch.
 */
export const handleReminderDismissed = async (userId) => {
  if (!userId) return;
  console.log('[InactiveNotifier] Reminder dismissed — next one in 3h');
  await scheduleInactiveReminder(userId, REMINDER_COOLDOWN_MS);
};

export const cancelInactiveReminder = async () => {
  try {
    const ids = [REMINDER_ID];
    // Ids from the previous fan-out. Without this, a user upgrading still has up
    // to ten old reminders queued and would keep seeing them stack.
    for (let i = 0; i < LEGACY_MAX_REMINDERS; i++) {
      ids.push(`${REMINDER_ID}-${i}`);
    }

    await Promise.all(ids.map((id) => notifee.cancelNotification(id).catch(() => {})));
    console.log('[InactiveNotifier] Cancelled all inactive reminders');
  } catch (error) {
    console.error('[InactiveNotifier] Error cancelling reminders:', error);
  }
};

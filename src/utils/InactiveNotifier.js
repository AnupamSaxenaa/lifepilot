import notifee, { AndroidImportance, TriggerType } from '@notifee/react-native';
import { Storage } from './storage';

// Base id; individual reminders are suffixed (inactive-reminder-0, -1, ...)
const NOTIFICATION_ID_BASE = 'inactive-reminder';
const ONE_HOUR_MS = 60 * 60 * 1000;

// How many hourly reminders to queue up when the app goes to background.
// This is what makes the reminders "recurring" — dismissing one no longer
// stops the rest, because several future reminders are already scheduled.
const MAX_REMINDERS = 10;

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

export const scheduleInactiveReminder = async (userId) => {
  if (!userId) return;

  try {
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

    // 3. Schedule a series of hourly reminders so dismissing one doesn't
    //    stop the rest. Skip any that land in quiet overnight hours.
    const messages = pickMessages(MAX_REMINDERS);

    for (let i = 0; i < MAX_REMINDERS; i++) {
      const fireAt = new Date(Date.now() + ONE_HOUR_MS * (i + 1));
      if (isQuietHour(fireAt)) continue;

      const body = messages[i]
        .replace('{count}', String(count))
        .replace('{task}', firstTask);

      await notifee.createTriggerNotification(
        {
          id: `${NOTIFICATION_ID_BASE}-${i}`,
          title: 'Keep up the momentum! 🔥',
          body,
          android: {
            channelId,
            smallIcon: 'notification_icon',
            largeIcon: require('../../assets/images/icon.png'),
            pressAction: { id: 'default' },
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: fireAt.getTime(),
        },
      );
    }

    console.log(`[InactiveNotifier] Scheduled up to ${MAX_REMINDERS} hourly reminders (task: ${firstTask})`);
  } catch (error) {
    console.error('[InactiveNotifier] Error scheduling reminder:', error);
  }
};

export const cancelInactiveReminder = async () => {
  try {
    const ids = [];
    for (let i = 0; i < MAX_REMINDERS; i++) {
      ids.push(`${NOTIFICATION_ID_BASE}-${i}`);
    }
    // Also cancel the legacy single-id notification from older versions
    ids.push(NOTIFICATION_ID_BASE);

    await Promise.all(ids.map((id) => notifee.cancelNotification(id).catch(() => {})));
    console.log('[InactiveNotifier] Cancelled all inactive reminders');
  } catch (error) {
    console.error('[InactiveNotifier] Error cancelling reminders:', error);
  }
};

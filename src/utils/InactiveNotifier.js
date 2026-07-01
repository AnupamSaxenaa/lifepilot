import notifee, { TriggerType, AndroidImportance } from '@notifee/react-native';
import { Storage } from './storage';

const NOTIFICATION_ID = 'inactive-reminder';
// 1 hour in milliseconds
const ONE_HOUR_MS = 60 * 60 * 1000;

const MOTIVATIONAL_MESSAGES = [
  "You have {count} tasks left today, including '{task}'. Jump back in and crush them!",
  "Your goals don't take days off. '{task}' is waiting for you!",
  "Momentum is everything. You have {count} tasks left to conquer today.",
  "Don't let today slip away. Take 5 minutes to tackle '{task}'.",
  "You're closer to your goals than you think. Finish your {count} remaining tasks!"
];

export const scheduleInactiveReminder = async (userId) => {
  if (!userId) return;

  try {
    // 1. Fetch local tasks
    const tasks = await Storage.get(`tasks_${userId}`) || [];
    
    // 2. Filter active tasks for today
    const activeTodayTasks = tasks.filter(t => !t.is_completed && t.added_to_today);
    
    if (activeTodayTasks.length === 0) {
      // No active tasks today, don't nag the user
      return;
    }

    // 3. Prepare message
    const count = activeTodayTasks.length;
    const firstTask = activeTodayTasks[0]?.title || 'your next task';
    
    // Pick random template
    const template = MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)];
    const body = template
      .replace('{count}', count)
      .replace('{task}', firstTask);

    // Removed requestPermission as it forces the app back to foreground!

    // 5. Create Android channel
    const channelId = await notifee.createChannel({
      id: 'reminders',
      name: 'Reminders',
      importance: AndroidImportance.HIGH,
    });

    // 6. Schedule notification
    const trigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: Date.now() + ONE_HOUR_MS, 
    };

    await notifee.createTriggerNotification(
      {
        id: NOTIFICATION_ID,
        title: "Keep up the momentum! 🔥",
        body: body,
        android: {
          channelId,
          pressAction: {
            id: 'default',
          },
        },
      },
      trigger,
    );

    console.log('[InactiveNotifier] Scheduled 1-hour reminder for task:', firstTask);
  } catch (error) {
    console.error('[InactiveNotifier] Error scheduling reminder:', error);
  }
};

export const cancelInactiveReminder = async () => {
  try {
    await notifee.cancelNotification(NOTIFICATION_ID);
    console.log('[InactiveNotifier] Cancelled inactive reminder');
  } catch (error) {
    console.error('[InactiveNotifier] Error cancelling reminder:', error);
  }
};

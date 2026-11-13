import notifee, { AndroidImportance, TriggerType } from '@notifee/react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Notification utility — gracefully degrades in Expo Go.
 * 
 * expo-notifications crashes on module load in Expo Go (SDK 53+).
 * We detect the environment BEFORE requiring the module.
 * In Expo Go, all functions are safe no-ops.
 * In a dev build, full notification scheduling is enabled.
 */

const isExpoGo = Constants.executionEnvironment === 'storeClient';

let N = null;

if (!isExpoGo) {
  try {
    N = require('expo-notifications');
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch (err) {
    N = null;
  }
}

export const requestNotificationPermissions = async () => {
  try {
    const settings = await notifee.requestPermission();
    
    if (settings.authorizationStatus !== 1) return false;

    if (Platform.OS === 'android') {
      await notifee.createChannel({
        id: 'task-reminders-v2',
        name: 'Task Reminders',
        importance: AndroidImportance.HIGH,
        vibration: true,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ffffff',
        sound: 'custom_alert'
      });

      await notifee.createChannel({
        id: 'inactivity-nudge-v2',
        name: 'Smart Reminders',
        importance: AndroidImportance.HIGH,
        vibration: true,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#FFFFFF',
        sound: 'custom_alert'
      });
    }
    return true;
  } catch (err) {
    console.log('[Notifications] Perm Error:', err);
    return false;
  }
};

const reminderIdentifier = (taskId, metadata = {}) => {
  if (metadata?.userId == null) return `reminder_${taskId}`;
  const userPart = encodeURIComponent(String(metadata.userId));
  const taskPart = encodeURIComponent(String(taskId));
  const scopePart = metadata.spaceId == null
    ? 'personal'
    : `space:${encodeURIComponent(String(metadata.spaceId))}`;
  return `reminder_v2:${userPart}:${scopePart}:${taskPart}`;
};

/**
 * Schedule a local task reminder. The optional metadata keeps the original
 * three-argument signature working while allowing shared-task routing data.
 */
export const scheduleTaskReminder = async (taskId, title, reminderTime, metadata = {}) => {
  if (!N) return null;
  try {
    const triggerDate = new Date(reminderTime);
    if (Number.isNaN(triggerDate.getTime()) || triggerDate <= new Date()) return null;

    await cancelTaskReminder(taskId, metadata);

    const id = await N.scheduleNotificationAsync({
      content: {
        title: '🔔 Task Reminder',
        body: title,
        data: {
          taskId,
          userId: metadata?.userId ?? null,
          spaceId: metadata?.spaceId ?? null,
          assignedTo: metadata?.assignedTo ?? null,
          createdBy: metadata?.createdBy ?? null,
        },
        sound: true,
      },
      trigger: {
        type: 'date',
        date: triggerDate,
        channelId: Platform.OS === 'android' ? 'task-reminders-v2' : undefined,
      },
      identifier: reminderIdentifier(taskId, metadata),
    });
    return id;
  } catch (err) {
    return null;
  }
};

export const cancelTaskReminder = async (taskId, metadata = {}) => {
  if (!N) return;
  try {
    const identifiers = new Set([reminderIdentifier(taskId, metadata)]);
    // Metadata-aware reminders replaced legacy reminder_<taskId> entries.
    // Clearing both prevents duplicate or stale notifications after upgrades.
    if (metadata?.userId != null) identifiers.add(reminderIdentifier(taskId));
    await Promise.all(
      [...identifiers].map((identifier) => N.cancelScheduledNotificationAsync(identifier)),
    );
  } catch (err) {}
};

const sameUser = (left, right) => (
  left != null && right != null && String(left) === String(right)
);

export const rescheduleAllReminders = async (tasks, currentUserId) => {
  if (!N || !Array.isArray(tasks)) return;

  for (const task of tasks) {
    if (!task || task.id == null) continue;

    const spaceId = task.space_id ?? task.spaceId ?? null;
    const assignedTo = task.assigned_to ?? task.assignedTo ?? null;
    const createdBy = task.created_by ?? task.createdBy ?? null;
    const ownerId = task.owner_id ?? task.ownerId ?? task.user_id ?? task.userId ?? null;
    const shared = spaceId != null;
    const metadata = currentUserId == null
      ? undefined
      : { userId: currentUserId, spaceId, assignedTo, createdBy };

    const reminderDate = task.reminder_time ? new Date(task.reminder_time) : null;
    const activeReminder = reminderDate != null
      && !Number.isNaN(reminderDate.getTime())
      && reminderDate > new Date()
      && !task.is_completed
      && !task._deleted
      && !task.deleted_at;
    const eligibleSharedActor = !shared || (
      currentUserId != null
      && (
        sameUser(assignedTo, currentUserId)
        || (
          assignedTo == null
          && (sameUser(createdBy, currentUserId) || sameUser(ownerId, currentUserId))
        )
      )
    );

    if (activeReminder && eligibleSharedActor) {
      await scheduleTaskReminder(task.id, task.title, task.reminder_time, metadata);
    } else {
      await cancelTaskReminder(task.id, metadata);
    }
  }
};

const MOTIVATIONAL_MESSAGES = [
  "Time to lock in! 🚀 You have active tasks waiting for you.",
  "Your future self is watching. Make them proud today! ⚡",
  "Don't lose momentum! A quick 5-minute focus session changes everything. 🔥",
  "Small steps every hour build empires. What's your next move? 🎯",
  "LifePilot is waiting for your next check-off. Let's get it done! ✅",
  "Take a deep breath, open the app, and knock out one more task. 🧘‍♂️",
  "Consistency is the ultimate cheat code. Keep your streak alive! 💎",
  "You are 1 hour closer to your goals. Have you made progress? ⏳",
  "Even a 1% improvement today compounds massively. Let's work! 📈",
  "The hardest part is starting. Open LifePilot and just do 2 minutes. 🛠️",
  "Stay hard! Let's crush the remaining tasks on your dashboard today. 😤",
  "Aura is waiting to help you organize your thoughts. Talk to her! 🎙️",
  "Action cures fear and anxiety. Tap a task and get moving! 🏃‍♂️",
  "You've got this! Let's turn today's goals into reality. 🌟",
  "Don't let the day slip away. Review your priorities now. 🔍"
];

export const scheduleInactivityReminder = async (bodyText, delayHours = 1) => {
  try {
    // 1. Cancel any existing inactivity reminders
    await cancelInactivityReminder();
    
    // 2. Schedule 24 distinct hourly notifications to guarantee diversity and reliability
    // Notifee Timestamp Triggers are exact and survive app kills perfectly.
    const now = Date.now();
    const promises = [];
    
    for (let i = 1; i <= 24; i++) {
      const trigger = {
        type: TriggerType.TIMESTAMP,
        timestamp: now + (i * delayHours * 60 * 60 * 1000), 
        alarmManager: true, // Guarantees exact delivery even in Doze mode
      };
      
      const randomMsg = MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)];
      
      promises.push(
        notifee.createTriggerNotification({
          id: `lifepilot_inactivity_${i}`,
          title: '🚀 LifePilot Check-In',
          body: randomMsg,
          android: {
            channelId: 'inactivity-nudge-v2',
            smallIcon: 'notification_icon', // Matches the expo generated icon
            color: '#FFFFFF',
            pressAction: { id: 'default' },
          },
        }, trigger)
      );
    }
    
    await Promise.all(promises);
    console.log('[Notifications] Scheduled 24 dynamic hourly reminders via Notifee.');
    return true;
  } catch (err) {
    console.log('[Notifications] Failed to schedule inactivity reminder:', err);
    return null;
  }
};

export const cancelInactivityReminder = async () => {
  try {
    const ids = Array.from({length: 24}, (_, i) => `lifepilot_inactivity_${i + 1}`);
    await notifee.cancelTriggerNotifications(ids);
  } catch (err) {}
};


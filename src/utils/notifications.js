import Constants from 'expo-constants';
import { Platform } from 'react-native';
import notifee, { TriggerType, AndroidImportance } from '@notifee/react-native';

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
        lightColor: '#A78BFA',
        sound: 'custom_alert'
      });
    }
    return true;
  } catch (err) {
    console.log('[Notifications] Perm Error:', err);
    return false;
  }
};

export const scheduleTaskReminder = async (taskId, title, reminderTime) => {
  if (!N) return null;
  try {
    const triggerDate = new Date(reminderTime);
    if (triggerDate <= new Date()) return null;

    await cancelTaskReminder(taskId);

    const id = await N.scheduleNotificationAsync({
      content: {
        title: '🔔 Task Reminder',
        body: title,
        data: { taskId },
        sound: true,
      },
      trigger: {
        type: 'date',
        date: triggerDate,
        channelId: Platform.OS === 'android' ? 'task-reminders-v2' : undefined,
      },
      identifier: `reminder_${taskId}`,
    });
    return id;
  } catch (err) {
    return null;
  }
};

export const cancelTaskReminder = async (taskId) => {
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(`reminder_${taskId}`);
  } catch (err) {}
};

export const rescheduleAllReminders = async (tasks) => {
  if (!N || !tasks || !Array.isArray(tasks)) return;
  for (const task of tasks) {
    if (task.reminder_time && !task.is_completed) {
      await scheduleTaskReminder(task.id, task.title, task.reminder_time);
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
            color: '#A855F7',
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


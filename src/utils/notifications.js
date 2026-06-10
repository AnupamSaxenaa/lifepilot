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
  if (!N) return false;
  try {
    const { status: existingStatus } = await N.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await N.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return false;

    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('task-reminders', {
        name: 'Task Reminders',
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ffffff',
        sound: true,
      });
    }
    return true;
  } catch (err) {
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
        channelId: Platform.OS === 'android' ? 'task-reminders' : undefined,
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

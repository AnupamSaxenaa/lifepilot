import { Platform } from 'react-native';
import notifee, { AndroidCategory, AndroidImportance, TriggerType } from '@notifee/react-native';

export const initAlarmSystem = async () => {
  if (Platform.OS === 'android') {
    await notifee.createChannel({
      id: 'alarm-channel',
      name: 'Alarms',
      importance: AndroidImportance.HIGH,
      sound: 'default',
    });
  }
};

export const scheduleSnoozeAlarm = async (timestampMs) => {
  await initAlarmSystem();
  
  const trigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: timestampMs,
    alarmManager: { allowWhileIdle: true },
  };

  await notifee.createTriggerNotification(
    {
      title: 'Alarm Ringing',
      body: "Wake up and conquer your day.",
      android: {
        channelId: 'alarm-channel',
        category: AndroidCategory.ALARM,
        importance: AndroidImportance.HIGH,
        fullScreenAction: {
          id: 'default',
          mainComponent: 'AlarmScreen',
        },
        actions: [
          { title: 'Snooze 5m', pressAction: { id: 'snooze' } },
          { title: 'Dismiss', pressAction: { id: 'dismiss' } },
        ],
        lightUpScreen: true,
      },
      data: {
        sound_uri: 'default',
      }
    },
    trigger,
  );
};

export const cancelAllAlarms = async () => {
  await notifee.cancelAllNotifications();
};

export const syncAlarmsToNotifications = async (alarms) => {
  await initAlarmSystem();
  await cancelAllAlarms();
  
  if (!alarms || !alarms.length) return;

  for (const alarm of alarms) {
    if (!alarm.is_active) continue;

    const [hoursStr, minutesStr] = alarm.time.split(':');
    const hour = parseInt(hoursStr, 10);
    const minute = parseInt(minutesStr, 10);

    const hasSpecificDays = alarm.days_of_week && alarm.days_of_week.some(d => d);

    if (hasSpecificDays) {
      const jsDaysMap = [1, 2, 3, 4, 5, 6, 0]; 

      for (let i = 0; i < 7; i++) {
        if (alarm.days_of_week[i]) {
          const targetDay = jsDaysMap[i];
          
          for (let week = 0; week < 4; week++) {
            const triggerDate = new Date();
            triggerDate.setHours(hour, minute, 0, 0);
            
            let daysToWait = (targetDay - triggerDate.getDay() + 7) % 7;
            if (daysToWait === 0 && triggerDate <= new Date()) {
              daysToWait = 7;
            }
            triggerDate.setDate(triggerDate.getDate() + daysToWait + (week * 7));

            const trigger = {
              type: TriggerType.TIMESTAMP,
              timestamp: triggerDate.getTime(),
              alarmManager: { allowWhileIdle: true },
            };

            await notifee.createTriggerNotification(
              {
                title: alarm.title || "Alarm",
                body: "Wake up and conquer your day.",
                android: {
                  channelId: 'alarm-channel',
                  category: AndroidCategory.ALARM,
                  importance: AndroidImportance.HIGH,
                  fullScreenAction: {
                    id: 'default',
                    mainComponent: 'AlarmScreen',
                  },
                  actions: [
                    { title: 'Snooze 5m', pressAction: { id: 'snooze' } },
                    { title: 'Dismiss', pressAction: { id: 'dismiss' } },
                  ],
                  lightUpScreen: true,
                },
                data: {
                  sound_uri: alarm.sound_uri || 'default',
                }
              },
              trigger,
            );
          }
        }
      }
    } else {
      const now = new Date();
      let triggerDate = new Date();
      triggerDate.setHours(hour, minute, 0, 0);

      if (triggerDate <= now) {
        triggerDate.setDate(triggerDate.getDate() + 1);
      }

      const trigger = {
        type: TriggerType.TIMESTAMP,
        timestamp: triggerDate.getTime(),
        alarmManager: { allowWhileIdle: true },
      };

      await notifee.createTriggerNotification(
        {
          title: alarm.title || "Alarm",
          body: "Wake up and conquer your day.",
          android: {
            channelId: 'alarm-channel',
            category: AndroidCategory.ALARM,
            importance: AndroidImportance.HIGH,
            fullScreenAction: {
              id: 'default',
              mainComponent: 'AlarmScreen',
            },
            actions: [
              { title: 'Snooze 5m', pressAction: { id: 'snooze' } },
              { title: 'Dismiss', pressAction: { id: 'dismiss' } },
            ],
            lightUpScreen: true,
          },
          data: {
            sound_uri: alarm.sound_uri || 'default',
          }
        },
        trigger,
      );
    }
  }
};

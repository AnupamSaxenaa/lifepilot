/**
 * LifePilot — AlarmManager (back-compat shim)
 * ------------------------------------------------------------------
 * The alarm engine lives in `src/features/alarm/scheduler/*`. This module
 * retains only the live list-screen adapter so older imports continue to use
 * the recurrence-aware scheduler.
 */
import { rescheduleAll } from '../features/alarm/scheduler/alarmScheduler';

export {
    cancelAllAlarms,
    initAlarmChannel as initAlarmSystem
} from '../features/alarm/scheduler/alarmScheduler';

export const syncAlarmsToNotifications = async (alarms) => {
  await rescheduleAll(alarms, new Date());
};

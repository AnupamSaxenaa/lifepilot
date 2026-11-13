/**
 * LifePilot — Alarm Boot / Foreground Restore
 * ------------------------------------------------------------------
 * Notifee persists trigger notifications across reboot, but we run this as a
 * belt-and-suspenders safety net on every app launch/foreground:
 *   • Re-arms the LOOK_AHEAD window for all cached alarms (idempotent — same
 *     occurrences map to the same deterministic ids, so no duplicates).
 *   • Detects a device timezone change and reschedules so an alarm keeps
 *     firing at the intended local wall-clock time (Property 8).
 *
 * Reads only from the offline cache (`current_user_id`, `alarms_<uid>`) so it
 * never blocks on the network and obeys the offline-first rule.
 */
import { Storage } from '../../../utils/storage';
import { rescheduleAll } from './alarmScheduler';

const TZ_KEY = 'alarm_last_tz_offset';

const currentTzOffset = () => new Date().getTimezoneOffset();

/**
 * Re-arm all cached alarms. Safe to call repeatedly. Returns the number of
 * alarms considered (0 if none / not logged in).
 */
export const restoreAlarms = async () => {
  try {
    const userId = await Storage.get('current_user_id');
    if (!userId) return 0;

    const alarms = (await Storage.get(`alarms_${userId}`)) || [];

    // Note any timezone change (logged for diagnostics); rescheduling from
    // "now" below already re-anchors occurrences to the current local time.
    const prevTz = await Storage.get(TZ_KEY);
    const nowTz = currentTzOffset();
    if (prevTz == null || parseInt(prevTz, 10) !== nowTz) {
      await Storage.set(TZ_KEY, String(nowTz));
    }

    await rescheduleAll(alarms, new Date());
    return alarms.length;
  } catch (e) {
    console.warn('[BootRestore] restoreAlarms failed:', e?.message || e);
    return 0;
  }
};

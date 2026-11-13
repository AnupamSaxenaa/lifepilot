/**
 * LifePilot — Alarm Reliability Check
 * ------------------------------------------------------------------
 * Evaluates the OS conditions an alarm needs to fire dependably and returns a
 * structured status the UI turns into a "your alarms may not fire reliably"
 * banner with one-tap fixes. Never throws — unknown/unsupported checks report
 * `null` (unknown) rather than failing.
 *
 * Checks:
 *   • notifications authorized (POST_NOTIFICATIONS on Android 13+)
 *   • full-screen intent access (USE_FULL_SCREEN_INTENT, Android 14+ gated)
 *   • battery-optimization exemption (best-effort)
 *   • exact-alarm capability via a small Android AlarmManager bridge
 */
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { NativeModules, Platform } from 'react-native';

const { AlarmReliability } = NativeModules;

let Battery = null;
try {
  Battery = require('expo-battery');
} catch (_e) {
  Battery = null;
}

const LOW_BATTERY_THRESHOLD = 0.15; // 15%

export const reliabilityCheck = async () => {
  const result = {
    ok: true,
    notifications: null,
    fullScreenIntent: null,
    batteryOptimized: null, // true = optimized (BAD), false = exempt (GOOD)
    exactAlarm: null,
    lowBattery: null,       // true = below threshold and not charging
    issues: [],             // stable keys the UI localizes
  };

  if (Platform.OS !== 'android') return result;

  try {
    const settings = await notifee.getNotificationSettings();

    // Notifications authorized?
    result.notifications = settings.authorizationStatus === AuthorizationStatus.AUTHORIZED;
    if (result.notifications === false) result.issues.push('notifications_disabled');

    // Full-screen intent access (Android 14+ can revoke this).
    if (settings.android && typeof settings.android.canUseFullScreenIntent !== 'undefined') {
      result.fullScreenIntent = settings.android.canUseFullScreenIntent !== false;
      if (result.fullScreenIntent === false) result.issues.push('full_screen_intent_disabled');
    }
  } catch (e) {
    console.warn('[Reliability] notification settings check failed:', e?.message || e);
  }

  try {
    if (typeof AlarmReliability?.canScheduleExactAlarms === 'function') {
      result.exactAlarm = await AlarmReliability.canScheduleExactAlarms();
      if (result.exactAlarm === false) result.issues.push('exact_alarm_disabled');
    }
  } catch (e) {
    console.warn('[Reliability] exact alarm check failed:', e?.message || e);
  }

  try {
    if (typeof notifee.isBatteryOptimizationEnabled === 'function') {
      const optimized = await notifee.isBatteryOptimizationEnabled();
      result.batteryOptimized = optimized;
      if (optimized === true) result.issues.push('battery_optimized');
    }
  } catch (e) {
    console.warn('[Reliability] battery optimization check failed:', e?.message || e);
  }

  try {
    if (Battery) {
      const level = await Battery.getBatteryLevelAsync(); // 0..1, or -1 if unknown
      const state = await Battery.getBatteryStateAsync(); // enum incl. CHARGING
      const charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
      if (level >= 0 && level < LOW_BATTERY_THRESHOLD && !charging) {
        result.lowBattery = true;
        result.issues.push('low_battery');
      } else {
        result.lowBattery = false;
      }
    }
  } catch (e) {
    console.warn('[Reliability] battery level check failed:', e?.message || e);
  }

  result.ok = result.issues.length === 0;
  return result;
};

/**
 * Best-effort actions to help the user fix issues. The UI wires buttons to
 * these; each is wrapped so a failure never crashes the caller.
 */
export const openExactAlarmSettings = async () => {
  try {
    if (typeof AlarmReliability?.openExactAlarmSettings === 'function') {
      await AlarmReliability.openExactAlarmSettings();
    }
  } catch (e) {
    console.warn('[Reliability] openExactAlarmSettings failed:', e?.message || e);
  }
};

export const openFullScreenIntentSettings = async () => {
  try {
    if (typeof notifee.openFullScreenIntentSettings === 'function') {
      await notifee.openFullScreenIntentSettings();
    }
  } catch (e) {
    console.warn('[Reliability] openFullScreenIntentSettings failed:', e?.message || e);
  }
};

export const requestBatteryExemption = async () => {
  try {
    if (typeof notifee.openBatteryOptimizationSettings === 'function') {
      await notifee.openBatteryOptimizationSettings();
    }
  } catch (e) {
    console.warn('[Reliability] requestBatteryExemption failed:', e?.message || e);
  }
};

export const requestNotificationPermission = async () => {
  try {
    await notifee.requestPermission();
  } catch (e) {
    console.warn('[Reliability] requestNotificationPermission failed:', e?.message || e);
  }
};

/**
 * Opens Android's "Do Not Disturb access" settings screen so the user can
 * grant this app permission to bypass DND for alarm-category notifications
 * (Req 7.3). Degrades gracefully (no-op) if IntentLauncher is unavailable.
 */
export const openDndAccessSettings = async () => {
  if (Platform.OS !== 'android') return;
  try {
    const IntentLauncher = require('expo-intent-launcher');
    await IntentLauncher.startActivityAsync('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS');
  } catch (e) {
    console.warn('[Reliability] openDndAccessSettings failed:', e?.message || e);
  }
};

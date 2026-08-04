/**
 * LifePilot — Alarm Scheduler (Notifee wrapper; native side effects)
 * ------------------------------------------------------------------
 * Turns an alarm's recurrence rule into concrete Android exact-alarm trigger
 * notifications. The OS (Notifee + AlarmManager) owns the clock — JS only
 * computes WHEN and renders the ring screen once woken.
 *
 * Each armed occurrence is a Notifee trigger notification whose id is
 * DETERMINISTIC: `alarm_<alarmId>_<occurrenceEpochMs>`. This makes arming
 * idempotent (Property 2): re-running never creates duplicates because the same
 * occurrence maps to the same id, and Notifee replaces same-id notifications.
 *
 * We arm a small LOOK_AHEAD window of upcoming occurrences so recurring alarms
 * keep firing without the app being reopened; `bootRestore` + the ring
 * controller top the window back up (Property 3: never runs dry).
 */
import notifee, { AndroidCategory, AndroidImportance, TriggerType } from '@notifee/react-native';
import * as Application from 'expo-application';
import { NativeModules, Platform } from 'react-native';
import { normalizeAlarm } from '../data/alarmModel';
import { selectConfiguredSound } from '../soundLibrary';
import { nextOccurrences } from './recurrenceEngine';

// Android notification channels are immutable after first creation. v3 is a
// deliberate migration from v2 so devices that previously created a muted or
// downgraded alarm channel receive a fresh high-importance alarm channel.
const CHANNEL_ID = 'alarm-channel-v3';
const AMBIENT_CHANNEL_ID = 'alarm-ambient-channel';
const RECOVERY_CHANNEL_ID = 'alarm-recovery-channel';
const ID_PREFIX = 'alarm_';
const AMBIENT_SUFFIX = '_ambient';
const LOOK_AHEAD = 3; // occurrences armed ahead for recurring alarms

const ALARM_ACTIVITY = NativeModules?.AlarmReliability?.alarmActivityName;
// Older production APKs predate AlarmActivity/AlarmReliability. Their existing
// MainActivity is still a valid full-screen target; App.js consumes Notifee's
// initial notification and mounts the ring overlay after that activity wakes.
const MAIN_ACTIVITY = Application.applicationId
  ? `${Application.applicationId}.MainActivity`
  : undefined;
const alarmLaunchAction = () => ({
  id: 'default',
  mainComponent: 'AlarmScreen',
  ...((ALARM_ACTIVITY || MAIN_ACTIVITY) ? { launchActivity: ALARM_ACTIVITY || MAIN_ACTIVITY } : {}),
});

const BACKUP_SUFFIX = '_backup';
const BACKUP_DELAY_MIN = 5; // fires this many minutes after the primary if unresolved

const occurrenceId = (alarmId, epochMs) => `${ID_PREFIX}${alarmId}_${epochMs}`;
const ambientId = (alarmId, epochMs) => `${ID_PREFIX}${alarmId}_${epochMs}${AMBIENT_SUFFIX}`;
const backupId = (alarmId, epochMs) => `${ID_PREFIX}${alarmId}_${epochMs}${BACKUP_SUFFIX}`;
const recoveryId = (alarmId, wakeSessionId) => `alarm_recovery_${alarmId}_${wakeSessionId}`;
const isAlarmTriggerId = (id, alarmId) => typeof id === 'string' && id.startsWith(`${ID_PREFIX}${alarmId}_`);

/**
 * Effective "lead time" in minutes before the alarm during which a gentle
 * ambient pre-wake experience should run. Smart-wake and ambient both express
 * this concept; smart-wake's window takes precedence when both are enabled
 * since it implies "wake gently starting at (time - windowMin), guaranteed
 * full alarm by `time`" (Req 8) — which the ambient screen also satisfies.
 */
const effectiveLeadMinutes = (alarm) => {
  if (alarm.smart_wake && alarm.smart_wake.enabled && alarm.smart_wake.windowMin > 0) {
    return alarm.smart_wake.windowMin;
  }
  if (alarm.ambient && alarm.ambient.enabled && alarm.ambient.leadMin > 0) {
    return alarm.ambient.leadMin;
  }
  return 0;
};

export const initAlarmChannel = async () => {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Alarms',
    importance: AndroidImportance.HIGH,
    // Bundled android/app/src/main/res/raw/custom_alert.* provides an audible
    // killed-app fallback until the ring screen starts the configured audio.
    sound: 'custom_alert',
    vibration: true,
    // Honored only after the user grants notification-policy access. Keeping
    // it on the alarm channel lets granted DND access actually take effect.
    bypassDnd: true,
  });
  // Ambient pre-wake uses a SEPARATE, lower-importance channel — it opens the
  // full-screen ambient experience without the urgent alarm sound/vibration,
  // which stays reserved for the real alarm channel above.
  await notifee.createChannel({
    id: AMBIENT_CHANNEL_ID,
    name: 'Alarm Pre-Wake',
    importance: AndroidImportance.HIGH,
    vibration: false,
  });
  await notifee.createChannel({
    id: RECOVERY_CHANNEL_ID,
    name: 'Missed Alarms',
    importance: AndroidImportance.DEFAULT,
    vibration: true,
  });
};

/** Notify the user after an unresolved ring/snooze session is recovered. */
export const showMissedAlarmRecovery = async (alarm, session, copy = {}) => {
  if (Platform.OS !== 'android' || !alarm?.id || typeof notifee.displayNotification !== 'function') return;
  await initAlarmChannel();
  const wakeSessionId = String(session?.wakeSessionId || session?.occurrenceEpoch || Date.now());
  await notifee.displayNotification({
    id: recoveryId(alarm.id, wakeSessionId),
    title: copy.title || 'Missed alarm',
    body: copy.body || 'This alarm may have been interrupted. Tap to review it.',
    data: {
      alarmId: String(alarm.id),
      wakeSessionId,
      recovery: 'true',
    },
    android: {
      channelId: RECOVERY_CHANNEL_ID,
      pressAction: { id: 'default' },
      autoCancel: true,
    },
  });
};

// Build the Notifee notification payload for a single occurrence.
const buildNotification = (alarm, occ, session = {}) => {
  const epochMs = occ.getTime();
  const mission = Array.isArray(alarm.mission) ? alarm.mission : [];
  const wakeSessionId = session.wakeSessionId || `${alarm.id}_${session.sourceOccurrenceEpoch || epochMs}`;
  const occurrenceSoundUri = selectConfiguredSound(
    alarm.sound_config || { uri: alarm.sound_uri },
    `${alarm.id}:${session.sourceOccurrenceEpoch || epochMs}`,
  );
  return {
    id: occurrenceId(alarm.id, epochMs),
    title: alarm.title || 'Alarm',
    body: alarm.description || 'Wake up and conquer your day.',
    android: {
      channelId: CHANNEL_ID,
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      fullScreenAction: alarmLaunchAction(),
      pressAction: alarmLaunchAction(),
      // Dismiss/Snooze notification actions intentionally stay off the locked
      // notification. They could bypass mission and emergency gates before JS
      // reconstructs the wake session; the immersive screen owns both actions.
      lightUpScreen: true,
      autoCancel: false,
      ongoing: true,
      // Keep the OS fallback tone looping until AlarmScreen/controller takes
      // ownership and cancels the notification on dismiss or snooze.
      loopSound: true,
    },
    // Notifee requires string data values.
    data: {
      alarmId: String(alarm.id),
      userId: String(alarm.user_id || ''),
      occurrenceEpoch: String(session.sourceOccurrenceEpoch || epochMs),
      wakeSessionId: String(wakeSessionId),
      sessionStartedAt: String(session.sessionStartedAt || epochMs),
      snoozeCount: String(session.snoozeCount || 0),
      lastSnoozeMinutes: String(session.lastSnoozeMinutes || 0),
      recurrence: JSON.stringify(alarm.recurrence || {}),
      label: JSON.stringify(alarm.label || null),
      visualConfig: JSON.stringify(alarm.visual_config || {}),
      soundUri: String(occurrenceSoundUri || 'default'),
      volume: String((alarm.sound_config && alarm.sound_config.volume) ?? 100),
      fadeInMs: String((alarm.sound_config && alarm.sound_config.fadeInMs) ?? 0),
      vibrationPattern: String(alarm.vibration_pattern || (alarm.vibrate === false ? 'none' : 'strong')),
      emergency: String(!!(alarm.flags && alarm.flags.emergency)),
      mission: JSON.stringify(mission),
      snoozeConfig: JSON.stringify(alarm.snooze_config || {}),
    },
  };
};

const createTrigger = (epochMs) => ({
  type: TriggerType.TIMESTAMP,
  timestamp: epochMs,
  alarmManager: { allowWhileIdle: true },
});

// Ambient pre-wake notification — opens AlarmScreen in "ambient" mode via a
// data flag; the ring screen checks this flag to render the gentle pre-wake
// experience instead of the full ring immediately.
const buildAmbientNotification = (alarm, occ, leadMinutes) => {
  const epochMs = occ.getTime();
  const occurrenceSoundUri = selectConfiguredSound(
    alarm.sound_config || { uri: alarm.sound_uri },
    `${alarm.id}:${epochMs}`,
  );
  return {
    id: ambientId(alarm.id, epochMs),
    title: alarm.title || 'Alarm',
    body: 'Waking gently…',
    android: {
      channelId: AMBIENT_CHANNEL_ID,
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      fullScreenAction: alarmLaunchAction(),
      pressAction: alarmLaunchAction(),
      lightUpScreen: true,
      autoCancel: false,
    },
    data: {
      alarmId: String(alarm.id),
      userId: String(alarm.user_id || ''),
      occurrenceEpoch: String(epochMs),
      ambient: 'true',
      leadMin: String(leadMinutes),
      recurrence: JSON.stringify(alarm.recurrence || {}),
      label: JSON.stringify(alarm.label || null),
      visualConfig: JSON.stringify(alarm.visual_config || {}),
      soundUri: String(occurrenceSoundUri || 'default'),
      volume: String((alarm.sound_config && alarm.sound_config.volume) ?? 100),
      fadeInMs: String((alarm.sound_config && alarm.sound_config.fadeInMs) ?? 0),
      vibrationPattern: String(alarm.vibration_pattern || (alarm.vibrate === false ? 'none' : 'strong')),
      emergency: String(!!(alarm.flags && alarm.flags.emergency)),
      mission: JSON.stringify(Array.isArray(alarm.mission) ? alarm.mission : []),
      snoozeConfig: JSON.stringify(alarm.snooze_config || {}),
    },
  };
};

// Cancel every armed/displayed notification belonging to a specific alarm.
export const cancelAlarm = async (alarmId) => {
  if (Platform.OS !== 'android' || !alarmId) return;
  try {
    const ids = await notifee.getTriggerNotificationIds();
    const mine = (ids || []).filter((id) => isAlarmTriggerId(id, alarmId));
    if (mine.length) await notifee.cancelTriggerNotifications(mine);

    if (typeof notifee.getDisplayedNotifications === 'function') {
      const displayed = await notifee.getDisplayedNotifications();
      const displayedIds = (displayed || [])
        .map((item) => item?.notification?.id)
        .filter((id) => isAlarmTriggerId(id, alarmId));
      await Promise.all(displayedIds.map((id) => notifee.cancelNotification(id)));
    }
  } catch (e) {
    console.warn('[AlarmScheduler] cancelAlarm failed:', e?.message || e);
  }
};

/** Cancel the notification that opened the current full-screen alarm. */
export const cancelCurrentNotification = async (notificationId) => {
  if (!notificationId || typeof notifee.cancelNotification !== 'function') return;
  try { await notifee.cancelNotification(notificationId); } catch (_e) {}
};

/** Primary ring handoff removes its separately-displayed ambient notification. */
export const cancelAmbientNotification = async (alarmId, occurrenceEpoch) => {
  if (!alarmId || !occurrenceEpoch || typeof notifee.cancelNotification !== 'function') return;
  try { await notifee.cancelNotification(ambientId(alarmId, occurrenceEpoch)); } catch (_e) {}
};

/** Remove the primary trigger/display when the ambient screen claims the ring. */
export const claimPrimaryOccurrence = async (alarmId, occurrenceEpoch) => {
  if (!alarmId || !occurrenceEpoch) return;
  const id = occurrenceId(alarmId, occurrenceEpoch);
  try { await notifee.cancelTriggerNotification?.(id); } catch (_e) {}
  try { await notifee.cancelNotification?.(id); } catch (_e) {}
};

/** Cancel only this occurrence's ambient/backup companions, preserving look-ahead. */
export const cancelOccurrenceCompanions = async (alarmId, occurrenceEpoch) => {
  if (!alarmId || !occurrenceEpoch) return;
  const ids = [ambientId(alarmId, occurrenceEpoch), backupId(alarmId, occurrenceEpoch)];
  try { await notifee.cancelTriggerNotifications(ids); } catch (_e) {}
  await Promise.all(ids.map((id) => notifee.cancelNotification?.(id).catch(() => {})));
};

/**
 * Cancel this alarm's existing triggers and arm the next LOOK_AHEAD
 * occurrences. Idempotent: same occurrences => same deterministic ids.
 * Skips inactive/archived alarms (and cancels any leftover triggers).
 */
export const rescheduleAlarm = async (rawAlarm, fromDate = new Date()) => {
  if (Platform.OS !== 'android' || !rawAlarm || !rawAlarm.id) return;
  const alarm = normalizeAlarm(rawAlarm);

  await initAlarmChannel();
  await cancelAlarm(alarm.id);

  const inactive = alarm.is_active === false || (alarm.flags && alarm.flags.archived);
  if (inactive) return;

  const count = alarm.recurrence.mode === 'once' ? 1 : LOOK_AHEAD;
  const occurrences = nextOccurrences(alarm.recurrence, fromDate, count);
  const leadMinutes = effectiveLeadMinutes(alarm);

  for (const occ of occurrences) {
    // A missing primary occurrence makes the alarm unreliable. Let the
    // rejection reach the caller so it cannot be reported as armed.
    await notifee.createTriggerNotification(buildNotification(alarm, occ), createTrigger(occ.getTime()));

    // Arm a backup trigger a few minutes after the primary (Req 17.2) when
    // requested — a second full alarm firing as a safety net.
    if (alarm.flags && alarm.flags.backupAlarm) {
      const backupEpoch = occ.getTime() + BACKUP_DELAY_MIN * 60 * 1000;
      try {
        const backupNotif = buildNotification(alarm, new Date(backupEpoch));
        backupNotif.id = backupId(alarm.id, occ.getTime());
        backupNotif.title = `${alarm.title || 'Alarm'} (backup)`;
        await notifee.createTriggerNotification(backupNotif, createTrigger(backupEpoch));
      } catch (e) {
        console.warn('[AlarmScheduler] failed to arm backup occurrence:', e?.message || e);
      }
    }

    // Arm the ambient pre-wake trigger, if configured, `leadMinutes` earlier.
    if (leadMinutes > 0) {
      const ambientEpoch = occ.getTime() - leadMinutes * 60 * 1000;
      // Only arm if it's still in the future (e.g. not for an occurrence
      // that's less than `leadMinutes` away right now).
      if (ambientEpoch > Date.now()) {
        try {
          await notifee.createTriggerNotification(
            buildAmbientNotification(alarm, occ, leadMinutes),
            createTrigger(ambientEpoch),
          );
        } catch (e) {
          console.warn('[AlarmScheduler] failed to arm ambient pre-wake:', e?.message || e);
        }
      }
    }
  }
};

// Reschedule every alarm (used by bootRestore, settings changes, tz changes).
export const rescheduleAll = async (alarms, fromDate = new Date()) => {
  if (Platform.OS !== 'android' || !Array.isArray(alarms)) return;
  for (const a of alarms) {
    await rescheduleAlarm(a, fromDate);
  }
};

/**
 * Arm a one-off snooze occurrence `minutes` from now, reusing the alarm's
 * sound/mission/vibration payload so the re-fire behaves like the original.
 */
export const scheduleSnooze = async (rawAlarm, minutes, session = {}) => {
  if (Platform.OS !== 'android' || !rawAlarm) return;
  const alarm = normalizeAlarm(rawAlarm);
  await initAlarmChannel();
  const when = Date.now() + Math.max(1, minutes) * 60 * 1000;
  const notif = buildNotification(alarm, new Date(when), session);
  // Distinct id so it doesn't collide with a regular occurrence id.
  notif.id = `${ID_PREFIX}${alarm.id}_snooze_${when}`;
  // Scheduling a snooze is a required operation. Callers must receive a
  // rejection so they can keep the current alarm ringing instead of falsely
  // transitioning to a snoozed state.
  await notifee.createTriggerNotification(notif, createTrigger(when));
};

export const cancelAllAlarms = async () => {
  if (Platform.OS !== 'android') return;
  try {
    const ids = await notifee.getTriggerNotificationIds();
    const mine = (ids || []).filter((id) => typeof id === 'string' && id.startsWith(ID_PREFIX));
    if (mine.length) await notifee.cancelTriggerNotifications(mine);
  } catch (e) {
    console.warn('[AlarmScheduler] cancelAllAlarms failed:', e?.message || e);
  }
};

// Exposed for tests / bootRestore diffing.
export const _internals = {
  occurrenceId,
  isAlarmTriggerId,
  buildNotification,
  buildAmbientNotification,
  createTrigger,
  LOOK_AHEAD,
  ID_PREFIX,
};

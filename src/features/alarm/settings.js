/**
 * LifePilot — Alarm Global Settings, Backup & Restore
 * ------------------------------------------------------------------
 * Global defaults applied to newly-created alarms (per-alarm settings always
 * override these), plus export/import/backup/restore/reset for the user's
 * full alarm configuration. Everything is offline-first: reads/writes go
 * through `Storage` / `dataManager`, never Supabase directly.
 */
import { cacheAlarms } from '../../lib/dataManager';
import { Storage } from '../../utils/storage';
import { DEFAULT_SNOOZE_CONFIG, DEFAULT_SOUND_CONFIG } from './data/alarmModel';

const defaultsKey = (userId) => `alarm_defaults_${userId}`;

export const DEFAULT_GLOBAL_ALARM_SETTINGS = {
  vibration_pattern: 'strong',
  sound_config: { ...DEFAULT_SOUND_CONFIG },
  snooze_config: { ...DEFAULT_SNOOZE_CONFIG },
  category: null,
};

/** Load the user's global alarm defaults (falls back to the built-in defaults). */
export const loadAlarmDefaults = async (userId) => {
  if (!userId) return { ...DEFAULT_GLOBAL_ALARM_SETTINGS };
  const stored = await Storage.get(defaultsKey(userId));
  return stored ? { ...DEFAULT_GLOBAL_ALARM_SETTINGS, ...stored } : { ...DEFAULT_GLOBAL_ALARM_SETTINGS };
};

/** Persist updated global alarm defaults (merged with existing). */
export const saveAlarmDefaults = async (userId, patch) => {
  if (!userId) return;
  const current = await loadAlarmDefaults(userId);
  const next = { ...current, ...patch };
  await Storage.set(defaultsKey(userId), next);
  return next;
};

export const resetAlarmDefaults = async (userId) => {
  if (!userId) return;
  await Storage.set(defaultsKey(userId), { ...DEFAULT_GLOBAL_ALARM_SETTINGS });
};

/**
 * Export the user's full alarm configuration (alarms + defaults) as a plain
 * JSON-serializable object, suitable for `Share.share` or writing to a file.
 */
export const exportAlarmConfig = async (userId, alarms) => {
  const defaults = await loadAlarmDefaults(userId);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    defaults,
    alarms: (alarms || []).map((a) => ({ ...a, id: undefined, user_id: undefined })),
  };
};

/**
 * Import a previously-exported config. Alarms are added as NEW alarms (never
 * overwrite existing ones) via the provided `addAlarmFn` (typically
 * `dataManager.addAlarm`) so legacy/rich-field splitting stays consistent with
 * the rest of the app. Returns the updated alarms array.
 */
export const importAlarmConfig = async (userId, currentAlarms, config, addAlarmFn) => {
  if (!userId || !config || !Array.isArray(config.alarms)) return currentAlarms;

  if (config.defaults) {
    await saveAlarmDefaults(userId, config.defaults);
  }

  let updated = currentAlarms;
  for (const alarm of config.alarms) {
    const legacyFields = {
      time: alarm.time,
      title: alarm.title || null,
      days_of_week: alarm.days_of_week,
      vibrate: alarm.vibrate ?? true,
      sound_uri: alarm.sound_uri || 'default',
      sound_name: alarm.sound_name || null,
      sound: true,
      is_active: alarm.is_active ?? true,
    };
    const prevIds = new Set(updated.map((a) => a.id));
    updated = await addAlarmFn(userId, updated, legacyFields);
    const added = updated.find((a) => !prevIds.has(a.id));
    if (added) {
      const richLocal = {
        recurrence: alarm.recurrence,
        vibration_pattern: alarm.vibration_pattern,
        sound_config: alarm.sound_config,
        label: alarm.label,
        snooze_config: alarm.snooze_config,
        category: alarm.category,
        description: alarm.description,
        mission: alarm.mission,
        smart_wake: alarm.smart_wake,
        ambient: alarm.ambient,
        flags: alarm.flags,
        group_id: alarm.group_id,
      };
      updated = updated.map((a) => (a.id === added.id ? { ...a, ...richLocal } : a));
    }
  }
  await cacheAlarms(userId, updated);
  return updated;
};

/** Reset ALL alarm data for the user: clears defaults; caller clears alarms via deleteAlarm loop or a fresh cacheAlarms([]). */
export const resetAllAlarmData = async (userId) => {
  if (!userId) return;
  await Promise.all([
    resetAlarmDefaults(userId),
    cacheAlarms(userId, []),
    Storage.remove(`alarm_history_${userId}`),
    Storage.remove(`alarm_stats_${userId}`),
    Storage.remove(`alarm_qr_codes_${userId}`),
    Storage.remove(`alarm_nfc_tags_${userId}`),
  ]);
};

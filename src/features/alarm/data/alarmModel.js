/**
 * LifePilot — Alarm Model
 * ------------------------------------------------------------------
 * Pure helpers for normalizing, defaulting, and validating alarm objects, and
 * for keeping the LEGACY `days_of_week` array (boolean[7], Mon..Sun) in sync
 * with the new structured `recurrence` rule.
 *
 * This module has NO side effects and NO native/Supabase imports so it stays
 * unit-testable and OTA-safe. Screens use it to shape data before handing it
 * to `dataManager` (which owns persistence + sync).
 *
 * Recurrence rule shape (also stored on the alarm as `recurrence`):
 *   {
 *     mode: 'once'|'daily'|'weekdays'|'weekends'|'weekly'|'everyNDays'
 *           |'monthly'|'yearly'|'nthWeekday'|'lastWeekday'|'odd'|'even',
 *     time: 'HH:mm',
 *     daysOfWeek?: boolean[7],   // weekly (Mon..Sun)
 *     interval?: number,         // everyNDays / weekly interval
 *     dayOfMonth?: number,       // monthly
 *     month?: number, day?: number, // yearly (month 1-12, day 1-31)
 *     nth?: 1|2|3|4|5, weekday?: 0-6, // nthWeekday (weekday: 0=Mon..6=Sun)
 *     skipDates?: string[],      // ISO 'YYYY-MM-DD' dates to skip
 *     pausedUntil?: string|null, // ISO date; occurrences before this are suppressed
 *   }
 */

// ── Constants ────────────────────────────────────────────────────────────
export const RECURRENCE_MODES = [
  'once', 'daily', 'weekdays', 'weekends', 'weekly', 'everyNDays',
  'monthly', 'yearly', 'nthWeekday', 'lastWeekday', 'odd', 'even',
];

export const VIBRATION_PATTERNS = ['none', 'strong', 'soft', 'heartbeat', 'pulse', 'wave'];

// i18n keys are resolved by the UI layer; these are stable identifiers only.
export const ALARM_CATEGORIES = [
  'morning', 'afternoon', 'evening', 'night', 'medication', 'habit',
  'workout', 'study', 'travel', 'meeting', 'custom',
];

export const PRESET_LABELS = [
  'workout', 'college', 'medicine', 'meeting', 'study',
  'prayer', 'sleep', 'reading', 'gym', 'exam',
];

export const DEFAULT_SNOOZE_CONFIG = {
  presets: [5, 10, 15, 20, 30, 45, 60],
  defaultMin: 5,
  maxCount: 3,
  progressive: false,
  disabled: false,
};

export const DEFAULT_SOUND_CONFIG = {
  uri: 'default',
  name: null,
  volume: 100,      // 0-100
  fadeInMs: 0,      // 0 = no fade
  rotateSet: null,  // optional array of sound ids/uris
  rotateMode: 'fixed', // fixed | random | rotate
  rotationIndex: 0,
  favorite: false,
};

export const DEFAULT_SMART_WAKE_CONFIG = { enabled: false, windowMin: 30 };

export const DEFAULT_FLAGS = {
  favorite: false,
  archived: false,
  emergency: false,
  backupAlarm: false,
};

export const CLOCK_STYLES = ['minimal', 'material', 'glass'];
export const BACKGROUND_MODES = ['dark', 'light', 'dynamic'];
export const VISUAL_PALETTES = ['standard', 'deuteranopia', 'tritanopia', 'highContrast'];

export const DEFAULT_VISUAL_CONFIG = {
  clockStyle: 'minimal',
  backgroundMode: 'dark',
  palette: 'standard',
};

const NO_DAYS = [false, false, false, false, false, false, false];

// ── Time helpers ─────────────────────────────────────────────────────────
export const isValidTimeStr = (time) =>
  typeof time === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(time);

const clampInt = (n, min, max, fallback) => {
  const v = parseInt(n, 10);
  if (Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, v));
};

// ── Legacy <-> recurrence bridging ──────────────────────────────────────
/**
 * Build a recurrence rule from a legacy alarm that only has `days_of_week`.
 * No days selected → 'once' (mirrors the legacy single-shot behavior).
 */
export const deriveRecurrenceFromLegacy = (time, daysOfWeek) => {
  const days = Array.isArray(daysOfWeek) && daysOfWeek.length === 7 ? daysOfWeek : NO_DAYS;
  const anyDay = days.some(Boolean);
  if (!anyDay) return { mode: 'once', time };
  return { mode: 'weekly', time, daysOfWeek: [...days], interval: 1 };
};

/**
 * Derive the legacy `days_of_week` boolean[7] (Mon..Sun) from a recurrence
 * rule, so old code paths / the legacy scheduler keep working.
 */
export const legacyDaysFromRecurrence = (rule) => {
  if (!rule || typeof rule !== 'object') return [...NO_DAYS];
  switch (rule.mode) {
    case 'daily':
      return [true, true, true, true, true, true, true];
    case 'weekdays':
      return [true, true, true, true, true, false, false];
    case 'weekends':
      return [false, false, false, false, false, true, true];
    case 'weekly':
      return Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length === 7
        ? [...rule.daysOfWeek]
        : [...NO_DAYS];
    default:
      // once / everyNDays / monthly / yearly / nth / last / odd / even have no
      // clean weekday representation — leave legacy days empty.
      return [...NO_DAYS];
  }
};

// ── Normalization ────────────────────────────────────────────────────────
/**
 * Return a fully-populated, internally-consistent alarm object with all new
 * fields defaulted and legacy `days_of_week` kept in sync with `recurrence`.
 * Safe to call on legacy alarms (only time/title/days_of_week) and on new ones.
 */
export const normalizeAlarm = (alarm = {}) => {
  const time = isValidTimeStr(alarm.time) ? alarm.time : '06:00';

  // Recurrence: prefer an explicit rule; otherwise derive from legacy days.
  let recurrence = alarm.recurrence && typeof alarm.recurrence === 'object'
    ? { ...alarm.recurrence, time: isValidTimeStr(alarm.recurrence.time) ? alarm.recurrence.time : time }
    : deriveRecurrenceFromLegacy(time, alarm.days_of_week);

  if (!RECURRENCE_MODES.includes(recurrence.mode)) recurrence.mode = 'once';
  if (recurrence.mode === 'everyNDays') {
    recurrence.interval = clampInt(recurrence.interval, 1, 365, 2);
  }
  if (!Array.isArray(recurrence.skipDates)) recurrence.skipDates = [];
  if (!Array.isArray(recurrence.holidayDates)) recurrence.holidayDates = [];
  recurrence.skipPublicHolidays = !!recurrence.skipPublicHolidays;
  recurrence.holidayCountry = recurrence.holidayCountry || null;
  if (recurrence.pausedUntil === undefined) recurrence.pausedUntil = null;

  // Keep the legacy array authoritative-in-reverse so old code still reads it.
  const days_of_week = legacyDaysFromRecurrence(recurrence);
  const rawSound = alarm.sound_config || {};
  const rotateSet = Array.isArray(rawSound.rotateSet)
    ? Array.from(new Set(rawSound.rotateSet.filter((uri) => typeof uri === 'string' && uri)))
    : null;
  const rotateMode = ['fixed', 'random', 'rotate'].includes(rawSound.rotateMode)
    ? rawSound.rotateMode
    : (rotateSet && rotateSet.length > 1 ? 'random' : 'fixed');
  const rawSnooze = alarm.snooze_config || {};
  const snoozePresets = Array.from(new Set(
    (Array.isArray(rawSnooze.presets) ? rawSnooze.presets : DEFAULT_SNOOZE_CONFIG.presets)
      .map((value) => clampInt(value, 1, 120, 5)),
  )).sort((a, b) => a - b);
  const rawSmartWake = alarm.smart_wake || {};
  const rawVisual = alarm.visual_config && typeof alarm.visual_config === 'object'
    ? alarm.visual_config
    : {};
  // Early builds persisted this field as `accessibilityPalette`. Accept it on
  // read, but always emit the canonical `palette` field going forward.
  const { accessibilityPalette: legacyAccessibilityPalette, ...canonicalVisual } = rawVisual;
  const requestedPalette = rawVisual.palette ?? legacyAccessibilityPalette;
  const visual_config = {
    ...DEFAULT_VISUAL_CONFIG,
    ...canonicalVisual,
    clockStyle: CLOCK_STYLES.includes(rawVisual.clockStyle)
      ? rawVisual.clockStyle
      : DEFAULT_VISUAL_CONFIG.clockStyle,
    backgroundMode: BACKGROUND_MODES.includes(rawVisual.backgroundMode)
      ? rawVisual.backgroundMode
      : DEFAULT_VISUAL_CONFIG.backgroundMode,
    palette: VISUAL_PALETTES.includes(requestedPalette)
      ? requestedPalette
      : DEFAULT_VISUAL_CONFIG.palette,
  };

  return {
    ...alarm,
    time,
    title: alarm.title ?? null,
    description: alarm.description ?? null,
    label: alarm.label && typeof alarm.label === 'object'
      ? { ...alarm.label, text: alarm.label.text || null, color: alarm.label.color || null }
      : null,
    category: alarm.category ?? null,
    visual_config,
    recurrence,
    days_of_week,
    vibrate: alarm.vibrate ?? true,
    vibration_pattern: VIBRATION_PATTERNS.includes(alarm.vibration_pattern)
      ? alarm.vibration_pattern
      : (alarm.vibrate === false ? 'none' : 'strong'),
    sound: alarm.sound ?? true,
    sound_uri: alarm.sound_uri ?? DEFAULT_SOUND_CONFIG.uri,
    sound_name: alarm.sound_name ?? null,
    sound_config: {
      ...DEFAULT_SOUND_CONFIG,
      ...rawSound,
      uri: rawSound.uri || alarm.sound_uri || DEFAULT_SOUND_CONFIG.uri,
      name: rawSound.name || alarm.sound_name || null,
      volume: clampInt(rawSound.volume, 0, 100, DEFAULT_SOUND_CONFIG.volume),
      fadeInMs: clampInt(rawSound.fadeInMs, 0, 300000, DEFAULT_SOUND_CONFIG.fadeInMs),
      rotateSet: rotateSet && rotateSet.length ? rotateSet : null,
      rotateMode,
      rotationIndex: clampInt(rawSound.rotationIndex, 0, 1000000, 0),
      favorite: !!rawSound.favorite,
    },
    snooze_config: {
      ...DEFAULT_SNOOZE_CONFIG,
      ...rawSnooze,
      presets: snoozePresets,
      defaultMin: clampInt(rawSnooze.defaultMin, 1, 120, DEFAULT_SNOOZE_CONFIG.defaultMin),
      maxCount: clampInt(rawSnooze.maxCount, 0, 10, DEFAULT_SNOOZE_CONFIG.maxCount),
      progressive: !!rawSnooze.progressive,
      disabled: !!rawSnooze.disabled,
    },
    mission: Array.isArray(alarm.mission) ? alarm.mission : [],
    smart_wake: {
      ...DEFAULT_SMART_WAKE_CONFIG,
      ...rawSmartWake,
      enabled: !!rawSmartWake.enabled,
      windowMin: clampInt(rawSmartWake.windowMin, 5, 120, DEFAULT_SMART_WAKE_CONFIG.windowMin),
    },
    ambient: alarm.ambient || { enabled: false, leadMin: 10, visual: 'sunrise', soundscape: null },
    flags: { ...DEFAULT_FLAGS, ...(alarm.flags || {}) },
    group_id: alarm.group_id ?? null,
    is_active: alarm.is_active ?? true,
    order_index: alarm.order_index ?? null,
  };
};

/**
 * Create a brand-new alarm with sensible defaults, optionally seeded from a
 * user's global defaults object.
 */
export const createDefaultAlarm = (overrides = {}, globalDefaults = {}) => {
  return normalizeAlarm({
    time: '06:00',
    title: null,
    is_active: true,
    ...globalDefaults,
    ...overrides,
  });
};

// ── Validation ───────────────────────────────────────────────────────────
/**
 * Validate an alarm's core structure. Returns { valid, errors: string[] }.
 * Error strings are stable keys the UI maps to localized messages.
 */
export const validateAlarm = (alarm = {}) => {
  const errors = [];
  if (!isValidTimeStr(alarm.time)) errors.push('invalid_time');

  const r = alarm.recurrence;
  if (r && typeof r === 'object') {
    if (!RECURRENCE_MODES.includes(r.mode)) errors.push('invalid_recurrence_mode');
    if (r.mode === 'weekly' && !(Array.isArray(r.daysOfWeek) && r.daysOfWeek.some(Boolean))) {
      errors.push('weekly_requires_days');
    }
    if (r.mode === 'everyNDays' && !(r.interval >= 1)) errors.push('invalid_interval');
    if (r.mode === 'monthly' && !(r.dayOfMonth >= 1 && r.dayOfMonth <= 31)) errors.push('invalid_day_of_month');
    if (r.mode === 'yearly' && !(r.month >= 1 && r.month <= 12 && r.day >= 1 && r.day <= 31)) {
      errors.push('invalid_yearly_date');
    }
    if ((r.mode === 'nthWeekday') &&
        !(r.nth >= 1 && r.nth <= 5 && r.weekday >= 0 && r.weekday <= 6)) {
      errors.push('invalid_nth_weekday');
    }
    if (r.mode === 'lastWeekday' && !(r.weekday >= 0 && r.weekday <= 6)) {
      errors.push('invalid_last_weekday');
    }
  }

  if (alarm.snooze_config && alarm.snooze_config.maxCount != null && alarm.snooze_config.maxCount < 0) {
    errors.push('invalid_snooze_max');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * LifePilot — Alarm option presets (UI constants)
 * ------------------------------------------------------------------
 * Preset labels with color-coding and the selectable vibration patterns. Label
 * `key`s map to i18n strings under `alarmOptions.labels.*`; colors are stable
 * so a label reads the same across the list and ring screens.
 */
export const LABEL_PRESETS = [
  { key: 'workout', color: '#FB923C' },
  { key: 'college', color: '#60A5FA' },
  { key: 'medicine', color: '#FB7185' },
  { key: 'meeting', color: '#FFFFFF' },
  { key: 'study', color: '#34D399' },
  { key: 'prayer', color: '#C7C7C7' },
  { key: 'sleep', color: '#818CF8' },
  { key: 'reading', color: '#2DD4BF' },
  { key: 'gym', color: '#FB7185' },
  { key: 'exam', color: '#F472B6' },
];

export const VIBRATION_OPTIONS = ['none', 'strong', 'soft', 'heartbeat', 'pulse', 'wave'];

export const findLabelColor = (key) => {
  const found = LABEL_PRESETS.find((l) => l.key === key);
  return found ? found.color : null;
};

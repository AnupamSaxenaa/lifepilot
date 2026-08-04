/** Bundled alarm sounds. Static requires keep every WAV visible to Metro. */
export const BUILT_IN_SOUND_SOURCES = {
  'nature-birds': require('../../../assets/sounds/nature_birds.wav'),
  'instrumental-chime': require('../../../assets/sounds/instrumental_chime.wav'),
  'ambient-drift': require('../../../assets/sounds/ambient_drift.wav'),
  'digital-pulse': require('../../../assets/sounds/digital_pulse.wav'),
  'gentle-dawn': require('../../../assets/sounds/gentle_dawn.wav'),
  'aggressive-alert': require('../../../assets/sounds/aggressive_alert.wav'),
  'lifepilot-pulse': require('../../../assets/sounds/custom_alert.wav'),
};

export const SOUND_CATEGORIES = ['nature', 'instrumental', 'ambient', 'digital', 'gentle', 'aggressive'];

export const BUILT_IN_SOUNDS = [
  { id: 'nature-birds', category: 'nature', nameKey: 'natureBirds' },
  { id: 'instrumental-chime', category: 'instrumental', nameKey: 'instrumentalChime' },
  { id: 'ambient-drift', category: 'ambient', nameKey: 'ambientDrift' },
  { id: 'digital-pulse', category: 'digital', nameKey: 'digitalPulse' },
  { id: 'gentle-dawn', category: 'gentle', nameKey: 'gentleDawn' },
  { id: 'aggressive-alert', category: 'aggressive', nameKey: 'aggressiveAlert' },
];

const stableIndex = (seed, length) => {
  let hash = 2166136261;
  for (const char of String(seed || 'alarm')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Math.abs(hash) % length;
};

/** Resolve a multi-sound config to one deterministic URI while retaining its pool. */
export const selectConfiguredSound = (config = {}, seed = '') => {
  const pool = Array.from(new Set((config.rotateSet || []).filter(Boolean)));
  if (!pool.length) return config.uri || 'default';
  const seededIndex = stableIndex(seed, pool.length);
  if (config.rotateMode === 'rotate') {
    return pool[(Math.max(0, Number(config.rotationIndex) || 0) + seededIndex) % pool.length];
  }
  return pool[seededIndex];
};

export const getBuiltInSound = (id) => BUILT_IN_SOUNDS.find((sound) => sound.id === id) || null;

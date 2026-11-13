/**
 * LifePilot — Alarm Vibration Patterns
 * ------------------------------------------------------------------
 * Named vibration patterns for the ring experience, played via RN's
 * `Vibration` API. Patterns are millisecond arrays in the RN convention:
 * [wait, vibrate, wait, vibrate, ...], repeated via `Vibration.vibrate(pattern,
 * true)` until explicitly stopped.
 */
import { Platform, Vibration } from 'react-native';

export const VIBRATION_PATTERNS = {
  none: [],
  strong: [0, 800, 400],
  soft: [0, 250, 400],
  heartbeat: [0, 120, 100, 120, 600],
  pulse: [0, 200, 200, 200, 200, 200, 800],
  wave: [0, 100, 100, 200, 100, 300, 100, 400, 600],
};

let _active = false;

/**
 * Start a named pattern, looping until `stopVibration()` is called.
 * No-op for 'none' or on unsupported platforms.
 */
export const startVibration = (patternName = 'strong') => {
  if (Platform.OS === 'web') return;
  const pattern = VIBRATION_PATTERNS[patternName] || VIBRATION_PATTERNS.strong;
  if (!pattern.length) return;
  try {
    Vibration.vibrate(pattern, true);
    _active = true;
  } catch (e) {
    console.warn('[VibrationPlayer] startVibration failed:', e?.message || e);
  }
};

export const stopVibration = () => {
  if (!_active) return;
  try {
    Vibration.cancel();
  } catch (e) {
    console.warn('[VibrationPlayer] stopVibration failed:', e?.message || e);
  } finally {
    _active = false;
  }
};

export const isVibrating = () => _active;

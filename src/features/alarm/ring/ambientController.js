/**
 * LifePilot — Ambient Pre-Wake Controller
 * ------------------------------------------------------------------
 * Gradually ramps screen brightness up (simulating a sunrise) over the
 * configured lead time, using `expo-brightness`'s app-level
 * `setBrightnessAsync` (no special permission required, unlike the
 * system-wide variant). Restores the original brightness on cleanup so the
 * user's normal setting isn't left altered after the alarm/ambient session.
 *
 * Fully optional and defensive: any Brightness API failure is swallowed so
 * the ambient screen (and, more importantly, the alarm itself) still works
 * without dimming/brightening control.
 */
import * as Brightness from 'expo-brightness';

let _originalBrightness = null;
let _rampInterval = null;

const clampBrightness = (v) => Math.max(0, Math.min(1, v));

/**
 * Start ramping brightness from a low starting point up to full brightness
 * over `durationMs`. Call `stopAmbientBrightnessRamp()` when the ambient
 * phase ends (either by transitioning to the full ring or by dismiss).
 */
export const startAmbientBrightnessRamp = async (durationMs) => {
  try {
    const { status } = await Brightness.requestPermissionsAsync?.() || { status: 'granted' };
    if (status && status !== 'granted') return; // no permission -> skip silently

    if (_originalBrightness == null) {
      _originalBrightness = await Brightness.getBrightnessAsync();
    }

    const startVal = 0.05;
    const endVal = Math.max(startVal, _originalBrightness ?? 0.6);
    await Brightness.setBrightnessAsync(startVal);

    const steps = 30;
    const stepMs = Math.max(200, durationMs / steps);
    let step = 0;
    clearInterval(_rampInterval);
    _rampInterval = setInterval(async () => {
      step += 1;
      const value = clampBrightness(startVal + (endVal - startVal) * (step / steps));
      try { await Brightness.setBrightnessAsync(value); } catch (_e) {}
      if (step >= steps) clearInterval(_rampInterval);
    }, stepMs);
  } catch (e) {
    console.warn('[Ambient] startAmbientBrightnessRamp failed (non-fatal):', e?.message || e);
  }
};

/** Stop the ramp and restore the device's original brightness. */
export const stopAmbientBrightnessRamp = async () => {
  clearInterval(_rampInterval);
  _rampInterval = null;
  try {
    if (_originalBrightness != null) {
      await Brightness.setBrightnessAsync(_originalBrightness);
    }
  } catch (e) {
    console.warn('[Ambient] stopAmbientBrightnessRamp restore failed (non-fatal):', e?.message || e);
  } finally {
    _originalBrightness = null;
  }
};

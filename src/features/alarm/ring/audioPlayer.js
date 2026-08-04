/**
 * LifePilot — Alarm Audio Player
 * ------------------------------------------------------------------
 * Imperative (non-hook) audio playback for the ring screen, using expo-audio
 * (the SDK 56 successor to the disabled expo-av path). Handles:
 *   • Looping playback of the alarm's chosen sound
 *   • Linear volume fade-in over `fadeInMs`
 *   • Playing through the alarm stream even if the device is on silent
 *     (`playsInSilentMode`) — Android DND override still requires the
 *     separate policy-access flow (Phase 3, out of scope here)
 *   • Emergency mode forces full volume immediately, no fade
 *   • If anything fails to initialize, we DO NOT throw — the Notifee channel
 *     sound (played by the OS the moment the notification posts) is always
 *     the fallback, so the user is never left in total silence.
 *
 * This module has one active player at a time (an alarm ring session), which
 * matches how the app is used — only one alarm rings at a time in the UI even
 * if multiple are scheduled back-to-back.
 */
import { BUILT_IN_SOUND_SOURCES } from '../soundLibrary';

// expo-audio was added after some production APKs were shipped. Load it
// defensively so OTA bundles remain compatible with those binaries; they keep
// using the looping Notifee alarm-channel tone until the next native build.
let createAudioPlayer = null;
let setAudioModeAsync = null;
try {
  ({ createAudioPlayer, setAudioModeAsync } = require('expo-audio'));
} catch (_error) {
  // Native module absent in an older APK — OS channel audio remains available.
}

let _player = null;
let _fadeInterval = null;

const clearFade = () => {
  if (_fadeInterval) {
    clearInterval(_fadeInterval);
    _fadeInterval = null;
  }
};

/**
 * Resolve a sound identifier ('default' | uri) into a source expo-audio can
 * play. The default always resolves to the bundled LifePilot tone so ringing
 * never depends solely on Android's immutable notification-channel sound.
 */
const resolveSource = (soundUri) => {
  if (!soundUri || soundUri === 'default') return BUILT_IN_SOUND_SOURCES['lifepilot-pulse'];
  if (BUILT_IN_SOUND_SOURCES[soundUri]) return BUILT_IN_SOUND_SOURCES[soundUri];
  return { uri: soundUri };
};

/**
 * Start playing the alarm sound.
 * @param {object} opts
 * @param {string} opts.soundUri   'default' or a file:// / content:// uri
 * @param {number} [opts.volume]   0-100, target volume (default 100)
 * @param {number} [opts.fadeInMs] fade-in duration in ms (0 = instant)
 * @param {boolean} [opts.emergency] force full volume, skip fade
 * @returns {Promise<boolean>} true if a player was started, false if using
 *   the OS fallback only (e.g. soundUri === 'default')
 */
export const startAlarmAudio = async ({ soundUri, volume = 100, fadeInMs = 0, emergency = false } = {}) => {
  if (typeof createAudioPlayer !== 'function' || typeof setAudioModeAsync !== 'function') {
    return false;
  }

  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
  } catch (e) {
    console.warn('[AudioPlayer] setAudioModeAsync failed:', e?.message || e);
  }

  const source = resolveSource(soundUri);
  if (!source) return false; // OS channel sound is already ringing

  try {
    stopAlarmAudio(); // safety: never leak a previous player
    _player = createAudioPlayer(source);
    _player.loop = true;

    const targetVolume = Math.max(0, Math.min(100, volume)) / 100;

    if (emergency || fadeInMs <= 0) {
      _player.volume = emergency ? 1 : targetVolume;
      _player.play();
      return true;
    }

    // Linear fade-in: start silent, ramp to target over fadeInMs.
    _player.volume = 0;
    _player.play();
    const steps = 20;
    const stepMs = Math.max(50, fadeInMs / steps);
    let step = 0;
    clearFade();
    _fadeInterval = setInterval(() => {
      step++;
      if (!_player) { clearFade(); return; }
      _player.volume = Math.min(targetVolume, (step / steps) * targetVolume);
      if (step >= steps) clearFade();
    }, stepMs);

    return true;
  } catch (e) {
    console.warn('[AudioPlayer] startAlarmAudio failed, relying on OS channel sound:', e?.message || e);
    _player = null;
    return false;
  }
};

/** Stop and release the active player, if any. Safe to call repeatedly. */
export const stopAlarmAudio = () => {
  clearFade();
  if (_player) {
    try {
      _player.pause();
      _player.remove();
    } catch (e) {
      console.warn('[AudioPlayer] stopAlarmAudio cleanup failed:', e?.message || e);
    }
    _player = null;
  }
};

/** Force volume to maximum immediately (Emergency mode escalation). */
export const forceMaxVolume = () => {
  clearFade();
  if (_player) {
    try { _player.volume = 1; } catch (_e) {}
  }
};

export const isAlarmAudioPlaying = () => !!(_player && _player.playing);

/** Play a short non-looping sample from the alarm editor. */
export const previewAlarmSound = async (soundUri, volume = 100) => {
  const started = await startAlarmAudio({ soundUri, volume, fadeInMs: 0 });
  if (!started) return false;
  setTimeout(() => stopAlarmAudio(), 3000);
  return true;
};
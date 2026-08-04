import * as Updates from 'expo-updates';
import { Storage } from './storage';

/**
 * OTA Update Manager (production-grade)
 * ------------------------------------------------------------------
 * Wraps `expo-updates` with a safe, predictable update lifecycle:
 *
 *   • checkForUpdates()  — asks the server if a new bundle exists (no download)
 *   • downloadUpdate()   — downloads the new bundle to local storage
 *   • applyUpdate()      — reloads into the downloaded bundle
 *   • silentBackgroundUpdate() — the default launch behavior: check → download
 *     → mark "ready", but DON'T reload mid-session. The bundle applies on the
 *     next natural cold start (or when the user taps "Apply" / reopens).
 *
 * Design decisions that make this reliable in production:
 *   1. NEVER force-reload the app out from under the user right after launch.
 *      That's jarring and can interrupt in-progress work. We download quietly
 *      and let it apply on the next launch, or surface a gentle prompt.
 *   2. Handle rollback-to-embedded directives (server can tell clients to drop
 *      a bad OTA and return to the shipped bundle).
 *   3. Surface emergency-launch state (expo-updates fell back to the embedded
 *      bundle because a downloaded update failed to load) so it's visible.
 *   4. All calls are guarded so they no-op cleanly in dev / when disabled,
 *      and never throw into the app.
 */

const LAST_CHECK_KEY = 'ota_last_check_ts';
const PENDING_READY_KEY = 'ota_update_ready';
const MIN_CHECK_INTERVAL_MS = 30 * 1000; // don't hammer the server on rapid foregrounds

export const UpdateManager = {
  /**
   * Whether OTA is usable in this build (false in Expo Go / dev / if disabled).
   */
  isEnabled: () => {
    try {
      return !__DEV__ && Updates.isEnabled;
    } catch {
      return false;
    }
  },

  /**
   * True if the currently running bundle is an "emergency launch" — i.e. a
   * downloaded update failed to load and expo-updates fell back to the
   * embedded bundle. Useful for surfacing/telemetry.
   */
  getEmergencyLaunchInfo: () => {
    try {
      return {
        isEmergencyLaunch: !!Updates.isEmergencyLaunch,
        reason: Updates.emergencyLaunchReason || null,
      };
    } catch {
      return { isEmergencyLaunch: false, reason: null };
    }
  },

  /**
   * Ask the server whether a new update (or rollback directive) is available.
   * Does NOT download. Returns a normalized result.
   *
   * @returns {Promise<{isAvailable:boolean, isRollBack:boolean, reason?:string, error?:Error}>}
   */
  checkForUpdates: async () => {
    if (!UpdateManager.isEnabled()) {
      return { isAvailable: false, isRollBack: false, reason: 'disabled' };
    }
    try {
      const result = await Updates.checkForUpdateAsync();
      await Storage.set(LAST_CHECK_KEY, Date.now().toString());
      return {
        isAvailable: !!result.isAvailable,
        isRollBack: !!result.isRollBackToEmbedded,
        reason: result.reason,
      };
    } catch (error) {
      console.log('[OTA] checkForUpdates error:', error?.message || error);
      return { isAvailable: false, isRollBack: false, error };
    }
  },

  /**
   * Download the newest available update to local storage. Does NOT reload.
   *
   * @returns {Promise<{success:boolean, isNew:boolean, isRollBack:boolean, error?:Error}>}
   */
  downloadUpdate: async () => {
    if (!UpdateManager.isEnabled()) {
      return { success: false, isNew: false, isRollBack: false, reason: 'disabled' };
    }
    try {
      const result = await Updates.fetchUpdateAsync();
      const isNew = !!result.isNew;
      const isRollBack = !!result.isRollBackToEmbedded;
      if (isNew || isRollBack) {
        await Storage.set(PENDING_READY_KEY, 'true');
      }
      return { success: true, isNew, isRollBack };
    } catch (error) {
      console.log('[OTA] downloadUpdate error:', error?.message || error);
      return { success: false, isNew: false, isRollBack: false, error };
    }
  },

  /**
   * Reload into the most recently downloaded bundle. Only call this when it's
   * safe (user tapped "Apply", or you've confirmed no critical in-progress
   * work). Sets a flag so a success toast can show after the reload.
   */
  applyUpdate: async () => {
    if (!UpdateManager.isEnabled()) return false;
    try {
      await Storage.set('showUpdateSuccessToast', 'true');
      await Storage.remove(PENDING_READY_KEY);
      await Updates.reloadAsync();
      return true;
    } catch (error) {
      console.log('[OTA] applyUpdate error:', error?.message || error);
      // If reload failed, clear the premature success flag so we don't lie.
      await Storage.remove('showUpdateSuccessToast');
      return false;
    }
  },

  /**
   * Whether a downloaded update is sitting ready to be applied on next reload.
   */
  isUpdateReady: async () => {
    try {
      return (await Storage.get(PENDING_READY_KEY)) === 'true';
    } catch {
      return false;
    }
  },

  /**
   * The core launch/foreground routine. Checks for an update and, if one
   * exists, downloads it QUIETLY. It does NOT reload the app — the downloaded
   * bundle applies on the next cold start, or the caller can prompt the user
   * to apply immediately via the onReady callback.
   *
   * @param {(progressPhase: 'checking'|'downloading'|'ready'|'idle') => void} [onPhase]
   * @param {(ready: {isNew:boolean, isRollBack:boolean}) => void} [onReady]
   *   Called when a fresh update finished downloading and is ready to apply.
   * @param {boolean} [force] bypass the min-interval throttle (e.g. manual check)
   * @returns {Promise<{updated:boolean, ready:boolean}>}
   */
  silentBackgroundUpdate: async (onPhase, onReady, force = false) => {
    if (!UpdateManager.isEnabled()) {
      onPhase?.('idle');
      return { updated: false, ready: false };
    }

    // Throttle: avoid re-checking on every rapid foreground event.
    if (!force) {
      try {
        const lastStr = await Storage.get(LAST_CHECK_KEY);
        const last = lastStr ? parseInt(lastStr, 10) : 0;
        if (last && Date.now() - last < MIN_CHECK_INTERVAL_MS) {
          onPhase?.('idle');
          return { updated: false, ready: false };
        }
      } catch {}
    }

    try {
      onPhase?.('checking');
      const check = await UpdateManager.checkForUpdates();

      if (!check.isAvailable && !check.isRollBack) {
        onPhase?.('idle');
        return { updated: false, ready: false };
      }

      onPhase?.('downloading');
      const dl = await UpdateManager.downloadUpdate();

      if (dl.success && (dl.isNew || dl.isRollBack)) {
        onPhase?.('ready');
        onReady?.({ isNew: dl.isNew, isRollBack: dl.isRollBack });
        return { updated: true, ready: true };
      }

      onPhase?.('idle');
      return { updated: false, ready: false };
    } catch (error) {
      console.log('[OTA] silentBackgroundUpdate error:', error?.message || error);
      onPhase?.('idle');
      return { updated: false, ready: false };
    }
  },

  /**
   * Info about the currently running bundle (for a Settings/debug display).
   */
  getCurrentUpdate: () => {
    if (!UpdateManager.isEnabled()) return null;
    try {
      return {
        updateId: Updates.updateId,
        createdAt: Updates.createdAt,
        channel: Updates.channel,
        runtimeVersion: Updates.runtimeVersion,
        isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      };
    } catch {
      return null;
    }
  },
};

import * as Updates from 'expo-updates';

/**
 * OTA Update Manager
 * Handles checking, downloading, and applying Expo Updates
 */

export const UpdateManager = {
  /**
   * Check if updates are enabled in this build
   */
  isEnabled: () => {
    return !__DEV__ && Updates.isEnabled;
  },

  /**
   * Check for available updates
   * @returns {Promise<Object>} { isAvailable: boolean, manifest: object }
   */
  checkForUpdates: async () => {
    try {
      if (!UpdateManager.isEnabled()) {
        console.log('[OTA] Updates disabled in dev mode');
        return { isAvailable: false };
      }

      const update = await Updates.checkForUpdateAsync();
      console.log('[OTA] Update check:', update);
      return update;
    } catch (error) {
      console.error('[OTA] Error checking for updates:', error);
      return { isAvailable: false, error };
    }
  },

  /**
   * Download and apply update
   * @param {Function} onProgress - callback with download progress (0-1)
   * @returns {Promise<Object>} download result
   */
  downloadAndApply: async (onProgress) => {
    try {
      if (!UpdateManager.isEnabled()) {
        console.log('[OTA] Updates disabled in dev mode');
        return { success: false, reason: 'dev_mode' };
      }

      // Start download with progress tracking
      const result = await Updates.fetchUpdateAsync();
      
      // Call progress callback with completion
      if (onProgress) onProgress(1.0);

      console.log('[OTA] Download complete:', result);

      if (result.isNew) {
        console.log('[OTA] New update downloaded, reloading app...');
        // Reload the app to apply the update
        await Updates.reloadAsync();
        return { success: true, isNew: true };
      } else {
        console.log('[OTA] No new update available');
        return { success: true, isNew: false };
      }
    } catch (error) {
      console.error('[OTA] Error downloading update:', error);
      return { success: false, error };
    }
  },

  /**
   * Get current update info
   */
  getCurrentUpdate: () => {
    if (!UpdateManager.isEnabled()) {
      return null;
    }
    return {
      updateId: Updates.updateId,
      createdAt: Updates.createdAt,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
    };
  },

  /**
   * Check and download update if available
   * @param {Function} onProgress - callback with download progress
   * @param {Function} onStatusChange - callback when status changes
   * @returns {Promise<boolean>} true if update was applied
   */
  checkAndUpdate: async (onProgress, onStatusChange) => {
    try {
      // Notify checking
      if (onStatusChange) onStatusChange('checking');

      const { isAvailable } = await UpdateManager.checkForUpdates();

      if (!isAvailable) {
        if (onStatusChange) onStatusChange('no_update');
        return false;
      }

      // Notify downloading
      if (onStatusChange) onStatusChange('downloading');

      const result = await UpdateManager.downloadAndApply(onProgress);

      if (result.success && result.isNew) {
        if (onStatusChange) onStatusChange('reloading');
        return true;
      } else {
        if (onStatusChange) onStatusChange('complete');
        return false;
      }
    } catch (error) {
      console.error('[OTA] Update process failed:', error);
      if (onStatusChange) onStatusChange('error');
      return false;
    }
  },
};

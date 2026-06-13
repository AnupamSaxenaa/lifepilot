import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

/**
 * APK Downloader and Installer
 * Downloads APK with progress tracking and triggers install
 */

/**
 * Download APK file with progress tracking
 * @param {string} url - APK download URL
 * @param {Function} onProgress - Callback with progress (0-1)
 * @returns {Promise<string>} Local file path of downloaded APK
 */
export const downloadAPK = async (url, onProgress) => {
  if (Platform.OS !== 'android') {
    throw new Error('APK downloads are only supported on Android');
  }

  try {
    const fileName = 'lifepilot-update.apk';
    const fileUri = FileSystem.documentDirectory + fileName;

    console.log('[APK] Starting download from:', url);
    console.log('[APK] Saving to:', fileUri);

    // Delete old APK if exists
    try {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    } catch (e) {
      // Ignore if doesn't exist
    }

    // Create download resumable with progress tracking
    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      fileUri,
      {},
      (downloadProgress) => {
        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        console.log('[APK] Download progress:', Math.round(progress * 100) + '%');
        if (onProgress) {
          onProgress(progress);
        }
      }
    );

    const result = await downloadResumable.downloadAsync();
    
    if (!result || !result.uri) {
      throw new Error('Download failed - no file URI returned');
    }

    console.log('[APK] Download complete:', result.uri);
    return result.uri;
  } catch (error) {
    console.error('[APK] Download error:', error);
    throw error;
  }
};

/**
 * Install downloaded APK
 * Opens Android install prompt
 * @param {string} fileUri - Local file path of APK
 * @returns {Promise<void>}
 */
export const installAPK = async (fileUri) => {
  if (Platform.OS !== 'android') {
    throw new Error('APK installation is only supported on Android');
  }

  try {
    console.log('[APK] Triggering install for:', fileUri);

    // Verify file exists
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    console.log('[APK] File info:', JSON.stringify(fileInfo, null, 2));
    
    if (!fileInfo.exists) {
      throw new Error('APK file not found at path: ' + fileUri);
    }

    if (fileInfo.size < 1000000) { // Less than 1MB is suspicious
      console.warn('[APK] File size seems too small:', fileInfo.size);
    }

    // Convert file:// URI to content:// URI for Android 11+
    const contentUri = await FileSystem.getContentUriAsync(fileUri);
    console.log('[APK] Content URI:', contentUri);

    // Open install prompt with proper flags
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });

    console.log('[APK] Install prompt opened successfully');
  } catch (error) {
    console.error('[APK] Install error:', error);
    console.error('[APK] Error details:', JSON.stringify(error, null, 2));
    throw error;
  }
};

/**
 * Download and install APK in one go
 * @param {string} url - APK download URL
 * @param {Function} onProgress - Callback with progress (0-1)
 * @returns {Promise<void>}
 */
export const downloadAndInstallAPK = async (url, onProgress) => {
  try {
    // Download with progress
    const fileUri = await downloadAPK(url, onProgress);
    
    // Trigger install
    await installAPK(fileUri);
  } catch (error) {
    console.error('[APK] Download & install error:', error);
    throw error;
  }
};

import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

/**
 * Version Checker for Force Updates
 * Compares current app version with minimum required version from Supabase
 */

/**
 * Compare two version strings
 * @param {string} v1 - Current version
 * @param {string} v2 - Required version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
const compareVersions = (v1, v2) => {
  // Remove 'v' prefix if present
  const cleanV1 = v1.replace(/^v/, '').toLowerCase();
  const cleanV2 = v2.replace(/^v/, '').toLowerCase();

  // Handle special development versions like "vjasper1.0"
  // These should be treated as valid/current to avoid blocking dev builds
  if (cleanV1.includes('jasper') || cleanV1.includes('dev') || cleanV1.includes('beta')) {
    console.log('[VersionChecker] Development version detected, skipping version check');
    return 0; // Treat as equal (don't block dev versions)
  }

  const parts1 = cleanV1.split('.').map(p => parseInt(p, 10) || 0);
  const parts2 = cleanV2.split('.').map(p => parseInt(p, 10) || 0);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }

  return 0;
};

/**
 * Get current app version
 * @returns {string} Current version string
 */
export const getCurrentVersion = () => {
  try {
    if (Platform.OS === 'android') {
      return Application.nativeApplicationVersion || '1.0.0';
    } else if (Platform.OS === 'ios') {
      return Application.nativeApplicationVersion || '1.0.0';
    }
    return '1.0.0';
  } catch (error) {
    console.error('[VersionChecker] Error getting version:', error);
    return '1.0.0';
  }
};

/**
 * Get build number
 * @returns {string} Build number
 */
export const getBuildNumber = () => {
  try {
    return Application.nativeBuildVersion || '1';
  } catch (error) {
    return '1';
  }
};

/**
 * Check if force update is required
 * Fetches minimum version from Supabase and compares with current version
 * 
 * Supabase table schema:
 * CREATE TABLE app_versions (
 *   id serial PRIMARY KEY,
 *   platform text NOT NULL,  -- 'android' or 'ios'
 *   min_version text NOT NULL,  -- e.g., '1.0.0'
 *   latest_version text NOT NULL,  -- e.g., '1.2.0'
 *   download_url text,  -- APK download URL for Android
 *   release_notes text,
 *   force_update boolean DEFAULT false,
 *   created_at timestamptz DEFAULT now(),
 *   updated_at timestamptz DEFAULT now()
 * );
 * 
 * @returns {Promise<Object>} { updateRequired, updateInfo }
 */
export const checkForceUpdate = async () => {
  try {
    const currentVersion = getCurrentVersion();
    const platform = Platform.OS;

    // Fetch version info from Supabase
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .eq('platform', platform)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error('[VersionChecker] Error fetching version:', error);
      // If table doesn't exist or error, don't block app
      return { updateRequired: false, updateInfo: null };
    }

    if (!data) {
      console.log('[VersionChecker] No version info found in database');
      return { updateRequired: false, updateInfo: null };
    }

    // Check if current version is below minimum required
    const minComparison = compareVersions(currentVersion, data.min_version);
    const latestComparison = compareVersions(currentVersion, data.latest_version);
    
    // An update is required if:
    // 1. We are below min_version
    // 2. We are below latest_version AND force_update is true
    const updateRequired = minComparison < 0 || (latestComparison < 0 && data.force_update);

    console.log('[VersionChecker] Current:', currentVersion, 'Min:', data.min_version, 'Required:', updateRequired);

    return {
      updateRequired,
      updateInfo: updateRequired ? {
        currentVersion,
        minVersion: data.min_version,
        latestVersion: data.latest_version,
        downloadUrl: data.download_url,
        releaseNotes: data.release_notes,
        forceUpdate: data.force_update,
      } : null,
    };
  } catch (error) {
    console.error('[VersionChecker] Error checking version:', error);
    // Don't block app on error
    return { updateRequired: false, updateInfo: null };
  }
};

/**
 * Format version info for display
 * @param {Object} updateInfo
 * @returns {string}
 */
export const formatVersionInfo = (updateInfo) => {
  if (!updateInfo) return '';
  
  return `Current: v${updateInfo.currentVersion}\nLatest: v${updateInfo.latestVersion}`;
};

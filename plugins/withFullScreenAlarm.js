const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withFullScreenAlarm(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // 1. Add USE_FULL_SCREEN_INTENT permission
    const permissions = androidManifest.manifest['uses-permission'] ?? [];
    const fsiPermission = 'android.permission.USE_FULL_SCREEN_INTENT';
    const wakePermission  = 'android.permission.WAKE_LOCK';

    if (!permissions.find(p => p.$['android:name'] === fsiPermission)) {
      permissions.push({ $: { 'android:name': fsiPermission } });
    }
    if (!permissions.find(p => p.$['android:name'] === wakePermission)) {
      permissions.push({ $: { 'android:name': wakePermission } });
    }
    androidManifest.manifest['uses-permission'] = permissions;

    // 2. Patch the main <activity> with showWhenLocked + turnScreenOn
    const mainActivity = mainApplication.activity?.find(
      a => a.$['android:name'] === '.MainActivity'
    );
    if (mainActivity) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn']   = 'true';
    }

    return config;
  });
};

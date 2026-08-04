const STORE_VARIANT = 'store';
const STORE_PACKAGE = 'com.anupam.lifepilot';
const STORE_TARGET_SDK = 36;

const pluginName = (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin);

const configureStorePlugins = (plugins = []) => plugins
  .filter((plugin) => ![
    'expo-camera',
    'react-native-nfc-manager',
    './plugins/withFullScreenAlarm',
  ].includes(pluginName(plugin)))
  .map((plugin) => {
    const name = pluginName(plugin);
    const options = Array.isArray(plugin) ? (plugin[1] || {}) : {};

    if (name === 'expo-location') {
      return [
        'expo-location',
        {
          ...options,
          locationAlwaysAndWhenInUsePermission:
            'LifePilot uses your approximate location for weather and location-aware planning.',
        },
      ];
    }

    if (name !== 'expo-build-properties') return plugin;
    return [
      'expo-build-properties',
      {
        ...options,
        android: {
          ...(options.android || {}),
          compileSdkVersion: STORE_TARGET_SDK,
          targetSdkVersion: STORE_TARGET_SDK,
        },
      },
    ];
  });

export default ({ config }) => {
  const variant = process.env.APP_VARIANT || 'production';
  const channel =
    variant === 'development' ? 'development'
    : variant === 'preview' ? 'preview'
    : 'production';

  const updates = {
    ...config.updates,
    url: 'https://u.expo.dev/f79f9e16-1938-4c95-a8db-cc580b62f081',
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: {
      ...(config.updates && config.updates.requestHeaders),
      'expo-channel-name': channel,
    },
  };

  if (variant === 'development') {
    return {
      ...config,
      name: 'LP LAB',
      slug: config.slug,
      updates,
      scheme: [
        'lifepilot',
        'com.anupam.lp',
        'com.googleusercontent.apps.753694130355-8bhkicmdd6qqu9esu09qo5c9dv8ab3vi',
      ],
      ios: {
        ...config.ios,
        bundleIdentifier: 'com.anupam.lp.tester',
      },
      android: {
        ...config.android,
        package: 'com.anupam.lp.tester',
      },
    };
  }

  if (variant === STORE_VARIANT) {
    const blockedPermissions = [
      'android.permission.CAMERA',
      'android.permission.NFC',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.USE_EXACT_ALARM',
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.REQUEST_INSTALL_PACKAGES',
    ];
    const removedPermissions = new Set([
      ...blockedPermissions,
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ]);

    return {
      ...config,
      name: 'LifePilot',
      updates,
      scheme: [...new Set([...(config.scheme || []), STORE_PACKAGE])],
      plugins: configureStorePlugins(config.plugins),
      ios: {
        ...config.ios,
        bundleIdentifier: STORE_PACKAGE,
      },
      android: {
        ...config.android,
        package: STORE_PACKAGE,
        permissions: (config.android?.permissions || []).filter(
          (permission) => !removedPermissions.has(permission),
        ),
        blockedPermissions: [
          ...new Set([...(config.android?.blockedPermissions || []), ...blockedPermissions]),
        ],
      },
    };
  }

  return {
    ...config,
    name: 'LifePilot',
    updates,
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.anupam.lp',
    },
    android: {
      ...config.android,
      package: 'com.anupam.lp',
    },
  };
};

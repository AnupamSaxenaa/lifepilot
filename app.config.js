import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

const STORE_VARIANT = 'store';
const STORE_PACKAGE = 'com.anupam.lifepilot';
const STORE_TARGET_SDK = 36;
// Store binaries have a different native surface from LP LAB and the legacy
// com.anupam.lp build, so they must never consume one another's OTA updates.
const STORE_UPDATE_CHANNEL = 'store-production';
const LEGACY_UPDATE_CHANNEL = 'legacy-production';

const normalizeSchemes = (scheme) => (
  Array.isArray(scheme) ? scheme : scheme ? [scheme] : []
);
const withLifePilotSchemes = (scheme) => [
  ...new Set(['lifepilot', ...normalizeSchemes(scheme)]),
];

const pluginName = (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin);

// ── Release size settings ──────────────────────────────────────────────────
// These MUST live in config, not in android/. That directory is untracked and
// listed in .easignore, so EAS regenerates it with `expo prebuild` on every
// cloud build — any hand-edit to android/gradle.properties or
// android/app/proguard-rules.pro is silently discarded and the build ships
// without the optimisation.
//
// Measured on the v1.0.9 universal APK (179 MB):
//   lib/            104.1 MB, of which 58.6 MB was x86 + x86_64 — emulator-only
//                   architectures no shipping phone uses
//   classes*.dex     ~62 MB across 7 files, because minify defaulted to false
//
// buildArchs keeps only the two real-device ABIs. Consequence: the app will not
// run on an x86 emulator; use a physical device or an arm64 emulator image.
const RELEASE_BUILD_ARCHS = ['armeabi-v7a', 'arm64-v8a'];

/**
 * ProGuard keep rules, read from plugins/proguard-rules.pro so they stay a
 * readable, commented file instead of an escaped JSON blob.
 *
 * R8 is the riskiest size lever: breakage shows up ONLY in release builds, as a
 * runtime crash rather than a build failure, because anything reached by
 * reflection or JNI is invisible to its reachability analysis.
 */
const readProguardRules = () => {
  const rulesPath = path.join(CONFIG_DIR, 'plugins', 'proguard-rules.pro');
  if (!fs.existsSync(rulesPath)) {
    // Fail closed. Building with R8 enabled but without the reflection/JNI keep
    // rules creates a release-only crash that debug builds and lint cannot see.
    // A silent empty fallback is therefore less safe than stopping the build.
    throw new Error('Missing plugins/proguard-rules.pro; refusing to build a minified release.');
  }
  return fs.readFileSync(rulesPath, 'utf8');
};

/**
 * Apply the release size settings to expo-build-properties for every variant,
 * preserving whatever that plugin was already configured with.
 */
const withReleaseSizeProperties = (plugins = []) => plugins.map((plugin) => {
  if (pluginName(plugin) !== 'expo-build-properties') return plugin;
  const options = Array.isArray(plugin) ? (plugin[1] || {}) : {};
  return [
    'expo-build-properties',
    {
      ...options,
      android: {
        ...(options.android || {}),
        buildArchs: RELEASE_BUILD_ARCHS,
        enableMinifyInReleaseBuilds: true,
        enableShrinkResourcesInReleaseBuilds: true,
        enablePngCrunchInReleaseBuilds: true,
        extraProguardRules: readProguardRules(),
      },
    },
  ];
});

// ── AdMob ──────────────────────────────────────────────────────────────────
// The app id is NOT a secret: the native SDK writes it into AndroidManifest, so
// it ships inside every APK regardless. It lives here rather than in .env so a
// missing env var can never produce a build that crashes on launch — the Google
// Mobile Ads SDK aborts at startup if the manifest id is absent.
//
// The rewarded AD UNIT id is separate and read at runtime from
// EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID (see src/lib/adRewards.js), which lets the
// ad surface stay hidden until it is configured.
const ADMOB_ANDROID_APP_ID = 'ca-app-pub-5159407135439148~2996583987';

const ADMOB_PLUGIN = [
  'react-native-google-mobile-ads',
  {
    androidAppId: ADMOB_ANDROID_APP_ID,
    // Consent/attribution prompts are deliberately not auto-shown; UMP consent
    // is a Play requirement we handle explicitly before serving EEA traffic.
    userTrackingUsageDescription:
      'This identifier is used to show you more relevant ads when you choose to watch one for credits.',
  },
];

/** Add the AdMob plugin exactly once, whatever the variant already carries. */
const withAdMob = (plugins = []) => (
  plugins.some((plugin) => pluginName(plugin) === 'react-native-google-mobile-ads')
    ? plugins
    : [...plugins, ADMOB_PLUGIN]
);

/**
 * Stop a cloud build before it can produce a signed but unusable artifact.
 *
 * Expo inlines EXPO_PUBLIC_* values into the bundle. If Supabase is absent,
 * createClient() throws during startup and the app opens to a blank screen. If
 * the proxy or rewarded unit is absent, a declared production feature silently
 * disappears. These are public client identifiers, not server secrets.
 */
const assertStoreEnvironment = () => {
  const required = [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_AI_PROXY_URL',
    'EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID',
  ];
  const missing = required.filter((name) => !String(process.env[name] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Store build is missing required environment variables: ${missing.join(', ')}`);
  }

  const proxyRequired = ['true', '1'].includes(process.env.EXPO_PUBLIC_REQUIRE_AI_PROXY);
  if (!proxyRequired) {
    throw new Error('Store build requires EXPO_PUBLIC_REQUIRE_AI_PROXY=true.');
  }

  const billingEnabled = ['true', '1'].includes(process.env.EXPO_PUBLIC_PLAYSTORE_MODE);
  if (billingEnabled && !String(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '').trim()) {
    throw new Error('PLAYSTORE_MODE is enabled but EXPO_PUBLIC_REVENUECAT_ANDROID_KEY is missing.');
  }
};

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
    : variant === STORE_VARIANT ? STORE_UPDATE_CHANNEL
    : LEGACY_UPDATE_CHANNEL;

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
      plugins: withReleaseSizeProperties(withAdMob(config.plugins)),
      scheme: withLifePilotSchemes([
        'com.anupam.lp',
        'com.googleusercontent.apps.753694130355-8bhkicmdd6qqu9esu09qo5c9dv8ab3vi',
      ]),
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
    assertStoreEnvironment();

    const blockedPermissions = [
      'android.permission.CAMERA',
      'android.permission.NFC',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.USE_EXACT_ALARM',
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.REQUEST_INSTALL_PACKAGES',
      // Weather and location-aware planning only need a rough area, so precise
      // location cannot be justified under Play's least-privilege expectations.
      // Coarse location stays.
      'android.permission.ACCESS_FINE_LOCATION',
      // Google's Photo & Video Permissions policy expects the system photo
      // picker rather than broad library access. The avatar picker uses the
      // picker, which needs no permission, so this must not ship.
      'android.permission.READ_MEDIA_IMAGES',
      // expo-sensors injects ACTIVITY_RECOGNITION for the Pedometer, which only
      // the alarm "walk N steps" dismiss challenge uses. Alarms are OFF in store
      // builds (EXPO_PUBLIC_ALARMS_ENABLED=false), so the permission ships for a
      // feature nobody can reach — and Play Console then forces the app into the
      // Health apps policy with no "no health features" opt-out. Strip it.
      'android.permission.ACTIVITY_RECOGNITION',
      // Belt and braces. QUERY_ALL_PACKAGES has been removed from app.json and
      // the Mindful Lock picker now resolves ACTION_MAIN/CATEGORY_LAUNCHER via the
      // <queries> element withAppBlocker.js adds, so nothing should request it.
      // Play approves this permission only for search/antivirus/file-manager type
      // apps, so if a dependency ever re-injects it the store build must still
      // drop it rather than silently ship a rejection risk.
      'android.permission.QUERY_ALL_PACKAGES',
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
      // Fingerprint changes whenever the native surface changes. Combined with
      // STORE_UPDATE_CHANNEL, this prevents an OTA built for LP LAB, the legacy
      // package, or an older native dependency set from reaching Play users.
      runtimeVersion: { policy: 'fingerprint' },
      scheme: withLifePilotSchemes([...normalizeSchemes(config.scheme), STORE_PACKAGE]),
      plugins: withReleaseSizeProperties(withAdMob(configureStorePlugins(config.plugins))),
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
    plugins: withAdMob(config.plugins),
    scheme: withLifePilotSchemes(config.scheme),
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

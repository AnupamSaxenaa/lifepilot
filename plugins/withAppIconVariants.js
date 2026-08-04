const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin — Marketplace App Icon Variants (Android)
 * ----------------------------------------------------------------------------
 * Android has no runtime API to swap mipmap resources directly. The standard
 * approach is `activity-alias`: define one alias PER icon variant pointing at
 * the same MainActivity, each with its own android:icon. At runtime, the app
 * enables exactly one alias and disables the rest via PackageManager
 * (see AppIconModule.kt) — the OS then updates the launcher icon shown.
 *
 * Variants:
 *   MainActivity        → default icon (always present, the "no variant" state)
 *   MainActivityLogo2   → ic_launcher_logo2
 *
 * IMPORTANT: the android folder is gitignored/easignored and gets regenerated
 * fresh on every `expo prebuild` (including `eas build --local`). The mipmap
 * PNGs for these variants therefore cannot just live directly in the
 * generated res mipmap density folders — they would be wiped on the next
 * prebuild. Source-of-truth copies live in `assets/images/app_icons/mipmaps/`
 * and this plugin copies them into the regenerated res mipmap density folders
 * every time (see withIconAssets below).
 * ----------------------------------------------------------------------------
 */
// The launcher aliases. `default` uses the standard app icon and is the ONLY
// one enabled at install time. Noir/Gold are disabled until equipped.
//
// CRITICAL: MainActivity holds the app's deep-link intent-filters
// (lifepilot://, the Google OAuth callback scheme, exp+lifepilot, etc.). If we
// ever DISABLED MainActivity to switch icons, those deep links would stop
// resolving (breaking OAuth sign-in and the app-blocker redirect). So instead
// the launcher MAIN/LAUNCHER entry is moved OFF MainActivity and onto these
// aliases. MainActivity stays enabled forever (deep links intact); only the
// alias that owns the launcher icon is toggled.
const ICON_VARIANTS = [
  { alias: 'MainActivityDefault', icon: '@mipmap/ic_launcher', roundIcon: '@mipmap/ic_launcher_round', enabled: 'true' },
  { alias: 'MainActivityLogo2', icon: '@mipmap/ic_launcher_logo2', roundIcon: '@mipmap/ic_launcher_logo2_round', enabled: 'false' },
];

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const ICON_FILES = ['ic_launcher_logo2.png', 'ic_launcher_logo2_round.png'];

// True if this parsed <intent-filter> node is the MAIN/LAUNCHER one.
const isLauncherFilter = (filter) => {
  const actions = filter.action || [];
  const categories = filter.category || [];
  const hasMain = actions.some((a) => a.$?.['android:name'] === 'android.intent.action.MAIN');
  const hasLauncher = categories.some((c) => c.$?.['android:name'] === 'android.intent.category.LAUNCHER');
  return hasMain && hasLauncher;
};

const withAppIconVariants = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = manifest.application[0];

    // 1. Strip the MAIN/LAUNCHER intent-filter off MainActivity (its deep-link
    //    VIEW filter stays). The launcher entry now lives on the aliases.
    const mainActivity = (application.activity || []).find(
      (a) => a.$?.['android:name'] === '.MainActivity'
    );
    if (mainActivity && Array.isArray(mainActivity['intent-filter'])) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'].filter(
        (f) => !isLauncherFilter(f)
      );
    }

    // 2. Add the launcher aliases (idempotent across prebuilds).
    if (!application['activity-alias']) {
      application['activity-alias'] = [];
    }

    for (const variant of ICON_VARIANTS) {
      const exists = application['activity-alias'].some(
        (a) => a.$['android:name'] === `.${variant.alias}`
      );
      if (exists) continue;

      application['activity-alias'].push({
        $: {
          'android:name': `.${variant.alias}`,
          'android:enabled': variant.enabled,
          'android:exported': 'true',
          'android:icon': variant.icon,
          'android:roundIcon': variant.roundIcon,
          'android:targetActivity': '.MainActivity',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
            category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
          },
        ],
      });
    }

    return config;
  });
};

// Copies the pre-generated per-density icon PNGs from
// assets/images/app_icons/mipmaps/<density>/ into the regenerated
// android/app/src/main/res/mipmap-<density>/ folders on every prebuild.
const withIconAssets = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const srcBase = path.join(projectRoot, 'assets/images/app_icons/mipmaps');
      const resBase = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');

      for (const density of DENSITIES) {
        const srcDir = path.join(srcBase, density);
        const destDir = path.join(resBase, `mipmap-${density}`);
        if (!fs.existsSync(srcDir)) continue;
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of ICON_FILES) {
          const srcFile = path.join(srcDir, file);
          if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, path.join(destDir, file));
          }
        }
      }

      return config;
    },
  ]);
};

// ----------------------------------------------------------------------------
// Native `AppIcon` module — actually flips the enabled activity-alias.
// The manifest/asset side of this plugin was previously complete, but the
// native Kotlin module that PackageManager-toggles the aliases at runtime was
// never generated, so `NativeModules.AppIcon` was `undefined` and every
// `setAppIcon()` call in the JS layer silently no-op'd. This writes the module
// + package on every prebuild, same pattern as withAppBlocker.js's
// AppBlockerModule/AppBlockerPackage.
// ----------------------------------------------------------------------------
const withAppIconNativeModule = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android.package || 'com.anupam.lp';
      const packagePath = packageName.replace(/\./g, '/');
      const srcDir = path.join(config.modRequest.platformProjectRoot, `app/src/main/java/${packagePath}`);
      fs.mkdirSync(srcDir, { recursive: true });

      const moduleContent = `package ${packageName}

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// Maps a JS-facing variant key to the activity-alias defined in
// AndroidManifest.xml by the withAppIconVariants config plugin. Enabling one
// alias and disabling the others is what actually changes the launcher icon
// shown on the home screen — Android has no direct "swap this PNG" API.
private val ALIAS_BY_VARIANT = mapOf(
    "default" to ".MainActivityDefault",
    "logo2" to ".MainActivityLogo2"
)

class AppIconModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppIcon"

    @ReactMethod
    fun setAppIcon(variant: String, promise: Promise) {
        try {
            val targetAlias = ALIAS_BY_VARIANT[variant] ?: ALIAS_BY_VARIANT["default"]!!
            val pm = reactApplicationContext.packageManager
            val pkg = reactApplicationContext.packageName

            for ((_, alias) in ALIAS_BY_VARIANT) {
                val state = if (alias == targetAlias) {
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                } else {
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                }
                pm.setComponentEnabledSetting(
                    ComponentName(pkg, "$pkg$alias"),
                    state,
                    PackageManager.DONT_KILL_APP
                )
            }
            promise.resolve(variant)
        } catch (e: Exception) {
            promise.reject("APP_ICON_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getCurrentIcon(promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            val pkg = reactApplicationContext.packageName
            for ((variant, alias) in ALIAS_BY_VARIANT) {
                val state = pm.getComponentEnabledSetting(ComponentName(pkg, "$pkg$alias"))
                val isEnabled = state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
                    (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && alias == ".MainActivityDefault")
                if (isEnabled) {
                    promise.resolve(variant)
                    return
                }
            }
            promise.resolve("default")
        } catch (e: Exception) {
            promise.reject("APP_ICON_ERROR", e.message, e)
        }
    }
}
`;
      fs.writeFileSync(path.join(srcDir, 'AppIconModule.kt'), moduleContent);

      const packageContent = `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AppIconPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(AppIconModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;
      fs.writeFileSync(path.join(srcDir, 'AppIconPackage.kt'), packageContent);

      return config;
    },
  ]);
};

// Register AppIconPackage in MainApplication.kt (same PackageList.apply hook
// pattern used by withAppBlocker.js for AppBlockerPackage).
const withAppIconPackageRegistry = (config) => {
  return withMainApplication(config, async (config) => {
    let mainApp = config.modResults.contents;

    const packageMatch = mainApp.match(/package ([\w.]+)/);
    const packageName = packageMatch ? packageMatch[1] : (config.android?.package || 'com.anupam.lp');

    if (!mainApp.includes(`import ${packageName}.AppIconPackage`)) {
      mainApp = mainApp.replace(
        `package ${packageName}`,
        `package ${packageName}\nimport ${packageName}.AppIconPackage`
      );
    }

    const rn74Regex = /PackageList\(this\)\.packages\.apply \{\n/;
    if (mainApp.match(rn74Regex) && !mainApp.includes('add(AppIconPackage())')) {
      mainApp = mainApp.replace(
        rn74Regex,
        'PackageList(this).packages.apply {\n            add(AppIconPackage())\n'
      );
    } else {
      const getPackagesRegex = /override fun getPackages\(\): List<ReactPackage> \{\n\s*return PackageList\(this\)\.packages\.apply \{\n/;
      if (mainApp.match(getPackagesRegex) && !mainApp.includes('add(AppIconPackage())')) {
        mainApp = mainApp.replace(
          getPackagesRegex,
          'override fun getPackages(): List<ReactPackage> {\n          return PackageList(this).packages.apply {\n            add(AppIconPackage())\n'
        );
      }
    }

    config.modResults.contents = mainApp;
    return config;
  });
};

module.exports = function withAppIconVariantsCombined(config) {
  config = withAppIconVariants(config);
  config = withIconAssets(config);
  config = withAppIconNativeModule(config);
  config = withAppIconPackageRegistry(config);
  return config;
};

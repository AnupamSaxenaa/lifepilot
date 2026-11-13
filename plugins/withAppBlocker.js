const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { kotlinSources, ACCESSIBILITY_SERVICE_CONFIG } = require('./appBlockerSources');

const SERVICE_NAME = '.AppBlockerAccessibilityService';

// 1. Add the accessibility service to AndroidManifest.xml
const withAppBlockerManifest = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;

    if (!androidManifest.manifest['uses-permission']) {
      androidManifest.manifest['uses-permission'] = [];
    }

    // BIND_ACCESSIBILITY_SERVICE goes on the service itself (below).
    // SYSTEM_ALERT_WINDOW is declared in app.json — it is what lets the service
    // foreground the block screen from the background on Android 10+, so it is
    // load-bearing, not decorative. The user still has to grant it at runtime
    // via AppBlocker.requestOverlayPermission().

    // Package visibility for the Mindful Lock app picker.
    //
    // Android 11+ hides other installed apps unless you either hold
    // QUERY_ALL_PACKAGES or declare what you need to see. Play only approves
    // QUERY_ALL_PACKAGES for a narrow set of app types (device search, antivirus,
    // file managers, browsers, enterprise management); an app blocker is not one,
    // so requesting it risks rejection.
    //
    // Declaring the launcher intent instead grants exactly the visibility
    // getInstalledApps() needs — apps the user can actually open — with no
    // permission at all. Keep this in sync with the queryIntentActivities call in
    // appBlockerSources.js: if that query changes, this declaration must too, or
    // the picker silently comes back empty on Android 11+.
    const queries = androidManifest.manifest.queries ?? [];
    const declaresLauncherQuery = queries.some((entry) => (entry?.intent ?? []).some((intent) => (
      (intent?.action ?? []).some((a) => a?.$?.['android:name'] === 'android.intent.action.MAIN')
      && (intent?.category ?? []).some((c) => c?.$?.['android:name'] === 'android.intent.category.LAUNCHER')
    )));

    if (!declaresLauncherQuery) {
      queries.push({
        intent: [{
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        }],
      });
    }
    androidManifest.manifest.queries = queries;

    const application = androidManifest.manifest.application[0];
    if (!application.service) {
      application.service = [];
    }

    const hasService = application.service.some(s => s.$['android:name'] === SERVICE_NAME);

    if (!hasService) {
      application.service.push({
        $: {
          'android:name': SERVICE_NAME,
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
          'android:exported': 'false'
        },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }]
        }],
        'meta-data': [{
          $: {
            'android:name': 'android.accessibilityservice',
            'android:resource': '@xml/accessibility_service_config'
          }
        }]
      });
    }

    return config;
  });
};

// 2. Inject the accessibility_service_config.xml
const withAccessibilityConfig = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const resDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(resDir, { recursive: true });
      fs.writeFileSync(
        path.join(resDir, 'accessibility_service_config.xml'),
        ACCESSIBILITY_SERVICE_CONFIG,
      );
      return config;
    },
  ]);
};

// 3. Inject the Kotlin files (Service, Module, Package, UsageUtils).
//    Contents come from ./appBlockerSources.js — the single source of truth.
const withNativeFiles = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android.package || 'com.anupam.lp';
      const packagePath = packageName.replace(/\./g, '/');
      const srcDir = path.join(config.modRequest.platformProjectRoot, `app/src/main/java/${packagePath}`);

      fs.mkdirSync(srcDir, { recursive: true });

      const sources = kotlinSources(packageName);
      Object.entries(sources).forEach(([fileName, contents]) => {
        fs.writeFileSync(path.join(srcDir, fileName), contents);
      });

      return config;
    }
  ]);
};

// 4. Register Package in MainApplication.kt
const withPackageRegistry = (config) => {
  return withMainApplication(config, async (config) => {
    let mainApp = config.modResults.contents;

    // Dynamically get the package name from MainApplication.kt
    const packageMatch = mainApp.match(/package ([\w.]+)/);
    const packageName = packageMatch ? packageMatch[1] : (config.android?.package || 'com.anupam.lp');

    // Add AppBlockerPackage to the list of imports
    if (!mainApp.includes(`import ${packageName}.AppBlockerPackage`)) {
       mainApp = mainApp.replace(
         `package ${packageName}`,
         `package ${packageName}\nimport ${packageName}.AppBlockerPackage`
       );
    }

    // In React Native 0.74+, we inject into PackageList(this).packages.apply
    const rn74Regex = /PackageList\(this\)\.packages\.apply \{\n/;
    if (mainApp.match(rn74Regex) && !mainApp.includes('add(AppBlockerPackage())')) {
      mainApp = mainApp.replace(
        rn74Regex,
        'PackageList(this).packages.apply {\n            add(AppBlockerPackage())\n'
      );
    } else {
      // Fallback for older RN versions
      const getPackagesRegex = /override fun getPackages\(\): List<ReactPackage> \{\n\s*return PackageList\(this\)\.packages\.apply \{\n/;
      if (mainApp.match(getPackagesRegex) && !mainApp.includes('add(AppBlockerPackage())')) {
        mainApp = mainApp.replace(
          getPackagesRegex,
          'override fun getPackages(): List<ReactPackage> {\n          return PackageList(this).packages.apply {\n            add(AppBlockerPackage())\n'
        );
      }
    }

    config.modResults.contents = mainApp;
    return config;
  });
};

module.exports = function withAppBlocker(config) {
  config = withAppBlockerManifest(config);
  config = withAccessibilityConfig(config);
  config = withNativeFiles(config);
  config = withPackageRegistry(config);
  return config;
};

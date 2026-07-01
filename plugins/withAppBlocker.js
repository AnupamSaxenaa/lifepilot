const { withAndroidManifest, withDangerousMod, withMainApplication, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SERVICE_NAME = '.AppBlockerAccessibilityService';

// 1. Add permissions and service to AndroidManifest.xml
const withAppBlockerManifest = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;

    // Add BIND_ACCESSIBILITY_SERVICE permission if not present
    if (!androidManifest.manifest['uses-permission']) {
      androidManifest.manifest['uses-permission'] = [];
    }
    
    // Actually, BIND_ACCESSIBILITY_SERVICE goes on the service itself, but we need SYSTEM_ALERT_WINDOW for overlays
    // We already have SYSTEM_ALERT_WINDOW in app.json, so that's covered.

    // Get the application node
    const application = androidManifest.manifest.application[0];
    if (!application.service) {
      application.service = [];
    }

    // Check if our service is already added
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
      
      const configPath = path.join(resDir, 'accessibility_service_config.xml');
      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagDefault"
    android:canRetrieveWindowContent="true"
    android:description="@string/app_name" />
`;
      fs.writeFileSync(configPath, xmlContent);
      return config;
    },
  ]);
};

// 3. Inject Kotlin Files (Service, Module, Package)
const withNativeFiles = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android.package || 'com.anupam.lp';
      const packagePath = packageName.replace(/\./g, '/');
      const srcDir = path.join(config.modRequest.platformProjectRoot, `app/src/main/java/${packagePath}`);
      
      fs.mkdirSync(srcDir, { recursive: true });

      // -- SERVICE --
      const serviceContent = `package ${packageName}

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.content.Intent
import android.content.Context
import android.content.SharedPreferences

class AppBlockerAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageName = event.packageName?.toString() ?: return
        
        // Don't block ourselves
        if (packageName == applicationContext.packageName) return

        val prefs: SharedPreferences = applicationContext.getSharedPreferences("AppBlockerPrefs", Context.MODE_PRIVATE)
        val blockedAppsString = prefs.getString("blockedApps", "") ?: ""
        val blockedApps = blockedAppsString.split(",").filter { it.isNotEmpty() }

        if (blockedApps.contains(packageName)) {
            // App is blocked! Relaunch LifePilot
            val launchIntent = packageManager.getLaunchIntentForPackage(applicationContext.packageName)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                // Add an extra so React Native knows we intercepted a launch
                launchIntent.putExtra("blocked_app", packageName)
                startActivity(launchIntent)
            }
        }
    }

    override fun onInterrupt() {}
}
`;
      fs.writeFileSync(path.join(srcDir, 'AppBlockerAccessibilityService.kt'), serviceContent);

      // -- MODULE --
      const moduleContent = `package ${packageName}

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import android.view.accessibility.AccessibilityManager
import android.accessibilityservice.AccessibilityServiceInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class AppBlockerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "AppBlocker"
    }

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        try {
            val am = reactApplicationContext.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
            val enabledServices = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            
            for (service in enabledServices) {
                val componentName = service.resolveInfo.serviceInfo
                if (componentName.packageName == reactApplicationContext.packageName &&
                    componentName.name.contains("AppBlockerAccessibilityService", ignoreCase = true)) {
                    promise.resolve(true)
                    return
                }
            }
            promise.resolve(false)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
    }

    @ReactMethod
    fun updateBlockedApps(appsStr: String) {
        val prefs = reactApplicationContext.getSharedPreferences("AppBlockerPrefs", Context.MODE_PRIVATE)
        prefs.edit().putString("blockedApps", appsStr).apply()
    }
}
`;
      fs.writeFileSync(path.join(srcDir, 'AppBlockerModule.kt'), moduleContent);

      // -- PACKAGE --
      const packageContent = `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AppBlockerPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(AppBlockerModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;
      fs.writeFileSync(path.join(srcDir, 'AppBlockerPackage.kt'), packageContent);

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

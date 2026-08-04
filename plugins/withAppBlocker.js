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

      // -- USAGE UTILS --
      const usageUtilsContent = `package ${packageName}

import android.content.SharedPreferences
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Shared helpers for tracking per-app, per-day usage time in the
 * AppBlockerPrefs SharedPreferences store. The date-scoped key means
 * usage automatically "resets" at midnight without any cron job.
 */
object AppBlockerUsageUtils {

    private fun todayDateString(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        return sdf.format(Date())
    }

    fun usageKey(packageName: String): String {
        return "usage_" + packageName + "_" + todayDateString()
    }

    fun getTodayUsageMs(prefs: SharedPreferences, packageName: String): Long {
        return prefs.getLong(usageKey(packageName), 0L)
    }

    fun addTodayUsage(prefs: SharedPreferences, packageName: String, ms: Long) {
        if (ms <= 0) return
        val key = usageKey(packageName)
        val current = prefs.getLong(key, 0L)
        prefs.edit().putLong(key, current + ms).apply()
    }

    /**
     * Parses a rule entry for a package from the blockedApps JSON.
     * Supports both the new object format:
     *   { "unblockUntil": 0, "dailyBudgetMinutes": 60, "lockMode": "allowance" }
     * and the legacy plain-number format (unblockUntil only, no budget)
     * for backward compatibility with stale prefs from an older JS build.
     */
    fun parseRule(root: org.json.JSONObject, packageName: String): org.json.JSONObject {
        val raw = root.opt(packageName)
        return when (raw) {
            is org.json.JSONObject -> raw
            is Number -> org.json.JSONObject().apply {
                put("unblockUntil", raw.toLong())
                put("dailyBudgetMinutes", 0)
            }
            else -> org.json.JSONObject()
        }
    }

    fun getEffectiveMode(prefs: SharedPreferences): String {
        val raw = prefs.getString("scheduleConfig", null) ?: return "cbt"
        try {
            val root = org.json.JSONObject(raw)
            val baseMode = root.optString("baseMode", "cbt")
            val schedules = root.optJSONArray("schedules") ?: return baseMode

            val cal = java.util.Calendar.getInstance()
            val day = cal.get(java.util.Calendar.DAY_OF_WEEK) - 1
            val nowMinutes = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)

            var sawActiveStrict = false
            var sawActiveAny = false

            for (i in 0 until schedules.length()) {
                val s = schedules.optJSONObject(i) ?: continue
                if (!s.optBoolean("enabled", true)) continue

                val days = s.optJSONArray("days")
                if (days != null && days.length() > 0) {
                    var dayMatches = false
                    for (j in 0 until days.length()) {
                        if (days.optInt(j, -1) == day) { dayMatches = true; break }
                    }
                    if (!dayMatches) continue
                }

                val start = s.optString("start", "")
                val end = s.optString("end", "")
                if (start.isEmpty() || end.isEmpty()) continue

                val startParts = start.split(":")
                val endParts = end.split(":")
                if (startParts.size != 2 || endParts.size != 2) continue

                val startMinutes = (startParts[0].toIntOrNull() ?: continue) * 60 + (startParts[1].toIntOrNull() ?: continue)
                val endMinutes = (endParts[0].toIntOrNull() ?: continue) * 60 + (endParts[1].toIntOrNull() ?: continue)
                if (startMinutes == endMinutes) continue

                val isActive = if (startMinutes < endMinutes) {
                    nowMinutes >= startMinutes && nowMinutes < endMinutes
                } else {
                    nowMinutes >= startMinutes || nowMinutes < endMinutes
                }

                if (isActive) {
                    sawActiveAny = true
                    if (s.optString("mode", "cbt") == "strict") sawActiveStrict = true
                }
            }

            return when {
                sawActiveStrict -> "strict"
                sawActiveAny -> "cbt"
                else -> baseMode
            }
        } catch (e: Exception) {
            return "cbt"
        }
    }
}
`;
      fs.writeFileSync(path.join(srcDir, 'AppBlockerUsageUtils.kt'), usageUtilsContent);

      // -- SERVICE --
      const serviceContent = `package ${packageName}

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.content.Intent
import android.content.Context
import android.content.SharedPreferences
import android.net.Uri

// Ignore usage jumps bigger than this (e.g. after phone sleep/service restart)
private const val MAX_SESSION_MS = 3 * 60 * 60 * 1000L // 3 hours

class AppBlockerAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageName = event.packageName?.toString() ?: return

        // Don't track/block ourselves
        if (packageName == applicationContext.packageName) return

        val prefs: SharedPreferences = applicationContext.getSharedPreferences("AppBlockerPrefs", Context.MODE_PRIVATE)

        // ── 1. Credit elapsed time to whichever tracked app was previously in the foreground ──
        val now = System.currentTimeMillis()
        val lastPkg = prefs.getString("lastForegroundPackage", null)
        val lastTs = prefs.getLong("lastForegroundTimestamp", 0L)

        if (lastPkg != null && lastTs > 0 && lastPkg != packageName) {
            val elapsed = now - lastTs
            if (elapsed > 0 && elapsed < MAX_SESSION_MS) {
                AppBlockerUsageUtils.addTodayUsage(prefs, lastPkg, elapsed)
            }
        }

        // Update foreground tracker for next time, regardless of whether this package is blocked
        prefs.edit()
            .putString("lastForegroundPackage", packageName)
            .putLong("lastForegroundTimestamp", now)
            .apply()

        // ── 2. Decide whether THIS app should be blocked right now ──
        val blockedAppsString = prefs.getString("blockedApps", "{}") ?: "{}"

        try {
            val jsonObj = org.json.JSONObject(blockedAppsString)
            if (!jsonObj.has(packageName)) return

            val rule = AppBlockerUsageUtils.parseRule(jsonObj, packageName)
            val unblockUntil = rule.optLong("unblockUntil", 0L)
            val perAppLockMode = rule.optString("lockMode", "allowance")
            val dailyBudgetMinutes = rule.optInt("dailyBudgetMinutes", 0)

            // Temporary "grant N minutes" override always wins, for any lock mode
            if (now < unblockUntil) return

            val effectiveGlobalMode = AppBlockerUsageUtils.getEffectiveMode(prefs)
            val lockMode = if (effectiveGlobalMode == "strict") "hard" else perAppLockMode

            val shouldBlock = when (lockMode) {
                "hard" -> true // Hard lock mode: always block, no allowance
                else -> {
                    // Allowance mode: only block once today's usage meets/exceeds the budget.
                    // A budget of 0 or less means "no allowance configured" -> always block,
                    // matching the previous (pre-fix) behavior for those apps.
                    if (dailyBudgetMinutes <= 0) {
                        true
                    } else {
                        val usedMs = AppBlockerUsageUtils.getTodayUsageMs(prefs, packageName)
                        val budgetMs = dailyBudgetMinutes * 60_000L
                        usedMs >= budgetMs
                    }
                }
            }

            if (!shouldBlock) return

            // App is blocked! Relaunch LifePilot straight to the block screen.
            // Use an ACTION_VIEW deep link so React Navigation routes to the
            // BlockedApp screen. (Intent extras are NOT read by RN Linking.)
            val blockUri = Uri.parse("lifepilot://blocked?app=" + Uri.encode(packageName))
            val deepLinkIntent = Intent(Intent.ACTION_VIEW, blockUri)
            deepLinkIntent.setPackage(applicationContext.packageName)
            deepLinkIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            deepLinkIntent.putExtra("blocked_app", packageName)
            try {
                startActivity(deepLinkIntent)
            } catch (e: Exception) {
                // Fallback to a plain launch if the deep link fails to resolve
                val launchIntent = packageManager.getLaunchIntentForPackage(applicationContext.packageName)
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    launchIntent.putExtra("blocked_app", packageName)
                    startActivity(launchIntent)
                }
            }
        } catch (e: Exception) {
            // Ignore parse errors silently in background
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

    @ReactMethod
    fun updateSchedules(schedulesJson: String) {
        val prefs = reactApplicationContext.getSharedPreferences("AppBlockerPrefs", Context.MODE_PRIVATE)
        prefs.edit().putString("scheduleConfig", schedulesJson).apply()
    }

    @ReactMethod
    fun getUsageToday(packageName: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("AppBlockerPrefs", Context.MODE_PRIVATE)
            promise.resolve(AppBlockerUsageUtils.getTodayUsageMs(prefs, packageName).toDouble())
        } catch (e: Exception) {
            promise.resolve(0.0)
        }
    }

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            val packages = pm.getInstalledApplications(android.content.pm.PackageManager.GET_META_DATA)
            val jsonArray = org.json.JSONArray()
            for (packageInfo in packages) {
                if (reactApplicationContext.packageName != packageInfo.packageName) {
                    val jsonObj = org.json.JSONObject()
                    jsonObj.put("packageName", packageInfo.packageName)
                    jsonObj.put("name", packageInfo.loadLabel(pm).toString())
                    
                    try {
                        val iconDrawable = packageInfo.loadIcon(pm)
                        val w = if (iconDrawable.intrinsicWidth > 0) iconDrawable.intrinsicWidth else 1
                        val h = if (iconDrawable.intrinsicHeight > 0) iconDrawable.intrinsicHeight else 1
                        val bitmap = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
                        val canvas = android.graphics.Canvas(bitmap)
                        iconDrawable.setBounds(0, 0, canvas.width, canvas.height)
                        iconDrawable.draw(canvas)
                        val stream = java.io.ByteArrayOutputStream()
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream)
                        val base64 = android.util.Base64.encodeToString(stream.toByteArray(), android.util.Base64.NO_WRAP)
                        jsonObj.put("icon", base64)
                    } catch (e: Exception) {
                        jsonObj.put("icon", "")
                    }
                    
                    jsonArray.put(jsonObj)
                }
            }
            promise.resolve(jsonArray.toString())
        } catch (e: Exception) {
            promise.reject("Error", e.message)
        }
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

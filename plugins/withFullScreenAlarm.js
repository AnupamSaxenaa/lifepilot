const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAlarmManifest = (config) => withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // 1. Add USE_FULL_SCREEN_INTENT permission
    const permissions = androidManifest.manifest['uses-permission'] ?? [];
    const fsiPermission = 'android.permission.USE_FULL_SCREEN_INTENT';
    const wakePermission  = 'android.permission.WAKE_LOCK';
    // Notification-policy access lets the app check/request "bypass Do Not
    // Disturb" for alarm-category notifications (Req 7.3). Granting this is a
    // user action in system settings — we only declare the permission here;
    // reliabilityCheck.js guides the user to the settings screen.
    const dndPermission = 'android.permission.ACCESS_NOTIFICATION_POLICY';

    if (!permissions.find(p => p.$['android:name'] === fsiPermission)) {
      permissions.push({ $: { 'android:name': fsiPermission } });
    }
    if (!permissions.find(p => p.$['android:name'] === wakePermission)) {
      permissions.push({ $: { 'android:name': wakePermission } });
    }
    if (!permissions.find(p => p.$['android:name'] === dndPermission)) {
      permissions.push({ $: { 'android:name': dndPermission } });
    }
    androidManifest.manifest['uses-permission'] = permissions;

    // NFC is optional. Declaring the hardware feature as non-required keeps
    // LifePilot installable on devices without NFC; the JS registry hides the
    // challenge when support is unavailable.
    const features = androidManifest.manifest['uses-feature'] ?? [];
    const nfcFeature = features.find(f => f.$?.['android:name'] === 'android.hardware.nfc');
    if (nfcFeature) {
      nfcFeature.$['android:required'] = 'false';
    } else {
      features.push({ $: { 'android:name': 'android.hardware.nfc', 'android:required': 'false' } });
    }
    androidManifest.manifest['uses-feature'] = features;

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

const nativeModuleSource = (packageName) => `package ${packageName}

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class AlarmReliabilityModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "AlarmReliability"

    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "alarmActivityName" to "\${reactApplicationContext.packageName}.AlarmActivity"
    )

    @ReactMethod
    fun canScheduleExactAlarms(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                promise.resolve(true)
                return
            }
            val manager = reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            promise.resolve(manager.canScheduleExactAlarms())
        } catch (error: Exception) {
            promise.reject("EXACT_ALARM_CHECK_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun openExactAlarmSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val intent = Intent(
                    Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:\${reactApplicationContext.packageName}")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactApplicationContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("EXACT_ALARM_SETTINGS_ERROR", error.message, error)
        }
    }
}

@Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
class AlarmReliabilityPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(AlarmReliabilityModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;

const withAlarmReliabilityFiles = (config) => withDangerousMod(config, [
  'android',
  async (config) => {
    const packageName = config.android?.package || 'com.anupam.lp';
    const sourceDir = path.join(
      config.modRequest.platformProjectRoot,
      'app', 'src', 'main', 'java',
      ...packageName.split('.'),
    );
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'AlarmReliabilityModule.kt'),
      nativeModuleSource(packageName),
    );
    return config;
  },
]);

const withAlarmReliabilityPackage = (config) => withMainApplication(config, (config) => {
  let mainApp = config.modResults.contents;
  const packageMatch = mainApp.match(/package ([\w.]+)/);
  const packageName = packageMatch?.[1] || config.android?.package || 'com.anupam.lp';
  const packageImport = `import ${packageName}.AlarmReliabilityPackage`;

  if (!mainApp.includes(packageImport)) {
    mainApp = mainApp.replace(`package ${packageName}`, `package ${packageName}\n${packageImport}`);
  }
  if (!mainApp.includes('add(AlarmReliabilityPackage())')) {
    mainApp = mainApp.replace(
      /PackageList\(this\)\.packages\.apply \{\n/,
      'PackageList(this).packages.apply {\n            add(AlarmReliabilityPackage())\n',
    );
  }

  config.modResults.contents = mainApp;
  return config;
});

const alarmActivitySource = (packageName) => `package ${packageName}

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper
import io.invertase.notifee.NotifeeApiModule

class AlarmActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    super.onCreate(null)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }

  override fun getMainComponentName(): String =
    NotifeeApiModule.getMainComponent("AlarmScreen")

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {}
    )
}
`;

const withAlarmActivityFile = (config) => withDangerousMod(config, [
  'android',
  async (config) => {
    const packageName = config.android?.package || 'com.anupam.lp';
    const sourceDir = path.join(
      config.modRequest.platformProjectRoot,
      'app', 'src', 'main', 'java',
      ...packageName.split('.'),
    );
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'AlarmActivity.kt'), alarmActivitySource(packageName));
    return config;
  },
]);

const withAlarmActivityManifest = (config) => withAndroidManifest(config, (config) => {
  const mainApplication = config.modResults.manifest.application[0];
  mainApplication.activity = mainApplication.activity || [];
  let alarmActivity = mainApplication.activity.find(
    (activity) => activity.$?.['android:name'] === '.AlarmActivity',
  );
  if (!alarmActivity) {
    alarmActivity = { $: { 'android:name': '.AlarmActivity' } };
    mainApplication.activity.push(alarmActivity);
  }
  Object.assign(alarmActivity.$, {
    'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|locale|layoutDirection',
    'android:excludeFromRecents': 'true',
    'android:exported': 'false',
    'android:launchMode': 'singleTop',
    'android:screenOrientation': 'portrait',
    'android:showWhenLocked': 'true',
    'android:theme': '@style/AppTheme',
    'android:turnScreenOn': 'true',
    'android:windowSoftInputMode': 'adjustResize',
  });
  return config;
});

const withAlarmMainActivity = (config) => {
  const { withMainActivity } = require('@expo/config-plugins');
  return withMainActivity(config, (config) => {
    let mainActivity = config.modResults.contents;
    const notifeeImport = 'import io.invertase.notifee.NotifeeApiModule';

    // Anchor the import on the package declaration, which every MainActivity
    // has. A previous revision anchored on expo-splash-screen's MainActivity
    // import; newer Expo templates no longer emit it, so the import was
    // silently dropped while the override below still referenced the class,
    // failing the Kotlin build with "Unresolved reference 'NotifeeApiModule'".
    if (!mainActivity.includes(notifeeImport)) {
      const packageDeclaration = mainActivity.match(/^package .*$/m);
      if (!packageDeclaration) {
        throw new Error(
          '[withFullScreenAlarm] Could not find a package declaration in MainActivity to anchor the Notifee import.',
        );
      }
      mainActivity = mainActivity.replace(
        packageDeclaration[0],
        `${packageDeclaration[0]}\n\n${notifeeImport}`,
      );
    }

    // Notifee decides which component a launch should mount so full-screen
    // alarm deliveries can replace the normal app UI.
    const defaultMainComponent = /override fun getMainComponentName\(\): String = "main"/;
    if (defaultMainComponent.test(mainActivity)) {
      mainActivity = mainActivity.replace(
        defaultMainComponent,
        'override fun getMainComponentName(): String = NotifeeApiModule.getMainComponent("main")',
      );
    } else if (!mainActivity.includes('NotifeeApiModule.getMainComponent(')) {
      throw new Error(
        '[withFullScreenAlarm] Could not patch getMainComponentName() in MainActivity; the Expo template changed.',
      );
    }

    config.modResults.contents = mainActivity;
    return config;
  });
};

module.exports = function withFullScreenAlarm(config) {
  config = withAlarmManifest(config);
  config = withAlarmActivityManifest(config);
  config = withAlarmReliabilityFiles(config);
  config = withAlarmActivityFile(config);
  config = withAlarmReliabilityPackage(config);
  config = withAlarmMainActivity(config);
  return config;
};

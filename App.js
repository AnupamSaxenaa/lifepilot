import notifee, { EventType } from '@notifee/react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppRegistry, AppState, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initI18n } from './src/i18n';

import { PlaywriteGBJ_400Regular, useFonts } from '@expo-google-fonts/playwrite-gb-j';
import { DailyPromiseOverlay } from './src/components/DailyPromiseOverlay';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { ForceUpdateBlocker } from './src/components/ForceUpdateBlocker';
import { UpdateProgress } from './src/components/UpdateProgress';
import { XpToast } from './src/components/XpToast';
import { recoverInterruptedWakeSessions } from './src/features/alarm/ring/wakeSessionRecovery';
import { restoreAlarms } from './src/features/alarm/scheduler/bootRestore';
import { supabase } from './src/lib/supabase';
import { drainSyncQueue, setupNetworkListener } from './src/lib/syncQueue';
import { AlarmInsightsScreen } from './src/screens/AlarmInsightsScreen';
import { AlarmListScreen } from './src/screens/AlarmListScreen';
import { AlarmNfcTagsScreen } from './src/screens/AlarmNfcTagsScreen';
import { AlarmPermissionsScreen } from './src/screens/AlarmPermissionsScreen';
import { AlarmQrCodesScreen } from './src/screens/AlarmQrCodesScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import { BlockedAppScreen } from './src/screens/BlockedAppScreen';
import { ComingSoonScreen } from './src/screens/ComingSoonScreen';
import { CustomListScreen } from './src/screens/CustomListScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { FeedbackScreen } from './src/screens/FeedbackScreen';
import FocusModeScreen from './src/screens/FocusModeScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MindfulLockScreen } from './src/screens/MindfulLockScreen';
import { MindfulLockSetupScreen } from './src/screens/MindfulLockSetupScreen';
import { MorningFocusScreen } from './src/screens/MorningFocusScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { OTPScreen } from './src/screens/OTPScreen';
import { PermissionsScreen } from './src/screens/PermissionsScreen';
import { PlannedScreen } from './src/screens/PlannedScreen';
import { PromisesScreen } from './src/screens/PromisesScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StarredScreen } from './src/screens/StarredScreen';
import { TaskDetailScreen } from './src/screens/TaskDetailScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { WidgetSettingsScreen } from './src/screens/WidgetSettingsScreen';
import { cancelInactiveReminder, scheduleInactiveReminder } from './src/utils/InactiveNotifier';
import { UpdateManager } from './src/utils/updateManager';
import { checkForceUpdate } from './src/utils/versionChecker';
// 📱 Android Widgets Support
import { ALARMS_ENABLED, PLAYSTORE_MODE } from './src/config/flags';
import { ThemeProvider } from './src/context/ThemeContext';
import { initPurchases } from './src/lib/purchases';
import { MarketplaceScreen } from './src/screens/MarketplaceScreen';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { registerAllWidgets } from './src/widgets/registerWidgets';

// Notifee does not automatically mount a React screen when a trigger is
// delivered while LifePilot is already foregrounded. Keep one process-wide
// bridge so both the normal app root and the dedicated AlarmActivity can react
// to the same delivery (including ambient -> primary handoff).
const alarmEventSubscribers = new Set();
let nativeAlarmHostCount = 0;

// Only real ambient/primary alarm deliveries may mount the ring UI. Recovery
// notices deliberately carry alarmId for review/navigation, but they are not
// live alarms and must never start the controller's looping vibration.
const isAlarmNotification = (notification) => {
  const data = notification?.data;
  return !!data?.alarmId && data.recovery !== 'true';
};
const subscribeToAlarmEvents = (subscriber) => {
  alarmEventSubscribers.add(subscriber);
  return () => alarmEventSubscribers.delete(subscriber);
};
const emitAlarmEvent = (notification) => {
  if (!isAlarmNotification(notification)) return;
  alarmEventSubscribers.forEach((subscriber) => subscriber(notification));
};

if (ALARMS_ENABLED) {
  notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.DELIVERED || type === EventType.PRESS) {
      emitAlarmEvent(detail?.notification);
    }
  });
}

const alarmScreenKey = (notification) => [
  notification?.id || 'alarm',
  notification?.data?.wakeSessionId || '',
  notification?.data?.ambient || 'false',
].join(':');

const AlarmRoot = (props) => {
  const [i18nReady, setI18nReady] = useState(false);
  const [notification, setNotification] = useState(props.notification || null);
  const userId = notification?.data?.userId || null;

  useEffect(() => {
    nativeAlarmHostCount += 1;
    const unsubscribe = subscribeToAlarmEvents((nextNotification) => {
      setNotification((current) => (
        alarmScreenKey(current) === alarmScreenKey(nextNotification)
          ? current
          : nextNotification
      ));
    });
    return () => {
      unsubscribe();
      nativeAlarmHostCount = Math.max(0, nativeAlarmHostCount - 1);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    initI18n().catch(() => {}).finally(() => {
      if (mounted) setI18nReady(true);
    });
    return () => { mounted = false; };
  }, []);

  if (!i18nReady || !notification) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <ThemeProvider userId={userId} showHydrationScreen={false}>
        <SafeAreaProvider style={{ backgroundColor: '#000' }}>
          <StatusBar hidden />
          <AlarmScreen
            {...props}
            key={alarmScreenKey(notification)}
            notification={notification}
          />
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
};

if (ALARMS_ENABLED) {
  AppRegistry.registerComponent('AlarmScreen', () => AlarmRoot);

  // Trigger delivery can start JS before AlarmActivity mounts. The ring screen
  // owns dismiss/snooze actions, so the handler intentionally stays empty.
  notifee.onBackgroundEvent(async () => {});
}

// Notification actions are intentionally omitted for alarm notifications.
// Snooze/dismiss live exclusively in AlarmScreen so missions, emergency mode,
// max-snooze limits, history, and one-time auto-disable cannot be bypassed.


const Stack = createNativeStackNavigator();

// 📱 Register Android Widgets at the top level for Headless JS background tasks
if (Platform.OS === 'android') {
  console.log('[App] Registering Android widgets...');
  registerAllWidgets();
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [userId, setUserId] = useState(null);
  const [i18nReady, setI18nReady] = useState(false);
  const [foregroundAlarmNotification, setForegroundAlarmNotification] = useState(null);
  const foregroundAlarmRef = useRef(null);
  const startupAlarmRecoveryUserRef = useRef(null);
  const [fontsLoaded, fontError] = useFonts({
    PlaywriteGBJ_400Regular,
  });

  // A full-screen intent may be suppressed while the app is already visible.
  // In that case, mount the exact same ring screen over the navigator. Give a
  // newly launched AlarmActivity a short chance to claim delivery first so we
  // never create two controllers for one wake session.
  useEffect(() => {
    if (!ALARMS_ENABLED) return undefined;

    let mounted = true;
    let pendingTimer = null;
    const showInMainApp = (notification, delayForNativeHost = true) => {
      if (!isAlarmNotification(notification)) return;
      if (foregroundAlarmRef.current || !delayForNativeHost) {
        foregroundAlarmRef.current = notification;
        setForegroundAlarmNotification(notification);
        return;
      }
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (mounted && nativeAlarmHostCount === 0) {
          foregroundAlarmRef.current = notification;
          setForegroundAlarmNotification(notification);
        }
      }, 350);
    };

    const unsubscribe = subscribeToAlarmEvents((notification) => {
      showInMainApp(notification, true);
    });

    // When an older APK is cold-started through its existing MainActivity,
    // DELIVERED can occur before React subscribes. Recover the launch payload
    // explicitly so the alarm screen still replaces the normal app UI.
    notifee.getInitialNotification()
      .then((initial) => {
        if (mounted) showInMainApp(initial?.notification, false);
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unsubscribe();
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, []);

  const closeForegroundAlarm = useCallback(() => {
    foregroundAlarmRef.current = null;
    setForegroundAlarmNotification(null);
  }, []);

  // 🌐 Initialize i18n (device-locale detection + persisted user choice)
  // before anything renders, so no screen ever flashes English before
  // switching to the resolved language.
  useEffect(() => {
    initI18n().finally(() => setI18nReady(true));
  }, []);

  // OTA Update state
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateReady, setUpdateReady] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);

  // Force Update state
  const [forceUpdateRequired, setForceUpdateRequired] = useState(false);
  const [forceUpdateInfo, setForceUpdateInfo] = useState(null);
  const [checkingForceUpdate, setCheckingForceUpdate] = useState(true);

  // 🌐 Network Monitoring — Auto-sync when coming back online
  useEffect(() => {
    const unsubscribe = setupNetworkListener();
    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  // 💳 Initialize RevenueCat once we know the user — only when Play Store
  // mode is ON. Keeps billing fully out of the picture while it's off.
  useEffect(() => {
    if (userId && PLAYSTORE_MODE) {
      initPurchases(userId).catch(() => {});
    }
  }, [userId]);

  // Recover interrupted rings once per authenticated cold launch, then re-arm
  // from local cache. This also covers the cached-session offline auth path.
  useEffect(() => {
    if (!ALARMS_ENABLED || !userId || !i18nReady || startupAlarmRecoveryUserRef.current === userId) return;
    startupAlarmRecoveryUserRef.current = userId;
    (async () => {
      try {
        await recoverInterruptedWakeSessions({ force: true });
      } finally {
        await restoreAlarms();
        drainSyncQueue().catch(() => {});
      }
    })().catch((error) => {
      console.warn('[App] alarm startup recovery failed:', error?.message || error);
    });
  }, [i18nReady, userId]);

  // 🔔 Inactive Reminder — Schedule when leaving, cancel when returning
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        cancelInactiveReminder();
        if (ALARMS_ENABLED && userId && i18nReady) {
          // Widget writes and alarm recovery are both local-first. Recover any
          // stale wake session before idempotently restoring future triggers.
          drainSyncQueue().catch(() => {});
          (async () => {
            try {
              await recoverInterruptedWakeSessions({ force: false });
            } finally {
              await restoreAlarms();
            }
          })().catch((error) => {
            console.warn('[App] alarm foreground recovery failed:', error?.message || error);
          });
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (userId) {
          scheduleInactiveReminder(userId);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [i18nReady, userId]);

  useEffect(() => {
    let mounted = true;

    // Read the persisted Supabase session straight from storage. This is a pure
    // local read, so it works instantly offline — unlike `getSession()`, which
    // triggers a NETWORK token refresh when the stored token has expired and was
    // therefore the real reason an offline launch stalled.
    const readCachedSession = async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const projectRef = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace('https://', '').split('.')[0];
        if (!projectRef) return null;
        const cached = await AsyncStorage.getItem(`sb-${projectRef}-auth-token`);
        if (!cached) return null;
        const parsed = JSON.parse(cached);
        return parsed?.user?.id || null;
      } catch {
        return null;
      }
    };

    const checkAuth = async () => {
      // 1. Decide the route from cache first so the UI can paint immediately.
      let routedFromCache = false;
      const cachedUserId = await readCachedSession();
      if (mounted && cachedUserId) {
        setUserId(cachedUserId);
        setInitialRoute('Dashboard');
        routedFromCache = true;
      }

      // 2. Reconcile with Supabase in the background. A shorter timeout is fine
      //    now that nothing user-visible depends on it finishing.
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise((resolve) => setTimeout(() => resolve({ data: { session: null }, timedOut: true }), 2000)),
        ]);
        if (!mounted) return;

        const session = result?.data?.session;
        if (session) {
          setUserId(session.user.id); // ← Store userId for DailyPromiseOverlay
          setInitialRoute('Dashboard');
        } else if (!routedFromCache) {
          // No cached session and none from the server: genuinely signed out.
          setInitialRoute('Onboarding');
        }
      } catch {
        if (mounted && !routedFromCache) setInitialRoute('Onboarding');
      }
    };

    checkAuth();

    // Keep the root user identity current after an in-app login/logout. This
    // lets ThemeProvider hydrate the newly authenticated user's cached theme
    // instead of remaining on the anonymous default until the next cold start.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUserId(session?.user?.id || null);
      // Keep the mount-time route in step with auth. `initialRouteName` is only
      // read when the navigator mounts, so this changes nothing right now — it
      // is insurance: if anything ever remounts the tree, a signed-in user must
      // not be dropped back onto the signed-out intro screens.
      setInitialRoute(session?.user?.id ? 'Dashboard' : 'Onboarding');
    });

    return () => {
      mounted = false;
      data?.subscription?.unsubscribe?.();
    };
  }, []);

  // Check for FORCE UPDATE first (critical - blocks app if needed)
  // Race against a 3-second timeout so offline users aren't blocked
  useEffect(() => {
    const checkVersion = async () => {
      console.log('[ForceUpdate] Checking version requirements...');
      try {
        const result = await Promise.race([
          checkForceUpdate(),
          new Promise((resolve) => setTimeout(() => resolve({ updateRequired: false, updateInfo: null, timedOut: true }), 3000)),
        ]);

        if (result.timedOut) {
          console.log('[ForceUpdate] Timed out (offline?) — skipping force update check');
        }

        setForceUpdateRequired(result.updateRequired);
        setForceUpdateInfo(result.updateInfo);
        setCheckingForceUpdate(false);

        if (result.updateRequired) {
          console.log('[ForceUpdate] Force update required!', result.updateInfo);
        } else {
          console.log('[ForceUpdate] App version is up to date');
        }
      } catch {
        console.log('[ForceUpdate] Error checking — allowing app to proceed');
        setCheckingForceUpdate(false);
      }
    };

    checkVersion();
  }, []);

  // Check for success toast after reload
  useEffect(() => {
    const checkSuccessToast = async () => {
      const { Storage } = require('./src/utils/storage');
      const showToast = await Storage.get('showUpdateSuccessToast');
      if (showToast === 'true') {
        setUpdateStatus('success_toast');
        await Storage.remove('showUpdateSuccessToast');
      }
    };
    checkSuccessToast();
  }, []);

  // ── OTA Updates (production behavior) ────────────────────────────────────
  // Strategy: on launch (and when returning to the foreground) we quietly ask
  // the server for a new bundle and, if there is one, download it in the
  // background. We DO NOT force-reload the app mid-session — that yanks the UI
  // out from under the user. Instead the downloaded bundle applies on the next
  // natural cold start, and we surface a gentle, dismissible "Update ready"
  // banner so the user can apply it now if they want.
  const runOtaCheck = useCallback(async (force = false) => {
    if (forceUpdateRequired || !initialRoute) return;
    await UpdateManager.silentBackgroundUpdate(
      (phase) => {
        // Check silently — only surface the banner once we're actually
        // downloading a real update or it's ready to apply. No "checking..."
        // flash on every launch.
        if (phase === 'downloading') setUpdateStatus('downloading');
        else if (phase === 'ready') setUpdateStatus('ready');
      },
      () => {
        // A fresh bundle finished downloading and is ready to apply.
        setUpdateReady(true);
        setUpdateStatus('ready');
      },
      force
    );
  }, [forceUpdateRequired, initialRoute]);

  // Initial launch check (slightly delayed so it never competes with first paint)
  useEffect(() => {
    if (forceUpdateRequired || !initialRoute) return;
    const timer = setTimeout(() => { runOtaCheck(false); }, 2500);
    return () => clearTimeout(timer);
  }, [initialRoute, forceUpdateRequired, runOtaCheck]);

  // Re-check when the app returns to the foreground (common way users get
  // updates without ever fully closing the app).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') runOtaCheck(false);
    });
    return () => sub.remove();
  }, [runOtaCheck]);

  // User tapped "Apply" on the update-ready banner — reload into the new bundle.
  const handleApplyUpdate = useCallback(async () => {
    setApplyingUpdate(true);
    setUpdateStatus('reloading');
    const ok = await UpdateManager.applyUpdate();
    // If reload succeeds the app restarts and this never returns; if it fails,
    // reset so the banner can be tried again.
    if (!ok) {
      setApplyingUpdate(false);
      setUpdateStatus('ready');
    }
  }, []);

  // First paint waits ONLY on local work: fonts, i18n, and the route decision
  // (which resolves from cached storage). The force-update check is deliberately
  // NOT here — it is a network call, and gating on it meant an offline launch sat
  // on a blank screen until its timeout fired. ForceUpdateBlocker is an overlay,
  // so it can appear a moment later without holding the whole app hostage.
  if ((!fontsLoaded && !fontError) || !initialRoute || !i18nReady) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        <ThemeProvider userId={userId}>
        <SafeAreaProvider style={{ backgroundColor: '#000' }}>
          <StatusBar style="light" />
          <NavigationContainer 
            theme={DarkTheme}
            linking={{
              prefixes: ['lifepilot://', 'lifepilot-alpha://'],
              config: {
                screens: {
                  Today: 'today',
                  Settings: 'settings',
                  WidgetSettings: 'widget-settings',
                  ...(ALARMS_ENABLED ? { MorningFocus: 'morning-focus' } : {}),
                  TaskDetail: 'task/:taskId',
                  MindfulLock: 'mindful-lock-dashboard',
                  BlockedApp: 'blocked',
                  BlockedAppLegacy: 'mindful-lock',
                }
              }
            }}
          >
            <Stack.Navigator 
              initialRouteName={initialRoute}
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#000' },
                animation: 'none',
              }}
            >
              <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ animation: 'fade' }} />
              <Stack.Screen name="Login" component={LoginScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="Register" component={RegisterScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="OTP" component={OTPScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="Dashboard" component={DashboardScreen} />
              <Stack.Screen name="Today" component={TodayScreen} />
              <Stack.Screen name="Starred" component={StarredScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="WidgetSettings" component={WidgetSettingsScreen} />
              <Stack.Screen name="Permissions" component={PermissionsScreen} />
              <Stack.Screen name="Planned" component={PlannedScreen} />
              <Stack.Screen name="Promises" component={PromisesScreen} />
              <Stack.Screen name="History" component={HistoryScreen} />
              <Stack.Screen name="CustomList" component={CustomListScreen} />
              {ALARMS_ENABLED && (
                <>
                  <Stack.Screen name="AlarmList" component={AlarmListScreen} />
                  <Stack.Screen name="MorningFocus" component={MorningFocusScreen} options={{ animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="AlarmPermissions" component={AlarmPermissionsScreen} options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="AlarmInsights" component={AlarmInsightsScreen} options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="AlarmQrCodes" component={AlarmQrCodesScreen} options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="AlarmNfcTags" component={AlarmNfcTagsScreen} options={{ animation: 'slide_from_right' }} />
                </>
              )}
              <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="ComingSoon" component={ComingSoonScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen 
                name="TaskDetail" 
                component={TaskDetailScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen 
                name="FocusMode" 
                component={FocusModeScreen}
                options={{ animation: 'fade' }}
              />
              <Stack.Screen name="MindfulLock" component={MindfulLockScreen} />
              <Stack.Screen 
                name="MindfulLockSetup" 
                component={MindfulLockSetupScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen name="BlockedApp" component={BlockedAppScreen} />
              <Stack.Screen name="BlockedAppLegacy" component={BlockedAppScreen} />
              <Stack.Screen name="Marketplace" component={MarketplaceScreen} options={{ animation: 'slide_from_right' }} />
              {PLAYSTORE_MODE && (
                <Stack.Screen name="Paywall" component={PaywallScreen} options={{ animation: 'slide_from_bottom' }} />
              )}
            </Stack.Navigator>
          </NavigationContainer>

          {/* Daily Promise Popup - Shows once per day on app launch */}
          {userId && <DailyPromiseOverlay userId={userId} />}

          {/* OTA Update Progress UI - Shows at bottom when updating.
              When an update has finished downloading it becomes a gentle,
              dismissible "Update ready — Apply" banner instead of force-reloading. */}
          <UpdateProgress
            status={updateStatus}
            progress={updateProgress}
            updateReady={updateReady}
            applying={applyingUpdate}
            onApply={handleApplyUpdate}
            onDismiss={() => { setUpdateReady(false); setUpdateStatus(null); }}
          />

          {/* Force Update Blocker - Full screen overlay when APK update required */}
          <ForceUpdateBlocker 
            visible={forceUpdateRequired} 
            updateInfo={forceUpdateInfo} 
          />

          {/* Global XP gain/loss popup (fires on every task/step complete) */}
          <XpToast />

          {/* Android may suppress a full-screen intent while this activity is
              already visible. Delivery still becomes the real ring UI here,
              not a notification-only experience. */}
          {ALARMS_ENABLED && foregroundAlarmNotification && (
            <View style={styles.foregroundAlarmOverlay}>
              <StatusBar hidden />
              <AlarmScreen
                key={alarmScreenKey(foregroundAlarmNotification)}
                notification={foregroundAlarmNotification}
                onClose={closeForegroundAlarm}
              />
            </View>
          )}
        </SafeAreaProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  foregroundAlarmOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
    backgroundColor: '#000',
  },
});

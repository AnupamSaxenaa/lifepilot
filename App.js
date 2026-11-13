import notifee, { EventType } from '@notifee/react-native';
import NetInfo from '@react-native-community/netinfo';
import { createNavigationContainerRef, DarkTheme, NavigationContainer } from '@react-navigation/native';
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
import { refreshCollaboration } from './src/lib/collaborationManager';
import {
    startCollaborationRealtime,
    stopCollaborationRealtime
} from './src/lib/collaborationRealtime';
import { getCurrentUserId, setAuthenticatedUser, setCurrentUserId } from './src/lib/dataManager';
import { completeOAuthFromInitialUrl, subscribeOAuthRedirects } from './src/lib/oauthRecovery';
import { endPresence, startPresence, stopPresence } from './src/lib/presenceManager';
import { supabase } from './src/lib/supabase';
import { drainSyncQueue, getSyncState, setActiveSyncUser, setupNetworkListener } from './src/lib/syncQueue';
import { AlarmInsightsScreen } from './src/screens/AlarmInsightsScreen';
import { AlarmListScreen } from './src/screens/AlarmListScreen';
import { AlarmNfcTagsScreen } from './src/screens/AlarmNfcTagsScreen';
import { AlarmPermissionsScreen } from './src/screens/AlarmPermissionsScreen';
import { AlarmQrCodesScreen } from './src/screens/AlarmQrCodesScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import { BlockedAppScreen } from './src/screens/BlockedAppScreen';
import { CollaborationInboxScreen } from './src/screens/CollaborationInboxScreen';
import { ComingSoonScreen } from './src/screens/ComingSoonScreen';
import { CreateHustleRoomScreen } from './src/screens/CreateHustleRoomScreen';
import { CustomListScreen } from './src/screens/CustomListScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { FeedbackScreen } from './src/screens/FeedbackScreen';
import FocusModeScreen from './src/screens/FocusModeScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { HustleRoomScreen } from './src/screens/HustleRoomScreen';
import { HustleRoomsScreen } from './src/screens/HustleRoomsScreen';
import { HustlersScreen } from './src/screens/HustlersScreen';
import InviteAcceptanceRoute from './src/screens/InviteAcceptanceScreen';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
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
import { cancelInactiveReminder, handleReminderDismissed, isInactiveReminder, scheduleInactiveReminder } from './src/utils/InactiveNotifier';
import { UpdateManager } from './src/utils/updateManager';
import { checkForceUpdate } from './src/utils/versionChecker';
// 📱 Android Widgets Support
import { ALARMS_ENABLED, HUSTLERS_ENABLED, PLAYSTORE_MODE } from './src/config/flags';
import { ProProvider } from './src/context/ProContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { isRewardedAdAvailable } from './src/lib/adRewards';
import { initPurchases } from './src/lib/purchases';
import { CreditStoreScreen } from './src/screens/CreditStoreScreen';
import { MarketplaceScreen } from './src/screens/MarketplaceScreen';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { WhatsNewScreen } from './src/screens/WhatsNewScreen';
import {
    handleHustleRoomNotificationAction,
    HUSTLE_ROOM_ACTIONS,
} from './src/utils/hustleRoomNotifications';
import { Storage } from './src/utils/storage';
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

const PENDING_HUSTLE_ROOM_PRESS_KEY = 'pending_hustle_room_press';
const hustleRoomPressSubscribers = new Set();
let pendingHustleRoomId = null;
let pendingHustleRoomUserId = null;
const isHustleRoomNotification = (notification) => (
  notification?.data?.type === 'hustle_room' && notification?.data?.roomId
);
const subscribeToHustleRoomPresses = (subscriber) => {
  hustleRoomPressSubscribers.add(subscriber);
  return () => hustleRoomPressSubscribers.delete(subscriber);
};
const emitHustleRoomPress = (notification) => {
  if (!isHustleRoomNotification(notification)) return;
  pendingHustleRoomId = String(notification.data.roomId);
  pendingHustleRoomUserId = notification.data.userId ? String(notification.data.userId) : null;
  hustleRoomPressSubscribers.forEach((subscriber) => subscriber(
    pendingHustleRoomId,
    pendingHustleRoomUserId,
  ));
};
const persistHustleRoomPress = async (notification) => {
  if (!isHustleRoomNotification(notification)) return;
  await Storage.set(PENDING_HUSTLE_ROOM_PRESS_KEY, {
    roomId: String(notification.data.roomId),
    userId: notification.data.userId ? String(notification.data.userId) : null,
    pressedAt: new Date().toISOString(),
  });
};

const isHustleRoomAction = (notification, pressActionId) => (
  isHustleRoomNotification(notification)
  && Object.values(HUSTLE_ROOM_ACTIONS).includes(pressActionId)
);

// Notifee permits one process-wide foreground and one background handler.
/**
 * Resolve the signed-in user and schedule the next inactivity reminder.
 *
 * These notifee handlers are registered at module scope, so there is no component
 * state to read the id from. getCurrentUserId resolves from memory or AsyncStorage
 * with no network call, which is what a background handler needs.
 */
const rearmInactiveReminder = async () => {
  try {
    const userId = await getCurrentUserId();
    if (userId) await handleReminderDismissed(userId);
  } catch {
    // A missed re-arm is recoverable: opening the app schedules one again.
  }
};

// Dispatch by notification type so Focus Room actions never disable alarms.
notifee.onForegroundEvent(({ type, detail }) => {
  if (ALARMS_ENABLED && (type === EventType.DELIVERED || type === EventType.PRESS)) {
    emitAlarmEvent(detail?.notification);
  }
  if (type === EventType.ACTION_PRESS && isHustleRoomAction(detail?.notification, detail?.pressAction?.id)) {
    handleHustleRoomNotificationAction(detail.notification, detail.pressAction.id);
    return;
  }
  if (type === EventType.PRESS) emitHustleRoomPress(detail?.notification);
  // Clearing a nudge is what arms the next one. Only one reminder is ever
  // scheduled at a time now, so without this the series would stop after the
  // first — see the cadence note in InactiveNotifier.
  if (type === EventType.DISMISSED && isInactiveReminder(detail?.notification)) {
    rearmInactiveReminder();
  }
});
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS && isHustleRoomAction(detail?.notification, detail?.pressAction?.id)) {
    await handleHustleRoomNotificationAction(detail.notification, detail.pressAction.id);
    return;
  }
  if (type === EventType.PRESS && isHustleRoomNotification(detail?.notification)) {
    await persistHustleRoomPress(detail.notification);
    emitHustleRoomPress(detail.notification);
  }
  // Dismissals almost always happen with the app in the background, so this is
  // the branch that matters most for keeping reminders going.
  if (type === EventType.DISMISSED && isInactiveReminder(detail?.notification)) {
    await rearmInactiveReminder();
  }
});

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
}

// Notification actions are intentionally omitted for alarm notifications.
// Snooze/dismiss live exclusively in AlarmScreen so missions, emergency mode,
// max-snooze limits, history, and one-time auto-disable cannot be bypassed.


const Stack = createNativeStackNavigator();
const rootNavigationRef = createNavigationContainerRef();

// 📱 Register Android Widgets at the top level for Headless JS background tasks
if (Platform.OS === 'android') {
  console.log('[App] Registering Android widgets...');
  registerAllWidgets();
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [userId, setUserId] = useState(null);
  const [navigationReady, setNavigationReady] = useState(false);
  const [i18nReady, setI18nReady] = useState(false);
  const [foregroundAlarmNotification, setForegroundAlarmNotification] = useState(null);
  const foregroundAlarmRef = useRef(null);
  const initialHustleRoomPressCheckedRef = useRef(false);
  const hustleRoomOpenInFlightRef = useRef(null);
  const storedHustleRoomPressUserRef = useRef(null);
  const startupAlarmRecoveryUserRef = useRef(null);
  const collaborationGenerationRef = useRef(0);
  const collaborationLifecycleRef = useRef(Promise.resolve());
  // Kick off the font load but do not read its state: nothing gates on it any
  // more (see the first-paint comment below). The hook still has to be called so
  // the font is registered and becomes available once loaded.
  useFonts({
    PlaywriteGBJ_400Regular,
  });

  // Notification presses reopen the exact room. Background presses are also
  // persisted because a headless handler and the launched app may run in
  // different JS processes. Consume only after auth and navigation are ready.
  useEffect(() => {
    const openRoom = async (roomId, targetUserId = pendingHustleRoomUserId) => {
      if (!roomId) return;
      pendingHustleRoomId = String(roomId);
      pendingHustleRoomUserId = targetUserId ? String(targetUserId) : null;
      if (!userId || !navigationReady || !rootNavigationRef.isReady()) return;
      if (pendingHustleRoomUserId && pendingHustleRoomUserId !== String(userId)) return;

      const openedRoomId = pendingHustleRoomId;
      if (hustleRoomOpenInFlightRef.current === openedRoomId) return;
      hustleRoomOpenInFlightRef.current = openedRoomId;
      rootNavigationRef.navigate('HustleRoom', { roomId: openedRoomId });
      pendingHustleRoomId = null;
      pendingHustleRoomUserId = null;

      try {
        const persisted = await Storage.get(PENDING_HUSTLE_ROOM_PRESS_KEY);
        if (persisted?.roomId && String(persisted.roomId) === openedRoomId) {
          await Storage.remove(PENDING_HUSTLE_ROOM_PRESS_KEY);
        }
      } finally {
        if (hustleRoomOpenInFlightRef.current === openedRoomId) {
          hustleRoomOpenInFlightRef.current = null;
        }
      }
    };

    const unsubscribe = subscribeToHustleRoomPresses(openRoom);
    if (pendingHustleRoomId) {
      openRoom(pendingHustleRoomId, pendingHustleRoomUserId).catch(() => {});
    }

    if (userId && navigationReady && storedHustleRoomPressUserRef.current !== String(userId)) {
      storedHustleRoomPressUserRef.current = String(userId);
      Storage.get(PENDING_HUSTLE_ROOM_PRESS_KEY).then((persisted) => {
        if (!persisted?.roomId) return;
        openRoom(persisted.roomId, persisted.userId).catch(() => {});
      }).catch(() => {});
    }

    if (userId && navigationReady && !initialHustleRoomPressCheckedRef.current) {
      initialHustleRoomPressCheckedRef.current = true;
      notifee.getInitialNotification()
        .then((initial) => {
          if (isHustleRoomNotification(initial?.notification)) {
            openRoom(
              initial.notification.data.roomId,
              initial.notification.data.userId,
            ).catch(() => {});
          }
        })
        .catch(() => {});
    }
    return unsubscribe;
  }, [navigationReady, userId]);

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

  // Keep offline mutations and collaboration data scoped to the current
  // identity. Serialize coordinator transitions so a slow auth lookup for an
  // old identity can never replace the newer user's single coordinator. All
  // remote work remains fire-and-forget and starts only after first paint.
  useEffect(() => {
    const generation = collaborationGenerationRef.current + 1;
    collaborationGenerationRef.current = generation;
    setActiveSyncUser(userId);

    collaborationLifecycleRef.current = collaborationLifecycleRef.current
      .catch(() => {})
      .then(async () => {
        await stopCollaborationRealtime().catch(() => {});
        if (generation !== collaborationGenerationRef.current || !userId) return;

        // setActiveSyncUser scopes this drain to anonymous/legacy entries and
        // mutations owned by the authenticated identity. Verified-online
        // reconnect below performs the authoritative remote refresh.
        drainSyncQueue().catch(() => {});
        if (!getSyncState().online) return;
        refreshCollaboration(userId).catch(() => {});

        try {
          const stop = await startCollaborationRealtime(userId);
          if (generation !== collaborationGenerationRef.current) {
            await stop().catch(() => {});
          }
        } catch {
          // Offline launches keep cached collaboration data and retry later.
        }
      });

    return () => {
      if (collaborationGenerationRef.current === generation) {
        collaborationGenerationRef.current += 1;
      }
      setActiveSyncUser(null);
      stopCollaborationRealtime().catch(() => {});
    };
  }, [userId]);

  // If the first coordinator start happened while offline, retry as soon as a
  // verified connection appears. Supabase channels reconnect themselves once
  // created; this covers the earlier failure where no channel existed at all.
  useEffect(() => {
    if (!userId) return undefined;
    const generation = collaborationGenerationRef.current;
    let awaitingOnline = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable === true;
      if (!online) {
        awaitingOnline = true;
        return;
      }
      if (!awaitingOnline) return;
      awaitingOnline = false;
      collaborationLifecycleRef.current = collaborationLifecycleRef.current
        .catch(() => {})
        .then(async () => {
          if (generation !== collaborationGenerationRef.current) return;
          await drainSyncQueue().catch(() => {});
          await refreshCollaboration(userId).catch(() => {});
          try {
            const stop = await startCollaborationRealtime(userId);
            if (generation !== collaborationGenerationRef.current) await stop().catch(() => {});
          } catch {
            // A later NetInfo transition or foreground refresh will retry.
          }
        });
    });
    return unsubscribe;
  }, [userId]);

  // Presence belongs to the authenticated app lifecycle, not the Hustlers
  // screen. Ending on background makes a graceful departure immediately
  // visible; timestamp decay still handles crashes, force-kills, and no signal.
  useEffect(() => {
    if (!HUSTLERS_ENABLED || !userId) return undefined;

    const handleAppState = (nextState) => {
      if (nextState === 'active') startPresence(userId);
      else if (nextState === 'inactive' || nextState === 'background') endPresence(userId);
    };

    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') {
      startPresence(userId);
    }
    const subscription = AppState.addEventListener('change', handleAppState);

    return () => {
      subscription.remove();
      stopPresence(userId);
    };
  }, [userId]);

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
        // Core offline mutations must retry on every foreground transition,
        // independently of whether the optional alarm system is enabled.
        if (userId) drainSyncQueue().catch(() => {});
        if (ALARMS_ENABLED && userId && i18nReady) {
          // Alarm recovery remains feature-gated and local-first.
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
        if (projectRef) {
          const cached = await AsyncStorage.getItem(`sb-${projectRef}-auth-token`);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed?.user?.id) {
              await setAuthenticatedUser(parsed.user);
              return parsed.user.id;
            }
          }
        }
      } catch {
        // A malformed/missing auth token is signed-out state. The widget pointer
        // alone must never authenticate a user or select another account cache.
      }
      await setCurrentUserId(null);
      return null;
    };

    const checkAuth = async () => {
      // 0. If the app was cold-started BY an OAuth redirect, finish the sign-in
      //    before deciding anything. This happens when Android kills the app
      //    while the sign-in browser is in the foreground: the promise awaiting
      //    the redirect dies, so without this the authorisation code is dropped
      //    and the user is returned to onboarding as though they never signed in.
      //    The PKCE verifier lives in AsyncStorage, so the code is still valid.
      const recovered = await completeOAuthFromInitialUrl();
      if (recovered?.user) {
        await setAuthenticatedUser(recovered.user);
        if (!mounted) return;
        setUserId(recovered.user.id);
        setInitialRoute('Dashboard');
        return;
      }

      // 1. Decide the route from cache only, so first paint never waits for a
      //    session refresh or any other network request.
      const cachedUserId = await readCachedSession();
      if (!mounted) return;
      setUserId(cachedUserId);
      setInitialRoute(cachedUserId ? 'Dashboard' : 'Onboarding');

      // 2. Reconcile with Supabase in the background. Nothing user-visible
      //    depends on this request finishing.
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise((resolve) => setTimeout(() => resolve({ data: { session: null }, timedOut: true }), 2000)),
        ]);
        if (!mounted) return;

        const session = result?.data?.session;
        if (session) {
          await setAuthenticatedUser(session.user);
          if (!mounted) return;
          setUserId(session.user.id);
          setInitialRoute('Dashboard');
        } else if (!result?.timedOut) {
          await setCurrentUserId(null);
          if (!mounted) return;
          setUserId(null);
          setInitialRoute('Onboarding');
        }
      } catch {
        // Cached identity and the already-painted route remain authoritative
        // while offline; auth state events will reconcile them later.
      }
    };

    checkAuth();

    // Keep the root user identity current after an in-app login/logout. This
    // lets ThemeProvider hydrate the newly authenticated user's cached theme
    // instead of remaining on the anonymous default until the next cold start.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const nextUserId = session?.user?.id || null;
      setUserId(nextUserId);
      if (session?.user) setAuthenticatedUser(session.user).catch(() => {});
      else setCurrentUserId(null).catch(() => {});
      // Keep the mount-time route in step with auth. `initialRouteName` is only
      // read when the navigator mounts, so this changes nothing right now — it
      // is insurance: if anything ever remounts the tree, a signed-in user must
      // not be dropped back onto the signed-out intro screens.
      setInitialRoute(nextUserId ? 'Dashboard' : 'Onboarding');
    });

    // Warm returns: the process survived but the promise awaiting the sign-in
    // redirect did not (for example the activity was recreated while the browser
    // was in front). onAuthStateChange above then does the routing for us.
    const unsubscribeOAuth = subscribeOAuthRedirects(async (session) => {
      if (!mounted || !session?.user) return;
      await setAuthenticatedUser(session.user);
      if (!mounted) return;
      setUserId(session.user.id);
      setInitialRoute('Dashboard');
    });

    return () => {
      mounted = false;
      data?.subscription?.unsubscribe?.();
      unsubscribeOAuth();
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

  // First paint waits ONLY on what every screen genuinely needs:
  //   i18nReady    — all visible text comes from translations, so rendering
  //                  before it would flash translation keys
  //   initialRoute — the navigator needs a starting route; resolved from cached
  //                  storage, no network
  //
  // Deliberately NOT gated on:
  //   fonts        — `PlaywriteGBJ_400Regular` is decorative and referenced by a
  //                  single style rule on one screen (PlannedScreen). Blocking
  //                  every launch on a font almost nobody sees first meant a black
  //                  screen for as long as it took to read and parse from disk.
  //                  It now loads in the background; until it arrives that one
  //                  label falls back to the system font, which is a far better
  //                  trade than delaying the whole app.
  //   force-update — a network call. Gating on it left offline launches on a
  //                  blank screen until the timeout fired. ForceUpdateBlocker is
  //                  an overlay, so it can arrive a moment later instead.
  if (!initialRoute || !i18nReady) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        <ThemeProvider userId={userId}>
        <ProProvider userId={userId}>
        <SafeAreaProvider style={{ backgroundColor: '#000' }}>
          <StatusBar style="light" />
          <NavigationContainer
            ref={rootNavigationRef}
            onReady={() => setNavigationReady(true)}
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
                  InviteAcceptance: 'invite/:token',
                  CollaborationInbox: 'collaboration',
                  HustleRooms: 'hustle-rooms',
                  HustleRoom: 'hustle-room/:roomId',
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
              <Stack.Screen name="InviteAcceptance" component={InviteAcceptanceRoute} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="Hustlers" component={HustlersScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="HustleRooms" component={HustleRoomsScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="CreateHustleRoom" component={CreateHustleRoomScreen} options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="HustleRoom" component={HustleRoomScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="CollaborationInbox" component={CollaborationInboxScreen} options={{ animation: 'slide_from_right' }} />
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
              <Stack.Screen name="WhatsNew" component={WhatsNewScreen} options={{ animation: 'slide_from_right' }} />
              {PLAYSTORE_MODE && (
                <Stack.Screen name="Paywall" component={PaywallScreen} options={{ animation: 'slide_from_bottom' }} />
              )}
              {/* CreditStore must be registered whenever EITHER purchases or
                  rewarded ads exist. Registering it on PLAYSTORE_MODE alone
                  meant the Settings entry could be visible (ads configured,
                  billing off) while the route did not exist, so tapping it threw
                  "The action 'NAVIGATE' was not handled by any navigator".
                  The screen hides its purchase packs on its own. */}
              {(PLAYSTORE_MODE || isRewardedAdAvailable()) && (
                <Stack.Screen name="CreditStore" component={CreditStoreScreen} options={{ animation: 'slide_from_right' }} />
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
        </ProProvider>
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

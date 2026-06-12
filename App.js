import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';

import { PlaywriteGBJ_400Regular, useFonts } from '@expo-google-fonts/playwrite-gb-j';
import notifee, { EventType } from '@notifee/react-native';
import { AppRegistry, Platform } from 'react-native';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { ForceUpdateBlocker } from './src/components/ForceUpdateBlocker';
import { UpdateProgress } from './src/components/UpdateProgress';
import { supabase } from './src/lib/supabase';
import { drainSyncQueue } from './src/lib/syncQueue';
import { AlarmListScreen } from './src/screens/AlarmListScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import { CustomListScreen } from './src/screens/CustomListScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import FocusModeScreen from './src/screens/FocusModeScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
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
import { scheduleSnoozeAlarm } from './src/utils/AlarmManager';
import { UpdateManager } from './src/utils/updateManager';
import { checkForceUpdate } from './src/utils/versionChecker';
// 📱 Android Widgets Support
import { registerAllWidgets } from './src/widgets/registerWidgets';

AppRegistry.registerComponent('AlarmScreen', () => AlarmScreen);

notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;

  if (type === EventType.ACTION_PRESS && pressAction?.id === 'snooze') {
    await notifee.cancelNotification(notification.id);
    await scheduleSnoozeAlarm(Date.now() + 5 * 60 * 1000); // Default to 5m via notification button
  }

  if (type === EventType.ACTION_PRESS && pressAction?.id === 'dismiss') {
    await notifee.cancelNotification(notification.id);
  }
});

const Stack = createNativeStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [fontsLoaded, fontError] = useFonts({
    PlaywriteGBJ_400Regular,
  });

  // OTA Update state
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);

  // Force Update state
  const [forceUpdateRequired, setForceUpdateRequired] = useState(false);
  const [forceUpdateInfo, setForceUpdateInfo] = useState(null);
  const [checkingForceUpdate, setCheckingForceUpdate] = useState(true);

  // 📱 Register Android Widgets on app startup
  useEffect(() => {
    if (Platform.OS === 'android') {
      console.log('[App] Registering Android widgets...');
      registerAllWidgets();
    }
  }, []);

  // 🌐 Network Monitoring — Auto-sync when coming online
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable) {
        console.log('[NetInfo] Network connected, draining sync queue...');
        drainSyncQueue().catch(err => {
          console.error('[NetInfo] Sync queue drain failed:', err);
        });
      } else if (state.isConnected === false) {
        console.log('[NetInfo] Network disconnected - app will continue working offline');
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Drain any offline mutations from previous session
        drainSyncQueue().catch(() => {});
        setInitialRoute('Dashboard');
      } else {
        setInitialRoute('Onboarding');
      }
    };
    checkAuth();
  }, []);

  // Check for FORCE UPDATE first (critical - blocks app if needed)
  useEffect(() => {
    const checkVersion = async () => {
      console.log('[ForceUpdate] Checking version requirements...');
      const { updateRequired, updateInfo } = await checkForceUpdate();
      
      setForceUpdateRequired(updateRequired);
      setForceUpdateInfo(updateInfo);
      setCheckingForceUpdate(false);

      if (updateRequired) {
        console.log('[ForceUpdate] Force update required!', updateInfo);
      } else {
        console.log('[ForceUpdate] App version is up to date');
      }
    };

    checkVersion();
  }, []);

  // Check for OTA updates on app launch (only if no force update required)
  useEffect(() => {
    const checkForUpdates = async () => {
      // Don't check OTA if force update is required
      if (forceUpdateRequired) return;
      
      // Only check after app is initialized
      if (!initialRoute) return;

      // Wait 2 seconds after launch to check for updates (don't block app load)
      setTimeout(async () => {
        await UpdateManager.checkAndUpdate(
          // Progress callback
          (progress) => {
            setUpdateProgress(progress);
          },
          // Status callback
          (status) => {
            setUpdateStatus(status);
            console.log('[OTA] Status:', status);
          }
        );
      }, 2000);
    };

    checkForUpdates();
  }, [initialRoute, forceUpdateRequired]);

  // Show loading while checking force update
  if ((!fontsLoaded && !fontError) || !initialRoute || checkingForceUpdate) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        <SafeAreaProvider style={{ backgroundColor: '#000' }}>
          <StatusBar style="light" />
          <NavigationContainer theme={DarkTheme}>
            <Stack.Navigator 
              initialRouteName={initialRoute}
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#000' },
                animation: 'none',
              }}
            >
              <Stack.Screen name="Onboarding" component={OnboardingScreen} />
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Register" component={RegisterScreen} />
              <Stack.Screen name="OTP" component={OTPScreen} />
              <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
              <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
              <Stack.Screen name="Dashboard" component={DashboardScreen} />
              <Stack.Screen name="Today" component={TodayScreen} />
              <Stack.Screen name="Starred" component={StarredScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="Permissions" component={PermissionsScreen} />
              <Stack.Screen name="Planned" component={PlannedScreen} />
              <Stack.Screen name="Promises" component={PromisesScreen} />
              <Stack.Screen name="History" component={HistoryScreen} />
              <Stack.Screen name="CustomList" component={CustomListScreen} />
              <Stack.Screen name="AlarmList" component={AlarmListScreen} />
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
            </Stack.Navigator>
          </NavigationContainer>

          {/* OTA Update Progress UI - Shows at bottom when updating */}
          <UpdateProgress status={updateStatus} progress={updateProgress} />

          {/* Force Update Blocker - Full screen overlay when APK update required */}
          <ForceUpdateBlocker 
            visible={forceUpdateRequired} 
            updateInfo={forceUpdateInfo} 
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

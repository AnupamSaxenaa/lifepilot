import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TasksScreen } from './src/screens/TasksScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { OTPScreen } from './src/screens/OTPScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StarredScreen } from './src/screens/StarredScreen';
import { PromisesScreen } from './src/screens/PromisesScreen';
import { PlannedScreen } from './src/screens/PlannedScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { TaskDetailScreen } from './src/screens/TaskDetailScreen';
import { AlarmListScreen } from './src/screens/AlarmListScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import { useFonts, PlaywriteGBJ_400Regular } from '@expo-google-fonts/playwrite-gb-j';
import { supabase } from './src/lib/supabase';
import { drainSyncQueue } from './src/lib/syncQueue';
import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { scheduleSnoozeAlarm } from './src/utils/AlarmManager';

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
  const [fontsLoaded] = useFonts({
    PlaywriteGBJ_400Regular,
  });

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

  if (!fontsLoaded || !initialRoute) {
    return null;
  }

  return (
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
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

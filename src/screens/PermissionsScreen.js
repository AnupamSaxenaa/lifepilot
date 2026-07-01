import notifee from '@notifee/react-native';
import * as Calendar from 'expo-calendar';
import * as IntentLauncher from 'expo-intent-launcher';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { ArrowLeft, Bell, Calendar as CalendarIcon, CheckCircle2, Mic, Settings, XCircle, Shield } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, NativeModules } from 'react-native';
const { AppBlocker } = NativeModules;
import { SafeAreaView } from 'react-native-safe-area-context';

const PermissionItem = ({ title, description, icon: Icon, isGranted, onRequest, isAndroidOnly }) => {
  if (isAndroidOnly && Platform.OS !== 'android') return null;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        if (isGranted) {
          Alert.alert(
            'Already Granted',
            'This permission is already granted. You can manage it in your device settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() }
            ]
          );
        } else {
          onRequest();
        }
      }}
      style={styles.permissionItem}
    >
      <View style={styles.permissionLeft}>
        <View style={[styles.iconCircle, isGranted && styles.iconCircleGranted]}>
          <Icon color={isGranted ? '#fff' : '#A855F7'} size={20} />
        </View>
        <View style={styles.permissionText}>
          <Text style={styles.permissionTitle}>{title}</Text>
          <Text style={styles.permissionDesc}>{description}</Text>
        </View>
      </View>
      
      <View style={styles.permissionRight}>
        {isGranted ? (
          <CheckCircle2 color="#22c55e" size={24} />
        ) : (
          <XCircle color="#444" size={24} />
        )}
      </View>
    </TouchableOpacity>
  );
};
export const PermissionsScreen = ({ navigation }) => {
  const [permissions, setPermissions] = useState({
    notifications: false,
    calendar: false,
    microphone: false,
    fullScreenIntent: true, // Android only
    accessibility: false,
  });

  const checkPermissions = async () => {
    try {
      // 1. Notifications
      const notifSettings = await notifee.getNotificationSettings();
      const hasNotifications = notifSettings.authorizationStatus === 1; // AUTHORIZED
      console.log('[Permissions] Notifications:', hasNotifications, notifSettings);

      // 2. Calendar (new API - non-deprecated)
      let hasCalendar = false;
      try {
        const { status } = await Calendar.getCalendarPermissions();
        hasCalendar = status === 'granted';
        console.log('[Permissions] Calendar:', hasCalendar);
      } catch (e) {
        hasCalendar = false;
        console.log('[Permissions] Calendar check error:', e.message);
      }

      // 3. Microphone
      const micStatus = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      const hasMic = micStatus.granted;
      console.log('[Permissions] Microphone:', hasMic, micStatus);

      // 4. Full Screen Intent (Android Alarms)
      let hasFullScreen = true;
      if (Platform.OS === 'android') {
        const settings = await notifee.getNotificationSettings();
        hasFullScreen = settings.android?.canUseFullScreenIntent !== false;
        console.log('[Permissions] Full Screen:', hasFullScreen);
      }

      // 5. Accessibility
      let hasAccessibility = false;
      if (Platform.OS === 'android' && AppBlocker) {
        hasAccessibility = await AppBlocker.isAccessibilityServiceEnabled();
        console.log('[Permissions] Accessibility:', hasAccessibility);
      }

      setPermissions({
        notifications: hasNotifications,
        calendar: hasCalendar,
        microphone: hasMic,
        fullScreenIntent: hasFullScreen,
        accessibility: hasAccessibility,
      });
      
      console.log('[Permissions] Final state:', {
        notifications: hasNotifications,
        calendar: hasCalendar,
        microphone: hasMic,
        fullScreenIntent: hasFullScreen,
        accessibility: hasAccessibility,
      });
    } catch (e) {
      console.error('[Permissions] Error checking permissions:', e);
    }
  };

  useEffect(() => {
    checkPermissions();
    // Re-check when app comes back to foreground (user might have changed settings)
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkPermissions();
      }
    });
    return () => subscription.remove();
  }, []);

  const handleRequestNotification = async () => {
    try {
      console.log('[Permissions] Requesting notification permission...');
      const result = await notifee.requestPermission();
      console.log('[Permissions] Notification result:', result);
      
      if (result.authorizationStatus === 1) {
        Alert.alert('Success', 'Notifications enabled!');
      } else {
        // OS didn't show dialog — open settings directly
        Alert.alert(
          'Permission Required',
          'Please enable Notifications for LifePilot in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
      }
      await checkPermissions();
    } catch (error) {
      console.error('[Permissions] Notification error:', error);
      Alert.alert(
        'Permission Required',
        'Could not request permission directly. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() }
        ]
      );
    }
  };

  const handleRequestCalendar = async () => {
    try {
      console.log('[Permissions] Requesting calendar permission...');
      let granted = false;
      
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const perm = PermissionsAndroid.PERMISSIONS.READ_CALENDAR;
        let status = await PermissionsAndroid.check(perm);
        if (!status) {
          const req = await PermissionsAndroid.request(perm);
          status = req === PermissionsAndroid.RESULTS.GRANTED;
        }
        granted = status;
      } else {
        let result = await Calendar.getCalendarPermissionsAsync();
        if (result.status !== 'granted') {
          result = await Calendar.requestCalendarPermissionsAsync();
        }
        granted = result.status === 'granted';
      }
      
      console.log('[Permissions] Calendar result:', granted);
      
      if (granted) {
        Alert.alert('Success', 'Calendar access granted!');
      } else {
        Alert.alert(
          'Permission Required',
          'Please enable Calendar access for LifePilot in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
      }
      await checkPermissions();
    } catch (error) {
      console.error('[Permissions] Calendar error:', error);
      Alert.alert(
        'Permission Required',
        'Could not request permission directly. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() }
        ]
      );
    }
  };

  const handleRequestMic = async () => {
    try {
      console.log('[Permissions] Requesting microphone permission...');
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      console.log('[Permissions] Mic result:', result);
      
      if (result.granted) {
        Alert.alert('Success', 'Microphone access granted!');
      } else {
        Alert.alert(
          'Permission Required',
          'Please enable Microphone access for LifePilot in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
      }
      await checkPermissions();
    } catch (error) {
      console.error('[Permissions] Microphone error:', error);
      Alert.alert(
        'Permission Required',
        'Could not request permission directly. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() }
        ]
      );
    }
  };

  const handleRequestFullScreen = async () => {
    if (Platform.OS === 'android') {
      try {
        console.log('[Permissions] Opening full screen intent settings...');
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_APP_USE_FULL_SCREEN_INTENT);
      } catch (e) {
        console.error('[Permissions] Full screen intent error:', e);
        Alert.alert('Error', 'Could not open system settings');
      }
    }
  };

  const handleRequestAccessibility = async () => {
    if (Platform.OS === 'android' && AppBlocker) {
      try {
        const isEnabled = await AppBlocker.isAccessibilityServiceEnabled();
        if (!isEnabled) {
          Alert.alert(
            'Action Required',
            'Please enable the Accessibility Service for LifePilot in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => AppBlocker.openAccessibilitySettings() }
            ]
          );
        } else {
          Alert.alert('Success', 'Accessibility Service is already enabled!');
        }
      } catch (e) {
        console.error('[Permissions] Accessibility error:', e);
      }
    }
  };


  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.replace('Dashboard')}>
          <ArrowLeft color="#fff" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>App Permissions</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <Text style={styles.title}>PERMISSIONS</Text>
          <Text style={styles.subtitle}>
            Tap any permission to grant access
          </Text>
        </View>

        {/* Permissions List */}
        <View style={styles.permissionsList}>
          <PermissionItem 
            title="Notifications"
            description="Reminders and alarm triggers"
            icon={Bell}
            isGranted={permissions.notifications}
            onRequest={handleRequestNotification}
          />

          <PermissionItem 
            title="Calendar Sync"
            description="Import calendar events"
            icon={CalendarIcon}
            isGranted={permissions.calendar}
            onRequest={handleRequestCalendar}
          />

          <PermissionItem 
            title="Microphone"
            description="Voice commands for Aura"
            icon={Mic}
            isGranted={permissions.microphone}
            onRequest={handleRequestMic}
          />

          <PermissionItem 
            title="Full Screen Alarms"
            description="Wake screen for alarms"
            icon={Settings}
            isGranted={permissions.fullScreenIntent}
            onRequest={handleRequestFullScreen}
            isAndroidOnly={true}
          />

          <PermissionItem 
            title="Accessibility Service"
            description="Required for strict mode app blocking"
            icon={Shield}
            isGranted={permissions.accessibility}
            onRequest={handleRequestAccessibility}
            isAndroidOnly={true}
          />
        </View>
        
        {/* Privacy Note */}
        <Text style={styles.privacyNote}>
          Your data is stored locally and encrypted. We never share your information with third parties.
        </Text>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#000000' 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  backButton: { 
    padding: 8, 
    marginLeft: -8 
  },
  headerTitle: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: '#fff',
    letterSpacing: 0.5,
  },
  scrollContent: { 
    padding: 24,
  },
  
  // Header Section
  headerSection: {
    marginBottom: 32,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#555',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: '#fff',
    lineHeight: 26,
  },
  
  // Permissions List
  permissionsList: {
    gap: 0,
  },
  permissionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  permissionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 16,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  iconCircleGranted: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: '#222',
  },
  permissionText: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: '#fff',
    marginBottom: 4,
    lineHeight: 24,
  },
  permissionDesc: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  permissionRight: {
    marginLeft: 'auto',
  },
  
  // Privacy Note
  privacyNote: {
    fontSize: 13,
    color: '#444',
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 32,
    fontStyle: 'italic',
  },
});

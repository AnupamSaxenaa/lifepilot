import notifee from '@notifee/react-native';
import * as Calendar from 'expo-calendar';
import * as IntentLauncher from 'expo-intent-launcher';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { ArrowLeft, Bell, Calendar as CalendarIcon, CheckCircle2, Mic, Settings, Shield, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AppState, Linking, NativeModules, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
const { AppBlocker } = NativeModules;

const INITIAL_PERMISSIONS = Object.freeze({
  notifications: false,
  calendar: false,
  microphone: false,
  fullScreenIntent: true,
  accessibility: false,
});

/**
 * Read the operating-system permission snapshot without touching React state.
 * Keeping this external synchronization separate lets both mount and button
 * handlers reuse it, while late native responses can be ignored after unmount.
 */
const readPermissionSnapshot = async () => {
  // 1. Notifications
  const notifSettings = await notifee.getNotificationSettings();
  const hasNotifications = notifSettings.authorizationStatus === 1;
  console.log('[Permissions] Notifications:', hasNotifications, notifSettings);

  // 2. Calendar
  let hasCalendar = false;
  try {
    const { status } = await Calendar.getCalendarPermissions();
    hasCalendar = status === 'granted';
    console.log('[Permissions] Calendar:', hasCalendar);
  } catch (error) {
    console.log('[Permissions] Calendar check error:', error.message);
  }

  // 3. Microphone
  const micStatus = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  const hasMic = micStatus.granted;
  console.log('[Permissions] Microphone:', hasMic, micStatus);

  // 4. Full Screen Intent (Android alarms)
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

  const snapshot = {
    notifications: hasNotifications,
    calendar: hasCalendar,
    microphone: hasMic,
    fullScreenIntent: hasFullScreen,
    accessibility: hasAccessibility,
  };
  console.log('[Permissions] Final state:', snapshot);
  return snapshot;
};

const PermissionItem = ({ title, description, icon: Icon, isGranted, onRequest, isAndroidOnly }) => {
  const { t } = useTranslation();
  if (isAndroidOnly && Platform.OS !== 'android') return null;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        if (isGranted) {
          Alert.alert(
            t('permissions.alreadyGrantedTitle'),
            t('permissions.alreadyGrantedMessage'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('permissions.openSettings'), onPress: () => Linking.openSettings() }
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
          <Icon color={isGranted ? '#fff' : '#FFFFFF'} size={20} />
        </View>
        <View style={styles.permissionText}>
          <Text style={styles.permissionTitle}>{title}</Text>
          <Text style={styles.permissionDesc}>{description}</Text>
        </View>
      </View>
      
      <View style={styles.permissionRight}>
        {isGranted ? (
          <CheckCircle2 color="#E5E7EB" size={24} />
        ) : (
          <XCircle color="#444" size={24} />
        )}
      </View>
    </TouchableOpacity>
  );
};
export const PermissionsScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState(INITIAL_PERMISSIONS);

  // Event-facing refresh used after permission prompts and AppState changes.
  const checkPermissions = useCallback(async () => {
    try {
      setPermissions(await readPermissionSnapshot());
    } catch (error) {
      console.error('[Permissions] Error checking permissions:', error);
    }
  }, []);

  useEffect(() => {
    let active = true;

    // The commit is visibly behind a native async boundary, and an answer that
    // arrives after unmount is ignored.
    readPermissionSnapshot().then((snapshot) => {
      if (active) setPermissions(snapshot);
    }).catch((error) => {
      console.error('[Permissions] Error checking permissions:', error);
    });

    // Re-check when the app returns from system settings.
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') checkPermissions();
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [checkPermissions]);

  const handleRequestNotification = async () => {
    try {
      console.log('[Permissions] Requesting notification permission...');
      const result = await notifee.requestPermission();
      console.log('[Permissions] Notification result:', result);
      
      if (result.authorizationStatus === 1) {
        Alert.alert(t('common.success'), t('permissions.notificationsEnabled'));
      } else {
        // OS didn't show dialog — open settings directly
        Alert.alert(
          t('permissions.permissionRequiredTitle'),
          t('permissions.enableNotificationsMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('permissions.openSettings'), onPress: () => Linking.openSettings() }
          ]
        );
      }
      await checkPermissions();
    } catch (error) {
      console.error('[Permissions] Notification error:', error);
      Alert.alert(
        t('permissions.permissionRequiredTitle'),
        t('permissions.requestPermissionErrorMessage'),
        [
          { text: t('permissions.openSettings'), onPress: () => Linking.openSettings() }
        ]
      );
    }
  };

  const handleRequestCalendar = async () => {
    try {
      console.log('[Permissions] Requesting calendar permission...');
      let granted = false;

      if (Platform.OS === 'android') {
        // expo-calendar v56 only reports "granted" when BOTH READ and WRITE
        // calendar permissions are granted, so request them together.
        const res = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_CALENDAR,
          PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR,
        ]);
        granted =
          res[PermissionsAndroid.PERMISSIONS.READ_CALENDAR] === PermissionsAndroid.RESULTS.GRANTED &&
          res[PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR] === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const { status } = await Calendar.requestCalendarPermissions();
        granted = status === 'granted';
      }

      console.log('[Permissions] Calendar result:', granted);
      if (granted) {
        Alert.alert(t('common.success'), t('permissions.calendarGranted'));
      } else {
        Alert.alert(
          t('permissions.permissionRequiredTitle'),
          t('permissions.enableCalendarMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('permissions.openSettings'), onPress: () => Linking.openSettings() }
          ]
        );
      }
      await checkPermissions();
    } catch (error) {
      console.error('[Permissions] Calendar error:', error);
      Alert.alert(
        t('permissions.permissionRequiredTitle'),
        t('permissions.requestPermissionErrorMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('permissions.openSettings'), onPress: () => Linking.openSettings() }
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
        Alert.alert(t('common.success'), t('permissions.microphoneGranted'));
      } else {
        Alert.alert(
          t('permissions.permissionRequiredTitle'),
          t('permissions.enableMicrophoneMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('permissions.openSettings'), onPress: () => Linking.openSettings() }
          ]
        );
      }
      await checkPermissions();
    } catch (error) {
      console.error('[Permissions] Microphone error:', error);
      Alert.alert(
        t('permissions.permissionRequiredTitle'),
        t('permissions.requestPermissionErrorMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('permissions.openSettings'), onPress: () => Linking.openSettings() }
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
        Alert.alert(t('common.error'), t('permissions.openSystemSettingsError'));
      }
    }
  };

  const handleRequestAccessibility = async () => {
    if (Platform.OS === 'android' && AppBlocker) {
      try {
        const isEnabled = await AppBlocker.isAccessibilityServiceEnabled();
        if (!isEnabled) {
          Alert.alert(
            t('permissions.actionRequiredTitle'),
            t('permissions.enableAccessibilityMessage'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('permissions.openSettings'), onPress: () => AppBlocker.openAccessibilitySettings() }
            ]
          );
        } else {
          Alert.alert(t('common.success'), t('permissions.accessibilityAlreadyEnabled'));
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
        <Text style={styles.headerTitle}>{t('permissions.headerTitle')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <Text style={styles.title}>{t('permissions.title')}</Text>
          <Text style={styles.subtitle}>
            {t('permissions.subtitle')}
          </Text>
        </View>

        {/* Permissions List */}
        <View style={styles.permissionsList}>
          <PermissionItem 
            title={t('permissions.notificationsTitle')}
            description={t('permissions.notificationsDesc')}
            icon={Bell}
            isGranted={permissions.notifications}
            onRequest={handleRequestNotification}
          />

          <PermissionItem 
            title={t('permissions.calendarTitle')}
            description={t('permissions.calendarDesc')}
            icon={CalendarIcon}
            isGranted={permissions.calendar}
            onRequest={handleRequestCalendar}
          />

          <PermissionItem 
            title={t('permissions.microphoneTitle')}
            description={t('permissions.microphoneDesc')}
            icon={Mic}
            isGranted={permissions.microphone}
            onRequest={handleRequestMic}
          />

          <PermissionItem 
            title={t('permissions.fullScreenTitle')}
            description={t('permissions.fullScreenDesc')}
            icon={Settings}
            isGranted={permissions.fullScreenIntent}
            onRequest={handleRequestFullScreen}
            isAndroidOnly={true}
          />

          <PermissionItem 
            title={t('permissions.accessibilityTitle')}
            description={t('permissions.accessibilityDesc')}
            icon={Shield}
            isGranted={permissions.accessibility}
            onRequest={handleRequestAccessibility}
            isAndroidOnly={true}
          />
        </View>
        
        {/* Privacy Note */}
        <Text style={styles.privacyNote}>
          {t('permissions.privacyNote')}
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
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

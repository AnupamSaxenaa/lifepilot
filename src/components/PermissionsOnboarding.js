import notifee from '@notifee/react-native';
import * as Calendar from 'expo-calendar';
import * as ImagePicker from 'expo-image-picker';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Bell, Calendar as CalendarIcon, Check, Folder, Mic, Shield, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AppState, Modal, NativeModules, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Storage } from '../utils/storage';
const { AppBlocker } = NativeModules;

const getPermissionSteps = (t) => [
  // Android's system photo picker does not require broad media-library access.
  // Keep photo permission contextual on iOS and request it only when needed.
  ...(Platform.OS === 'ios' ? [{
    id: 'storage',
    title: t('permissionsOnboarding.storageTitle'),
    description: t('permissionsOnboarding.storageDescription'),
    icon: Folder,
  }] : []),
  {
    id: 'notifications',
    title: t('permissionsOnboarding.notificationsTitle'),
    description: t('permissionsOnboarding.notificationsDescription'),
    icon: Bell,
  },
  {
    id: 'calendar',
    title: t('permissionsOnboarding.calendarTitle'),
    description: t('permissionsOnboarding.calendarDescription'),
    icon: CalendarIcon,
  },
  {
    id: 'microphone',
    title: t('permissionsOnboarding.microphoneTitle'),
    description: t('permissionsOnboarding.microphoneDescription'),
    icon: Mic,
  },
  ...(Platform.OS === 'android' ? [{
    id: 'accessibility',
    title: t('permissionsOnboarding.accessibilityTitle'),
    description: t('permissionsOnboarding.accessibilityDescription'),
    icon: Shield,
  }] : [])
];

const getAccessibleAccent = (accent) => {
  if (typeof accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(accent)) return '#3F3F46';
  const red = parseInt(accent.slice(1, 3), 16);
  const green = parseInt(accent.slice(3, 5), 16);
  const blue = parseInt(accent.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? '#3F3F46' : accent;
};

export const PermissionsOnboarding = () => {
  const { t } = useTranslation();
  const themeAccent = useTheme().theme.accent;
  const ACCENT = useMemo(() => getAccessibleAccent(themeAccent), [themeAccent]);
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);
  const PERMISSION_STEPS = useMemo(() => getPermissionSteps(t), [t]);
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [grantedStatus, setGrantedStatus] = useState({});
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    const checkFirstLaunch = async () => {
      const hasSeen = await Storage.get('has_seen_permissions_onboarding');
      if (hasSeen !== 'true') setIsVisible(true);
    };
    checkFirstLaunch().catch((error) => {
      console.warn('[PermissionsOnboarding] First-launch check failed:', error?.message || error);
    });
  }, []);

  const markCompleted = async () => {
    await Storage.set('has_seen_permissions_onboarding', 'true');
    setIsVisible(false);
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState !== 'active' || !isVisible) return;
      if (currentStep < 0 || currentStep >= PERMISSION_STEPS.length) return;

      const stepId = PERMISSION_STEPS[currentStep].id;
      if (stepId !== 'accessibility' || Platform.OS !== 'android') return;
      if (typeof AppBlocker?.isAccessibilityServiceEnabled !== 'function') return;

      try {
        const isEnabled = await AppBlocker.isAccessibilityServiceEnabled();
        if (!isEnabled || grantedStatus[stepId]) return;

        setGrantedStatus((previous) => ({ ...previous, [stepId]: true }));
        if (currentStep < PERMISSION_STEPS.length - 1) {
          setTimeout(() => setCurrentStep((previous) => previous + 1), 300);
        } else {
          setTimeout(() => { markCompleted().catch(() => {}); }, 600);
        }
      } catch (error) {
        console.warn('[PermissionsOnboarding] Accessibility check failed:', error?.message || error);
      }
    });
    return () => subscription.remove();
  }, [isVisible, currentStep, grantedStatus, PERMISSION_STEPS]);

  const handleSkip = () => {
    Alert.alert(
      t('permissionsOnboarding.skipSetupTitle'),
      t('permissionsOnboarding.skipSetupMessage'),
      [
        { text: t('permissionsOnboarding.cancel'), style: 'cancel' },
        {
          text: t('permissionsOnboarding.skip'),
          style: 'destructive',
          onPress: () => { markCompleted().catch(() => {}); }
        }
      ]
    );
  };

  const showPermissionSettingsPrompt = () => {
    import('react-native').then(({ Alert: NativeAlert, Linking }) => {
      NativeAlert.alert(
        t('permissionsOnboarding.permissionRequiredTitle'),
        t('permissionsOnboarding.permissionRequiredMessage'),
        [
          { text: t('permissionsOnboarding.cancel'), style: 'cancel' },
          { text: t('permissionsOnboarding.openSettings'), onPress: () => Linking.openSettings() }
        ]
      );
    }).catch(() => {});
  };

  const requestPermission = async (stepId) => {
    if (isRequesting) return;
    setIsRequesting(true);
    let granted = false;

    try {
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');

        if (stepId === 'notifications') {
          if (typeof notifee?.requestPermission !== 'function') throw new Error('Notifications module unavailable');
          const settings = await notifee.requestPermission();
          granted = Number(settings?.authorizationStatus) >= 1;
        } else if (stepId === 'calendar') {
          const perms = [
            PermissionsAndroid.PERMISSIONS.READ_CALENDAR,
            PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR,
          ].filter(Boolean);
          if (perms.length !== 2) throw new Error('Calendar permissions unavailable');
          const results = await PermissionsAndroid.requestMultiple(perms);
          granted = perms.every((permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED);
        } else if (stepId === 'microphone') {
          const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
          if (!permission) throw new Error('Microphone permission unavailable');
          const alreadyGranted = await PermissionsAndroid.check(permission);
          const result = alreadyGranted
            ? PermissionsAndroid.RESULTS.GRANTED
            : await PermissionsAndroid.request(permission);
          granted = result === PermissionsAndroid.RESULTS.GRANTED;
        } else if (stepId === 'accessibility') {
          if (
            typeof AppBlocker?.isAccessibilityServiceEnabled !== 'function'
            || typeof AppBlocker?.openAccessibilitySettings !== 'function'
          ) {
            throw new Error('Accessibility module unavailable');
          }
          granted = await AppBlocker.isAccessibilityServiceEnabled();
          if (!granted) {
            await AppBlocker.openAccessibilitySettings();
            Alert.alert(
              t('permissionsOnboarding.actionRequiredTitle'),
              t('permissionsOnboarding.enableAccessibilityMessage')
            );
            return;
          }
        }
      } else if (stepId === 'storage') {
        let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (permission.status !== 'granted') {
          permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        }
        granted = permission.status === 'granted';
      } else if (stepId === 'notifications') {
        if (typeof notifee?.requestPermission !== 'function') throw new Error('Notifications module unavailable');
        const settings = await notifee.requestPermission();
        granted = Number(settings?.authorizationStatus) >= 1;
      } else if (stepId === 'calendar') {
        let permission = await Calendar.getCalendarPermissionsAsync();
        if (permission.status !== 'granted') {
          permission = await Calendar.requestCalendarPermissionsAsync();
        }
        granted = permission.status === 'granted';
      } else if (stepId === 'microphone') {
        const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        granted = !!result?.granted;
      }

      setGrantedStatus((previous) => ({ ...previous, [stepId]: granted }));

      if (!granted) {
        showPermissionSettingsPrompt();
        return;
      }

      if (currentStep < PERMISSION_STEPS.length - 1) {
        setTimeout(() => setCurrentStep((previous) => previous + 1), 300);
      } else {
        setTimeout(() => { markCompleted().catch(() => {}); }, 600);
      }
    } catch (error) {
      console.warn(`[PermissionsOnboarding] ${stepId} request failed:`, error?.message || error);
      showPermissionSettingsPrompt();
    } finally {
      setIsRequesting(false);
    }
  };

  if (!isVisible) return null;

  return (
    <Modal visible={isVisible} animationType="slide" presentationStyle="pageSheet" transparent={Platform.OS === 'android'}>
      <View style={styles.modalOverlay}>
        <View style={styles.container}>
          
          <View style={styles.header}>
            <View style={{ width: 40 }} />
            <Text style={styles.headerTitle}>{t('permissionsOnboarding.welcomeSetupTitle')}</Text>
            <TouchableOpacity onPress={handleSkip} style={styles.closeBtn}>
              <X color="#A1A1AA" size={24} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            {t('permissionsOnboarding.subtitle')}
          </Text>

          <ScrollView style={styles.timeline} showsVerticalScrollIndicator={false}>
            {PERMISSION_STEPS.map((step, index) => {
              const isCurrent = index === currentStep;
              const isPast = index < currentStep;
              const isGranted = grantedStatus[step.id];
              const Icon = step.icon;

              return (
                <View key={step.id} style={styles.stepContainer}>
                  {/* Timeline Line */}
                  {index !== PERMISSION_STEPS.length - 1 && (
                    <View style={[styles.timelineLine, isPast && styles.timelineLineActive]} />
                  )}

                  {/* Step Node */}
                  <View style={[styles.stepNode, isPast && styles.stepNodeCompleted, isCurrent && styles.stepNodeCurrent]}>
                    {isGranted ? (
                      <Check color="#34D399" size={16} />
                    ) : (
                      <Text style={[styles.stepNodeText, (isPast || isCurrent) && { color: '#FFF' }]}>{index + 1}</Text>
                    )}
                  </View>

                  {/* Step Content */}
                  <TouchableOpacity 
                    style={[
                      styles.card, 
                      isCurrent && styles.cardActive,
                      isPast && styles.cardDimmed
                    ]}
                    activeOpacity={0.8}
                    disabled={!isCurrent}
                    onPress={() => requestPermission(step.id)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, isCurrent && { backgroundColor: ACCENT + '1A' }]}>
                        <Icon color={isCurrent ? ACCENT : "#A1A1AA"} size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTitle, isCurrent && { color: '#FFF' }]}>{step.title}</Text>
                        <Text style={styles.cardDesc}>{step.description}</Text>
                      </View>
                    </View>
                    
                    {isCurrent && (
                      <View style={styles.grantBtn}>
                        <Text style={styles.grantBtnText}>{t('permissionsOnboarding.grantPermission')}</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                </View>
              );
            })}
          </ScrollView>

        </View>
      </View>
    </Modal>
  );
};

const makeStyles = (ACCENT) => StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: Platform.OS === 'android' ? 'rgba(0,0,0,0.5)' : '#09090B',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#18181B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  closeBtn: { padding: 4 },
  subtitle: {
    color: '#A1A1AA',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  timeline: { flex: 1 },
  stepContainer: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  timelineLine: {
    position: 'absolute',
    left: 15,
    top: 32,
    bottom: -24,
    width: 2,
    backgroundColor: '#27272A',
    zIndex: 0,
  },
  timelineLineActive: { backgroundColor: '#34D399' },
  stepNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#27272A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    zIndex: 1,
    borderWidth: 4,
    borderColor: '#18181B',
  },
  stepNodeCurrent: { backgroundColor: ACCENT },
  stepNodeCompleted: { backgroundColor: 'rgba(52, 211, 153, 0.18)' },
  // Was #71717A on the #27272A node — 3.08:1 for a step number the user reads
  // to know where they are. #A1A1AA gives 5.9:1.
  stepNodeText: { color: '#A1A1AA', fontWeight: '700', fontSize: 12 },
  
  card: {
    flex: 1,
    backgroundColor: '#09090B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  cardActive: { borderColor: ACCENT, backgroundColor: ACCENT + '0D' },
  cardDimmed: { opacity: 0.5 },
  cardHeader: { flexDirection: 'row' },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#27272A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardTitle: { color: '#A1A1AA', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardDesc: { color: '#71717A', fontSize: 13, lineHeight: 18 },
  grantBtn: {
    backgroundColor: ACCENT,
    marginTop: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  grantBtnText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
});

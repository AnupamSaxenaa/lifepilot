import notifee from '@notifee/react-native';
import * as Calendar from 'expo-calendar';
import * as ImagePicker from 'expo-image-picker';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Bell, Calendar as CalendarIcon, Check, Folder, Mic, X, Shield } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, NativeModules, AppState } from 'react-native';
const { AppBlocker } = NativeModules;
import { Storage } from '../utils/storage';

const PERMISSION_STEPS = [
  {
    id: 'storage',
    title: 'Storage & Media',
    description: 'Required to upload a custom avatar and save attachments.',
    icon: Folder,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Never miss an alarm, reminder, or focus session update.',
    icon: Bell,
  },
  {
    id: 'calendar',
    title: 'Device Calendar',
    description: 'Sync your Google/Apple calendar events directly into LifePilot.',
    icon: CalendarIcon,
  },
  {
    id: 'microphone',
    title: 'Microphone',
    description: 'Required so you can talk to Aura instead of typing.',
    icon: Mic,
  },
  ...(Platform.OS === 'android' ? [{
    id: 'accessibility',
    title: 'Accessibility Service',
    description: 'Required for strict mode to detect and block distracting apps.',
    icon: Shield,
  }] : [])
];

export const PermissionsOnboarding = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [grantedStatus, setGrantedStatus] = useState({}); // { storage: true, notifications: false, ... }

  useEffect(() => {
    const checkFirstLaunch = async () => {
      const hasSeen = await Storage.get('has_seen_permissions_onboarding');
      if (hasSeen !== 'true') {
        setIsVisible(true);
      }
    };
    checkFirstLaunch();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active' && isVisible) {
        if (currentStep >= 0 && currentStep < PERMISSION_STEPS.length) {
          const stepId = PERMISSION_STEPS[currentStep].id;
          if (stepId === 'accessibility' && Platform.OS === 'android' && AppBlocker) {
            const isEnabled = await AppBlocker.isAccessibilityServiceEnabled();
            if (isEnabled && !grantedStatus[stepId]) {
              setGrantedStatus(prev => ({ ...prev, [stepId]: true }));
              if (currentStep < PERMISSION_STEPS.length - 1) {
                setTimeout(() => setCurrentStep(prev => prev + 1), 300);
              } else {
                setTimeout(markCompleted, 600);
              }
            }
          }
        }
      }
    });
    return () => subscription.remove();
  }, [isVisible, currentStep, grantedStatus]);

  const markCompleted = async () => {
    await Storage.set('has_seen_permissions_onboarding', 'true');
    setIsVisible(false);
  };

  const handleSkip = () => {
    Alert.alert(
      "Skip Setup?",
      "You can always manage your permissions later from Menu > Permissions Hub.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Skip", 
          style: "destructive",
          onPress: markCompleted 
        }
      ]
    );
  };

  const requestPermission = async (stepId) => {
    let granted = false;

    try {
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const apiLevel = Platform.Version;

        if (stepId === 'storage') {
          const perm = apiLevel >= 33 
            ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES 
            : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
            
          let status = await PermissionsAndroid.check(perm);
          if (!status) {
            const req = await PermissionsAndroid.request(perm);
            status = req === PermissionsAndroid.RESULTS.GRANTED;
          }
          granted = status;
        } 
        else if (stepId === 'notifications') {
          const settings = await notifee.requestPermission();
          granted = settings.authorizationStatus === 1; // AUTHORIZED
        }
        else if (stepId === 'calendar') {
          const perm = PermissionsAndroid.PERMISSIONS.READ_CALENDAR;
          let status = await PermissionsAndroid.check(perm);
          if (!status) {
            const req = await PermissionsAndroid.request(perm);
            status = req === PermissionsAndroid.RESULTS.GRANTED;
          }
          granted = status;
        }
        else if (stepId === 'microphone') {
          const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
          let status = await PermissionsAndroid.check(perm);
          if (!status) {
            const req = await PermissionsAndroid.request(perm);
            status = req === PermissionsAndroid.RESULTS.GRANTED;
          }
          granted = status;
        }
        else if (stepId === 'accessibility') {
          if (AppBlocker) {
            let status = await AppBlocker.isAccessibilityServiceEnabled();
            if (!status) {
              AppBlocker.openAccessibilitySettings();
              import('react-native').then(({ Alert }) => {
                Alert.alert('Action Required', 'Please enable the Accessibility Service for LifePilot in Settings. We will automatically detect when you return.');
              });
              return;
            }
            granted = status;
          }
        }
      } else {
        // iOS Fallback (Expo modules work perfectly on iOS)
        if (stepId === 'storage') {
          let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
          if (perm.status !== 'granted') {
            perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          }
          granted = perm.status === 'granted';
        } 
        else if (stepId === 'notifications') {
          const settings = await notifee.requestPermission();
          granted = settings.authorizationStatus === 1; // AUTHORIZED
        }
        else if (stepId === 'calendar') {
          let perm = await Calendar.getCalendarPermissionsAsync();
          if (perm.status !== 'granted') {
            perm = await Calendar.requestCalendarPermissionsAsync();
          }
          granted = perm.status === 'granted';
        }
        else if (stepId === 'microphone') {
          const { granted: micGranted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          granted = micGranted;
        }
      }

      setGrantedStatus(prev => ({ ...prev, [stepId]: granted }));
      
      if (granted) {
        // Auto-advance only if granted
        if (currentStep < PERMISSION_STEPS.length - 1) {
          setTimeout(() => setCurrentStep(prev => prev + 1), 300);
        } else {
          // Finished all steps
          setTimeout(markCompleted, 600);
        }
      } else {
        // Permission was instantly denied by OS (likely previously denied)
        import('react-native').then(({ Alert, Linking }) => {
          Alert.alert(
            'Permission Required',
            'Could not request permission directly. Please enable it in your device Settings to continue.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() }
            ]
          );
        });
      }

    } catch (e) {
      console.log('Error requesting permission:', e);
      import('react-native').then(({ Alert, Linking }) => {
        Alert.alert(
          'Permission Required',
          'Could not request permission directly. Please enable it in your device Settings to continue.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
      });
    }
  };

  if (!isVisible) return null;

  return (
    <Modal visible={isVisible} animationType="slide" presentationStyle="pageSheet" transparent={Platform.OS === 'android'}>
      <View style={styles.modalOverlay}>
        <View style={styles.container}>
          
          <View style={styles.header}>
            <View style={{ width: 40 }} />
            <Text style={styles.headerTitle}>Welcome Setup</Text>
            <TouchableOpacity onPress={handleSkip} style={styles.closeBtn}>
              <X color="#A1A1AA" size={24} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Let's get LifePilot ready. We need a few permissions to make the magic happen.
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
                      <Check color="#10B981" size={16} />
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
                      <View style={[styles.iconBox, isCurrent && { backgroundColor: 'rgba(168, 85, 247, 0.1)' }]}>
                        <Icon color={isCurrent ? "#A855F7" : "#A1A1AA"} size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTitle, isCurrent && { color: '#FFF' }]}>{step.title}</Text>
                        <Text style={styles.cardDesc}>{step.description}</Text>
                      </View>
                    </View>
                    
                    {isCurrent && (
                      <View style={styles.grantBtn}>
                        <Text style={styles.grantBtnText}>Grant Permission</Text>
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

const styles = StyleSheet.create({
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
  timelineLineActive: { backgroundColor: '#10B981' },
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
  stepNodeCurrent: { backgroundColor: '#A855F7' },
  stepNodeCompleted: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  stepNodeText: { color: '#71717A', fontWeight: '700', fontSize: 12 },
  
  card: {
    flex: 1,
    backgroundColor: '#09090B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  cardActive: { borderColor: '#A855F7', backgroundColor: 'rgba(168, 85, 247, 0.05)' },
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
    backgroundColor: '#A855F7',
    marginTop: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  grantBtnText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
});

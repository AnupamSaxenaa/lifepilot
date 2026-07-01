// ─── Mindful Lock Setup Screen ───────────────────────────
// First-time onboarding for the Mindful Lock feature.
// 3 steps: Goal → Coach Persona → First Distraction App
// ─────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Dimensions, ScrollView, KeyboardAvoidingView, Platform, NativeModules, Alert, Image, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight, ArrowLeft, Check, Lock, BrainCircuit, Search } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { saveProfile, addApp, getInstalledApps, getApps } from '../utils/mindfulLock';

const { width } = Dimensions.get('window');

const { AppBlocker } = NativeModules;
const IS_ANDROID = Platform.OS === 'android';
const TOTAL_STEPS = IS_ANDROID ? 4 : 3;

const GOAL_PRESETS = [
  { emoji: '📚', label: 'Study / Exams' },
  { emoji: '😴', label: 'Better Sleep' },
  { emoji: '👨‍👩‍👧', label: 'Family Time' },
  { emoji: '💪', label: 'Health & Fitness' },
  { emoji: '💼', label: 'Work Productivity' },
  { emoji: '🎨', label: 'Creative Projects' },
];

const PERSONAS = [
  {
    id: 'gentle',
    emoji: '🤗',
    name: 'Gentle Friend',
    sample: "Hey, you're doing great. Just checking — is this really what you want right now?",
    color: '#22C55E',
  },
  {
    id: 'tough',
    emoji: '💪',
    name: 'Tough Love',
    sample: "Put the phone down. You told me you'd finish that project. Don't let yourself down.",
    color: '#EF4444',
  },
  {
    id: 'stoic',
    emoji: '🧘',
    name: 'Stoic Mentor',
    sample: "The obstacle is the way. What would your best self choose right now?",
    color: '#3B82F6',
  },
  {
    id: 'witty',
    emoji: '😏',
    name: 'Witty Roast',
    sample: "Oh look, someone's about to doomscroll again. Your goals aren't completing themselves, chief.",
    color: '#F59E0B',
  },
];

const APP_PRESETS = [
  { name: 'Instagram', package: 'com.instagram.android', icon: '📸' },
  { name: 'TikTok', package: 'com.zhiliaoapp.musically', icon: '🎵' },
  { name: 'YouTube', package: 'com.google.android.youtube', icon: '▶️' },
  { name: 'Twitter / X', package: 'com.twitter.android', icon: '🐦' },
  { name: 'Reddit', package: 'com.reddit.frontpage', icon: '🔴' },
  { name: 'Snapchat', package: 'com.snapchat.android', icon: '👻' },
  { name: 'Facebook', package: 'com.facebook.katana', icon: '📘' },
];

export const MindfulLockSetupScreen = ({ navigation, route }) => {
  const userId = route?.params?.userId;
  const isAddingMore = route?.params?.isAddingMore || false;
  const [step, setStep] = useState(route?.params?.initialStep ?? 0);
  
  const [installedApps, setInstalledApps] = useState([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [existingApps, setExistingApps] = useState([]);

  useEffect(() => {
    if (isAddingMore) {
      getApps(userId).then(setExistingApps);
    }
  }, [userId, isAddingMore]);

  useEffect(() => {
    if (IS_ANDROID) {
      setLoadingApps(true);
      getInstalledApps().then(apps => {
        // Sort alphabetically
        apps.sort((a, b) => a.name.localeCompare(b.name));
        setInstalledApps(apps);
        setLoadingApps(false);
      });
    }
  }, []);

  // Step 0: Goal
  const [selectedGoal, setSelectedGoal] = useState('');
  const [customGoal, setCustomGoal] = useState('');

  // Step 1: Persona
  const [selectedPersona, setSelectedPersona] = useState('gentle');
  
  // Step 2: Mode (Android only)
  const [blockingMode, setBlockingMode] = useState('cbt');

  // Step 3 (or 2 on iOS): First app
  const [selectedApps, setSelectedApps] = useState([]);
  const [customAppName, setCustomAppName] = useState('');
  const [customAppPackage, setCustomAppPackage] = useState('');

  const handleNext = async () => {
    // If selecting strict mode on Android, prompt for accessibility permission
    if (IS_ANDROID && step === 2 && blockingMode === 'strict') {
      if (AppBlocker) {
        const isEnabled = await AppBlocker.isAccessibilityServiceEnabled();
        if (!isEnabled) {
          Alert.alert(
            'Permission Required',
            'Strict mode requires the Accessibility Service to detect when you open a blocked app. Please enable it in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => AppBlocker.openAccessibilitySettings() }
            ]
          );
          return; // Block progressing until granted
        }
      }
    }

    if (step < TOTAL_STEPS - 1) setStep(step + 1);
    else handleFinish();
  };

  const handleBack = () => {
    if (isAddingMore && step === (route?.params?.initialStep ?? 0)) {
      navigation.goBack();
    } else if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleFinish = async () => {
    if (!isAddingMore) {
      const goal = customGoal.trim() || selectedGoal;

      // Save profile only during initial setup
      await saveProfile(userId, {
        goal,
        coachPersona: selectedPersona,
        blockingMode,
        onboardingComplete: true,
      });
    }

    // Add selected apps
    for (const app of selectedApps) {
      await addApp(userId, {
        name: app.name,
        packageName: app.package || app.packageName,
        icon: app.iconBase64 ? app.iconBase64 : app.icon, // Fallback to emoji if no base64
        lockMode: 'allowance',
        dailyBudgetMinutes: app.dailyBudgetMinutes || 60,
      });
    }

    // Add custom app if typed (for non-Android or fallback)
    if (customAppName.trim()) {
      await addApp(userId, {
        name: customAppName.trim(),
        packageName: customAppPackage.trim() || customAppName.trim().toLowerCase(),
        icon: '📱',
        lockMode: 'allowance',
        dailyBudgetMinutes: 60,
      });
    }

    if (isAddingMore) {
      navigation.goBack();
    } else {
      navigation.replace('MindfulLock', { userId });
    }
  };

  const toggleApp = (app) => {
    setSelectedApps(prev => {
      const exists = prev.find(a => a.name === app.name);
      if (exists) return prev.filter(a => a.name !== app.name);
      return [...prev, { ...app, dailyBudgetMinutes: 60 }];
    });
  };

  const updateAppTime = (appName, text) => {
    const mins = parseInt(text, 10);
    setSelectedApps(prev => prev.map(a => 
      a.name === appName ? { ...a, dailyBudgetMinutes: isNaN(mins) ? 0 : mins } : a
    ));
  };

  const canProceed = () => {
    if (step === 0) return selectedGoal || customGoal.trim();
    if (step === 1) return selectedPersona;
    if (IS_ANDROID && step === 2) return blockingMode;
    return true; // Last step is optional
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Progress dots */}
        <View style={styles.progressRow}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                i <= step && styles.progressDotActive,
              ]}
            />
          ))}
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ═══ STEP 0: GOAL ═══ */}
          {step === 0 && (
            <Animated.View entering={FadeIn.duration(300)}>
              <BrainCircuit color="#A855F7" size={44} style={{ alignSelf: 'center', marginBottom: 16 }} />
              <Text style={styles.heading}>What are you protecting your time for?</Text>
              <Text style={styles.subheading}>This helps your AI coach give you personalized motivation.</Text>

              <View style={styles.presetGrid}>
                {GOAL_PRESETS.map(goal => (
                  <TouchableOpacity
                    key={goal.label}
                    style={[
                      styles.presetCard,
                      selectedGoal === goal.label && styles.presetCardSelected,
                    ]}
                    onPress={() => { setSelectedGoal(goal.label); setCustomGoal(''); }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.presetEmoji}>{goal.emoji}</Text>
                    <Text style={[
                      styles.presetLabel,
                      selectedGoal === goal.label && { color: '#A855F7' },
                    ]}>{goal.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.orText}>or type your own</Text>
              <TextInput
                style={styles.input}
                placeholder="Finish my thesis, run a marathon..."
                placeholderTextColor="#52525b"
                value={customGoal}
                onChangeText={(t) => { setCustomGoal(t); setSelectedGoal(''); }}
                maxLength={100}
              />
            </Animated.View>
          )}

          {/* ═══ STEP 1: PERSONA ═══ */}
          {step === 1 && (
            <Animated.View entering={FadeIn.duration(300)}>
              <Text style={styles.heading}>Pick your coach</Text>
              <Text style={styles.subheading}>This sets the tone for every nudge, check-in, and weekly report.</Text>

              {PERSONAS.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.personaCard,
                    selectedPersona === p.id && { borderColor: p.color },
                  ]}
                  onPress={() => setSelectedPersona(p.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.personaHeader}>
                    <Text style={styles.personaEmoji}>{p.emoji}</Text>
                    <Text style={styles.personaName}>{p.name}</Text>
                    {selectedPersona === p.id && (
                      <View style={[styles.personaCheck, { backgroundColor: p.color }]}>
                        <Check color="#fff" size={14} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.personaSample}>"{p.sample}"</Text>
                </TouchableOpacity>
              ))}
            </Animated.View>
          )}

          {/* ═══ STEP 2 (ANDROID ONLY): MODE ═══ */}
          {IS_ANDROID && step === 2 && (
            <Animated.View entering={FadeIn.duration(300)}>
              <Text style={styles.heading}>How strict should we be?</Text>
              <Text style={styles.subheading}>Choose how LifePilot intervenes when you try to open a locked app.</Text>

              <TouchableOpacity
                style={[
                  styles.personaCard, // Reusing style structure
                  blockingMode === 'cbt' && { borderColor: '#A855F7' },
                ]}
                onPress={() => setBlockingMode('cbt')}
                activeOpacity={0.7}
              >
                <View style={styles.personaHeader}>
                  <BrainCircuit color="#A855F7" size={24} style={{ marginRight: 10 }} />
                  <Text style={styles.personaName}>Mindful Coach (Recommended)</Text>
                  {blockingMode === 'cbt' && (
                    <View style={[styles.personaCheck, { backgroundColor: '#A855F7' }]}>
                      <Check color="#fff" size={14} />
                    </View>
                  )}
                </View>
                <Text style={styles.personaSample}>Makes you pause, reflect, and do a breathing exercise. Builds self-awareness instead of relying on a hard block.</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.personaCard,
                  blockingMode === 'strict' && { borderColor: '#EF4444' },
                ]}
                onPress={() => setBlockingMode('strict')}
                activeOpacity={0.7}
              >
                <View style={styles.personaHeader}>
                  <Lock color="#EF4444" size={24} style={{ marginRight: 10 }} />
                  <Text style={styles.personaName}>Strict Blocker</Text>
                  {blockingMode === 'strict' && (
                    <View style={[styles.personaCheck, { backgroundColor: '#EF4444' }]}>
                      <Check color="#fff" size={14} />
                    </View>
                  )}
                </View>
                <Text style={styles.personaSample}>Forcefully blocks the app. Requires granting special Accessibility permissions in Android settings.</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* ═══ FINAL STEP: FIRST APP ═══ */}
          {step === (TOTAL_STEPS - 1) && (
            <Animated.View entering={FadeIn.duration(300)}>
              <Text style={styles.heading}>Add your first distraction</Text>
              <Text style={styles.subheading}>Pick the apps that steal your time, and set a daily allowance in minutes.</Text>

              <View style={styles.searchContainer}>
                <Search color="#71717A" size={20} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search apps..."
                  placeholderTextColor="#71717A"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              {IS_ANDROID ? (
                <>
                  {loadingApps ? (
                    <ActivityIndicator size="large" color="#A855F7" style={{ marginTop: 40 }} />
                  ) : (
                    <View style={styles.installedAppList}>
                      {installedApps.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase())).map(app => {
                        const isAlreadyLocked = existingApps.some(a => a.packageName === app.packageName || a.name === app.name);
                        const isSelected = selectedApps.some(a => a.name === app.name);
                        const selectedApp = selectedApps.find(a => a.name === app.name);
                        return (
                          <View key={app.packageName} style={styles.installedAppRow}>
                            <TouchableOpacity
                              style={[
                                styles.installedAppCard,
                                isSelected && styles.installedAppCardSelected,
                                isAlreadyLocked && { opacity: 0.5 }
                              ]}
                              onPress={() => toggleApp({ ...app, iconBase64: app.icon })}
                              activeOpacity={0.7}
                              disabled={isAlreadyLocked}
                            >
                              <Image source={{ uri: `data:image/png;base64,${app.icon}` }} style={styles.installedAppIcon} />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.installedAppName} numberOfLines={1}>{app.name}</Text>
                                {isAlreadyLocked && <Text style={{ color: '#71717A', fontSize: 12 }}>Already locked</Text>}
                              </View>
                              {isSelected && !isAlreadyLocked && (
                                <View style={[styles.personaCheck, { backgroundColor: '#A855F7', marginRight: 0 }]}>
                                  <Check color="#fff" size={14} />
                                </View>
                              )}
                              {isAlreadyLocked && (
                                <View style={[styles.personaCheck, { backgroundColor: '#27272A', marginRight: 0 }]}>
                                  <Lock color="#71717A" size={14} />
                                </View>
                              )}
                            </TouchableOpacity>
                            
                            {isSelected && !isAlreadyLocked && (
                              <View style={styles.allowanceContainer}>
                                <Text style={styles.allowanceLabel}>Daily limit:</Text>
                                <TextInput
                                  style={styles.allowanceInput}
                                  keyboardType="number-pad"
                                  value={selectedApp.dailyBudgetMinutes.toString()}
                                  onChangeText={(t) => updateAppTime(app.name, t)}
                                />
                                <Text style={styles.allowanceLabel}>mins</Text>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.appGrid}>
                    {APP_PRESETS.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase())).map(app => {
                      const isAlreadyLocked = existingApps.some(a => a.packageName === app.package || a.name === app.name);
                      const isSelected = selectedApps.some(a => a.name === app.name);
                      return (
                        <TouchableOpacity
                          key={app.name}
                          style={[
                            styles.appChip,
                            isSelected && styles.appChipSelected,
                            isAlreadyLocked && { opacity: 0.4 }
                          ]}
                          onPress={() => toggleApp(app)}
                          activeOpacity={0.7}
                          disabled={isAlreadyLocked}
                        >
                          <Text style={styles.appChipIcon}>{app.icon}</Text>
                          <Text style={[
                            styles.appChipText,
                            isSelected && { color: '#A855F7' },
                          ]}>{app.name} {isAlreadyLocked && '(Locked)'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={styles.orText}>or add a custom app</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="App name..."
                    placeholderTextColor="#52525b"
                    value={customAppName}
                    onChangeText={setCustomAppName}
                    maxLength={50}
                  />
                </>
              )}
            </Animated.View>
          )}
        </ScrollView>

        {/* Bottom Navigation */}
        <View style={styles.bottomRow}>
          {step > 0 ? (
            <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
              <ArrowLeft color="#a1a1aa" size={20} />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          ) : <View />}

          <TouchableOpacity
            style={[
              styles.nextBtn,
              !canProceed() && { opacity: 0.3 },
            ]}
            onPress={handleNext}
            disabled={!canProceed()}
            activeOpacity={0.8}
          >
            <Text style={styles.nextBtnText}>
              {step === 2 ? (selectedApps.length > 0 || customAppName.trim() ? "Let's go!" : 'Skip for now') : 'Next'}
            </Text>
            <ArrowRight color="#fff" size={18} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  progressDot: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#27272a',
  },
  progressDotActive: {
    backgroundColor: '#A855F7',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
  },
  heading: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  subheading: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },

  // ─── Goal Presets ───
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 20,
  },
  presetCard: {
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    width: (width - 68) / 2,
  },
  presetCardSelected: {
    borderColor: '#A855F7',
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
  },
  presetEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  presetLabel: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
  },

  // ─── Persona Cards ───
  personaCard: {
    backgroundColor: '#121212',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#27272a',
    padding: 18,
    marginBottom: 12,
  },
  personaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  personaEmoji: {
    fontSize: 24,
    marginRight: 10,
  },
  personaName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  personaCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personaSample: {
    color: '#71717a',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
  },

  // ─── App Selection ───
  appGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 20,
  },
  appChip: {
    backgroundColor: '#121212',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appChipSelected: {
    borderColor: '#A855F7',
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
  },
  appChipIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  appChipText: {
    fontSize: 15,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121214',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    height: 48,
    color: '#FAFAFA',
    fontSize: 16,
    marginLeft: 8,
  },
  installedAppList: {
    flexDirection: 'column',
    gap: 12,
  },
  installedAppRow: {
    flexDirection: 'column',
    gap: 8,
  },
  installedAppCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 16,
    padding: 12,
  },
  installedAppCardSelected: {
    borderColor: '#A855F7',
    backgroundColor: 'rgba(168, 85, 247, 0.05)',
  },
  installedAppIcon: {
    width: 32,
    height: 32,
    marginRight: 12,
  },
  installedAppName: {
    fontSize: 16,
    color: '#FAFAFA',
    fontWeight: '500',
  },
  allowanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1E',
    borderRadius: 12,
    padding: 12,
    marginLeft: 24,
  },
  allowanceLabel: {
    color: '#A1A1AA',
    fontSize: 14,
  },
  allowanceInput: {
    backgroundColor: '#000',
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginHorizontal: 8,
    minWidth: 60,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  orText: {
    color: '#52525b',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#ffffff',
    fontSize: 15,
    padding: 16,
  },

  // ─── Bottom Nav ───
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#18181b',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
  },
  backBtnText: {
    color: '#a1a1aa',
    fontSize: 15,
    fontWeight: '600',
  },
  nextBtn: {
    backgroundColor: '#A855F7',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nextBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});

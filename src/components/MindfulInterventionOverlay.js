// ─── Mindful Intervention Overlay ────────────────────────
// The heart of Mindful Lock. A 4-stage full-screen flow
// triggered when the user feels tempted to open a
// distraction app.
//
// Stage 1: App Selection (which app is calling you?)
// Stage 2: AI Personalized Prompt + resist/continue
// Stage 3: Breathing Exercise (friction step)
// Stage 4: Conscious Override (reason + duration)
// ─────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Dimensions,
  ScrollView, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, FlatList, Image,
  NativeModules
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { X, BrainCircuit, Heart, Sparkles } from 'lucide-react-native';
import { BreathingExercise } from './BreathingExercise';
import {
  getApps, addLogEntry, logUsage, getProfile, getTodayStats,
  getPersonaFallback, getReplacementActivity,
} from '../utils/mindfulLock';
import { Gamification } from '../utils/gamification';
import { generateMindfulIntervention, chatWithCoach } from '../lib/AIEngine';
import { loadTasks } from '../lib/dataManager';

const { width } = Dimensions.get('window');

const REASONS = [
  { label: '😑 Bored', value: 'bored' },
  { label: '😰 Stressed', value: 'stressed' },
  { label: '🔄 Habit', value: 'habit' },
  { label: '💼 Need it', value: 'need' },
  { label: '🤷 Just want to', value: 'want' },
];

const DURATIONS = [
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hr', value: 60 },
];

export const MindfulInterventionOverlay = ({ isVisible, onClose, userId, initialApp }) => {
  const [stage, setStage] = useState(1);
  const [apps, setApps] = useState([]);
  const [selectedApp, setSelectedApp] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [replacement, setReplacement] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  const [selectedReason, setSelectedReason] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [profile, setProfile] = useState(null);
  const [todayTasks, setTodayTasks] = useState([]);

  useEffect(() => {
    if (isVisible) {
      loadData();
      if (initialApp) {
        setStage(2);
        setSelectedApp(initialApp);
        setChatMessages([{ role: 'system', content: 'You are a mindful coach.' }]); // Basic setup, will be initialized properly later
        // Note: The handleSelectApp logic is slightly different, but since we are mocking handleSelectApp's behavior:
      } else {
        setStage(1);
        setSelectedApp(null);
      }
      setChatMessages([]);
      setInputText('');
      setReplacement('');
      setSelectedReason(null);
      setSelectedDuration(null);
      setShowCelebration(false);
    }
  }, [isVisible, initialApp]);

  const loadData = async () => {
    const [appList, prof] = await Promise.all([
      getApps(userId),
      getProfile(userId),
    ]);
    
    let appsWithUsage = appList;
    if (Platform.OS === 'android' && NativeModules.AppBlocker?.getUsageToday) {
      appsWithUsage = await Promise.all(
        appList.map(async (app) => {
          const ms = await NativeModules.AppBlocker.getUsageToday(app.packageName || app.name.toLowerCase());
          return { ...app, usageToday: Math.floor(ms / 60000) };
        })
      );
    }
    
    setApps(appsWithUsage);
    setProfile(prof);

    const tasks = await loadTasks(userId, () => {});
    const dateStr = new Date().toISOString().split('T')[0];
    const todays = tasks.filter(t => 
      !t.is_deleted && t.status !== 'completed' && 
      ((t.planned_date && t.planned_date.startsWith(dateStr)) || (t.due_date && t.due_date.startsWith(dateStr)))
    );
    setTodayTasks(todays);

    if (initialApp) {
      handleSelectApp(initialApp, prof, todays);
    } else if (appsWithUsage.length === 1) {
      handleSelectApp(appsWithUsage[0], prof, todays);
    } else {
      setStage(1);
    }
  };

  const handleSelectApp = async (app, overrideProfile = profile, overrideTasks = todayTasks) => {
    setSelectedApp(app);
    setStage(2);
    setLoadingAI(true);

    const stats = await getTodayStats(userId);
    const contextData = { tasks: overrideTasks, usage: apps, stats, profile: overrideProfile, appName: app.name };
    
    const firstMsg = await chatWithCoach([], contextData);
    
    setChatMessages([{ role: 'assistant', content: firstMsg }]);
    setReplacement(getReplacementActivity());
    setLoadingAI(false);
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || loadingAI) return;
    
    const userMsg = { role: 'user', content: inputText.trim() };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setInputText('');
    setLoadingAI(true);

    const stats = await getTodayStats(userId);
    const contextData = { tasks: todayTasks, usage: apps, stats, profile, appName: selectedApp?.name };
    
    const reply = await chatWithCoach(newMessages, contextData);
    setChatMessages([...newMessages, { role: 'assistant', content: reply }]);
    setLoadingAI(false);
  };

  const handleResist = async () => {
    // Log the resist
    await addLogEntry(userId, {
      appId: selectedApp.id,
      appName: selectedApp.name,
      action: 'resisted',
      aiResponse: chatMessages.map(m => m.content).join(' | '),
    });

    // Award XP
    await Gamification.addXP(userId, 25);

    // Show celebration
    setShowCelebration(true);
  };

  const handleProceedToBreathing = () => {
    setStage(3);
  };

  const handleBreathingComplete = () => {
    setStage(4);
  };

  const handleOverride = async () => {
    if (!selectedReason || !selectedDuration) return;

    // Log the override
    await addLogEntry(userId, {
      appId: selectedApp.id,
      appName: selectedApp.name,
      action: 'used',
      reason: selectedReason,
      duration: selectedDuration,
    });

    // Deduct XP for giving in
    await Gamification.addXP(userId, -25);

    // Log usage minutes
    await logUsage(userId, selectedApp.id, selectedDuration);

    onClose();
  };

  const handleCloseCelebration = () => {
    setShowCelebration(false);
    onClose();
  };

  if (!isVisible) return null;

  return (
    <Modal visible={isVisible} animationType="fade" transparent={false}>
      <View style={styles.container}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <X color="#52525b" size={28} />
        </TouchableOpacity>

        {/* ═══ CELEBRATION ═══ */}
        {showCelebration && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.celebrationContainer}>
            <Text style={styles.celebrationEmoji}>🎉</Text>
            <Text style={styles.celebrationTitle}>You resisted!</Text>
            <Text style={styles.celebrationXP}>+25 XP</Text>
            <Text style={styles.celebrationSub}>
              Instead, try this:
            </Text>
            <View style={styles.replacementCard}>
              <Text style={styles.replacementText}>{replacement}</Text>
            </View>
            <TouchableOpacity style={styles.celebrationBtn} onPress={handleCloseCelebration}>
              <Text style={styles.celebrationBtnText}>Nice! Let's go</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ═══ STAGE 1: App Selection ═══ */}
        {!showCelebration && stage === 1 && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.stageContainer}>
            <BrainCircuit color="#A855F7" size={40} style={{ marginBottom: 16 }} />
            <Text style={styles.stageTitle}>Which app is calling you?</Text>
            <Text style={styles.stageSubtitle}>Let's pause and think about this together</Text>

            <ScrollView style={styles.appList} showsVerticalScrollIndicator={false}>
              {apps.map(app => (
                <TouchableOpacity
                  key={app.id}
                  style={styles.appCard}
                  onPress={() => handleSelectApp(app)}
                  activeOpacity={0.8}
                >
                  {app.icon && app.icon.length > 10 ? (
                    <Image source={{ uri: `data:image/png;base64,${app.icon}` }} style={styles.appIconImage} />
                  ) : (
                    <Text style={styles.appIcon}>{app.icon}</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.appName}>{app.name}</Text>
                    {app.bundle && <Text style={styles.appBundle}>{app.bundle}</Text>}
                  </View>
                  <View style={styles.usageBadge}>
                    <Text style={styles.usageText}>
                      {app.usageToday || 0}/{app.dailyBudgetMinutes}m
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity 
              style={styles.justTemptedBtn}
              onPress={() => handleSelectApp({ name: 'General Distraction', id: 'general' })}
              activeOpacity={0.8}
            >
              <Text style={styles.justTemptedBtnText}>I'm Just Tempted</Text>
              <Text style={styles.justTemptedBtnSub}>I don't know what I want to open</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ═══ STAGE 2: AI Coach Chat ═══ */}
        {!showCelebration && stage === 2 && (
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.stageContainer, { paddingBottom: 20 }]}
          >
            {selectedApp?.icon && selectedApp.icon.length > 10 ? (
              <Image source={{ uri: `data:image/png;base64,${selectedApp.icon}` }} style={styles.selectedAppIconImage} />
            ) : (
              <Text style={styles.selectedAppIcon}>{selectedApp?.icon}</Text>
            )}
            <Text style={styles.selectedAppName}>Coach Chat</Text>

            <FlatList
              data={chatMessages.filter(m => m.role !== 'system')}
              keyExtractor={(item, index) => index.toString()}
              style={styles.chatList}
              contentContainerStyle={{ paddingBottom: 20 }}
              renderItem={({ item }) => (
                <View style={[styles.chatBubble, item.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAi]}>
                  {item.role === 'assistant' && <Sparkles color="#A855F7" size={14} style={{ marginRight: 6, alignSelf: 'flex-start', marginTop: 2 }} />}
                  <Text style={[styles.chatText, item.role === 'user' ? styles.chatTextUser : styles.chatTextAi]}>
                    {item.content}
                  </Text>
                </View>
              )}
            />

            {loadingAI && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <ActivityIndicator size="small" color="#A855F7" style={{ marginRight: 8 }} />
                <Text style={{ color: '#a3a3a3' }}>Coach is typing...</Text>
              </View>
            )}

            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Reply to coach..."
                placeholderTextColor="#666"
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={handleSendMessage}
                returnKeyType="send"
              />
              <TouchableOpacity style={styles.chatSendBtn} onPress={handleSendMessage}>
                <Text style={styles.chatSendBtnText}>Send</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.resistBtn}
                onPress={handleResist}
                activeOpacity={0.8}
              >
                <Heart color="#fff" size={18} />
                <Text style={styles.resistBtnText}>I'm good now</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.continueBtn}
                onPress={handleProceedToBreathing}
                activeOpacity={0.8}
              >
                <Text style={styles.continueBtnText}>I still want to</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ═══ STAGE 3: Breathing Exercise ═══ */}
        {!showCelebration && stage === 3 && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.stageContainer}>
            <Text style={styles.breathingTitle}>Take a moment</Text>
            <BreathingExercise
              visible={true}
              duration={20}
              onComplete={handleBreathingComplete}
            />
          </Animated.View>
        )}

        {/* ═══ STAGE 4: Conscious Override ═══ */}
        {!showCelebration && stage === 4 && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.stageContainer}>
            <Text style={styles.stageTitle}>
              Why do you want to open {selectedApp?.name}?
            </Text>

            <View style={styles.optionsGrid}>
              {REASONS.map(reason => (
                <TouchableOpacity
                  key={reason.value}
                  style={[
                    styles.optionChip,
                    selectedReason === reason.value && styles.optionChipSelected,
                  ]}
                  onPress={() => setSelectedReason(reason.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.optionChipText,
                    selectedReason === reason.value && { color: '#A855F7' },
                  ]}>{reason.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.stageTitle, { marginTop: 24 }]}>
              How long will you use it?
            </Text>

            <View style={styles.optionsGrid}>
              {DURATIONS.map(dur => (
                <TouchableOpacity
                  key={dur.value}
                  style={[
                    styles.optionChip,
                    selectedDuration === dur.value && styles.optionChipSelected,
                  ]}
                  onPress={() => setSelectedDuration(dur.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.optionChipText,
                    selectedDuration === dur.value && { color: '#A855F7' },
                  ]}>{dur.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[
                styles.overrideBtn,
                (!selectedReason || !selectedDuration) && { opacity: 0.3 },
              ]}
              onPress={handleOverride}
              disabled={!selectedReason || !selectedDuration}
              activeOpacity={0.8}
            >
              <Text style={styles.overrideBtnText}>Use Mindfully</Text>
            </TouchableOpacity>

            <Text style={styles.overrideNote}>
              No judgment. I'll check back with you.
            </Text>

            {/* Last chance resist */}
            <TouchableOpacity
              style={styles.lastChanceBtn}
              onPress={handleResist}
              activeOpacity={0.7}
            >
              <Text style={styles.lastChanceBtnText}>
                Actually, never mind — I'll pass ✨
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  stageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40,
  },

  // ─── Stage 1: App Selection ───
  stageTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  stageSubtitle: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  appList: {
    width: '100%',
    maxHeight: 400,
  },
  appCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.05)',
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.2)',
  },
  appIcon: {
    fontSize: 28,
    marginRight: 14,
  },
  appIconImage: {
    width: 32,
    height: 32,
    marginRight: 14,
    borderRadius: 8,
  },
  appName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  appBundle: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },
  usageBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  usageText: {
    color: '#A855F7',
    fontSize: 12,
    fontWeight: '700',
  },
  justTemptedBtn: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  justTemptedBtnText: {
    color: '#A855F7',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  justTemptedBtnSub: {
    color: '#a1a1aa',
    fontSize: 13,
  },

  // ─── Stage 2: AI Prompt ───
  selectedAppIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  selectedAppIconImage: {
    width: 56,
    height: 56,
    marginBottom: 8,
    borderRadius: 12,
  },
  selectedAppName: {
    color: '#71717a',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 24,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  aiLoadingContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  aiLoadingText: {
    color: '#71717a',
    fontSize: 14,
    marginTop: 12,
  },
  aiMessageCard: {
    backgroundColor: '#121212',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#A855F720',
    padding: 24,
    marginBottom: 20,
    width: '100%',
  },
  aiMessageText: {
    color: '#e4e4e7',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
  },
  futureMessageCard: {
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.2)',
  },
  futureMessageLabel: {
    color: '#A855F7',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  futureMessageText: {
    color: '#d4d4d8',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  buttonRow: {
    width: '100%',
    gap: 10,
  },
  resistBtn: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.4)',
  },
  resistBtnText: {
    color: '#22C55E',
    fontSize: 16,
    fontWeight: '700',
  },
  continueBtn: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'transparent',
  },
  continueBtnText: {
    color: '#71717a',
    fontSize: 14,
    fontWeight: '600',
  },

  // ─── Stage 3: Breathing ───
  breathingTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },

  // ─── Stage 4: Override ───
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 12,
    width: '100%',
  },
  optionChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  optionChipSelected: {
    borderColor: '#A855F7',
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
  },
  optionChipText: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '700',
  },
  overrideBtn: {
    backgroundColor: '#27272a',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginTop: 32,
  },
  overrideBtnText: {
    color: '#a1a1aa',
    fontSize: 15,
    fontWeight: '700',
  },
  overrideNote: {
    color: '#52525b',
    fontSize: 13,
    marginTop: 10,
    fontStyle: 'italic',
  },
  lastChanceBtn: {
    marginTop: 20,
    padding: 12,
  },
  lastChanceBtnText: {
    color: '#A855F7',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },

  // ─── Celebration ───
  celebrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40,
  },
  celebrationEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  celebrationTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  celebrationXP: {
    color: '#A855F7',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 32,
  },
  celebrationSub: {
    color: '#71717a',
    fontSize: 14,
    marginBottom: 12,
  },
  replacementCard: {
    backgroundColor: '#121212',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 20,
    marginBottom: 32,
    width: '100%',
  },
  replacementText: {
    color: '#e4e4e7',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  celebrationBtn: {
    backgroundColor: '#A855F7',
    borderRadius: 16,
    padding: 18,
    paddingHorizontal: 40,
  },
  celebrationBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  chatList: {
    flex: 1,
    width: '100%',
    marginBottom: 16,
  },
  chatBubble: {
    maxWidth: '85%',
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'row',
  },
  chatBubbleAi: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
  },
  chatBubbleUser: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
    borderColor: 'rgba(168, 85, 247, 0.4)',
    borderWidth: 1,
  },
  chatText: {
    fontSize: 15,
    lineHeight: 22,
    flexShrink: 1,
  },
  chatTextAi: {
    color: '#e4e4e7',
  },
  chatTextUser: {
    color: '#fff',
  },
  chatInputRow: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: 20,
    gap: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
    borderColor: '#333',
    borderWidth: 1,
  },
  chatSendBtn: {
    backgroundColor: '#A855F7',
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatSendBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});

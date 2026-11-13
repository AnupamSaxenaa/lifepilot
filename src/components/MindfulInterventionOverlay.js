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

import { BrainCircuit, Heart, Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Dimensions,
    FlatList, Image,
    KeyboardAvoidingView,
    Modal,
    NativeModules,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import { chatWithCoach } from '../lib/AIEngine';
import { loadTasks } from '../lib/dataManager';
import { Gamification } from '../utils/gamification';
import {
    addLogEntry,
    getApps,
    getEffectiveBlockingMode,
    getProfile,
    getReplacementActivity,
    getTodayStats,
    grantTempAllowance,
    logUsage
} from '../utils/mindfulLock';
import { BreathingExercise } from './BreathingExercise';

const { width } = Dimensions.get('window');

/** Prepare the coach response without mutating component state. */
const prepareCoachResponse = async ({ userId, app, profile, tasks, usage }) => {
  const stats = await getTodayStats(userId);
  const contextData = { tasks, usage, stats, profile, appName: app.name };
  const firstMessage = await chatWithCoach([], contextData);
  return { firstMessage, replacement: getReplacementActivity() };
};

/**
 * One mounted intervention session. The public wrapper below unmounts this whole
 * component whenever the overlay closes, so every opening starts with clean hook
 * state instead of synchronously resetting eleven values from an effect.
 */
const MindfulInterventionSession = ({ onClose, userId, initialApp }) => {
  const { theme } = useTheme();
  const ACCENT = theme.accent;
  const ON_ACCENT = theme.onAccent || '#0B0B0D';
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(ACCENT, ON_ACCENT), [ACCENT, ON_ACCENT]);

  const REASONS = [
    { label: t('mindfulIntervention.reasonBored'), value: 'bored' },
    { label: t('mindfulIntervention.reasonStressed'), value: 'stressed' },
    { label: t('mindfulIntervention.reasonHabit'), value: 'habit' },
    { label: t('mindfulIntervention.reasonNeedIt'), value: 'need' },
    { label: t('mindfulIntervention.reasonJustWantTo'), value: 'want' },
  ];

  const DURATIONS = [
    { label: t('mindfulIntervention.duration5Min'), value: 5 },
    { label: t('mindfulIntervention.duration15Min'), value: 15 },
    { label: t('mindfulIntervention.duration30Min'), value: 30 },
    { label: t('mindfulIntervention.duration1Hr'), value: 60 },
  ];
  const [stage, setStage] = useState(() => (initialApp ? 2 : 1));
  const [apps, setApps] = useState([]);
  const [selectedApp, setSelectedApp] = useState(() => initialApp || null);
  const [chatMessages, setChatMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [replacement, setReplacement] = useState('');
  const [loadingAI, setLoadingAI] = useState(() => !!initialApp);
  const [selectedReason, setSelectedReason] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [profile, setProfile] = useState(null);
  const [todayTasks, setTodayTasks] = useState([]);

  useEffect(() => {
    let active = true;

    (async () => {
      const [appList, loadedProfile] = await Promise.all([
        getApps(userId),
        getProfile(userId),
      ]);

      let appsWithUsage = appList;
      if (Platform.OS === 'android' && NativeModules.AppBlocker?.getUsageToday) {
        appsWithUsage = await Promise.all(
          appList.map(async (app) => {
            const ms = await NativeModules.AppBlocker.getUsageToday(
              app.packageName || app.name.toLowerCase(),
            );
            return { ...app, usageToday: Math.floor(ms / 60000) };
          }),
        );
      }

      const tasks = await loadTasks(userId, () => {});
      const dateStr = new Date().toISOString().split('T')[0];
      const todays = tasks.filter((task) => (
        !task.is_deleted
        && task.status !== 'completed'
        && ((task.planned_date && task.planned_date.startsWith(dateStr))
          || (task.due_date && task.due_date.startsWith(dateStr)))
      ));
      const autoSelectedApp = initialApp || (appsWithUsage.length === 1 ? appsWithUsage[0] : null);

      if (!active) return;
      setApps(appsWithUsage);
      setProfile(loadedProfile);
      setTodayTasks(todays);

      if (!autoSelectedApp) {
        setStage(1);
        return;
      }

      setSelectedApp(autoSelectedApp);
      setStage(2);
      setLoadingAI(true);
      const coach = await prepareCoachResponse({
        userId,
        app: autoSelectedApp,
        profile: loadedProfile,
        tasks: todays,
        usage: appsWithUsage,
      });
      if (!active) return;
      setChatMessages([{ role: 'assistant', content: coach.firstMessage }]);
      setReplacement(coach.replacement);
      setLoadingAI(false);
    })().catch((error) => {
      if (active) {
        console.warn('[MindfulIntervention] Could not initialize:', error?.message || error);
        setLoadingAI(false);
      }
    });

    return () => { active = false; };
  }, [initialApp, userId]);

  const handleSelectApp = async (app, overrideProfile = profile, overrideTasks = todayTasks) => {
    setSelectedApp(app);
    setStage(2);
    setLoadingAI(true);

    try {
      const coach = await prepareCoachResponse({
        userId,
        app,
        profile: overrideProfile,
        tasks: overrideTasks,
        usage: apps,
      });
      setChatMessages([{ role: 'assistant', content: coach.firstMessage }]);
      setReplacement(coach.replacement);
    } finally {
      setLoadingAI(false);
    }
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

    // Grant temporary allowance so Native blocker allows it
    await grantTempAllowance(userId, selectedApp.id, selectedDuration);

    // Log usage minutes
    await logUsage(userId, selectedApp.id, selectedDuration);

    onClose();
  };

  const handleCloseCelebration = () => {
    setShowCelebration(false);
    onClose();
  };

  // When the effective mode is strict (manual toggle OR an active schedule),
  // there is NO bypass — no coach negotiation, no allowance. The override
  // stage becomes a hard wall.
  const isStrict = getEffectiveBlockingMode(profile) === 'strict';

  return (
    <Modal visible animationType="fade" transparent={false}>
      <View style={styles.container}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <X color="#52525b" size={28} />
        </TouchableOpacity>

        {/* ═══ CELEBRATION ═══ */}
        {showCelebration && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.celebrationContainer}>
            <Text style={styles.celebrationEmoji}>🎉</Text>
            <Text style={styles.celebrationTitle}>{t('mindfulIntervention.celebrationTitle')}</Text>
            <Text style={styles.celebrationXP}>{t('mindfulIntervention.celebrationXp', { xp: 25 })}</Text>
            <Text style={styles.celebrationSub}>
              {t('mindfulIntervention.celebrationSub')}
            </Text>
            <View style={styles.replacementCard}>
              <Text style={styles.replacementText}>{replacement}</Text>
            </View>
            <TouchableOpacity style={styles.celebrationBtn} onPress={handleCloseCelebration}>
              <Text style={styles.celebrationBtnText}>{t('mindfulIntervention.celebrationBtnText')}</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ═══ STAGE 1: App Selection ═══ */}
        {!showCelebration && stage === 1 && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.stageContainer}>
            <BrainCircuit color={ACCENT} size={40} style={{ marginBottom: 16 }} />
            <Text style={styles.stageTitle}>{t('mindfulIntervention.stage1Title')}</Text>
            <Text style={styles.stageSubtitle}>{t('mindfulIntervention.stage1Subtitle')}</Text>

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
                      {t('mindfulIntervention.usageBadge', { used: app.usageToday || 0, budget: app.dailyBudgetMinutes })}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity 
              style={styles.justTemptedBtn}
              onPress={() => handleSelectApp({ name: t('mindfulIntervention.generalDistractionName'), id: 'general' })}
              activeOpacity={0.8}
            >
              <Text style={styles.justTemptedBtnText}>{t('mindfulIntervention.justTemptedBtnText')}</Text>
              <Text style={styles.justTemptedBtnSub}>{t('mindfulIntervention.justTemptedBtnSub')}</Text>
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
            <Text style={styles.selectedAppName}>{t('mindfulIntervention.coachChatTitle')}</Text>

            <FlatList
              data={chatMessages.filter(m => m.role !== 'system')}
              keyExtractor={(item, index) => index.toString()}
              style={styles.chatList}
              contentContainerStyle={{ paddingBottom: 20 }}
              renderItem={({ item }) => (
                <View style={[styles.chatBubble, item.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAi]}>
                  {item.role === 'assistant' && <Sparkles color={ACCENT} size={14} style={{ marginRight: 6, alignSelf: 'flex-start', marginTop: 2 }} />}
                  <Text style={[styles.chatText, item.role === 'user' ? styles.chatTextUser : styles.chatTextAi]}>
                    {item.content}
                  </Text>
                </View>
              )}
            />

            {loadingAI && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <ActivityIndicator size="small" color={ACCENT} style={{ marginRight: 8 }} />
                <Text style={{ color: '#a3a3a3' }}>{t('mindfulIntervention.coachTyping')}</Text>
              </View>
            )}

            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder={t('mindfulIntervention.chatInputPlaceholder')}
                placeholderTextColor="#666"
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={handleSendMessage}
                returnKeyType="send"
              />
              <TouchableOpacity style={styles.chatSendBtn} onPress={handleSendMessage}>
                <Text style={styles.chatSendBtnText}>{t('mindfulIntervention.sendButton')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.resistBtn}
                onPress={handleResist}
                activeOpacity={0.8}
              >
                <Heart color="#fff" size={18} />
                <Text style={styles.resistBtnText}>{t('mindfulIntervention.resistBtnText')}</Text>
              </TouchableOpacity>

              {!isStrict && (
                <TouchableOpacity
                  style={styles.continueBtn}
                  onPress={handleProceedToBreathing}
                  activeOpacity={0.8}
                >
                  <Text style={styles.continueBtnText}>{t('mindfulIntervention.continueBtnText')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ═══ STAGE 3: Breathing Exercise ═══ */}
        {!showCelebration && stage === 3 && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.stageContainer}>
            <Text style={styles.breathingTitle}>{t('mindfulIntervention.breathingTitle')}</Text>
            <BreathingExercise
              visible={true}
              duration={20}
              onComplete={handleBreathingComplete}
            />
          </Animated.View>
        )}

        {/* ═══ STAGE 4 (STRICT): Hard wall — no bypass allowed ═══ */}
        {!showCelebration && stage === 4 && isStrict && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.stageContainer}>
            <BrainCircuit color="#A1A1AA" size={40} style={{ marginBottom: 16 }} />
            <Text style={styles.stageTitle}>
              {t('mindfulIntervention.strictBlockedTitle', { appName: selectedApp?.name })}
            </Text>
            <Text style={[styles.overrideNote, { marginTop: 12, marginBottom: 28 }]}>
              {t('mindfulIntervention.strictOverrideNote')}
            </Text>
            <TouchableOpacity
              style={styles.lastChanceBtn}
              onPress={handleResist}
              activeOpacity={0.7}
            >
              <Text style={styles.lastChanceBtnText}>
                {t('mindfulIntervention.strictLastChanceBtnText')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ═══ STAGE 4: Conscious Override (non-strict) ═══ */}
        {!showCelebration && stage === 4 && !isStrict && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.stageContainer}>
            <Text style={styles.stageTitle}>
              {t('mindfulIntervention.overrideStageTitle', { appName: selectedApp?.name })}
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
                    selectedReason === reason.value && { color: ACCENT },
                  ]}>{reason.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.stageTitle, { marginTop: 24 }]}>
              {t('mindfulIntervention.durationQuestionTitle')}
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
                    selectedDuration === dur.value && { color: ACCENT },
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
              <Text style={styles.overrideBtnText}>{t('mindfulIntervention.overrideBtnText')}</Text>
            </TouchableOpacity>

            <Text style={styles.overrideNote}>
              {t('mindfulIntervention.overrideNote')}
            </Text>

            {/* Last chance resist */}
            <TouchableOpacity
              style={styles.lastChanceBtn}
              onPress={handleResist}
              activeOpacity={0.7}
            >
              <Text style={styles.lastChanceBtnText}>
                {t('mindfulIntervention.lastChanceBtnText')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
};

/**
 * Visibility is a mount boundary, not state to synchronize. Closing unmounts the
 * session; reopening creates fresh state and restarts initialization exactly once.
 */
export const MindfulInterventionOverlay = (props) => {
  if (!props.isVisible) return null;
  return (
    <MindfulInterventionSession
      key={`${props.userId || 'anonymous'}:${props.initialApp?.id || props.initialApp?.packageName || 'picker'}`}
      onClose={props.onClose}
      userId={props.userId}
      initialApp={props.initialApp}
    />
  );
};

const makeStyles = (ACCENT, ON_ACCENT) => StyleSheet.create({
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
    backgroundColor: ACCENT + '0D',
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: ACCENT + '33',
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
    backgroundColor: ACCENT + '1A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  usageText: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '700',
  },
  justTemptedBtn: {
    backgroundColor: ACCENT + '1A',
    borderWidth: 1,
    borderColor: ACCENT + '4D',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  justTemptedBtnText: {
    color: ACCENT,
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
    borderColor: ACCENT + '20',
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
    backgroundColor: ACCENT + '14',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: ACCENT + '33',
  },
  futureMessageLabel: {
    color: ACCENT,
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
    backgroundColor: 'rgba(229, 231, 235, 0.15)',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(229, 231, 235, 0.4)',
  },
  resistBtnText: {
    color: '#E5E7EB',
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
    borderColor: ACCENT,
    backgroundColor: ACCENT + '26',
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
    color: ACCENT,
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
    color: ACCENT,
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
    backgroundColor: ACCENT,
    borderRadius: 16,
    padding: 18,
    paddingHorizontal: 40,
  },
  celebrationBtnText: {
    color: ON_ACCENT,
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
    backgroundColor: ACCENT + '26',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
    borderColor: ACCENT + '66',
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
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatSendBtnText: {
    color: ON_ACCENT,
    fontWeight: '700',
    fontSize: 15,
  },
});

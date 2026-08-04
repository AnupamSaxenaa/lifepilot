/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect */
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Calendar, CheckCircle2, Circle, LayoutGrid, Mic, Send, Share2, Sparkles, X, Zap } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform, ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View
} from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withSpring,
    withTiming
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLAYSTORE_MODE } from '../config/flags';
import { getPriorityLabel, shouldShowFlag } from '../config/priorityConfig';
import { chatWithAura, generatePlan } from '../lib/AIEngine';
import { buildAuraContext } from '../lib/auraContext';
import { loadMemory, mergeMemory } from '../lib/auraMemory';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
import { fetchTodayEvents } from '../utils/calendarSync';
import { formatPlanAsText, savePlanForToday } from '../utils/planStore';
import { getCardLayout, getScaledType, isNarrow, isShort } from '../utils/responsive';
import { Storage } from '../utils/storage';
import { LiquidAura } from './LiquidAura';

// Deliberately NOT `Dimensions.get('window')` at module scope: that value is
// captured once at import and is wrong after a rotation, in split screen and on
// foldables. This screen reads the live size via `useWindowDimensions()`.
const MAX_CHAT_MESSAGES = 24;

const getScopedKey = (key, userId) => (userId ? `${key}_${userId}` : key);
const trimMessages = (items) => items.slice(-MAX_CHAT_MESSAGES);
const getTodayKey = () => new Date().toDateString();

const formatTaskContext = (tasks = []) => {
  if (!tasks.length) return 'No open LifePilot tasks.';

  return tasks.map((task) => {
    const details = [
      `title="${task.title}"`,
      `id=${task.id}`,
      shouldShowFlag(task.priority) ? `priority=${getPriorityLabel(task.priority)}` : null,
      task.is_important ? 'important=true' : null,
      task.due_date ? `due=${new Date(task.due_date).toLocaleString()}` : null,
      task.reminder_time ? `reminder=${new Date(task.reminder_time).toLocaleString()}` : null,
      task.repeat_rule ? `repeat=${task.repeat_rule}` : null,
      task.list_id ? `list=${task.list_id}` : null,
      task.notes ? `notes="${String(task.notes).slice(0, 140)}"` : null,
      task.subtasks?.length ? `subtasks=${task.subtasks.map(s => `${s.is_completed ? 'done' : 'open'}:${s.title}`).join('|')}` : null,
    ].filter(Boolean);
    return `- ${details.join(', ')}`;
  }).join('\n');
};

const TypewriterText = ({ message, isProcessing, style }) => {
  const { t } = useTranslation();
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    if (isProcessing) {
      let dots = 0;
      setDisplayedText(t('auraChat.thinking') + '...');
      const dotInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        setDisplayedText(t('auraChat.thinking') + '.'.repeat(dots));
      }, 400);
      return () => clearInterval(dotInterval);
    }
    
    if (!message || !message.content) {
      setDisplayedText(t('auraChat.defaultGreeting'));
      return;
    }

    if (message.role === 'user') {
      setDisplayedText(message.content);
      return;
    }

    setDisplayedText('');
    let i = 0;
    const text = message.content;
    const typeInterval = setInterval(() => {
      setDisplayedText(text.slice(0, i + 3)); 
      i += 3;
      if (i >= text.length) {
        setDisplayedText(text);
        clearInterval(typeInterval);
      }
    }, 15);

    return () => clearInterval(typeInterval);
  }, [message, isProcessing]);

  return <Text style={style}>{displayedText}</Text>;
};

const VoiceVisualizer = () => {
  const bar1 = useSharedValue(4);
  const bar2 = useSharedValue(8);
  const bar3 = useSharedValue(6);
  const bar4 = useSharedValue(10);
  const bar5 = useSharedValue(5);

  useEffect(() => {
    const startPulse = (sv, delay, min, max) => {
      setTimeout(() => {
        sv.value = withRepeat(
          withSequence(
            withTiming(max, { duration: Math.random() * 200 + 200, easing: Easing.inOut(Easing.ease) }),
            withTiming(min, { duration: Math.random() * 200 + 200, easing: Easing.inOut(Easing.ease) })
          ),
          -1,
          true
        );
      }, delay);
    };

    startPulse(bar1, 0, 4, 18);
    startPulse(bar2, 100, 8, 24);
    startPulse(bar3, 200, 6, 20);
    startPulse(bar4, 150, 10, 26);
    startPulse(bar5, 50, 4, 16);
  }, []);

  const s1 = useAnimatedStyle(() => ({ height: bar1.value }));
  const s2 = useAnimatedStyle(() => ({ height: bar2.value }));
  const s3 = useAnimatedStyle(() => ({ height: bar3.value }));
  const s4 = useAnimatedStyle(() => ({ height: bar4.value }));
  const s5 = useAnimatedStyle(() => ({ height: bar5.value }));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginHorizontal: 8, height: 30, justifyContent: 'center' }}>
      <Animated.View style={[{ width: 3, backgroundColor: '#FFFFFF', borderRadius: 2 }, s1]} />
      <Animated.View style={[{ width: 3, backgroundColor: '#FFFFFF', borderRadius: 2 }, s2]} />
      <Animated.View style={[{ width: 3, backgroundColor: '#E879F9', borderRadius: 2 }, s3]} />
      <Animated.View style={[{ width: 3, backgroundColor: '#F472B6', borderRadius: 2 }, s4]} />
      <Animated.View style={[{ width: 3, backgroundColor: '#FFFFFF', borderRadius: 2 }, s5]} />
    </View>
  );
};

const PulseMicButton = ({ isListening, disabled, onPress }) => {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (isListening) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 600, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      pulse.value = withTiming(1, { duration: 300 });
    }
  }, [isListening]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    backgroundColor: isListening ? 'rgba(255, 255, 255, 0.3)' : 'transparent',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: isListening ? 0.6 : 0,
    shadowRadius: isListening ? 12 : 0,
    elevation: isListening ? 10 : 0
  }));

  return (
    <Animated.View style={[styles.micBtn, animatedStyle, { position: 'relative' }]}>
      {isListening && (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', borderRadius: 25, opacity: 0.15 }]} />
      )}
      <TouchableOpacity 
        style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', borderRadius: 25 }} 
        disabled={disabled}
        onPress={onPress}
      >
        <Mic color={isListening ? "#FFF" : "#FFFFFF"} size={22} />
      </TouchableOpacity>
    </Animated.View>
  );
};

let accumulatedSpeech = "";
export const AIAuraOverlay = ({ visible, onClose, tasks, savedPlan, onPlanGenerated, onToggleTask, userId }) => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [userMemory, setUserMemory] = useState('');
  const [creditsLeft, setCreditsLeft] = useState(20);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();

  // Live window size. The planner card used to be sized from a module-scope
  // `Dimensions.get('window')` snapshot, so its layout was wrong after rotation
  // and broke on short screens where a fixed 70%-height card left the scroll
  // area with almost no room once the header and footer took their share.
  const { width: winW, height: winH } = useWindowDimensions();
  const shortScreen = isShort(winH);
  const narrowScreen = isNarrow(winW);

  // Sizing rules live in src/utils/responsive.js so they can be tested. The key
  // guarantee is that `height` is a resolved number: the plan list is a
  // `flex: 1` ScrollView, and with an auto-height card it collapses to zero and
  // the draft schedule renders with no rows.
  const plannerCardSize = getCardLayout(winW, winH);
  const scaled = getScaledType(winW, winH);

  // Animation values
  const overlayOpacity = useSharedValue(0);
  const plannerScale = useSharedValue(0);
  const plannerOpacity = useSharedValue(0);
  const plannerX = useSharedValue(0);
  const plannerY = useSharedValue(0);
  const boltRotation = useSharedValue(0);

  useEffect(() => {
    boltRotation.value = withRepeat(
      withSequence(
        withTiming(-20, { duration: 80, easing: Easing.linear }),
        withTiming(20, { duration: 80, easing: Easing.linear }),
        withTiming(-20, { duration: 80, easing: Easing.linear }),
        withTiming(0, { duration: 80, easing: Easing.linear }),
        withTiming(0, { duration: 2000 })
      ),
      -1,
      false
    );
  }, []);

  const persistMessages = async (nextMessages) => {
    await Storage.set(getScopedKey('ai_chat_history', userId), trimMessages(nextMessages));
  };

  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
    accumulatedSpeech = inputText;
  });
  useSpeechRecognitionEvent('end', () => setIsListening(false));
  useSpeechRecognitionEvent('error', (event) => {
    setIsListening(false);
    console.log('Voice Error:', event.error, event.message);
  });
  useSpeechRecognitionEvent('result', (event) => {
    const currentSegment = event.results[0]?.transcript || '';
    
    const previewText = accumulatedSpeech 
      ? accumulatedSpeech + (accumulatedSpeech.endsWith(' ') ? '' : ' ') + currentSegment
      : currentSegment;
      
    setInputText(previewText.trim());

    if (event.isFinal) {
      accumulatedSpeech = previewText.trim() + ' ';
    }
  });

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { 
      showSub.remove(); 
      hideSub.remove(); 
    };
  }, []);

  const handleMicPress = async () => {
    try {
      if (isListening) {
        ExpoSpeechRecognitionModule.stop();
        setIsListening(false);
      } else {
        const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!result.granted) {
          Alert.alert(t('auraChat.microphoneErrorTitle'), t('auraChat.microphonePermissionMessage'));
          return;
        }
        ExpoSpeechRecognitionModule.start({ 
          lang: 'en-US', 
          interimResults: true,
          continuous: true,
          addsPunctuation: true
        });
      }
    } catch (e) {
      console.error(e);
      Alert.alert(t('auraChat.microphoneErrorTitle'), t('auraChat.microphoneStartFailedMessage'));
    }
  };

  useEffect(() => {
    if (visible) {
      const init = async () => {
        const memoryKey = getScopedKey('aimemory', userId);
        
        // Memory: pull the cloud copy first (cross-device), then fold it into
        // the structured fact store. `mergeMemory` unions cloud + local facts,
        // so switching devices adds knowledge instead of replacing it.
        if (userId) {
          let cloudMemory = '';
          try {
            const { data: profileData, error } = await supabase
              .from('profiles')
              .select('ai_memory')
              .eq('id', userId)
              .single();
            if (!error && profileData?.ai_memory) cloudMemory = profileData.ai_memory;
          } catch (err) {
            console.log('⚠️ Failed to fetch memory from cloud:', err.message);
          }

          // One-time migration of the pre-scoping global blob.
          const legacyGlobal = await Storage.get('aimemory');
          if (legacyGlobal) {
            await mergeMemory(userId, legacyGlobal);
            await Storage.remove('aimemory');
          }

          const merged = cloudMemory
            ? await mergeMemory(userId, cloudMemory)
            : await loadMemory(userId);
          if (merged.text) setUserMemory(merged.text);
        } else {
          // Signed out: nothing to scope memory to, so keep the local blob only.
          const mem = (await Storage.get(memoryKey)) || (await Storage.get('aimemory')) || '';
          if (mem) setUserMemory(mem);
        }

        // AI tokens are server-authoritative and ALWAYS metered (no unlimited).
        // Show cached value instantly, then confirm the real balance with the server.
        const localCredits = await Storage.get(`aicredits_${userId}`);
        if (localCredits !== null && localCredits !== undefined) {
          setCreditsLeft(parseInt(localCredits, 10));
        }
        await refreshCredits();

        const savedMessages = await Storage.get(getScopedKey('ai_chat_history', userId));
        if (Array.isArray(savedMessages) && savedMessages.length > 0) {
          setMessages(trimMessages(savedMessages));
          return;
        }
        
        // Dynamic, versatile greetings based on memory
        // Use userMemory state which was just loaded above
        const currentMemory = await Storage.get(memoryKey);
        if (currentMemory && currentMemory.length > 30) {
          const returningGreetings = [
            t('auraChat.returningGreeting1'),
            t('auraChat.returningGreeting2'),
            t('auraChat.returningGreeting3'),
            t('auraChat.returningGreeting4')
          ];
          const randomGreeting = returningGreetings[Math.floor(Math.random() * returningGreetings.length)];
          const nextMessages = [{ role: 'assistant', content: randomGreeting }];
          setMessages(nextMessages);
          persistMessages(nextMessages);
        } else {
          const newGreetings = [
            t('auraChat.newGreeting1'),
            t('auraChat.newGreeting2'),
            t('auraChat.newGreeting3'),
            t('auraChat.newGreeting4')
          ];
          const randomGreeting = newGreetings[Math.floor(Math.random() * newGreetings.length)];
          const nextMessages = [{ role: 'assistant', content: randomGreeting }];
          setMessages(nextMessages);
          persistMessages(nextMessages);
        }
      };
      init();
      
      if (savedPlan) {
        setGeneratedPlan(savedPlan);
        plannerScale.value = 1;
        plannerOpacity.value = 1;
      } else {
        setGeneratedPlan(null);
        plannerScale.value = 0.8;
        plannerOpacity.value = 0;
      }
      
      overlayOpacity.value = withTiming(1, { duration: 400 });
      
      // Reset planner fly animation
      plannerScale.value = 1;
      plannerX.value = 0;
      plannerY.value = 0;
    } else {
      overlayOpacity.value = withTiming(0, { duration: 300 });
    }
  }, [visible, savedPlan, userId]);

  // Store builds require the secure proxy, so AsyncStorage is display cache
  // only and can never become an authoritative balance.
  const SERVER_CREDITS =
    process.env.EXPO_PUBLIC_REQUIRE_AI_PROXY === 'true'
    || process.env.EXPO_PUBLIC_REQUIRE_AI_PROXY === '1'
    || !!process.env.EXPO_PUBLIC_AI_PROXY_URL;

  // Read the authoritative token balance (daily free + purchased) from server.
  const refreshCredits = async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase.rpc('get_ai_balance');
      if (!error && data) {
        const total = data.total ?? 0;
        setCreditsLeft(total);
        await Storage.set(`aicredits_${userId}`, total.toString());
      }
    } catch (e) {
      console.log('[Tokens] refresh failed:', e.message);
    }
  };

  // In production the server already decremented; we just re-sync the UI.
  // In dev (no proxy) we optimistically decrement locally so testing works.
  const deductCredits = async (amount) => {
    if (SERVER_CREDITS) {
      await refreshCredits();
      return creditsLeft;
    }
    const newCredits = Math.max(0, creditsLeft - amount);
    setCreditsLeft(newCredits);
    await Storage.set(`aicredits_${userId}`, newCredits.toString());
    return newCredits;
  };

  const refundCredits = async (amount) => {
    if (SERVER_CREDITS) {
      await refreshCredits();
      return creditsLeft;
    }
    const newCredits = creditsLeft + amount;
    setCreditsLeft(newCredits);
    await Storage.set(`aicredits_${userId}`, newCredits.toString());
    return newCredits;
  };

  const handleSend = async () => {
    if (!inputText.trim() || isProcessing) return;

    if (creditsLeft < 1) {
      const outOfCreditsMessage = { role: 'assistant', content: t('auraChat.outOfCreditsMessage') };
      setMessages([...messages, outOfCreditsMessage]);
      setInputText('');
      return;
    }

    setIsProcessing(true);
    const newMessages = trimMessages([...messages, { role: 'user', content: inputText.trim() }]);
    setMessages(newMessages);
    await persistMessages(newMessages);
    setInputText('');
    
    let creditsDeducted = false;

    try {
      // Phase 1: Chat and update memory
      let calendarContext = '';
      try {
        const calEvents = await fetchTodayEvents(userId);
        if (calEvents) {
          calendarContext = `\n\n${calEvents}`;
        }
      } catch (calError) {
        console.log('[Calendar Fetch Error]:', calError.message);
      }
      
      // Full workspace snapshot (lists, overdue, today, upcoming, backlog,
      // routines, momentum) instead of only the tasks array passed in — and
      // token-budgeted so the prompt stays cheap.
      const worldContext = await buildAuraContext(userId, tasks);
      const taskContext = worldContext || formatTaskContext(tasks || []);

      const chatSysPrompt = {
        role: 'system',
        content: `The user may ask about their tasks, lists, backlog, routines, calendar or schedule. Answer directly from the workspace snapshot below — it is the live state of their account. Reference specific list names and counts when relevant. Do not build a full planner unless asked.

WORKSPACE SNAPSHOT:
${taskContext}${calendarContext}`
      };

      const responseJson = await chatWithAura([chatSysPrompt, ...newMessages], userMemory);

      // Merge rather than overwrite: facts the model restates win, facts it
      // simply didn't mention this turn survive. That's what stops Aura from
      // forgetting things it already learned.
      if (responseJson.memory) {
        const { text: mergedMemory, changed } = await mergeMemory(userId, responseJson.memory);
        if (changed && mergedMemory && mergedMemory !== userMemory) {
          setUserMemory(mergedMemory);

          if (userId) {
            // Through SyncQueue, not a direct write: a fire-and-forget call was
            // silently lost whenever the user chatted offline, so those facts
            // never reached the cloud and died on uninstall. Queued means it
            // retries automatically once connectivity returns.
            syncToSupabase(
              'profiles',
              'update',
              { ai_memory: mergedMemory },
              { column: 'id', value: userId },
            );
          }
          console.log('🧠 Memory merged & queued for sync');
        }
      }
      
      const nextMessages = trimMessages([...newMessages, { role: 'assistant', content: responseJson.reply || t('auraChat.defaultReply') }]);
      setMessages(nextMessages);
      await persistMessages(nextMessages);
      
      // IMPROVEMENT 2: Only deduct if not fallback and track deduction
      if (!responseJson._isFallback) {
        await deductCredits(1);
        creditsDeducted = true;
      }
    } catch (error) {
      console.error('[AI Chat Error]:', error);

      // Out of credits — inform the user (paywall hook point).
      if (error?.code === 'INSUFFICIENT_CREDITS') {
        setCreditsLeft(error.remaining ?? 0);
        const outMsg = PLAYSTORE_MODE
          ? t('auraChat.outOfCreditsUpgradeMessage')
          : t('auraChat.outOfCreditsTomorrowMessage');
        const nextMessages = trimMessages([...newMessages, { role: 'assistant', content: outMsg }]);
        setMessages(nextMessages);
        await persistMessages(nextMessages);
        setIsProcessing(false);
        return;
      }

      // Server-side rate limit hit — no tokens were spent (rejected before
      // the spend), so nothing to refund. Slow down messaging only.
      if (error?.code === 'RATE_LIMITED') {
        const nextMessages = trimMessages([...newMessages, { role: 'assistant', content: t('auraChat.rateLimitedMessage') }]);
        setMessages(nextMessages);
        await persistMessages(nextMessages);
        setIsProcessing(false);
        return;
      }

      // Global AI kill switch is off — nothing was spent.
      if (error?.code === 'AI_DISABLED') {
        const nextMessages = trimMessages([...newMessages, { role: 'assistant', content: t('auraChat.aiDisabledMessage') }]);
        setMessages(nextMessages);
        await persistMessages(nextMessages);
        setIsProcessing(false);
        return;
      }

      // IMPROVEMENT 2: Refund credits if we deducted them before the error
      if (creditsDeducted) {
        await refundCredits(1);
      }
      
      const errorMessage = t('auraChat.connectionLostMessage');
      
      const nextMessages = trimMessages([...newMessages, { role: 'assistant', content: errorMessage }]);
      setMessages(nextMessages);
      await persistMessages(nextMessages);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBuildSchedule = async () => {
    setIsProcessing(true);
    const planningMessages = trimMessages([...messages, { role: 'assistant', content: t('auraChat.buildingScheduleMessage') }]);
    setMessages(planningMessages);
    persistMessages(planningMessages);
    
    let creditsDeducted = false;

    try {
      if (creditsLeft < 3) {
        const nextMessages = trimMessages([...planningMessages, { role: 'assistant', content: t('auraChat.notEnoughCreditsForPlannerMessage') }]);
        setMessages(nextMessages);
        await persistMessages(nextMessages);
        setIsProcessing(false);
        return;
      }

      const now = new Date();
      // Same full snapshot the chat sees, so the planner can weigh backlog and
      // routines instead of only the tasks handed to this component.
      const plannerWorld = await buildAuraContext(userId, tasks);
      const taskContext = plannerWorld || formatTaskContext(tasks || []);

      let calendarContext = '';
      try {
        const calEvents = await fetchTodayEvents(userId);
        if (calEvents) {
          calendarContext = `\n\n${calEvents}`;
        }
      } catch (calError) {
        console.log('[Calendar Fetch Error in Build Schedule]:', calError.message);
      }

      const sysPrompt = {
        role: 'system',
        content: `Current date: ${now.toDateString()}. Current time: ${now.toLocaleTimeString()}.
Build a realistic day plan using the user's LifePilot tasks and connected calendar.

Planning quality rules:
- Never overlap tasks with booked calendar events.
- Prioritize overdue, due-today, important, and reminded tasks.
- Start from the current time; do not schedule new tasks in the past.
- Add buffer time between demanding tasks.
- If the user prefers a detailed planner, include realistic meals, breaks, and focus blocks.
- Keep explicit LifePilot task IDs exactly when scheduling those tasks.

LifePilot tasks:
${taskContext}${calendarContext}`
      };
      
      const planJson = await generatePlan([sysPrompt, ...messages], userMemory, tasks);
      console.log('✅ Plan generated:', planJson);
      setGeneratedPlan(planJson);

      // Save the plan for TODAY as soon as it exists, rather than waiting for
      // "Build & Save". Closing the overlay (or the app dying) used to throw the
      // schedule away even though 3 credits had already been spent on it, and
      // the home-screen widget had nothing to show.
      if (onPlanGenerated) onPlanGenerated(planJson);
      else await savePlanForToday(userId, planJson);


      // IMPROVEMENT 2: Only deduct if not fallback and track deduction
      if (!planJson._isFallback) {
        await deductCredits(3);
        creditsDeducted = true;
      }
      
      const finalMessages = trimMessages([...planningMessages, { role: 'assistant', content: t('auraChat.scheduleReadyMessage') }]);
      setMessages(finalMessages);
      await persistMessages(finalMessages);

      // Reveal Planner
      plannerScale.value = withSpring(1);
      plannerOpacity.value = withSpring(1);
      
    } catch (error) {
      console.error('[Build Schedule Error]:', error);

      if (error?.code === 'INSUFFICIENT_CREDITS') {
        setCreditsLeft(error.remaining ?? 0);
        const outMsg = PLAYSTORE_MODE
          ? t('auraChat.notEnoughTokensUpgradeMessage')
          : t('auraChat.notEnoughTokensTomorrowMessage');
        const nextMessages = trimMessages([...planningMessages, { role: 'assistant', content: outMsg }]);
        setMessages(nextMessages);
        await persistMessages(nextMessages);
        setIsProcessing(false);
        return;
      }

      if (error?.code === 'RATE_LIMITED') {
        const nextMessages = trimMessages([...planningMessages, { role: 'assistant', content: t('auraChat.buildRateLimitedMessage') }]);
        setMessages(nextMessages);
        await persistMessages(nextMessages);
        setIsProcessing(false);
        return;
      }

      if (error?.code === 'AI_DISABLED') {
        const nextMessages = trimMessages([...planningMessages, { role: 'assistant', content: t('auraChat.aiDisabledMessage') }]);
        setMessages(nextMessages);
        await persistMessages(nextMessages);
        setIsProcessing(false);
        return;
      }

      // IMPROVEMENT 2: Refund credits if we deducted them before the error
      if (creditsDeducted) {
        await refundCredits(3);
      }
      
      const nextMessages = trimMessages([...planningMessages, { role: 'assistant', content: t('auraChat.buildFailedMessage', { message: error.message }) }]);
      setMessages(nextMessages);
      await persistMessages(nextMessages);
    } finally {
      setIsProcessing(false);
    }
  };

  const triggerMinimizeAnimation = () => {
    if (generatedPlan && onPlanGenerated) {
      onPlanGenerated(generatedPlan);
    }
    
    plannerScale.value = withTiming(0, { duration: 500, easing: Easing.inOut(Easing.ease) });
    // Live height, not the module-scope snapshot — after a rotation the old
    // value sent the card the wrong distance.
    plannerY.value = withTiming(-winH / 2, { duration: 500, easing: Easing.inOut(Easing.ease) });
    overlayOpacity.value = withTiming(0, { duration: 500 }, () => {
      runOnJS(onClose)();
    });
  };

  const toggleCheckbox = async (item) => {
    let newPlan;
    if (item.taskId && item.taskId !== 'null') {
      const newStatus = !item.completed;
      if (onToggleTask) {
        onToggleTask(item.taskId, item.completed); // Pass old status because parent negates it
      }
      newPlan = generatedPlan.map(p => p.taskId === item.taskId ? {...p, completed: newStatus} : p);
    } else {
      newPlan = generatedPlan.map(p => p.title === item.title ? {...p, completed: !p.completed} : p);
    }
    setGeneratedPlan(newPlan);
    if (onPlanGenerated) onPlanGenerated(newPlan);
  };

  /** Share the day's schedule as plain text through the OS share sheet. */
  const handleSharePlan = async () => {
    const message = formatPlanAsText(generatedPlan);
    if (!message) return;
    try {
      await Share.share({ message, title: "Today's Plan" });
    } catch (error) {
      // User dismissing the sheet also lands here on some OEMs — stay quiet.
      console.log('[Aura] Share cancelled/failed:', error?.message);
    }
  };

  /**
   * Put the plan on the home screen.
   *
   * `react-native-android-widget` exposes no pin/requestPinAppWidget binding, so
   * a widget cannot be placed programmatically. What we CAN do is make sure the
   * plan is saved for today and the widget is rendered with it, then tell the
   * user the one manual step left.
   */
  const handleAddToHomeScreen = async () => {
    if (!generatedPlan) return;
    // The host screen persists + refreshes the widget via savePlanForToday; only
    // save directly when no host is listening, so the widget never renders empty.
    if (onPlanGenerated) onPlanGenerated(generatedPlan);
    else await savePlanForToday(userId, generatedPlan);
    Alert.alert(
      "Add Today's Plan widget",
      'Your plan is saved. To put it on your home screen: long-press an empty spot on the home screen, tap Widgets, find LifePilot, then drag "Today\'s Plan" out.\n\nYou can tick tasks straight from the widget, just like the Today widget.',
      [{ text: 'Got it' }]
    );
  };

  const animatedOverlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const animatedPlannerStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: plannerScale.value },
      { translateX: plannerX.value },
      { translateY: plannerY.value }
    ],
  }));

  const animatedBoltStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${boltRotation.value}deg` }],
  }));

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, animatedOverlayStyle]}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        
        <SafeAreaView style={{ flex: 1 }}>
          {/* Top Header Bar */}
          <View style={[styles.topBar, { top: Math.max(insets.top + 10, Platform.OS === 'android' ? 20 : 10) }]}>
            <View style={styles.creditsBadge}>
              <Animated.View style={animatedBoltStyle}>
                <Zap color="#FFD700" size={14} fill="#FFD700" />
              </Animated.View>
              <Text style={styles.creditsText}>{t('auraChat.creditsLeftLabel', { count: creditsLeft })}</Text>
            </View>
            
            <TouchableOpacity 
              style={styles.closeBtn} 
              onPress={onClose} 
              activeOpacity={0.7}
            >
              <X color="#FFF" size={28} />
            </TouchableOpacity>
          </View>

          <View style={[styles.interactionContainer, { paddingBottom: Platform.OS === 'android' ? keyboardHeight : 0 }]}>
            <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
              style={styles.interactionContainer}
            >
              {!generatedPlan ? (
              <>
                {/* Scrollable Chat Area */}
                <ScrollView 
                  style={{ flex: 1 }} 
                  contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
                  showsVerticalScrollIndicator={false}
                >
                  {/* The Eclipse Halo Aura */}
                  <View style={styles.auraContainer}>
                    <LiquidAura isProcessing={isProcessing} />
                    <TypewriterText 
                      message={messages[messages.length - 1]} 
                      isProcessing={isProcessing} 
                      style={styles.auraStatusText} 
                    />
                  </View>
                </ScrollView>

                {/* Chat Input Pushed to Bottom */}
                <View style={styles.inputWrapper}>
                  <View style={styles.inputBox}>
                    <TouchableOpacity 
                      style={[styles.micBtn, isListening && { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]} 
                      disabled={isProcessing}
                      onPress={handleMicPress}
                    >
                      <Mic color={isListening ? "#FFF" : "#FFFFFF"} size={22} />
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.input, isListening && { color: '#FFFFFF', fontWeight: '500' }]}
                      placeholder={isListening ? t('auraChat.listeningPlaceholder') : t('auraChat.inputPlaceholder')}
                      placeholderTextColor="#888"
                      value={inputText}
                      onChangeText={setInputText}
                      editable={!isProcessing}
                    />
                    <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={isProcessing || !inputText.trim()}>
                      <Send color="#000" size={18} style={{ marginLeft: -2 }} />
                    </TouchableOpacity>
                  </View>
                  
                  {/* Build Schedule Button */}
                  {creditsLeft < 3 ? (
                    <View style={{ marginTop: 12, padding: 12, backgroundColor: 'rgba(161, 161, 170, 0.1)', borderRadius: 12, alignItems: 'center' }}>
                      <Text style={{ color: '#A1A1AA', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                        {t('auraChat.notEnoughCreditsInline')}
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      style={styles.buildBtn} 
                      onPress={handleBuildSchedule} 
                      disabled={isProcessing}
                      activeOpacity={0.8}
                    >
                      <Sparkles color="#FFFFFF" size={20} />
                      <Text style={styles.buildBtnText}>
                        {t('auraChat.buildScheduleButton')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : (
              /* The Generated Planner Card */
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Animated.View style={[styles.plannerCard, plannerCardSize, animatedPlannerStyle]}>
                  <View style={[styles.plannerHeader, shortScreen && { marginBottom: 12 }]}>
                    <Calendar color="#FFF" size={scaled.headerIcon} />
                    <Text
                      style={[styles.plannerTitle, { fontSize: scaled.title, flexShrink: 1 }]}
                      numberOfLines={1}
                    >
                      {t('auraChat.draftScheduleTitle')}
                    </Text>
                    <View style={{ flex: 1, minWidth: 8 }} />
                    <TouchableOpacity
                      style={styles.plannerHeaderAction}
                      onPress={handleAddToHomeScreen}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="How to add this plan to your home screen"
                    >
                      <LayoutGrid color="#FFFFFF" size={17} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.plannerHeaderAction}
                      onPress={handleSharePlan}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="Share this plan"
                    >
                      <Share2 color="#FFFFFF" size={17} />
                    </TouchableOpacity>
                  </View>
                  {/* `flexShrink` lets the list give up space to the header and
                      footer on short screens rather than pushing them off. */}
                  <ScrollView style={styles.plannerScroll} contentContainerStyle={{ paddingBottom: 4 }}>
                    {generatedPlan.map((item, index) => {
                      const isImplicit = !item.taskId;
                      return (
                      <TouchableOpacity 
                        key={index} 
                        style={styles.plannerItem}
                        onPress={() => !isImplicit && toggleCheckbox(item)}
                        activeOpacity={isImplicit ? 1 : 0.7}
                      >
                        {isImplicit ? (
                          // Implicit Task: Glowing Dot
                          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', marginHorizontal: 4, shadowColor: '#FFFFFF', shadowOffset: {width:0, height:0}, shadowOpacity: 0.8, shadowRadius: 6 }} />
                        ) : (
                          // Explicit Task: Checkbox
                          item.completed ? (
                            <CheckCircle2 color="#FFFFFF" size={22} />
                          ) : (
                            <Circle color="#666" size={22} />
                          )
                        )}
                        <View style={styles.plannerItemContent}>
                          <Text
                            style={[styles.plannerItemTime, { fontSize: scaled.itemTime }, item.completed && styles.completedText, isImplicit && { color: '#FFFFFF' }]}
                            numberOfLines={1}
                          >
                            {item.time}
                          </Text>
                          <Text
                            style={[styles.plannerItemTitle, { fontSize: scaled.itemTitle }, item.completed && styles.completedText]}
                            numberOfLines={2}
                          >
                            {item.title}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )})}
                  </ScrollView>

                  {/* The Enhance & Build Buttons. On a narrow screen two
                      side-by-side labels at 16px clip, so they stack instead. */}
                  <View style={[styles.draftFooter, narrowScreen && styles.draftFooterStacked]}>
                    <TouchableOpacity 
                      style={styles.draftEnhanceBtn} 
                      onPress={() => {
                        setGeneratedPlan(null);
                        const nextMessages = trimMessages([...messages, { role: 'assistant', content: t('auraChat.enhancePromptMessage') }]);
                        setMessages(nextMessages);
                        persistMessages(nextMessages);
                      }}
                    >
                      <Sparkles color="#FFFFFF" size={scaled.actionIcon} />
                      <Text style={[styles.draftEnhanceBtnText, { fontSize: scaled.action }]} numberOfLines={1}>
                        {t('auraChat.enhanceButton')}
                      </Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.draftSaveBtn} onPress={triggerMinimizeAnimation}>
                      <CheckCircle2 color="#111" size={scaled.actionIcon} />
                      <Text style={[styles.draftSaveBtnText, { fontSize: scaled.action }]} numberOfLines={1}>
                        {t('auraChat.buildAndSaveButton')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              </View>
            )}
          </KeyboardAvoidingView>
          </View>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000',
    zIndex: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  creditsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  creditsText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  closeBtn: {
    padding: 8,
  },
  interactionContainer: {
    flex: 1,
  },
  auraContainer: {
    paddingVertical: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  auraStatusText: {
    color: '#FFF',
    fontSize: 18,
    textAlign: 'center',
    fontWeight: '600',
    maxWidth: 280,
    lineHeight: 26,
  },
  inputWrapper: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 20 : 40,
  },
  inputBox: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  input: {
    flex: 1,
    color: '#FFF',
    fontSize: 16,
    paddingRight: 16,
    minHeight: 40,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buildBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 24,
    paddingVertical: 14,
    marginTop: 16,
    gap: 8,
  },
  buildBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  plannerCard: {
    // Size comes from `useWindowDimensions` at render time (see plannerCardSize)
    // — a module-scope Dimensions snapshot is captured once at import and is
    // wrong after rotation, in split screen, and on foldables.
    backgroundColor: '#161618',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2C',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 20,
  },
  plannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  plannerTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '700',
  },
  plannerHeaderAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  plannerScroll: {
    flex: 1,
    // Without flexShrink the list refuses to give ground on a short screen and
    // pushes the footer buttons off the bottom of the card.
    flexShrink: 1,
  },
  plannerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  plannerItemContent: {
    marginLeft: 12,
    flex: 1,
  },
  plannerItemTime: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  plannerItemTitle: {
    color: '#FFF',
    fontSize: 16,
  },
  completedText: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  draftFooter: {
    flexDirection: 'row',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#333',
    justifyContent: 'space-between',
    gap: 12,
  },
  // Narrow screens can't fit two labelled buttons side by side without
  // clipping, so they become a full-width stack.
  draftFooterStacked: {
    flexDirection: 'column',
    gap: 8,
  },
  draftEnhanceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 20,
    paddingVertical: 12,
    gap: 6,
  },
  draftEnhanceBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  draftSaveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 12,
    gap: 6,
  },
  draftSaveBtnText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '700',
  },
});

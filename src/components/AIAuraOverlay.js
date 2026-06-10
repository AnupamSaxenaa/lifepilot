/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect */
import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, TextInput, 
  Dimensions, KeyboardAvoidingView, Platform, ScrollView, Modal, Alert, Keyboard
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { 
  useSharedValue, useAnimatedStyle, withTiming, 
  Easing, withSpring, runOnJS
} from 'react-native-reanimated';
import { Send, CheckCircle2, Circle, Calendar, X, Mic, Sparkles } from 'lucide-react-native';
import { generatePlan, chatWithAura } from '../lib/AIEngine';
import { Storage } from '../utils/storage';
import { LiquidAura } from './LiquidAura';
import { fetchTodayEvents } from '../utils/calendarSync';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

const { width, height } = Dimensions.get('window');
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
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    if (isProcessing) {
      let dots = 0;
      setDisplayedText('Thinking...');
      const dotInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        setDisplayedText('Thinking' + '.'.repeat(dots));
      }, 400);
      return () => clearInterval(dotInterval);
    }
    
    if (!message || !message.content) {
      setDisplayedText('How can I help you?');
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

export const AIAuraOverlay = ({ visible, onClose, tasks, savedPlan, onPlanGenerated, onToggleTask, userId }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [userMemory, setUserMemory] = useState('');
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();
  
  // Animation values
  const overlayOpacity = useSharedValue(0);
  const plannerScale = useSharedValue(0);
  const plannerOpacity = useSharedValue(0);
  const plannerX = useSharedValue(0);
  const plannerY = useSharedValue(0);

  const persistMessages = async (nextMessages) => {
    await Storage.set(getScopedKey('ai_chat_history', userId), trimMessages(nextMessages));
  };

  useSpeechRecognitionEvent('start', () => setIsListening(true));
  useSpeechRecognitionEvent('end', () => setIsListening(false));
  useSpeechRecognitionEvent('error', (event) => {
    setIsListening(false);
    console.log('Voice Error:', event.error, event.message);
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (event.results[0]?.transcript) {
      setInputText((prev) => prev ? prev + ' ' + event.results[0].transcript : event.results[0].transcript);
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
          Alert.alert('Microphone Error', 'Please enable microphone permissions in settings.');
          return;
        }
        ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: false });
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Microphone Error', 'Could not start voice recognition.');
    }
  };

  useEffect(() => {
    if (visible) {
      const init = async () => {
        const memoryKey = getScopedKey('aimemory', userId);
        const legacyMemory = await Storage.get('aimemory');
        const mem = await Storage.get(memoryKey) || legacyMemory || '';
        if (mem) setUserMemory(mem);
        
        if (legacyMemory && userId) {
          await Storage.set(memoryKey, legacyMemory);
          await Storage.remove('aimemory');
        }

        const aiCredits = await Storage.get(getScopedKey('ai_credits', userId));
        if (aiCredits && aiCredits.date === new Date().toDateString()) {
          setCreditsUsed(aiCredits.used || 0);
        } else {
          setCreditsUsed(0);
        }

        const savedMessages = await Storage.get(getScopedKey('ai_chat_history', userId));
        if (Array.isArray(savedMessages) && savedMessages.length > 0) {
          setMessages(trimMessages(savedMessages));
          return;
        }
        
        // Dynamic, versatile greetings based on memory
        if (mem && mem.length > 30) {
          const returningGreetings = [
            "Welcome back! Any changes to your usual routine today?",
            "Hello again! Should we stick to your standard schedule, or is something new happening?",
            "Ready to conquer the day? Let me know if you have any special meetings to add.",
            "I've got your habits loaded! Anything specific you want to focus on today?"
          ];
          const randomGreeting = returningGreetings[Math.floor(Math.random() * returningGreetings.length)];
          const nextMessages = [{ role: 'assistant', content: randomGreeting }];
          setMessages(nextMessages);
          persistMessages(nextMessages);
        } else {
          const newGreetings = [
            "Hello! To build the perfect schedule, could you tell me your occupation?",
            "Welcome! What do you do for work? Knowing your occupation helps me plan your day.",
            "Hi there! Tell me a bit about your daily life and occupation so I can customize your timeline.",
            "Hello! What's your main focus everyday? (e.g., Software Engineer, Student)"
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

  const handleSend = async () => {
    if (!inputText.trim() || isProcessing) return;

    setIsProcessing(true);
    const newMessages = trimMessages([...messages, { role: 'user', content: inputText.trim() }]);
    setMessages(newMessages);
    await persistMessages(newMessages);
    setInputText('');

    try {
      // Phase 1: Chat and update memory
      let calendarContext = '';
      const calEvents = await fetchTodayEvents(userId);
      if (calEvents) {
        calendarContext = `\n\n${calEvents}`;
      }
      
      const taskContext = formatTaskContext(tasks);
      
      const chatSysPrompt = {
        role: 'system',
        content: `Current date: ${new Date().toDateString()}. Current time: ${new Date().toLocaleTimeString()}.
The user might ask about their tasks, calendar, or schedule. If they ask what is in the calendar, answer directly from the calendar events below.
Use this context to inform chat, but do not build a full planner unless they ask for it.

LifePilot tasks:
${taskContext}${calendarContext}`
      };
      
      const responseJson = await chatWithAura([chatSysPrompt, ...newMessages], userMemory);
      
      if (responseJson.memory && responseJson.memory !== userMemory) {
        setUserMemory(responseJson.memory);
        await Storage.set(getScopedKey('aimemory', userId), responseJson.memory);
        console.log('🧠 Memory Updated:', responseJson.memory);
      }
      
      const nextMessages = trimMessages([...newMessages, { role: 'assistant', content: responseJson.reply || "Got it. Anything else?" }]);
      setMessages(nextMessages);
      await persistMessages(nextMessages);
    } catch (_error) {
      const nextMessages = trimMessages([...newMessages, { role: 'assistant', content: 'I lost the AI connection for a moment. Please try again.' }]);
      setMessages(nextMessages);
      await persistMessages(nextMessages);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBuildSchedule = async () => {
    setIsProcessing(true);
    const planningMessages = trimMessages([...messages, { role: 'assistant', content: 'Weaving your perfect timeline...' }]);
    setMessages(planningMessages);
    persistMessages(planningMessages);

    try {
      if (creditsUsed >= 3) {
        const nextMessages = trimMessages([...planningMessages, { role: 'assistant', content: 'You have reached your daily limit of 3 free AI schedules. Please try again tomorrow.' }]);
        setMessages(nextMessages);
        await persistMessages(nextMessages);
        setIsProcessing(false);
        return;
      }

      const now = new Date();
      const taskContext = formatTaskContext(tasks);
      
      let calendarContext = '';
      const calEvents = await fetchTodayEvents(userId);
      if (calEvents) {
        calendarContext = `\n\n${calEvents}`;
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
      setGeneratedPlan(planJson);
      
      const newUsed = creditsUsed + 1;
      setCreditsUsed(newUsed);
      Storage.set(getScopedKey('ai_credits', userId), { date: getTodayKey(), used: newUsed });
      
      // Reveal Planner
      plannerScale.value = withSpring(1);
      
    } catch (error) {
      const nextMessages = trimMessages([...planningMessages, { role: 'assistant', content: `I could not build a schedule yet: ${error.message}` }]);
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
    plannerY.value = withTiming(-height / 2, { duration: 500, easing: Easing.inOut(Easing.ease) });
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

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, animatedOverlayStyle]}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        
        <SafeAreaView style={{ flex: 1 }}>
          {/* Close Button */}
          <TouchableOpacity 
            style={[styles.closeBtn, { top: Math.max(insets.top + 10, Platform.OS === 'android' ? 20 : 10) }]} 
            onPress={onClose} 
            activeOpacity={0.7}
          >
            <X color="#FFF" size={28} />
          </TouchableOpacity>

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
                      style={[styles.micBtn, isListening && { backgroundColor: 'rgba(167, 139, 250, 0.2)' }]} 
                      disabled={isProcessing}
                      onPress={handleMicPress}
                    >
                      <Mic color={isListening ? "#FFF" : "#A78BFA"} size={22} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.input}
                      placeholder="Type or tap the mic..."
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
                  {creditsUsed >= 3 ? (
                    <View style={{ marginTop: 12, padding: 12, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 12, alignItems: 'center' }}>
                      <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                        ⚡ Daily AI limit reached (3/3).{'\n'}Upgrade to Premium for unlimited access.
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      style={styles.buildBtn} 
                      onPress={handleBuildSchedule} 
                      disabled={isProcessing}
                      activeOpacity={0.8}
                    >
                      <Sparkles color="#A78BFA" size={20} />
                      <Text style={styles.buildBtnText}>
                        Build Schedule ({3 - creditsUsed} left)
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : (
              /* The Generated Planner Card */
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Animated.View style={[styles.plannerCard, animatedPlannerStyle]}>
                  <View style={styles.plannerHeader}>
                    <Calendar color="#FFF" size={24} />
                    <Text style={styles.plannerTitle}>Your Draft Schedule</Text>
                  </View>
                  <ScrollView style={styles.plannerScroll}>
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
                          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#A78BFA', marginHorizontal: 4, shadowColor: '#A78BFA', shadowOffset: {width:0, height:0}, shadowOpacity: 0.8, shadowRadius: 6 }} />
                        ) : (
                          // Explicit Task: Checkbox
                          item.completed ? (
                            <CheckCircle2 color="#A78BFA" size={22} />
                          ) : (
                            <Circle color="#666" size={22} />
                          )
                        )}
                        <View style={styles.plannerItemContent}>
                          <Text style={[styles.plannerItemTime, item.completed && styles.completedText, isImplicit && { color: '#A78BFA' }]}>{item.time}</Text>
                          <Text style={[styles.plannerItemTitle, item.completed && styles.completedText]}>{item.title}</Text>
                        </View>
                      </TouchableOpacity>
                    )})}
                  </ScrollView>

                  {/* The Enhance & Build Buttons */}
                  <View style={styles.draftFooter}>
                    <TouchableOpacity 
                      style={styles.draftEnhanceBtn} 
                      onPress={() => {
                        setGeneratedPlan(null);
                        const nextMessages = trimMessages([...messages, { role: 'assistant', content: "No problem. What would you like me to enhance or change?" }]);
                        setMessages(nextMessages);
                        persistMessages(nextMessages);
                      }}
                    >
                      <Sparkles color="#A78BFA" size={18} />
                      <Text style={styles.draftEnhanceBtnText}>Enhance</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.draftSaveBtn} onPress={triggerMinimizeAnimation}>
                      <CheckCircle2 color="#111" size={18} />
                      <Text style={styles.draftSaveBtnText}>Build & Save</Text>
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
  closeBtn: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
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
    paddingHorizontal: 12,
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
    backgroundColor: '#A78BFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buildBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(167, 139, 250, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.4)',
    borderRadius: 24,
    paddingVertical: 14,
    marginTop: 16,
    gap: 8,
  },
  buildBtnText: {
    color: '#A78BFA',
    fontSize: 16,
    fontWeight: '600',
  },
  plannerCard: {
    width: width * 0.9,
    height: height * 0.7,
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
  plannerScroll: {
    flex: 1,
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
    color: '#A78BFA',
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
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
    justifyContent: 'space-between',
    gap: 12,
  },
  draftEnhanceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
    borderRadius: 20,
    paddingVertical: 12,
    gap: 6,
  },
  draftEnhanceBtnText: {
    color: '#A78BFA',
    fontSize: 16,
    fontWeight: '600',
  },
  draftSaveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A78BFA',
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

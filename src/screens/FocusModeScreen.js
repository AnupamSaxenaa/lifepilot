import Slider from '@react-native-community/slider';
import { useNavigation, useRoute } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import * as Brightness from 'expo-brightness';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { Brain, Clock, Coffee, Gamepad2, Info, Moon, Music, Pause, Pizza, Play, Save, Sun, X, Zap } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Easing, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCoachAdvice } from '../lib/AIEngine';
import { addTask } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
import { Storage } from '../utils/storage';

export default function FocusModeScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  
  // The task we are focusing on
  const { task } = route.params || {};

  // Orientation Unlock & Local Brightness
  useEffect(() => {
    const setup = async () => {
      await ScreenOrientation.unlockAsync();
      try {
        const currentBrightness = await Brightness.getBrightnessAsync();
        setBrightnessLevel(currentBrightness);
      } catch (e) {
        console.log('Brightness get error', e);
      }
    };
    setup();

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
    };
  }, []);

  // Brightness State
  const [showBrightnessModal, setShowBrightnessModal] = useState(false);
  const [brightnessLevel, setBrightnessLevel] = useState(0.5);

  // Core Timer State
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isBreak, setIsBreak] = useState(false);
  
  // Brain Dump State
  const [showBrainDump, setShowBrainDump] = useState(false);
  const [dumpText, setDumpText] = useState('');

  // AI Tough Love State
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [toughLoveMessage, setToughLoveMessage] = useState("Great things never came from comfort zones. Get back to work!");

  // AI Flow Coach State
  const [isCoaching, setIsCoaching] = useState(true);
  const [coachAdvice, setCoachAdvice] = useState('');

  // Custom Time State
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');

  // Random Break Icon State
  const breakIcons = [Coffee, Music, Gamepad2, Moon, Pizza, Clock];
  const [RandomBreakIcon, setRandomBreakIcon] = useState(() => breakIcons[0]);
  const breakIconOpacity = useRef(new Animated.Value(1)).current;

  // Cycle break icons every 5 seconds
  useEffect(() => {
    const iconInterval = setInterval(() => {
      Animated.sequence([
        Animated.timing(breakIconOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => {
        setRandomBreakIcon(() => breakIcons[Math.floor(Math.random() * breakIcons.length)]);
        Animated.timing(breakIconOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 5000);
    return () => clearInterval(iconInterval);
  }, []);

  const timerRef = useRef(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const originalFocusTimeRef = useRef(25 * 60);
  
  // Progress tracking states
  const [timeSpentWork, setTimeSpentWork] = useState(0);
  const [timeSpentBreak, setTimeSpentBreak] = useState(0);
  const [showStats, setShowStats] = useState(false);
  
  // Ref to fix stale closure in setInterval
  const isBreakRef = useRef(isBreak);
  useEffect(() => {
    isBreakRef.current = isBreak;
  }, [isBreak]);
  
  // Ref for back handler access without triggering effect
  const secondsLeftRef = useRef(secondsLeft);
  const totalSecondsRef = useRef(totalSeconds);

  useEffect(() => {
    secondsLeftRef.current = secondsLeft;
    totalSecondsRef.current = totalSeconds;
  }, [secondsLeft, totalSeconds]);

  // Immersive Mode & Back Handler
  useEffect(() => {
    const backAction = () => {
      if (secondsLeftRef.current === totalSecondsRef.current) {
        navigation.goBack();
        return true;
      }
      setIsRunning(false);
      setShowQuitModal(true);
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);

    return () => {
      backHandler.remove();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // AI Flow Coach (Initial Setup)
  useEffect(() => {
    if (!task) {
      setIsCoaching(false);
      return;
    }

    const runCoach = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setIsCoaching(false); return; }

        const profileReq = await supabase.from('profiles').select('ai_memory').eq('id', session.user.id).single();
        const memory = profileReq?.data?.ai_memory || "No memory yet.";

        // Find upcoming tasks to prevent overlap
        const allTasks = await Storage.get(`tasks_${session.user.id}`) || [];
        const now = new Date();
        const upcoming = allTasks.filter(t => !t.is_completed && t.id !== task.id && t.reminder_time && new Date(t.reminder_time) > now);
        upcoming.sort((a, b) => new Date(a.reminder_time) - new Date(b.reminder_time));
        const nextTaskInfo = upcoming.length > 0 ? `The next task (${upcoming[0].title}) is scheduled at ${new Date(upcoming[0].reminder_time).toLocaleTimeString()}. DO NOT let this focus session overlap with it.` : "No immediate upcoming tasks.";

        const response = await getCoachAdvice(task.title, nextTaskInfo, memory);
        if (response && response.minutes) {
          const secs = parseInt(response.minutes, 10) * 60;
          setTotalSeconds(secs);
          setSecondsLeft(secs);
          if (response.advice) setCoachAdvice(response.advice);
          if (response.tough_love) setToughLoveMessage(response.tough_love);
        }
      } catch (err) {
        console.log("Coach failed", err);
      } finally {
        setIsCoaching(false);
      }
    };

    runCoach();
  }, [task]);

  // Timer Logic
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setIsRunning(false);
            if (!isBreakRef.current) {
              setTimeSpentWork(t => t + 1);
              handleTimerComplete();
            } else {
              setTimeSpentBreak(t => t + 1);
              endBreak();
            }
            return 0;
          }
          if (isBreakRef.current) setTimeSpentBreak(t => t + 1);
          else setTimeSpentWork(t => t + 1);
          return prev - 1;
        });
      }, 1000);
      
      // Pulse animation while running
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true })
        ])
      ).start();
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      pulseAnim.stopAnimation();
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  // Animate Progress Ring
  useEffect(() => {
    const progress = totalSeconds > 0 ? 1 - (secondsLeft / totalSeconds) : 0;
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [secondsLeft, totalSeconds]);

  const handleTimerComplete = () => {
    Alert.alert(
      "Focus Session Complete! 🎉",
      "Did you finish the task?",
      [
        { text: "No, need a break", onPress: () => startBreak(5 * 60) },
        { text: "No, but I'm done", style: "cancel", onPress: () => navigation.goBack() },
        { text: "Yes, I finished it! 🏆", onPress: () => completeTaskAndExit() }
      ]
    );
  };

  const completeTaskAndExit = async () => {
    if (task) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          // ✅ CRITICAL FIX: Always reload the absolute latest tasks from storage
          // This prevents stale data from overwriting recent changes
          const latestTasks = await Storage.get(`tasks_${session.user.id}`) || [];
          
          console.log('[FocusMode] Loaded latest tasks:', latestTasks.length);
          console.log('[FocusMode] Looking for task:', task.id);
          
          // Find our task in the latest data
          const ourTask = latestTasks.find(t => t.id === task.id);
          
          if (!ourTask) {
            console.error('[FocusMode] Task not found in latest data:', task.id);
            // Task might have been deleted while in focus mode
            Alert.alert('Task Not Found', 'This task may have been deleted. Returning to previous screen.');
            navigation.goBack();
            return;
          }
          
          if (ourTask.is_completed) {
            console.log('[FocusMode] Task already completed, skipping update');
            navigation.goBack();
            return;
          }
          
          // Update ONLY this task - don't touch any others
          const updatedTasks = latestTasks.map(t =>
            t.id === task.id 
              ? { ...t, is_completed: true, completed_at: new Date().toISOString() }
              : t  // Keep all other tasks exactly as they are
          );
          
          console.log('[FocusMode] Updating task completion in cache');
          
          // Save back to cache
          await Storage.set(`tasks_${session.user.id}`, updatedTasks);
          await Storage.set('last_local_write_time', Date.now().toString());
          
          // Sync to Supabase (fire and forget)
          syncToSupabase('tasks', 'update',
            { is_completed: true, completed_at: new Date().toISOString() },
            { column: 'id', value: task.id }
          ).catch(err => {
            console.error('[FocusMode] Sync failed:', err);
          });
          
          console.log('[FocusMode] Task marked as completed successfully');
        }
      } catch (err) {
        console.error('[FocusMode] Error completing task:', err);
        Alert.alert('Error', 'Failed to complete task. Please try again.');
        return;
      }
    }
    navigation.goBack();
  };

  const startBreak = (secs) => {
    originalFocusTimeRef.current = secondsLeft;
    setIsBreak(true);
    setTotalSeconds(secs);
    setSecondsLeft(secs);
    setIsRunning(true);
  };

  const endBreak = () => {
    setIsBreak(false);
    setIsRunning(false);
    if (originalFocusTimeRef.current > 0) {
      setTotalSeconds(originalFocusTimeRef.current);
      setSecondsLeft(originalFocusTimeRef.current);
    } else {
      setTotalSeconds(25 * 60);
      setSecondsLeft(25 * 60);
    }
  };

  const toggleTimer = () => {
    setIsRunning(!isRunning);
  };

  const attemptQuit = () => {
    if (secondsLeft === totalSeconds) {
      // Haven't started yet, just leave
      navigation.goBack();
      return;
    }
    
    setIsRunning(false); // Pause timer
    setShowQuitModal(true);
  };

  const confirmQuit = () => {
    setShowQuitModal(false);
    navigation.goBack();
  };

  const resumeFromQuit = () => {
    setShowQuitModal(false);
    setIsRunning(true);
  };



  const saveBrainDump = async () => {
    if (!dumpText.trim()) {
      setShowBrainDump(false);
      return;
    }
    
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // Save to 'inbox' without scheduling it for Today
      const newTask = {
        title: dumpText.trim(),
        list_id: 'inbox',
        due_date: null,
        added_to_today: false,
        is_completed: false,
        created_at: new Date().toISOString()
      };
      
      // Load the current cache so we don't wipe out other tasks
      const currentCache = await Storage.get(`tasks_${session.user.id}`) || [];
      
      // Fire and forget so we can instantly go back to focus
      addTask(session.user.id, currentCache, newTask, () => {}).then();
    }
    
    setDumpText('');
    setShowBrainDump(false);
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Interpolate progress to ring height/width
  const ringSize = 300;
  
  if (isCoaching) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Brain color="#A855F7" size={64} style={{ marginBottom: 20 }} />
        <Text style={styles.coachTitle}>Aura is analyzing your task...</Text>
        <Text style={styles.coachSub}>Designing the perfect focus interval</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <StatusBar hidden />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={attemptQuit}>
          <X color="#fff" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isBreak ? "Break Time" : "Deep Focus"}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {isLandscape && (
            <TouchableOpacity style={[styles.iconBtn, { marginRight: 12 }]} onPress={() => setShowBrainDump(true)}>
              <Info color="#fff" size={24} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowBrightnessModal(true)}>
            <Sun color="#fff" size={24} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Timer Area */}
      {/* Main Timer Area */}
      <View style={[styles.timerContainer, isLandscape && { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 32 }]}>
        
        {/* Left Side: Progress Bar (Landscape only) */}
        {isLandscape && (timeSpentWork > 0 || timeSpentBreak > 0) ? (
          <View style={{ width: 8, height: '70%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
            {timeSpentWork > 0 && <View style={{ flex: timeSpentWork, backgroundColor: '#A855F7' }} />}
            {timeSpentBreak > 0 && <View style={{ flex: timeSpentBreak, backgroundColor: '#10B981' }} />}
          </View>
        ) : (
          isLandscape && <View style={{ width: 8 }} />
        )}

        {/* Center: Ring (Top in Portrait) */}
        <View style={isLandscape ? { flex: 1, alignItems: 'center', justifyContent: 'center' } : { alignItems: 'center' }}>
          {!isLandscape && coachAdvice ? (
            <View style={styles.adviceBadge}>
              <Zap color="#A855F7" size={16} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.adviceText}>{coachAdvice}</Text>
            </View>
          ) : null}
          
          <Animated.View style={[styles.ringContainer, { transform: [{ scale: pulseAnim }] }, isLandscape && { width: 280, height: 280 }]}>
            <View style={[styles.ringOuter, { borderColor: isBreak ? '#10B981' : '#A855F7' }, isLandscape && { width: 280, height: 280, borderRadius: 140, borderWidth: 6 }]}>
              <View style={[styles.ringInner, isLandscape && { width: 250, height: 250, borderRadius: 125 }]}>
                <TouchableOpacity onPress={() => setShowTimeModal(true)} style={{ alignItems: 'center' }}>
                  <Text style={[styles.timeText, isLandscape && { fontSize: 64 }]}>{formatTime(secondsLeft)}</Text>
                  <Text style={[styles.taskTitle, isLandscape && { fontSize: 16 }]} numberOfLines={2}>{task?.title || "Custom Focus Session"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </View>

        {/* Right Side: Controls (Bottom in Portrait) */}
        <View style={isLandscape ? { height: '80%', justifyContent: 'center' } : { width: '100%' }}>
          {/* Action Buttons Row */}
          <View style={[styles.controlsRow, isLandscape && { flexDirection: 'column', marginTop: 0, gap: 16 }]}>
            
            {/* Custom Time */}
            <TouchableOpacity 
              style={styles.secondaryBtn}
              onPress={() => setShowTimeModal(true)}
            >
              <Clock color="#fff" size={24} />
            </TouchableOpacity>

            {/* Center Action: Play/Pause */}
            <TouchableOpacity 
              style={[styles.playBtn, isLandscape && { marginHorizontal: 0, width: 80, height: 80, borderRadius: 40 }, { 
                backgroundColor: isRunning ? (isBreak ? '#064E3B' : '#3B0764') : (isBreak ? '#10B981' : '#A855F7'),
                shadowColor: isBreak ? '#10B981' : '#A855F7'
              }]} 
              onPress={toggleTimer}
            >
              {isRunning ? <Pause color="#fff" size={isLandscape ? 40 : 32} /> : <Play color="#fff" size={isLandscape ? 40 : 32} fill="#fff" style={{ marginLeft: 4 }} />}
            </TouchableOpacity>

            {/* Break / End Break */}
            {!isBreak ? (
              <Animated.View style={{ opacity: breakIconOpacity }}>
                <TouchableOpacity 
                  style={styles.secondaryBtn}
                  onPress={() => startBreak(5 * 60)}
                >
                  <RandomBreakIcon color="#fff" size={24} />
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <TouchableOpacity 
                style={[styles.secondaryBtn, { borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}
                onPress={endBreak}
              >
                <X color="#EF4444" size={24} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Session Progress Bar */}
      {!isLandscape && (timeSpentWork > 0 || timeSpentBreak > 0) && (
        <TouchableOpacity style={styles.statsContainer} onPress={() => setShowStats(!showStats)} activeOpacity={0.8}>
          <View style={styles.progressBar}>
            {timeSpentWork > 0 && (
              <View style={[styles.progressWork, { flex: timeSpentWork }]} />
            )}
            {timeSpentBreak > 0 && (
              <View style={[styles.progressBreak, { flex: timeSpentBreak }]} />
            )}
          </View>
          {showStats && (
            <View style={styles.statsDetails}>
              <Text style={styles.statTextWork}>Work: {Math.floor(timeSpentWork / 60)}m {timeSpentWork % 60}s</Text>
              <Text style={styles.statTextBreak}>Break: {Math.floor(timeSpentBreak / 60)}m {timeSpentBreak % 60}s</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Bottom Actions */}
      {!isLandscape && (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.brainDumpBtn} onPress={() => setShowBrainDump(true)}>
            <Info color="#fff" size={20} />
            <Text style={styles.brainDumpText}>Brain Dump Distraction</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Brain Dump Modal */}
      <Modal visible={showBrainDump} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.brainDumpCard}>
            <Text style={styles.modalTitle}>Dump Your Distraction</Text>
            <Text style={styles.modalSub}>Write it down here. Aura will automatically add it to your Inbox for later so you can get back to work immediately.</Text>
            <TextInput
              style={styles.brainDumpInput}
              placeholder="e.g., Remember to pay the electricity bill..."
              placeholderTextColor="#666"
              value={dumpText}
              onChangeText={setDumpText}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowBrainDump(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={saveBrainDump}>
                <Save color="#fff" size={20} style={{ marginRight: 8 }} />
                <Text style={styles.modalSaveText}>Save & Return to Focus</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Tough Love Modal */}
      <Modal visible={showQuitModal} transparent animationType="fade">
        <View style={styles.modalContainer}>
          <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.toughLoveCard}>
            <Brain color="#A855F7" size={48} style={{ alignSelf: 'center', marginBottom: 16 }} />
            <Text style={styles.modalTitle}>Quitting so soon?</Text>
            
            <Text style={styles.toughLoveText}>"{toughLoveMessage}"</Text>

            <View style={{ marginTop: 32 }}>
              <TouchableOpacity style={styles.resumeBtn} onPress={resumeFromQuit}>
                <Text style={styles.resumeText}>You're right. Let's finish this.</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quitBtn} onPress={confirmQuit}>
                <Text style={styles.quitText}>I'm weak. I quit.</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Time Modal */}
      <Modal visible={showTimeModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.brainDumpCard}>
            <Text style={styles.modalTitle}>Set Custom Time</Text>
            <Text style={styles.modalSub}>Override Aura's suggested time (in minutes).</Text>
            <TextInput
              style={[styles.brainDumpInput, { fontSize: 24, textAlign: 'center' }]}
              placeholder="e.g., 25"
              placeholderTextColor="#666"
              keyboardType="number-pad"
              value={customMinutes}
              onChangeText={setCustomMinutes}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowTimeModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={() => {
                const mins = parseInt(customMinutes, 10);
                if (!isNaN(mins) && mins > 0) {
                  setTotalSeconds(mins * 60);
                  setSecondsLeft(mins * 60);
                }
                setShowTimeModal(false);
                setCustomMinutes('');
              }}>
                <Clock color="#fff" size={20} style={{ marginRight: 8 }} />
                <Text style={styles.modalSaveText}>Set Timer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Brightness Modal */}
      <Modal visible={showBrightnessModal} transparent animationType="fade">
        <View style={styles.modalContainer}>
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[styles.brainDumpCard, isLandscape && { width: '60%', alignSelf: 'center' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Sun color="#A855F7" size={24} style={{ marginRight: 8 }} />
              <Text style={styles.modalTitle}>Display Brightness</Text>
            </View>
            <Text style={styles.modalSub}>Adjust screen brightness to reduce eye strain.</Text>
            
            <View style={{ height: 40, justifyContent: 'center', marginVertical: 20 }}>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={0}
                maximumValue={1}
                value={brightnessLevel}
                onValueChange={async (val) => {
                  setBrightnessLevel(val);
                  try {
                    await Brightness.setBrightnessAsync(val);
                  } catch (e) {
                    console.log('Brightness error:', e);
                  }
                }}
                minimumTrackTintColor="#A855F7"
                maximumTrackTintColor="rgba(255,255,255,0.2)"
                thumbTintColor="#D8B4FE"
              />
            </View>
            
            <TouchableOpacity style={[styles.modalSave, { width: '100%' }]} onPress={() => setShowBrightnessModal(false)}>
              <Text style={styles.modalSaveText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  timerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adviceBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginBottom: 48,
    maxWidth: '85%',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.2)',
  },
  adviceText: {
    color: '#D8B4FE',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'left',
    flex: 1,
    lineHeight: 22,
  },
  ringContainer: {
    width: 320,
    height: 320,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringOuter: {
    width: 320,
    height: 320,
    borderRadius: 160,
    borderWidth: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.05)',
  },
  ringInner: {
    width: 280,
    height: 280,
    borderRadius: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeText: {
    color: '#fff',
    fontSize: 84,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
  },
  taskTitle: {
    color: '#A1A1AA',
    fontSize: 14,
    marginTop: 4,
    maxWidth: '80%',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontWeight: '600',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 56,
  },
  playBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 32,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 15,
  },
  secondaryBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  bottomBar: {
    padding: 24,
    paddingBottom: 48,
  },
  statsContainer: {
    paddingHorizontal: 32,
    marginTop: 20,
    marginBottom: 10,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: '#333',
  },
  progressWork: {
    backgroundColor: '#A855F7',
  },
  progressBreak: {
    backgroundColor: '#EF4444',
  },
  statsDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  statTextWork: {
    color: '#A855F7',
    fontSize: 12,
    fontWeight: '600',
  },
  statTextBreak: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
  brainDumpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    borderRadius: 16,
  },
  brainDumpText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  brainDumpCard: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 48,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalSub: {
    color: '#888',
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },
  brainDumpInput: {
    backgroundColor: '#000',
    borderRadius: 16,
    color: '#fff',
    fontSize: 16,
    padding: 16,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalCancel: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    flex: 1,
    marginRight: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 16,
  },
  modalSave: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#A855F7',
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  toughLoveCard: {
    backgroundColor: '#1C1C1E',
    margin: 24,
    borderRadius: 32,
    padding: 32,
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  toughLoveText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
  generatingText: {
    color: '#A855F7',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
  },
  resumeBtn: {
    backgroundColor: '#A855F7',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  resumeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  quitBtn: {
    padding: 16,
    alignItems: 'center',
  },
  quitText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 14,
  }
});

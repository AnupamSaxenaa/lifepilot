import { useFocusEffect } from '@react-navigation/native';
import { Bell, Calendar, CheckCircle2, Circle, Lock, Menu, Repeat, Wand2, Zap, Flag } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AIAuraOverlay } from '../components/AIAuraOverlay';
import { AlarmOverlay } from '../components/AlarmOverlay';
import { DailyPromiseOverlay } from '../components/DailyPromiseOverlay';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassSidebar } from '../components/GlassSidebar';
import { LifetimeProgressRing } from '../components/LifetimeProgressRing';
import { LifetimeStatsModal } from '../components/LifetimeStatsModal';
import { AnimatedFlame } from '../components/AnimatedFlame';
import { GamificationStatsModal } from '../components/GamificationStatsModal';
import { PermissionsOnboarding } from '../components/PermissionsOnboarding';
import { cacheTasks, loadProfile, loadTasks, performInitialSync } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
import { getPriorityColor, shouldShowFlag } from '../config/priorityConfig';
import { LevelUpModal } from '../components/LevelUpModal';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';
import { requestNotificationPermissions, rescheduleAllReminders, scheduleInactivityReminder, cancelInactivityReminder } from '../utils/notifications';
import { generateInactivityNudge } from '../lib/AIEngine';
import { runRepeatEngine } from '../utils/repeatEngine';
import { Storage } from '../utils/storage';
const formatDate = (d) => {
  if (!d) return null;
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const formatDateTime = (d) => {
  if (!d) return null;
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const isTaskForToday = (t) => {
  if (t.added_to_today) return true;
  
  const todayStr = new Date().toDateString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (t.due_date) {
    const dueDate = new Date(t.due_date);
    if (dueDate < todayStart || dueDate.toDateString() === todayStr) return true;
  }

  if (t.reminder_time) {
    const reminderDate = new Date(t.reminder_time);
    if (reminderDate < todayStart || reminderDate.toDateString() === todayStr) return true;
  }

  // Tasks without a list (i.e. default tasks) belong to Today if they have no explicit due date
  if (!t.list_id && !t.due_date && !t.reminder_time) return true;
  return false;
};

export const DashboardScreen = ({ navigation }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [greeting] = useState(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning,';
    if (hour < 18) return 'Good afternoon,';
    return 'Good evening,';
  });
  const [quote, setQuote] = useState('Loading daily inspiration...');
  const [gamestate, setGamestate] = useState({ xp: 0, level: 1, streak: 0, tasksCompletedToday: 0 });
  const [allTasks, setAllTasks] = useState([]);
  const [todaysTasks, setTodaysTasks] = useState([]);
  const [lifetimeStats, setLifetimeStats] = useState({ completed: 0, total: 0 });
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isGamificationModalOpen, setIsGamificationModalOpen] = useState(false);
  const [isInitialSyncing, setIsInitialSyncing] = useState(false);
  const [showAura, setShowAura] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmData, setAlarmData] = useState(null);
  const [levelUpData, setLevelUpData] = useState(null);
  
  // Inactivity nudge: cache the AI-generated text
  const cachedNudgeRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  
  const [menuAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    // 1. Fetch Daily Quote
    const fetchQuote = async () => {
      try {
        const todayStr = new Date().toDateString();
        const savedQuoteData = await Storage.get('daily_quote_data');
        if (savedQuoteData && savedQuoteData.date === todayStr) {
          setQuote(savedQuoteData.quote);
          return;
        }

        const res = await fetch('https://dummyjson.com/quotes/random');
        const data = await res.json();
        setQuote(data.quote);
        Storage.set('daily_quote_data', { date: todayStr, quote: data.quote });
      } catch (err) {
        setQuote("Focus on being productive instead of busy."); // fallback
      }
    };
    fetchQuote();
  }, []);

  // Process tasks for dashboard display
  const processTasks = async (taskList) => {
    if (!taskList || !Array.isArray(taskList)) return;
    setAllTasks(taskList);

    const startDateStr = await Storage.get('lifetime_start_date');
    let statsTasks = taskList;
    if (startDateStr) {
       const sd = new Date(startDateStr).getTime();
       statsTasks = taskList.filter(t => {
         if (new Date(t.created_at).getTime() >= sd) return true;
         if (t.is_completed && t.completed_at) {
           if (new Date(t.completed_at).getTime() >= sd) return true;
         }
         if (!t.is_completed) return true;
         return false;
       });
    }
    const completed = statsTasks.filter(t => t.is_completed).length;
    setLifetimeStats({ completed, total: statsTasks.length });

    // Show uncompleted tasks: either general tasks OR custom list tasks added to today
    const activeTasks = taskList.filter(t => !t.is_completed && (!t.list_id || t.added_to_today));
    
    // Sort them exactly like the custom sort in Today screen
    activeTasks.sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || new Date(b.created_at) - new Date(a.created_at));
    
    setTodaysTasks(activeTasks);
    rescheduleAllReminders(taskList);
    
    // Generate AI nudge text for inactivity notifications (only if there are tasks and we don't have one cached)
    if (activeTasks.length > 0) {
      if (!cachedNudgeRef.current) {
        generateInactivityNudge(activeTasks)
          .then(nudge => {
            if (nudge) cachedNudgeRef.current = nudge;
          })
          .catch(() => {}); // Silent fail - not critical
      }
    } else {
      cachedNudgeRef.current = null; // No tasks = no notification
    }
  };

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const userId = session.user.id;

        // ── INSTANT: Load tasks + profile from cache FIRST (appears in ~10ms) ──
        const fallbackProfile = { 
          id: userId, 
          display_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User', 
          username: session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'user' 
        };
        
        const cachedProfile = await loadProfile(userId, (fresh) => setProfile(fresh || fallbackProfile));
        if (cachedProfile) setProfile(cachedProfile);
        else setProfile(fallbackProfile);

        const cachedTasks = await loadTasks(userId, (fresh) => processTasks(fresh));
        processTasks(cachedTasks);

        // Load gamification from local cache instantly
        const state = await Gamification.checkStreak(userId);
        if (state) {
          state.level = Gamification.getLevelFromXP(state.xp);
          setGamestate(state);
        }

        // ── BACKGROUND: Heavy operations run in parallel, don't block UI ──
        const backgroundOps = async () => {
          try {
            // Initial Sync for returning users (only runs once ever)
            const initialSyncDone = await Storage.get(`initial_sync_done_${userId}`);
            if (!initialSyncDone) {
              setIsInitialSyncing(true);
              await performInitialSync(userId);
              setIsInitialSyncing(false);
              // Reload tasks after initial sync
              const freshTasks = await loadTasks(userId, (fresh) => processTasks(fresh));
              processTasks(freshTasks);
            }

            // Run these in parallel — none depend on each other
            await Promise.all([
              runRepeatEngine(userId)
                .then(async (spawned) => {
                  if (spawned) {
                    console.log('[Dashboard] New repeat tasks spawned, reloading tasks...');
                    const fresh = await loadTasks(userId, (f) => processTasks(f));
                    processTasks(fresh);
                  }
                })
                .catch(e => console.log('[BG] RepeatEngine error:', e.message)),
            ]);

            // Hard Sync gamification from server (don't crash if offline)
            try {
              const { data: remoteProfile } = await supabase.from('profiles').select('xp, streak, level, last_active_date').eq('id', userId).single();
              if (remoteProfile) {
                // IMPORTANT: Re-read the LATEST state from storage — don't use stale closure variable
                const freshState = await Gamification.getState(userId);
                if (freshState) {
                  let changed = false;
                  // Only update if server has MORE than current local
                  if ((remoteProfile.xp || 0) > (freshState.xp || 0)) {
                    freshState.xp = remoteProfile.xp;
                    changed = true;
                  }
                  if ((remoteProfile.streak || 0) > (freshState.streak || 0)) {
                    freshState.streak = remoteProfile.streak;
                    changed = true;
                  }
                  if (remoteProfile.last_active_date && !freshState.lastActiveDate) {
                    freshState.lastActiveDate = new Date(remoteProfile.last_active_date).toDateString();
                    changed = true;
                  }
                  if (changed) {
                    freshState.level = Gamification.getLevelFromXP(freshState.xp);
                    await Gamification.saveState(userId, freshState);
                    setGamestate({ ...freshState });
                  }
                }
              }
            } catch (syncErr) {
              console.log('[Dashboard] Offline — using local gamification state:', syncErr.message);
            }
          } catch (bgErr) {
            console.log('[Dashboard] Background ops error:', bgErr.message);
          }
        };
        
        // Fire background ops without awaiting — UI is already populated
        backgroundOps();

        // Load AI Planner (from cache — instant)
        const planKey = `generated_plan_${userId}`;
        const planDateKey = `generated_plan_date_${userId}`;
        const cachedPlan = await Storage.get(planKey);
        const cachedPlanDate = await Storage.get(planDateKey);
        const todayString = new Date().toDateString();
        if (cachedPlan && cachedPlanDate === todayString) {
          setGeneratedPlan(cachedPlan);
        } else if (cachedPlan) {
          Storage.remove(planKey);
          Storage.remove(planDateKey);
        }
      }
    } catch (e) {
      console.log('Error loading dashboard data', e);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      loadData();
      
      const onBackPress = () => {
        BackHandler.exitApp();
        return true;
      };
      
      const backHandlerSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => {
        backHandlerSub.remove();
      };
    }, [])
  );


  const activeTasksLengthRef = useRef(0);

  useEffect(() => {
    activeTasksLengthRef.current = todaysTasks.length;
  }, [todaysTasks]);

  // Global AppState listener for inactivity nudges
  useEffect(() => {
    cancelInactivityReminder(); // Cancel on mount/foreground
    
    const appStateSub = AppState.addEventListener('change', (nextAppState) => {
      if (
        appStateRef.current.match(/active/) &&
        nextAppState.match(/inactive|background/)
      ) {
        try {
          const nudgeText = cachedNudgeRef.current;
          // Only schedule if we actually have active tasks left!
          if (nudgeText && activeTasksLengthRef.current > 0) {
            scheduleInactivityReminder(nudgeText, 1); // Fire immediately without blocking
          }
        } catch (err) {
          console.log('[Inactivity] Failed to schedule nudge:', err);
        }
      } else if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        cancelInactivityReminder();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      appStateSub.remove();
    };
  }, []);

  const toggleTask = async (id, currentStatus) => {
    if (!profile?.id) return;

    // ✅ FIX: Load fresh tasks, update only this task
    const latestTasks = await Storage.get(`tasks_${profile.id}`) || [];
    const newStatus = !currentStatus;
    const completedAt = newStatus ? new Date().toISOString() : null;
    
    const targetTask = latestTasks.find(t => t.id === id);
    let xpAmount = 10;
    if (targetTask) {
      if (targetTask.priority === 3) xpAmount = 50;
      else if (targetTask.priority === 2) xpAmount = 40;
      else if (targetTask.priority === 0) xpAmount = 5;
    }

    const updatedAll = latestTasks.map(t =>
      t.id === id 
        ? { ...t, is_completed: newStatus, completed_at: completedAt }
        : t
    );
    
    // ✅ Optimistic UI update instantly!
    processTasks(updatedAll);

    // Dynamic Gamification XP based on priority (optimistic)
    if (gamestate) {
      setGamestate(prev => {
        const nextXp = Math.max(0, prev.xp + (newStatus ? xpAmount : -xpAmount));
        let nextLevel = 1;
        while (nextXp >= 50 * nextLevel * (nextLevel + 3)) {
          nextLevel++;
        }
        return {
          ...prev,
          xp: nextXp,
          level: nextLevel
        };
      });
    }
    
    // Background saves
    cacheTasks(profile.id, updatedAll).catch(console.error); // Fire and forget so we don't block
    
    syncToSupabase('tasks', 'update',
      { is_completed: newStatus, completed_at: completedAt },
      { column: 'id', value: id }
    );

    // Dynamic Gamification XP based on priority
    if (newStatus) {
      const prevLevel = gamestate?.level || 1;
      
      const newState = await Gamification.addXP(profile.id, xpAmount);
      if (newState) {
        setGamestate(newState);
        if (newState.level > prevLevel) {
          setLevelUpData({ oldLevel: prevLevel, newLevel: newState.level });
        }
      }
    } else {
      const newState = await Gamification.addXP(profile.id, -xpAmount);
      if (newState) setGamestate(newState);
    }
  };

  const handleLogout = async () => {
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
    supabase.auth.signOut();
  };

  const handleMenuPress = () => {
    Animated.sequence([
      Animated.timing(menuAnim, { toValue: 0.8, duration: 100, useNativeDriver: true }),
      Animated.spring(menuAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true })
    ]).start();
    setIsSidebarOpen(true);
  };

  return (
    <BackgroundWrapper>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          
          {/* Menu Header & Progress Ring */}
          <View style={styles.topNav}>
            <Animated.View style={{ transform: [{ scale: menuAnim }] }}>
              <TouchableOpacity onPress={handleMenuPress} style={[styles.menuButton, { backgroundColor: '#000', borderColor: '#333' }]}>
                <Menu color="#fff" size={24} />
              </TouchableOpacity>
            </Animated.View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <TouchableOpacity onPress={() => Alert.alert('Coming Soon', 'The Smart Alarm module is currently locked and will be available in a future update.')} activeOpacity={0.7} style={{ padding: 4 }}>
                <View>
                  <Bell color="#A78BFA" size={26} />
                  <View style={{ position: 'absolute', bottom: -2, right: -4, backgroundColor: '#18181B', borderRadius: 8, padding: 2 }}>
                    <Lock color="#FFD700" size={12} />
                  </View>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowAura(true)} activeOpacity={0.7} style={{ padding: 4 }}>
                {generatedPlan ? (
                  <Calendar color="#A78BFA" size={26} />
                ) : (
                  <Wand2 color="#A78BFA" size={26} />
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIsGamificationModalOpen(true)} activeOpacity={0.7} style={{ padding: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AnimatedFlame streak={gamestate.streak} />
                {gamestate.streak > 0 && <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{gamestate.streak}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.ringContainer} onPress={() => setIsStatsModalOpen(true)}>
                 <LifetimeProgressRing 
                   completed={lifetimeStats.completed} 
                   total={lifetimeStats.total} 
                   size={32} 
                   strokeWidth={3} 
                 />
              </TouchableOpacity>
            </View>
          </View>

          {/* Profile Greeting Section */}
          <View style={styles.profileSection}>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.name} numberOfLines={2}>
              {profile?.display_name || 'Loading...'}
            </Text>
          </View>

          {/* Static Minimalist Quote */}
          <Text style={styles.quoteText}>{`"${quote}"`}</Text>

          {/* All Tasks List */}
          <View style={styles.tasksSection}>
            <Text style={styles.tasksHeader}>YOUR TASKS</Text>
            {todaysTasks.length === 0 ? (
              <Text style={styles.emptyText}>No tasks yet. Tap the menu to go to the Today screen and add one.</Text>
            ) : (
              todaysTasks.map(task => {
                const isOverdue = task.due_date && new Date(task.due_date) < new Date() && new Date(task.due_date).toDateString() !== new Date().toDateString();
                const isDueToday = task.due_date && new Date(task.due_date).toDateString() === new Date().toDateString();
                return (
                  <TouchableOpacity 
                    key={task.id} 
                    style={styles.taskItem}
                    onPress={() => toggleTask(task.id, task.is_completed)}
                    activeOpacity={0.7}
                  >

                    <View style={{ marginTop: 3 }}>
                      {task.is_completed ? (
                        <CheckCircle2 color="#555" size={18} />
                      ) : (
                        <Circle color="#fff" size={18} />
                      )}
                    </View>
                    <View style={styles.taskTextWrapper}>
                      <Text style={[styles.taskTitle, task.is_completed && styles.taskTitleCompleted]}>
                        {task.title}
                      </Text>
                      {(task.due_date || task.reminder_time || task.repeat_rule || shouldShowFlag(task.priority)) && (
                        <View style={[styles.taskMetaRow, { marginTop: 4 }]}>
                          {shouldShowFlag(task.priority) && (
                            <View style={styles.metaPill}>
                              <Flag color={getPriorityColor(task.priority)} size={11} fill={getPriorityColor(task.priority)} />
                            </View>
                          )}
                          {task.due_date && (
                            <>
                              {shouldShowFlag(task.priority) && <Text style={styles.metaSep}>·</Text>}
                              <View style={styles.metaPill}>
                                <Calendar color={isOverdue ? '#ef4444' : '#888'} size={12} />
                                <Text style={[styles.metaLabel, { color: isOverdue ? '#ef4444' : '#888' }]}>
                                  {formatDate(task.due_date)}
                                </Text>
                              </View>
                            </>
                          )}
                          {task.reminder_time && (
                            <>
                              {(task.due_date || shouldShowFlag(task.priority)) && <Text style={styles.metaSep}>·</Text>}
                              <View style={styles.metaPill}>
                                <Bell color="#888" size={12} />
                                <Text style={[styles.metaLabel, { color: '#888' }]}>
                                  {formatDateTime(task.reminder_time)}
                                </Text>
                              </View>
                            </>
                          )}
                          {task.repeat_rule && (
                            <>
                              {(task.due_date || task.reminder_time || shouldShowFlag(task.priority)) && <Text style={styles.metaSep}>·</Text>}
                              <View style={styles.metaPill}>
                                <Repeat color="#888" size={12} />
                                <Text style={[styles.metaLabel, { color: '#888' }]}>
                                  {task.repeat_rule}
                                </Text>
                              </View>
                            </>
                          )}
                        </View>
                      )}
                    </View>
                    {!task.is_completed && (
                      <TouchableOpacity 
                        style={{ padding: 8, marginLeft: 'auto' }}
                        onPress={(e) => {
                          e.stopPropagation();
                          navigation.navigate('FocusMode', { task });
                        }}
                      >
                        <Zap color="#A855F7" size={18} fill="rgba(168, 85, 247, 0.2)" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </View>

        </ScrollView>
        {/* New User Onboarding */}
        <PermissionsOnboarding />
      </SafeAreaView>
      
      <GlassSidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        profile={profile}
        handleLogout={handleLogout}
        navigation={navigation}
        currentRoute="Dashboard"
      />

      <LevelUpModal
        isVisible={!!levelUpData}
        oldLevel={levelUpData?.oldLevel || 1}
        newLevel={levelUpData?.newLevel || 2}
        onClose={() => setLevelUpData(null)}
      />

      {/* The Detailed Lifetime Matrix */}
      <LifetimeStatsModal 
        isVisible={isStatsModalOpen} 
        onClose={() => setIsStatsModalOpen(false)} 
        stats={lifetimeStats} 
        onReset={async () => {
          await Storage.set('lifetime_start_date', new Date().toISOString());
          processTasks(allTasks);
          setIsStatsModalOpen(false);
        }}
      />

      {/* Gamification Stats */}
      <GamificationStatsModal 
        isVisible={isGamificationModalOpen} 
        onClose={() => setIsGamificationModalOpen(false)} 
        gamestate={gamestate} 
        profile={profile} 
      />

      {isInitialSyncing && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center', zIndex: 999 }]}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', marginTop: 20, fontSize: 16, fontWeight: '600', letterSpacing: 0.5 }}>Syncing your workspace...</Text>
          <Text style={{ color: '#888888', marginTop: 8, fontSize: 13 }}>Downloading your data from the cloud.</Text>
        </View>
      )}

      {/* AIAuraOverlay */}
      <AIAuraOverlay 
        visible={showAura} 
        onClose={() => setShowAura(false)} 
        userId={profile?.id}
        firstName={profile?.first_name || 'there'}
        tasks={todaysTasks}
        savedPlan={generatedPlan}
        onPlanGenerated={(plan) => {
          setGeneratedPlan(plan);
          if (profile?.id) {
            Storage.set(`generated_plan_${profile.id}`, plan);
            Storage.set(`generated_plan_date_${profile.id}`, new Date().toDateString());
          }
        }}
        onToggleTask={toggleTask}
      />
      <AlarmOverlay 
        visible={alarmVisible} 
        alarmData={alarmData} 
        onDismiss={() => setAlarmVisible(false)} 
      />
      
      {profile?.id && (
        <DailyPromiseOverlay userId={profile.id} />
      )}
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: 24,
    paddingTop: 48,
  },
  topNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSection: {
    marginBottom: 16,
  },
  greeting: {
    fontSize: 16,
    marginBottom: 4,
    fontWeight: '400',
    color: '#888',
  },
  name: {
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 46,
    letterSpacing: -1,
    color: '#fff',
  },
  quoteText: {
    color: '#aaa',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
    fontWeight: '400',
    textAlign: 'left',
    marginBottom: 20,
  },
  ringContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  tasksSection: {
    marginTop: 16,
    paddingHorizontal: 8,
  },
  tasksHeader: {
    color: '#555',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingVertical: 4,
  },
  taskTitle: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 24,
    flex: 1,
  },
  taskTextWrapper: {
    flex: 1,
    marginLeft: 16,
  },
  overdueTag: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  overdueTagText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  dueTodayTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  dueTodayTagText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  taskTitleCompleted: {
    color: '#555',
    textDecorationLine: 'line-through',
  },
  emptyText: {
    color: '#444',
    fontSize: 14,
    fontStyle: 'italic',
  },
  taskMetaRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    flexWrap: 'wrap', 
    marginTop: 4, 
    gap: 6 
  },
  metaPill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 4 
  },
  metaLabel: { 
    fontSize: 12, 
    fontWeight: '500' 
  },
  metaSep: { 
    color: '#555', 
    fontSize: 12 
  }
});

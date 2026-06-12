import { useFocusEffect } from '@react-navigation/native';
import { Bell, Calendar, CheckCircle2, Circle, Lock, Menu, Repeat, Wand2, Zap } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Animated, BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AIAuraOverlay } from '../components/AIAuraOverlay';
import { PermissionsOnboarding } from '../components/PermissionsOnboarding';
import { AlarmOverlay } from '../components/AlarmOverlay';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { DailyPromiseOverlay } from '../components/DailyPromiseOverlay';
import { GlassSidebar } from '../components/GlassSidebar';
import { LifetimeProgressRing } from '../components/LifetimeProgressRing';
import { LifetimeStatsModal } from '../components/LifetimeStatsModal';
import { loadProfile, loadTasks, performInitialSync } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';
import { requestNotificationPermissions, rescheduleAllReminders } from '../utils/notifications';
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
  const [isInitialSyncing, setIsInitialSyncing] = useState(false);
  const [showAura, setShowAura] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmData, setAlarmData] = useState(null);
  
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
  const processTasks = (taskList) => {
    if (!taskList || !Array.isArray(taskList)) return;
    setAllTasks(taskList);

    // Calculate Lifetime Stats
    const completed = taskList.filter(t => t.is_completed).length;
    setLifetimeStats({ completed, total: taskList.length });

    // Show all uncompleted tasks to match the Dashboard view
    const activeTasks = taskList.filter(t => !t.is_completed);
    
    // Sort them exactly like the custom sort in Today screen
    activeTasks.sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || new Date(b.created_at) - new Date(a.created_at));
    
    setTodaysTasks(activeTasks);
    rescheduleAllReminders(taskList);
  };

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Initial Sync for returning users
        const initialSyncDone = await Storage.get(`initial_sync_done_${session.user.id}`);
        if (!initialSyncDone) {
          setIsInitialSyncing(true);
          await performInitialSync(session.user.id);
          setIsInitialSyncing(false);
        }

        // Load profile (cache first → Supabase background)
        const fallbackProfile = { 
          id: session.user.id, 
          display_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User', 
          username: session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'user' 
        };
        
        const cachedProfile = await loadProfile(session.user.id, (fresh) => setProfile(fresh || fallbackProfile));
        if (cachedProfile) setProfile(cachedProfile);
        else setProfile(fallbackProfile);

        // Run Repeat Engine
        await runRepeatEngine(session.user.id);
        await requestNotificationPermissions();

        // Load tasks (cache first → Supabase background)
        const cachedTasks = await loadTasks(session.user.id, (fresh) => processTasks(fresh));
        processTasks(cachedTasks);

        // Load Gamification
        const state = await Gamification.checkStreak(session.user.id);
        if (state) setGamestate(state);

        // Load AI Planner
        const planKey = `generated_plan_${session.user.id}`;
        const planDateKey = `generated_plan_date_${session.user.id}`;
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

  const toggleTask = async (id, currentStatus) => {
    if (!profile?.id) return;

    // ✅ FIX: Load fresh tasks, update only this task
    const latestTasks = await Storage.get(`tasks_${profile.id}`) || [];
    const newStatus = !currentStatus;
    const completedAt = newStatus ? new Date().toISOString() : null;
    
    const updatedAll = latestTasks.map(t =>
      t.id === id 
        ? { ...t, is_completed: newStatus, completed_at: completedAt }
        : t
    );
    
    await Storage.set(`tasks_${profile.id}`, updatedAll);
    await Storage.set('last_local_write_time', Date.now().toString());
    
    syncToSupabase('tasks', 'update',
      { is_completed: newStatus, completed_at: completedAt },
      { column: 'id', value: id }
    );
    
    processTasks(updatedAll);

    // Gamification XP
    await Gamification.addXP(profile.id, newStatus ? 10 : -10);
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
                    {task.is_completed ? (
                      <CheckCircle2 color="#555" size={18} />
                    ) : (
                      <Circle color="#fff" size={18} />
                    )}
                    <View style={styles.taskTextWrapper}>
                      <Text style={[styles.taskTitle, task.is_completed && styles.taskTitleCompleted]}>
                        {task.title}
                      </Text>
                      {(task.due_date || task.reminder_time || task.repeat_rule) && (
                        <View style={[styles.taskMetaRow, { marginTop: 4 }]}>
                          {task.due_date && (
                            <View style={styles.metaPill}>
                              <Calendar color={isOverdue ? '#ef4444' : '#888'} size={12} />
                              <Text style={[styles.metaLabel, { color: isOverdue ? '#ef4444' : '#888' }]}>
                                {formatDate(task.due_date)}
                              </Text>
                            </View>
                          )}
                          {task.reminder_time && (
                            <>
                              {task.due_date && <Text style={styles.metaSep}>·</Text>}
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
                              {(task.due_date || task.reminder_time) && <Text style={styles.metaSep}>·</Text>}
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
      
      {/* The Daily Promise Popup */}
      <DailyPromiseOverlay userId={profile?.id} />

      {/* The Detailed Lifetime Matrix */}
      <LifetimeStatsModal 
        isVisible={isStatsModalOpen} 
        onClose={() => setIsStatsModalOpen(false)} 
        stats={lifetimeStats} 
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
    alignItems: 'center',
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

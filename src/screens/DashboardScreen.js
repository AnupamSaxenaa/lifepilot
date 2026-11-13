import { useFocusEffect } from '@react-navigation/native';
import { Bell, Calendar, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Circle, Flag, ListChecks, Menu, Repeat, Trophy, Users, Wand2, Zap } from 'lucide-react-native';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, AppState, BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AIAuraOverlay } from '../components/AIAuraOverlay';
import { AlarmOverlay } from '../components/AlarmOverlay';
import { AnimatedFlame } from '../components/AnimatedFlame';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { DailyPromiseOverlay } from '../components/DailyPromiseOverlay';
import { DayAura } from '../components/DayAura';
import { GamificationStatsModal } from '../components/GamificationStatsModal';
import { GlassSidebar } from '../components/GlassSidebar';
import { LevelUpModal } from '../components/LevelUpModal';
import { PermissionsOnboarding } from '../components/PermissionsOnboarding';
import { ALARMS_ENABLED, HUSTLERS_ENABLED } from '../config/flags';
import { getPriorityColor, shouldShowFlag } from '../config/priorityConfig';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { useWidgetTaskSync } from '../hooks/useWidgetTaskSync';
import { syncLanguageFromProfile } from '../i18n';
import { generateInactivityNudge } from '../lib/AIEngine';
import { cacheTasks, getCurrentUserId, loadProfile, loadTasks, performInitialSync } from '../lib/dataManager';
import { loadHustlerBadges, subscribeToHustlerChanges } from '../lib/hustlersManager';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
import { getDayProgress } from '../utils/dayProgress';
import { Gamification } from '../utils/gamification';
import { cancelInactivityReminder, rescheduleAllReminders, scheduleInactivityReminder } from '../utils/notifications';
import { savePlanForToday } from '../utils/planStore';
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

// Extracted + memoized so a task list re-render (e.g. one task's completion
// toggling) doesn't have to rebuild every row's JSX tree from scratch — only
// rows whose own props actually changed re-render.
const DashboardTaskRow = memo(function DashboardTaskRow({ task, theme, onToggle, onToggleSubtask, onOpen, onFocus, isLast }) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && new Date(task.due_date).toDateString() !== new Date().toDateString();
  const [expanded, setExpanded] = useState(false);
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const hasSubs = subtasks.length > 0;
  const doneSubs = subtasks.filter((subtask) => subtask.is_completed).length;
  // One primary meta signal per row keeps the list scannable instead of noisy:
  // a reminder time is more urgent than a due date, which beats a repeat rule.
  const primaryMeta = task.reminder_time
    ? { icon: Bell, label: formatDateTime(task.reminder_time), tone: theme.muted }
    : task.due_date
      ? { icon: Calendar, label: formatDate(task.due_date), tone: isOverdue ? '#FB7185' : theme.muted }
      : task.repeat_rule
        ? { icon: Repeat, label: task.repeat_rule, tone: theme.muted }
        : null;
  const MetaIcon = primaryMeta?.icon;

  return (
    <View
      style={[
        styles.taskRow,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: `${theme.text}12` },
      ]}
    >
      <View style={styles.taskMain}>
        <TouchableOpacity
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.is_completed }}
          onPress={() => onToggle(task.id, task.is_completed)}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[
            styles.taskCheckbox,
            {
              backgroundColor: task.is_completed ? '#34D399' : 'transparent',
              borderColor: task.is_completed ? '#34D399' : `${theme.text}30`,
            },
          ]}
        >
          {task.is_completed ? <CheckCircle2 color="#07130F" size={15} /> : null}
        </TouchableOpacity>

        <TouchableOpacity style={styles.taskTextWrapper} activeOpacity={0.72} onPress={() => onOpen?.(task)}>
          <View style={styles.taskTitleRow}>
            {shouldShowFlag(task.priority) ? (
              <Flag color={getPriorityColor(task.priority)} size={11} fill={getPriorityColor(task.priority)} />
            ) : null}
            <Text
              numberOfLines={2}
              style={[styles.taskTitle, { color: theme.text }, task.is_completed && styles.taskTitleCompleted]}
            >
              {task.title}
            </Text>
          </View>

          {(primaryMeta || hasSubs) ? (
            <View style={styles.taskMetaRow}>
              {primaryMeta ? (
                <View style={styles.metaPill}>
                  <MetaIcon color={primaryMeta.tone} size={11} />
                  <Text style={[styles.metaLabel, { color: primaryMeta.tone }]} numberOfLines={1}>
                    {primaryMeta.label}
                  </Text>
                </View>
              ) : null}
              {hasSubs ? (
                <View style={styles.metaPill}>
                  <ListChecks color={theme.muted} size={11} />
                  <Text style={[styles.metaLabel, { color: theme.muted }]}>{doneSubs}/{subtasks.length}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </TouchableOpacity>

        <View style={styles.taskActions}>
          {!task.is_completed ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Focus on this task"
              onPress={(event) => {
                event.stopPropagation();
                onFocus(task);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.taskActionButton}
            >
              <Zap color={theme.accent} size={16} />
            </TouchableOpacity>
          ) : null}
          {hasSubs ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={(event) => {
                event.stopPropagation();
                setExpanded((value) => !value);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.taskActionButton}
            >
              {expanded
                ? <ChevronUp color={theme.muted} size={16} />
                : <ChevronDown color={theme.muted} size={16} />}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {hasSubs && expanded ? (
        <View style={styles.subtaskDropdown}>
          {subtasks.map((subtask, index) => (
            <TouchableOpacity
              key={subtask.id || String(index)}
              style={styles.dashSubRow}
              activeOpacity={0.65}
              onPress={() => onToggleSubtask?.(task.id, subtask.id)}
            >
              {subtask.is_completed
                ? <CheckCircle2 color="#34D399" size={14} />
                : <Circle color={`${theme.text}30`} size={14} />}
              <Text
                numberOfLines={2}
                style={[styles.dashSubText, { color: theme.muted }, subtask.is_completed && styles.dashSubDone]}
              >
                {subtask.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
});

export const DashboardScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme, themeVersion } = useAppTheme();
  void themeVersion;

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [greeting] = useState(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t('dashboard.greetingMorning');
    if (hour < 18) return t('dashboard.greetingAfternoon');
    return t('dashboard.greetingEvening');
  });
  const [quote, setQuote] = useState(t('dashboard.loadingQuote'));
  const [gamestate, setGamestate] = useState({ xp: 0, level: 1, streak: 0, tasksCompletedToday: 0 });
  const [socialBadges, setSocialBadges] = useState({ pendingCount: 0, onlineCount: 0 });
  const { height: windowHeight } = useWindowDimensions();
  const auraHeight = Math.round(windowHeight * 0.72);
  const [allTasks, setAllTasks] = useState([]);
  const [todaysTasks, setTodaysTasks] = useState([]);
  // Aura fuel: every task belonging to today, from the Today list and any
  // custom list. Derived from the same optimistic state the rows render, so the
  // glow moves the instant a task is ticked.
  const dayProgress = useMemo(
    () => getDayProgress({ openTasks: todaysTasks, allTasks }),
    [allTasks, todaysTasks],
  );

  const [isGamificationModalOpen, setIsGamificationModalOpen] = useState(false);
  const [showAura, setShowAura] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmData, setAlarmData] = useState(null);
  const [levelUpData, setLevelUpData] = useState(null);
  
  // Inactivity nudge: cache the AI-generated text
  const cachedNudgeRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  
  const [menuAnim] = useState(() => new Animated.Value(1));

  // Aura wand: collapsed to an icon until tapped, then labelled.
  const [planExpanded, setPlanExpanded] = useState(false);
  const [planAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(planAnim, {
      toValue: planExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: false, // maxWidth can't run on the native driver.
    }).start();
  }, [planExpanded, planAnim]);

  // Collapse on its own so a forgotten tap doesn't leave the label hanging.
  useEffect(() => {
    if (!planExpanded) return undefined;
    const timer = setTimeout(() => setPlanExpanded(false), 4000);
    return () => clearTimeout(timer);
  }, [planExpanded]);

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
        setQuote(t('dashboard.quoteFallback')); // fallback
      }
    };
    fetchQuote();
  }, []);

  // Process tasks for dashboard display
  const processTasks = async (taskList) => {
    if (!taskList || !Array.isArray(taskList)) return;
    setAllTasks(taskList);

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

  // Widget → app sync: when the widget toggles a task, reflect it here the
  // moment we return to the foreground (or near-instantly while foregrounded).
  useWidgetTaskSync(profile?.id, (freshTasks) => processTasks(freshTasks));

  const loadData = async () => {
    try {
      const userId = await getCurrentUserId();
      if (userId) {
        // ── INSTANT: Load tasks + profile from cache FIRST (appears in ~10ms) ──
        const fallbackProfile = {
          id: userId,
          display_name: t('dashboard.defaultUserName'),
          username: 'user'
        };

        const cachedProfile = await loadProfile(userId, (fresh) => {
          setProfile(fresh || fallbackProfile);
          // Cross-device continuity: if this device hasn't had an explicit
          // language choice made on it yet, adopt whatever the user picked
          // on another device/at registration.
          if (fresh?.preferred_language) {
            syncLanguageFromProfile(fresh.preferred_language).catch(() => {});
          }
        });
        if (cachedProfile) setProfile(cachedProfile);
        else {
          setProfile(fallbackProfile);
          // Session metadata only improves the no-profile fallback. Resolve it
          // without blocking cached profile/task rendering or offline actions.
          supabase.auth.getSession().then(({ data: { session } }) => {
            const authUser = session?.user;
            if (!authUser) return;
            const authFallback = {
              id: userId,
              display_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || t('dashboard.defaultUserName'),
              username: authUser.user_metadata?.username || authUser.email?.split('@')[0] || 'user'
            };
            setProfile((current) => current === fallbackProfile ? authFallback : current);
          }).catch(() => {});
        }

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
              await performInitialSync(userId);
              // Reload tasks after initial sync without covering cached UI.
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
                    freshState.lastActiveDate = Gamification.toLocalDayKey(remoteProfile.last_active_date);
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

  // Social badges are cache-first, then refreshed while Dashboard is visible.
  // Realtime accelerates arrivals; polling remains authoritative when the
  // friendships table has not yet been added to the Realtime publication.
  useFocusEffect(
    React.useCallback(() => {
      if (!HUSTLERS_ENABLED) return undefined;
      let active = true;
      let userId = null;
      let stopRealtime = () => {};
      let poll = null;

      const apply = (counts) => {
        if (active && counts) setSocialBadges(counts);
      };
      const refresh = () => {
        if (!userId) return;
        loadHustlerBadges(userId, apply).then(apply).catch(() => {});
      };

      (async () => {
        userId = await getCurrentUserId();
        if (!active || !userId) return;
        const cached = await loadHustlerBadges(userId, apply);
        apply(cached);
        if (!active) return;
        stopRealtime = subscribeToHustlerChanges(userId, refresh);
        poll = setInterval(refresh, 20 * 1000);
      })().catch(() => {});

      return () => {
        active = false;
        if (poll) clearInterval(poll);
        stopRealtime();
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
    // Grant priority-based XP on complete; on uncomplete deduct the EXACT
    // amount granted at completion (stored on the task) so a priority change
    // in between can't create or destroy XP.
    const xpAmount = newStatus
      ? Gamification.xpForTask(targetTask)
      : ((targetTask && targetTask.xp_awarded != null) ? targetTask.xp_awarded : Gamification.xpForTask(targetTask));

    const updatedAll = latestTasks.map(t =>
      t.id === id 
        ? { ...t, is_completed: newStatus, completed_at: completedAt, xp_awarded: newStatus ? xpAmount : null }
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

  // Toggle a single subtask (step) from the Dashboard's step dropdown.
  // Optimistic + cache + background sync (no XP — steps don't grant XP).
  const handleToggleSubtask = async (taskId, subId) => {
    if (!profile?.id) return;
    const latestTasks = (await Storage.get(`tasks_${profile.id}`)) || [];
    let nextSubtasks = null;
    let becameComplete = false;
    const updatedAll = latestTasks.map((t) => {
      if (t.id !== taskId || !Array.isArray(t.subtasks)) return t;
      nextSubtasks = t.subtasks.map((s) => {
        if (s.id !== subId) return s;
        becameComplete = !s.is_completed;
        return { ...s, is_completed: !s.is_completed };
      });
      return { ...t, subtasks: nextSubtasks };
    });
    processTasks(updatedAll);
    cacheTasks(profile.id, updatedAll).catch(console.error);
    if (nextSubtasks) {
      syncToSupabase('tasks', 'update', { subtasks: nextSubtasks }, { column: 'id', value: taskId });
      // Award/deduct small step XP (also triggers the +/− XP popup via addXP).
      const delta = becameComplete ? Gamification.xpForSubtask() : -Gamification.xpForSubtask();
      const newState = await Gamification.addXP(profile.id, delta);
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

  const planLabel = generatedPlan
    ? t('dashboard.viewPlan', { defaultValue: 'View your plan' })
    : t('dashboard.planWithAura', { defaultValue: 'Plan with Aura' });

  // Tap once to reveal the label, tap again to launch Aura.
  const handlePlanPress = () => {
    if (!planExpanded) {
      setPlanExpanded(true);
      return;
    }
    setPlanExpanded(false);
    setShowAura(true);
  };

  const displayName = profile?.display_name || t('common.loading');
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <BackgroundWrapper>
      {/* Behind everything: today's completion burning upward from the bottom. */}
      <DayAura
        ratio={dayProgress.ratio}
        isComplete={dayProgress.isComplete}
        hasWork={dayProgress.hasWork}
        height={auraHeight}
      />
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Header: borderless controls so the eye lands on content, not chrome ── */}
          <View style={styles.topNav}>
            <Animated.View style={{ transform: [{ scale: menuAnim }] }}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('dashboard.openMenu', { defaultValue: 'Open menu' })}
                onPress={handleMenuPress}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.navButton}
              >
                <Menu color={theme.text} size={22} />
              </TouchableOpacity>
            </Animated.View>

            <View style={styles.navActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('dashboard.streakLabel', { defaultValue: 'Streak' })}
                onPress={() => setIsGamificationModalOpen(true)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.streakChip}
              >
                <AnimatedFlame streak={gamestate.streak} />
                <Text style={[styles.streakChipText, { color: theme.text }]}>{gamestate.streak}</Text>
              </TouchableOpacity>

              {HUSTLERS_ENABLED && (
                <>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('sidebar.hustlers', {
                      defaultValue: `Hustlers, ${socialBadges.onlineCount} online, ${socialBadges.pendingCount} pending requests`,
                    })}
                    onPress={() => navigation.navigate('Hustlers')}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={[styles.navButton, styles.hustlersNavButton]}
                  >
                    <Users color={theme.text} size={20} />
                    {socialBadges.pendingCount > 0 ? (
                      <View style={styles.friendRequestBadge}>
                        <Text style={styles.friendRequestBadgeText}>
                          {socialBadges.pendingCount > 9 ? '9+' : socialBadges.pendingCount}
                        </Text>
                      </View>
                    ) : null}
                    {socialBadges.onlineCount > 0 ? (
                      <View style={styles.friendOnlineBadge}>
                        <Text style={styles.friendOnlineBadgeText}>
                          {socialBadges.onlineCount > 99 ? '99+' : socialBadges.onlineCount}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('leaderboard.title', { defaultValue: 'Leaderboard' })}
                    onPress={() => navigation.navigate('Leaderboard')}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.navButton}
                  >
                    <Trophy color={theme.text} size={20} />
                  </TouchableOpacity>
                </>
              )}

              {ALARMS_ENABLED && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('alarmList.headerTitle')}
                  onPress={() => navigation.navigate('AlarmList')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.navButton}
                >
                  <Bell color={theme.text} size={20} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── Hero: date sits above the name as a quiet timestamp ── */}
          <View style={styles.hero}>
            <Text style={[styles.heroDate, { color: theme.muted }]}>{dateLabel.toUpperCase()}</Text>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{displayName}</Text>
            <Text style={[styles.greeting, { color: theme.muted }]}>{greeting}</Text>
          </View>

          {/* ── Tasks: the main event, an airy list instead of stacked cards ── */}
          <View style={styles.tasksSection}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  {t('dashboard.yourTasksHeader')}
                </Text>
                {todaysTasks.length > 0 ? (
                  <Text style={[styles.sectionCount, { color: theme.muted }]}>{todaysTasks.length}</Text>
                ) : null}
              </View>
              {todaysTasks.length > 0 ? (
                <TouchableOpacity
                  onPress={() => navigation.navigate('Today')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.sectionAction}
                >
                  <Text style={[styles.sectionActionText, { color: theme.muted }]}>
                    {t('dashboard.viewAll', { defaultValue: 'View all' })}
                  </Text>
                  <ChevronRight color={theme.muted} size={14} />
                </TouchableOpacity>
              ) : null}
            </View>

            {todaysTasks.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  {t('dashboard.noTasksTitle', { defaultValue: 'Nothing pending' })}
                </Text>
                <Text style={[styles.emptyText, { color: theme.muted }]}>{t('dashboard.emptyTasksMessage')}</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Today')} style={styles.emptyAction}>
                  <Text style={[styles.emptyActionText, { color: theme.accent }]}>
                    {t('dashboard.openToday', { defaultValue: 'Open Today' })}
                  </Text>
                  <ChevronRight color={theme.accent} size={14} />
                </TouchableOpacity>
              </View>
            ) : (
              todaysTasks.map((task, index) => (
                <DashboardTaskRow
                  key={task.id}
                  task={task}
                  theme={theme}
                  isLast={index === todaysTasks.length - 1}
                  onToggle={toggleTask}
                  onToggleSubtask={handleToggleSubtask}
                  onOpen={(selectedTask) => navigation.navigate('TaskDetail', { task: selectedTask, userId: profile?.id })}
                  onFocus={(selectedTask) => navigation.navigate('FocusMode', { task: selectedTask })}
                />
              ))
            )}
          </View>

          {/* ── Quote closes the screen as a footnote, deliberately understated ── */}
          <View style={[styles.quoteBlock, { borderTopColor: `${theme.text}0D` }]}>
            <Text style={[styles.quoteText, { color: `${theme.muted}B0` }]}>
              {quote && quote.trim().length > 0
                ? quote
                : t('dashboard.quoteFallback', { defaultValue: 'Focus on being productive instead of busy.' })}
            </Text>
          </View>
        </ScrollView>

        {/* ── Aura sits above the content, pinned bottom-right. Collapsed it's
              just a wand; the first tap names it, the second opens it. Being
              right-anchored means the label grows inward over empty space. ── */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handlePlanPress}
          accessibilityRole="button"
          accessibilityLabel={planLabel}
          accessibilityHint={planExpanded
            ? t('dashboard.auraOpenHint', { defaultValue: 'Opens Aura' })
            : t('dashboard.auraRevealHint', { defaultValue: 'Shows the Aura action' })}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[
            styles.planFab,
            {
              backgroundColor: theme.surface,
              borderColor: planExpanded ? `${theme.accent}55` : `${theme.text}1A`,
            },
          ]}
        >
          {generatedPlan ? <Calendar color={theme.accent} size={19} /> : <Wand2 color={theme.accent} size={19} />}
          <Animated.View
            style={[
              styles.planLabelClip,
              {
                opacity: planAnim,
                maxWidth: planAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 200] }),
              },
            ]}
          >
            <Text numberOfLines={1} style={[styles.planLabel, { color: theme.text }]}>
              {planLabel}
            </Text>
          </Animated.View>
        </TouchableOpacity>

        <PermissionsOnboarding />
      </SafeAreaView>
      
      <GlassSidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        profile={profile}
        gamestate={gamestate}
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

      {/* Gamification Stats */}
      <GamificationStatsModal 
        isVisible={isGamificationModalOpen} 
        onClose={() => setIsGamificationModalOpen(false)} 
        gamestate={gamestate} 
        profile={profile} 
      />

      {/* AIAuraOverlay */}
      <AIAuraOverlay 
        visible={showAura} 
        onClose={() => setShowAura(false)} 
        userId={profile?.id}
        firstName={profile?.first_name || t('dashboard.defaultFirstName')}
        tasks={todaysTasks}
        savedPlan={generatedPlan}
        onPlanGenerated={(plan) => {
          setGeneratedPlan(plan);
          savePlanForToday(profile?.id, plan);
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

// Layout rhythm: one gutter, one section gap. Reusing these two constants
// everywhere is what keeps the screen from feeling crowded.
const GUTTER = 20;
const SECTION_GAP = 34;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    paddingHorizontal: GUTTER,
    paddingTop: 6,
    // Clears the pinned Aura button so the last row is never hidden under it.
    paddingBottom: 92,
  },
  topNav: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hustlersNavButton: { overflow: 'visible' },
  friendRequestBadge: {
    position: 'absolute',
    top: -5,
    left: -7,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FB7185',
  },
  friendRequestBadgeText: { color: '#0B0B0D', fontSize: 8, fontWeight: '700' },
  friendOnlineBadge: {
    position: 'absolute',
    top: -6,
    right: -9,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4ADE80',
  },
  friendOnlineBadgeText: { color: '#07130B', fontSize: 8, fontWeight: '700' },
  navActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  streakChip: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  streakChipText: { fontSize: 14, fontWeight: '600' },

  hero: { marginTop: 24 },
  heroDate: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1.3 },
  name: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '300',
    letterSpacing: -1,
    marginTop: 10,
  },
  greeting: { fontSize: 14, lineHeight: 19, fontWeight: '400', marginTop: 4 },

  planFab: {
    position: 'absolute',
    right: GUTTER,
    bottom: 18,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  planLabelClip: { overflow: 'hidden' },
  planLabel: { fontSize: 13, fontWeight: '500', paddingLeft: 10 },

  // Tighter than a full section gap: the greeting and the task list read as one
  // continuous thought, so they shouldn't be separated by dead space.
  tasksSection: { marginTop: 24 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  sectionCount: { fontSize: 12, fontWeight: '400' },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sectionActionText: { fontSize: 11.5, fontWeight: '500' },

  taskRow: { paddingVertical: 4 },
  taskMain: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTextWrapper: { flex: 1, marginLeft: 14, paddingVertical: 4 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  taskTitle: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '400' },
  taskTitleCompleted: { opacity: 0.4, textDecorationLine: 'line-through' },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 5,
  },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaLabel: { fontSize: 11, fontWeight: '400' },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginLeft: 12 },
  taskActionButton: { alignItems: 'center', justifyContent: 'center' },
  subtaskDropdown: {
    paddingLeft: 34,
    paddingBottom: 8,
  },
  dashSubRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dashSubText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  dashSubDone: { opacity: 0.4, textDecorationLine: 'line-through' },

  emptyState: { paddingVertical: 30 },
  emptyTitle: { fontSize: 17, fontWeight: '400' },
  emptyText: { fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 280 },
  emptyAction: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 16 },
  emptyActionText: { fontSize: 13, fontWeight: '500' },

  quoteBlock: {
    marginTop: SECTION_GAP,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  quoteText: {
    fontSize: 11.5,
    lineHeight: 18,
    fontWeight: '300',
    fontStyle: 'italic',
    letterSpacing: 0.1,
  },
});

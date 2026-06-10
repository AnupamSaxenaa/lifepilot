import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowUp, Bell, Calendar, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, FileText, GripVertical, ListChecks, Menu, MoreVertical, Plus, Repeat, Star, Trash2, Wand2, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { NestableDraggableFlatList, NestableScrollContainer, ScaleDecorator } from 'react-native-draggable-flatlist';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIAuraOverlay } from '../components/AIAuraOverlay';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassSidebar } from '../components/GlassSidebar';
import { ScribbleStrike } from '../components/ScribbleStrike';
import { cacheTasks, addTask as dmAddTask, deleteTask as dmDeleteTask, loadProfile, loadTasks, reorderTasks, toggleTaskImportance } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';
import { cancelTaskReminder, scheduleTaskReminder } from '../utils/notifications';
import { Storage } from '../utils/storage';

// ─── Helpers ────────────────────────────────────────────
const getDayName = (d) => d.toLocaleDateString('en-US', { weekday: 'short' });
const getToday = () => { const d = new Date(); d.setHours(23, 59, 0, 0); return d; };
const getTomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(23, 59, 0, 0); return d; };
const getNextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(23, 59, 0, 0); return d; };
const getReminderLaterToday = () => { const d = new Date(); d.setHours(14, 0, 0, 0); if (d <= new Date()) d.setHours(d.getHours() + 3); return d; };
const getReminderTomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; };
const getReminderNextWeek = () => { const d = getNextMonday(); d.setHours(9, 0, 0, 0); return d; };

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

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const UNIT_OPTIONS = ['days', 'weeks', 'months', 'years'];

const SkeletonTask = () => {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.taskCard, style, { backgroundColor: '#1A1A1A', borderColor: '#333' }]}>
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#333', marginRight: 14, marginTop: 2 }} />
      <View style={{ flex: 1, paddingRight: 8 }}>
        <View style={{ width: '60%', height: 16, borderRadius: 4, backgroundColor: '#333', marginBottom: 12 }} />
        <View style={{ width: '40%', height: 12, borderRadius: 4, backgroundColor: '#333' }} />
      </View>
    </Animated.View>
  );
};

export const TodayScreen = ({ navigation }) => {
  // Force dark theme only
  const theme = COLORS.dark;
  const insets = useSafeAreaInsets();

  // ─── Core State ───────────────────────────────────────
  const [tasks, setTasks] = useState([]);
  const latestTasksRef = useRef(tasks);
  useEffect(() => {
    latestTasksRef.current = tasks;
  }, [tasks]);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showAura, setShowAura] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [activeToolbarMenu, setActiveToolbarMenu] = useState(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [completingTaskIds, setCompletingTaskIds] = useState([]);

  // ─── New Task Metadata ────────────────────────────────
  const [pendingDueDate, setPendingDueDate] = useState(null);
  const [pendingReminder, setPendingReminder] = useState(null);
  const [pendingRepeatRule, setPendingRepeatRule] = useState(null);

  // ─── Keyboard state for Android fallback ──────────────
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  // ─── Native Picker State ──────────────────────────────
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showReminderDatePicker, setShowReminderDatePicker] = useState(false);
  const [showReminderTimePicker, setShowReminderTimePicker] = useState(false);
  const [reminderPickerDate, setReminderPickerDate] = useState(new Date());

  // ─── Custom Repeat Modal State ────────────────────────
  const [showCustomRepeatModal, setShowCustomRepeatModal] = useState(false);
  const [customRepeatEvery, setCustomRepeatEvery] = useState('1');
  const [customRepeatUnit, setCustomRepeatUnit] = useState('weeks');
  const [customRepeatDays, setCustomRepeatDays] = useState([]);

  // ─── Sort State ───────────────────────────────────────
  const [sortBy, setSortBy] = useState('custom');
  const [isSortLoaded, setIsSortLoaded] = useState(false);

  const todayDate = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  // ─── Init & Fetch ─────────────────────────────────────
  const [isCacheLoaded, setIsCacheLoaded] = useState(false);
  
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      // Load Profile, Sort Preference, Tasks, and Saved Plan concurrently
      const [cachedProfile, cachedSort, cachedTasks, cachedPlan, cachedPlanDate] = await Promise.all([
        loadProfile(session.user.id, (fresh) => setProfile(fresh)),
        Storage.get('sortBy_today'),
        loadTasks(session.user.id, (fresh) => {
          setTasks(fresh);
          setLoading(false);
          setIsCacheLoaded(true);
        }),
        Storage.get(`generated_plan_${session.user.id}`),
        Storage.get(`generated_plan_date_${session.user.id}`)
      ]);

      if (cachedProfile) setProfile(cachedProfile);
      if (cachedSort) setSortBy(cachedSort);
      setIsSortLoaded(true);
      
      // Restore saved plan so it survives app restarts, but wipe it if it's from a previous day
      const todayString = new Date().toDateString();
      if (cachedPlan && cachedPlanDate === todayString) {
        setGeneratedPlan(cachedPlan);
      } else if (cachedPlan) {
        Storage.remove(`generated_plan_${session.user.id}`);
        Storage.remove(`generated_plan_date_${session.user.id}`);
      }
      
      if (cachedTasks) {
        setTasks(cachedTasks);
        setLoading(false);
        setIsCacheLoaded(true);
      }
    };
    init();

    const kShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      if (Platform.OS === 'android') setAndroidKeyboardHeight(e.endCoordinates.height);
    });

    return () => {
      kShow.remove();
    };
  }, []);

  // Handle keyboard hide to close input if no menu is active
  useEffect(() => {
    const kHide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      if (Platform.OS === 'android') setAndroidKeyboardHeight(0);
      
      if (isAddingTask && !activeToolbarMenu && !showDatePicker && !showReminderDatePicker && !showCustomRepeatModal) {
        setIsAddingTask(false);
        setPendingDueDate(null);
        setPendingReminder(null);
        setPendingRepeatRule(null);
      }
    });
    return () => kHide.remove();
  }, [isAddingTask, activeToolbarMenu, showDatePicker, showReminderDatePicker, showCustomRepeatModal]);

  // Handle hardware back press
  useEffect(() => {
    const backAction = () => {
      if (isAddingTask) {
        setIsAddingTask(false);
        setActiveToolbarMenu(null);
        setPendingDueDate(null);
        setPendingReminder(null);
        setPendingRepeatRule(null);
        Keyboard.dismiss();
        return true;
      }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [isAddingTask]);

  // Save sort preference when it changes, but only after it has loaded
  useEffect(() => {
    if (isSortLoaded) {
      Storage.set('sortBy_today', sortBy);
    }
  }, [sortBy, isSortLoaded]);

  // Reload tasks from cache when screen gains focus (e.g. returning from TaskDetail)
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      const refreshFromCache = async () => {
        const cached = await Storage.get(`tasks_${userId}`);
        if (cached) setTasks(cached);
      };
      refreshFromCache();
    }, [userId])
  );

  const fetchTasks = async (uid) => {
    // Refresh from Supabase via dataManager
    await loadTasks(uid, (fresh) => {
      setTasks(fresh);
      setLoading(false);
    });
  };

  // ─── Sorting — only active tasks for draggable list ──
  const todayStr = new Date().toDateString();

  const isTaskForToday = (t) => {
    if (t.added_to_today) return true;
    
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

    // For backward compatibility, default tasks without a list belong to Today if they have no due date
    if (!t.list_id && !t.due_date && !t.reminder_time) return true;
    return false;
  };

  const getSortedActiveTasks = () => {
    // Keep task in active list while its scribble animation is playing
    const active = tasks.filter(t => isTaskForToday(t) && (!t.is_completed || completingTaskIds.includes(t.id)));
    const sortGroup = (arr) => {
      const s = [...arr];
      switch (sortBy) {
        case 'importance':
          s.sort((a, b) => (b.is_important ? 1 : 0) - (a.is_important ? 1 : 0));
          break;
        case 'due_date':
          s.sort((a, b) => {
            if (!a.due_date && !b.due_date) return 0;
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return new Date(a.due_date) - new Date(b.due_date);
          });
          break;
        case 'alphabetical':
          s.sort((a, b) => a.title.localeCompare(b.title));
          break;
        case 'custom':
        default:
          s.sort((a, b) => {
            const indexA = a.order_index ?? Infinity;
            const indexB = b.order_index ?? Infinity;
            return indexA - indexB || new Date(b.created_at) - new Date(a.created_at);
          });
          break;
      }
      return s;
    };
    return sortGroup(active);
  };

  const getSortedTasks = () => {
    const active = tasks.filter(t => isTaskForToday(t) && (!t.is_completed || completingTaskIds.includes(t.id)));
    const completed = tasks.filter(t => isTaskForToday(t) && t.is_completed && !completingTaskIds.includes(t.id));
    const sortGroup = (arr) => {
      const s = [...arr];
      switch (sortBy) {
        case 'importance':
          s.sort((a, b) => (b.is_important ? 1 : 0) - (a.is_important ? 1 : 0));
          break;
        case 'due_date':
          s.sort((a, b) => {
            if (!a.due_date && !b.due_date) return 0;
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return new Date(a.due_date) - new Date(b.due_date);
          });
          break;
        case 'alphabetical':
          s.sort((a, b) => a.title.localeCompare(b.title));
          break;
        case 'custom':
        default:
          s.sort((a, b) => {
            const indexA = a.order_index ?? Infinity;
            const indexB = b.order_index ?? Infinity;
            return indexA - indexB || new Date(b.created_at) - new Date(a.created_at);
          });
          break;
      }
      return s;
    };
    return [...sortGroup(active), ...sortGroup(completed)];
  };

  // Completed today — shown in collapsible section
  const completedTodayTasks = tasks.filter(t => {
    if (!isTaskForToday(t) && new Date(t.completed_at).toDateString() !== todayStr) return false;
    if (!t.is_completed) return false;
    const completedDate = t.completed_at ? new Date(t.completed_at).toDateString() : null;
    return completedDate === todayStr;
  });

  // Clear completed handler
  const handleClearCompleted = async () => {
    setIsMenuOpen(false);
    const currentTasks = latestTasksRef.current;
    const completed = currentTasks.filter(t => isTaskForToday(t) && t.is_completed);
    if (completed.length === 0) return;
    // Mark them with a flag so they won't show in Today anymore
    const updatedTasks = currentTasks.filter(t => !t.is_completed);
    setTasks(updatedTasks);
    if (userId) {
      await cacheTasks(userId, updatedTasks);
      // Delete from Supabase
      for (const t of completed) {
        syncToSupabase('tasks', 'delete', {}, { column: 'id', value: t.id });
      }
    }
  };

  // ─── Print / Share ────────────────────────────────────
  const handlePrintList = async () => {
    setIsMenuOpen(false);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const lines = getSortedTasks().map(t => {
      const status = t.is_completed ? '✅' : (t.is_important ? '⭐' : '⬜');
      let line = `${status} ${t.title}`;
      if (t.due_date)      line += `\n   📅 Due: ${formatDate(t.due_date)}`;
      if (t.reminder_time) line += `\n   🔔 Remind: ${formatDateTime(t.reminder_time)}`;
      if (t.repeat_rule)   line += `\n   🔁 Repeat: ${t.repeat_rule}`;
      return line;
    });
    const message = `📋 TODAY — ${today}\n${'─'.repeat(32)}\n\n${lines.join('\n\n')}`;
    try {
      await Share.share({ message, title: `Today's Tasks — ${today}` });
    } catch (e) {
      console.log('Share error', e);
    }
  };

  const SORT_LABELS = {
    created_at: null,
    importance: 'By importance',
    due_date: 'By due date',
    alphabetical: 'A–Z',
  };

  // ─── CRUD ─────────────────────────────────────────────
  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !userId) return;

    const taskData = {
      title: newTaskTitle.trim(),
      due_date: pendingDueDate ? pendingDueDate.toISOString() : null,
      reminder_time: pendingReminder ? pendingReminder.toISOString() : null,
      repeat_rule: pendingRepeatRule,
      added_to_today: true,
    };

    // Optimistic add via DataManager
    const newTasks = await dmAddTask(userId, tasks, taskData, (synced, realTask) => {
      setTasks(synced);
      // Schedule push notification with real ID
      if (realTask.reminder_time) {
        scheduleTaskReminder(realTask.id, realTask.title, realTask.reminder_time);
      }
    });

    setTasks(newTasks);
    setNewTaskTitle('');
    setPendingDueDate(null);
    setPendingReminder(null);
    setPendingRepeatRule(null);
    setActiveToolbarMenu(null);
    setIsAddingTask(false);
  };

  const toggleTask = async (id, currentStatus) => {
    const isCompleting = !currentStatus;

    if (isCompleting) {
      // 1. Mark as "completing" so scribble animation triggers but task stays in active list
      setCompletingTaskIds(prev => [...prev, id]);

      // 2. After scribble animation finishes (~800ms), actually move to completed
      setTimeout(() => {
        if (userId) {
          const currentTasks = latestTasksRef.current;
          const completedAt = new Date().toISOString();
          const updated = currentTasks.map(t =>
            t.id === id ? { ...t, is_completed: true, completed_at: completedAt } : t
          );

          // Update local state and clear animation state together in the same render cycle
          setTasks(updated);
          setCompletingTaskIds(prev => prev.filter(tid => tid !== id));

          // Run cache and sync tasks in the background asynchronously
          cacheTasks(userId, updated);
          syncToSupabase('tasks', 'update',
            { is_completed: true, completed_at: completedAt },
            { column: 'id', value: id }
          );

          const task = currentTasks.find(t => t.id === id);
          if (task?.reminder_time) cancelTaskReminder(id);
          Gamification.addXP(userId, 10);
        }
      }, 800);
    } else {
      // Un-completing: instant
      if (userId) {
        const currentTasks = latestTasksRef.current;
        const updated = currentTasks.map(t =>
          t.id === id ? { ...t, is_completed: false, completed_at: null } : t
        );
        
        // Update local state instantly
        setTasks(updated);

        // Run cache and sync tasks in the background asynchronously
        cacheTasks(userId, updated);
        syncToSupabase('tasks', 'update',
          { is_completed: false, completed_at: null },
          { column: 'id', value: id }
        );

        const task = currentTasks.find(t => t.id === id);
        if (task?.reminder_time) scheduleTaskReminder(id, task.title, task.reminder_time);
        Gamification.addXP(userId, -10);
      }
    }
  };

  const toggleImportant = async (id, currentStatus) => {
    const updated = await toggleTaskImportance(userId, latestTasksRef.current, id, currentStatus);
    setTasks(updated);
  };

  const deleteTaskHandler = async (id) => {
    cancelTaskReminder(id);
    const updated = await dmDeleteTask(userId, latestTasksRef.current, id);
    setTasks(updated);
  };

  // ─── Date Picker Handlers ────────────────────────────
  const onDatePickerChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (event.type === 'set' && selectedDate) {
      selectedDate.setHours(23, 59, 0, 0);
      setPendingDueDate(selectedDate);
    }
  };

  const onReminderDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') setShowReminderDatePicker(false);
    if (event.type === 'set' && selectedDate) {
      setReminderPickerDate(selectedDate);
      if (Platform.OS === 'android') {
        setShowReminderTimePicker(true);
      }
    }
  };

  const onReminderTimeChange = (event, selectedTime) => {
    if (Platform.OS === 'android') setShowReminderTimePicker(false);
    if (event.type === 'set' && selectedTime) {
      const combined = new Date(reminderPickerDate);
      combined.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
      setPendingReminder(combined);
      if (Platform.OS === 'ios') {
        setShowReminderDatePicker(false);
      }
    }
  };

  // ─── Custom Repeat Save ───────────────────────────────
  const saveCustomRepeat = () => {
    const rule = `every ${customRepeatEvery} ${customRepeatUnit}`;
    const daysStr = customRepeatDays.length > 0 ? ` on ${customRepeatDays.join(',')}` : '';
    setPendingRepeatRule(rule + daysStr);
    setShowCustomRepeatModal(false);
  };

  const toggleDay = (day) => {
    setCustomRepeatDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  // ─── Pending Tags Display ─────────────────────────────
  const renderPendingTags = () => {
    if (!pendingDueDate && !pendingReminder && !pendingRepeatRule) return null;
    return (
      <View style={styles.pendingTags}>
        {pendingDueDate && (
          <TouchableOpacity style={[styles.tag, { backgroundColor: '#333', borderColor: '#444' }]} onPress={() => setPendingDueDate(null)}>
            <Calendar color="#ccc" size={12} />
            <Text style={[styles.tagText, { color: '#ccc' }]}>{formatDate(pendingDueDate)}</Text>
            <X color="#ccc" size={12} />
          </TouchableOpacity>
        )}
        {pendingReminder && (
          <TouchableOpacity style={[styles.tag, { backgroundColor: '#333', borderColor: '#444' }]} onPress={() => setPendingReminder(null)}>
            <Bell color="#ccc" size={12} />
            <Text style={[styles.tagText, { color: '#ccc' }]}>{formatDateTime(pendingReminder)}</Text>
            <X color="#ccc" size={12} />
          </TouchableOpacity>
        )}
        {pendingRepeatRule && (
          <TouchableOpacity style={[styles.tag, { backgroundColor: '#333', borderColor: '#444' }]} onPress={() => setPendingRepeatRule(null)}>
            <Repeat color="#ccc" size={12} />
            <Text style={[styles.tagText, { color: '#ccc' }]}>{pendingRepeatRule}</Text>
            <X color="#ccc" size={12} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ─── Render ───────────────────────────────────────────
  const sortedTasks = getSortedActiveTasks();

  return (
    <BackgroundWrapper>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconButton}>
            <Menu color="#fff" size={28} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ position: 'relative' }}>
              <TouchableOpacity onPress={() => setIsMenuOpen(!isMenuOpen)} style={styles.iconButton}>
                <MoreVertical color="#fff" size={28} />
              </TouchableOpacity>
            {isMenuOpen && (
              <View style={[styles.dropdown, { backgroundColor: '#2A2A2A', borderColor: '#444' }]}>
                {[
                  { key: 'importance', label: 'Sort by importance' },
                  { key: 'due_date',   label: 'Sort by due date' },
                  { key: 'alphabetical', label: 'Sort alphabetically' },
                  { key: 'created_at', label: 'Sort by creation date' },
                ].map(item => (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.dropdownItem}
                    onPress={() => { setSortBy(item.key); setIsMenuOpen(false); }}
                  >
                    <Text style={[styles.dropdownText, { color: sortBy === item.key ? theme.primary : '#fff' }]}>
                      {item.label}
                    </Text>
                    {sortBy === item.key && <Check color={theme.primary} size={16} />}
                  </TouchableOpacity>
                ))}
                <View style={[styles.divider, { backgroundColor: '#444' }]} />
                <TouchableOpacity style={styles.dropdownItem} onPress={handlePrintList}>
                  <Text style={[styles.dropdownText, { color: '#fff' }]}>Share / Print list</Text>
                </TouchableOpacity>
                {completedTodayTasks.length > 0 && (
                  <>
                    <View style={[styles.divider, { backgroundColor: '#444' }]} />
                    <TouchableOpacity style={styles.dropdownItem} onPress={handleClearCompleted}>
                      <Text style={[styles.dropdownText, { color: '#ff4b4b' }]}>Clear completed</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </View>
        </View>
        </View>

        {/* Title + active sort badge */}
        <View style={styles.titleContainer}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={[styles.title, { color: '#fff' }]}>TODAY</Text>
            <TouchableOpacity onPress={() => setShowAura(true)} activeOpacity={0.7}>
              {generatedPlan ? (
                <Calendar color="#A78BFA" size={24} />
              ) : (
                <Wand2 color="#A78BFA" size={24} />
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.titleRow}>
            <Text style={[styles.subtitle, { color: '#fff' }]}>{todayDate}</Text>
            {SORT_LABELS[sortBy] && (
              <View style={styles.sortBadge}>
                <Text style={styles.sortBadgeText}>{SORT_LABELS[sortBy]}</Text>
                <TouchableOpacity onPress={() => setSortBy('created_at')} style={{ marginLeft: 4 }}>
                  <X color="#aaa" size={11} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
          style={styles.container}
        >

          {/* Task List */}
          {!isCacheLoaded ? (
            <View style={{ marginTop: 16, paddingHorizontal: 16 }}>
              <SkeletonTask />
              <SkeletonTask />
              <SkeletonTask />
              <SkeletonTask />
            </View>
          ) : (
            <NestableScrollContainer style={{ flex: 1 }}>
              {sortedTasks.length === 0 && completedTodayTasks.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>No tasks yet. Tap + to add one.</Text>
                </View>
              ) : null}

              {sortedTasks.length === 0 && completedTodayTasks.length > 0 ? (
                <View style={[styles.emptyState, { flex: 0, paddingVertical: 40 }]}>
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>All caught up for today!</Text>
                </View>
              ) : null}

              {sortedTasks.length > 0 && (
                <NestableDraggableFlatList
                data={sortedTasks}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
                onContainerLayout={() => {}}
                onDragEnd={({ data }) => {
                  if (sortBy !== 'custom') setSortBy('custom');
                  
                  const orderMap = new Map(data.map((t, i) => [t.id, i]));
                  
                  const mergedTasks = latestTasksRef.current.map(t => 
                    orderMap.has(t.id) ? { ...t, order_index: orderMap.get(t.id) } : t
                  );
                  
                  setTasks(mergedTasks);
                  
                  // Background sync via SyncQueue (caching full lists and syncing mappings)
                  const changedTasks = data.map((t, i) => ({ id: t.id, order_index: i }));
                  reorderTasks(userId, mergedTasks, changedTasks);
                }}
                renderItem={({ item: task, drag, isActive }) => {
                  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                  const hasNotes = task.notes && task.notes.trim().length > 0;
                  const hasMeta = task.due_date || task.reminder_time || task.repeat_rule || hasSubtasks || hasNotes;
                  const todayStart = new Date();
                  todayStart.setHours(0, 0, 0, 0);
                  const isOverdue = task.due_date && new Date(task.due_date) < todayStart && !task.is_completed;
                  const completedSubs = hasSubtasks ? task.subtasks.filter(s => s.is_completed).length : 0;
                  const totalSubs = hasSubtasks ? task.subtasks.length : 0;
                  return (
                    <ScaleDecorator>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        onPress={() => navigation.navigate('TaskDetail', { task, userId })}
                        onLongPress={drag}
                        disabled={isActive}
                        style={[
                          styles.taskCard,
                          task.is_important && styles.taskCardImportant,
                          task.is_completed && styles.taskCardCompleted,
                          isActive && { backgroundColor: 'rgba(255,255,255,0.08)', elevation: 12 }
                        ]}>
                        
                        <View style={[
                          styles.cardIndicator,
                          task.is_important && { backgroundColor: '#FFFFFF' }
                        ]} />

                        {/* Left: drag handle + checkbox */}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {!task.is_completed && !completingTaskIds.includes(task.id) && (
                            <TouchableOpacity onPressIn={drag} style={{ padding: 4, marginRight: 2 }}>
                              <GripVertical color="#444" size={20} />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity 
                            onPress={() => toggleTask(task.id, task.is_completed)} 
                            disabled={completingTaskIds.includes(task.id)} 
                            style={[
                              styles.checkbox, 
                              (task.is_completed || completingTaskIds.includes(task.id)) && { marginLeft: 28 }
                            ]}
                          >
                            {(task.is_completed || completingTaskIds.includes(task.id)) ? (
                              <CheckCircle2 color="#10B981" size={24} />
                            ) : (
                              <Circle color={theme.text} size={24} />
                            )}
                          </TouchableOpacity>
                        </View>

                        {/* Center: title + meta */}
                        <View style={styles.taskContent}>
                          <ScribbleStrike isCompleted={task.is_completed || completingTaskIds.includes(task.id)} shouldAnimate={completingTaskIds.includes(task.id)} color={theme.textMuted}>
                            <Text
                              style={[
                                styles.taskTitle,
                                { color: completingTaskIds.includes(task.id) ? '#666' : (task.is_completed ? '#666' : '#fff') },
                                (task.is_completed || completingTaskIds.includes(task.id)) && styles.taskCompleted,
                              ]}
                            >
                              {task.title}
                            </Text>
                          </ScribbleStrike>

                          {hasMeta && (
                            <View style={styles.taskMetaRow}>
                              {task.due_date && (
                                <View style={styles.metaPill}>
                                  <Calendar color={isOverdue ? '#EF4444' : '#888'} size={11} />
                                  <Text style={[styles.metaLabel, isOverdue && { color: '#EF4444' }]}>
                                    {formatDate(task.due_date)}
                                  </Text>
                                </View>
                              )}
                              {task.reminder_time && (
                                <View style={styles.metaPill}>
                                  <Bell color="#888" size={11} />
                                  <Text style={styles.metaLabel}>
                                    {formatDateTime(task.reminder_time)}
                                  </Text>
                                </View>
                              )}
                              {task.repeat_rule && (
                                <View style={styles.metaPill}>
                                  <Repeat color="#888" size={11} />
                                  <Text style={styles.metaLabel}>
                                    {task.repeat_rule}
                                  </Text>
                                </View>
                              )}
                              {hasSubtasks && (
                                <View style={styles.metaPill}>
                                  <ListChecks color="#888" size={11} />
                                  <Text style={styles.metaLabel}>
                                    {completedSubs}/{totalSubs}
                                  </Text>
                                </View>
                              )}
                              {hasNotes && (
                                <View style={[styles.metaPill, { paddingHorizontal: 6 }]}>
                                  <FileText color="#888" size={11} />
                                </View>
                              )}
                            </View>
                          )}
                        </View>

                        {/* Right: star + delete */}
                        <View style={styles.taskActions}>
                          <TouchableOpacity onPress={() => toggleImportant(task.id, task.is_important)} style={styles.iconButtonSmall}>
                            <Star
                              color={task.is_important ? '#FFFFFF' : '#444'}
                              fill={task.is_important ? '#FFFFFF' : 'transparent'}
                              size={18}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteTaskHandler(task.id)} style={styles.iconButtonSmall}>
                            <Trash2 color="#444" size={18} />
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    </ScaleDecorator>
                  );
                }}
              />
              )}

              {/* ─── Completed Today Section ──────────────── */}
              {completedTodayTasks.length > 0 && (
                <View style={{ paddingHorizontal: 0 }}>
                  <TouchableOpacity
                    onPress={() => setShowCompleted(!showCompleted)}
                    style={styles.completedHeader}
                    activeOpacity={0.7}
                  >
                    {showCompleted
                      ? <ChevronDown color="#888" size={18} />
                      : <ChevronRight color="#888" size={18} />}
                    <Text style={styles.completedHeaderText}>
                      Completed ({completedTodayTasks.length})
                    </Text>
                  </TouchableOpacity>

                  {showCompleted && completedTodayTasks.map(task => {
                    const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                    const hasNotes = task.notes && task.notes.trim().length > 0;
                    const hasMeta = task.due_date || task.reminder_time || task.repeat_rule || hasSubtasks || hasNotes;
                    const completedSubs = hasSubtasks ? task.subtasks.filter(s => s.is_completed).length : 0;
                    const totalSubs = hasSubtasks ? task.subtasks.length : 0;

                    const completedAgo = task.completed_at
                      ? (() => {
                          const diff = Date.now() - new Date(task.completed_at).getTime();
                          const mins = Math.floor(diff / 60000);
                          if (mins < 1) return 'Just now';
                          if (mins < 60) return `${mins}m ago`;
                          const hrs = Math.floor(mins / 60);
                          return `${hrs}h ago`;
                        })()
                      : null;

                    return (
                      <Animated.View key={task.id} entering={FadeIn.duration(300)}>
                        <TouchableOpacity
                          activeOpacity={0.75}
                          onPress={() => navigation.navigate('TaskDetail', { task, userId })}
                          style={[styles.taskCard, styles.taskCardCompleted]}
                        >
                          {/* Removed green indicator bar */}

                          <TouchableOpacity
                            onPress={() => toggleTask(task.id, task.is_completed)}
                            style={[styles.checkbox, { marginLeft: 28 }]}
                          >
                            <CheckCircle2 color="#10B981" size={24} />
                          </TouchableOpacity>

                          <View style={styles.taskContent}>
                            <ScribbleStrike isCompleted={true} shouldAnimate={false} color="#666">
                              <Text style={[styles.taskTitle, { color: '#666' }, styles.taskCompleted]}>
                                {task.title}
                              </Text>
                            </ScribbleStrike>

                            {(hasMeta || completedAgo) && (
                              <View style={styles.taskMetaRow}>
                                {completedAgo && (
                                  <View style={styles.metaPill}>
                                    <Check color="#10B981" size={11} />
                                    <Text style={[styles.metaLabel, { color: '#10B981' }]}>{completedAgo}</Text>
                                  </View>
                                )}
                                {hasSubtasks && (
                                  <View style={styles.metaPill}>
                                    <ListChecks color="#888" size={11} />
                                    <Text style={[styles.metaLabel, { color: '#888' }]}>{completedSubs}/{totalSubs}</Text>
                                  </View>
                                )}
                                {hasNotes && (
                                  <View style={[styles.metaPill, { paddingHorizontal: 6 }]}>
                                    <FileText color="#888" size={11} />
                                  </View>
                                )}
                              </View>
                            )}
                          </View>

                          <TouchableOpacity onPress={() => toggleImportant(task.id, task.is_important)} style={styles.iconButtonSmall}>
                            <Star 
                              color={task.is_important ? '#FFFFFF' : '#444'} 
                              fill={task.is_important ? '#FFFFFF' : 'transparent'} 
                              size={18} 
                            />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      </Animated.View>
                    );
                  })}
                </View>
              )}
            </NestableScrollContainer>
          )}

          {/* ─── Bottom Input Area ────────────────────── */}
          {isAddingTask ? (
            <View style={[styles.bottomInputWrapper, {
              paddingBottom: Platform.OS === 'android' && androidKeyboardHeight > 0 ? 32 : Math.max(insets.bottom, 16),
              marginBottom: Platform.OS === 'android' && androidKeyboardHeight > 0 ? androidKeyboardHeight : 0,
            }]}>

              {/* Due Date Pop-up */}
              {activeToolbarMenu === 'date' && (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.toolbarMenu, { bottom: 85, left: 16 }]}>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingDueDate(getToday()); setActiveToolbarMenu(null); }}>
                    <Calendar color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Today ({getDayName(new Date())})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingDueDate(getTomorrow()); setActiveToolbarMenu(null); }}>
                    <Calendar color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Tomorrow ({getDayName(getTomorrow())})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingDueDate(getNextMonday()); setActiveToolbarMenu(null); }}>
                    <Calendar color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Next week (Mon)</Text>
                  </TouchableOpacity>
                  <View style={[styles.divider, { backgroundColor: '#444' }]} />
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setActiveToolbarMenu(null); setShowDatePicker(true); }}>
                    <Calendar color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Pick a date</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Reminder Pop-up */}
              {activeToolbarMenu === 'reminder' && (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.toolbarMenu, { bottom: 85, left: 60 }]}>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingReminder(getReminderLaterToday()); setActiveToolbarMenu(null); }}>
                    <Bell color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Later today ({getReminderLaterToday().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingReminder(getReminderTomorrow()); setActiveToolbarMenu(null); }}>
                    <Bell color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Tomorrow ({getDayName(getTomorrow())} 09:00)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingReminder(getReminderNextWeek()); setActiveToolbarMenu(null); }}>
                    <Bell color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Next week (Mon 09:00)</Text>
                  </TouchableOpacity>
                  <View style={[styles.divider, { backgroundColor: '#444' }]} />
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setActiveToolbarMenu(null); setReminderPickerDate(new Date()); setShowReminderDatePicker(true); }}>
                    <Bell color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Pick a date & time</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Repeat Pop-up */}
              {activeToolbarMenu === 'repeat' && (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.toolbarMenu, { bottom: 85, right: 16 }]}>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('daily'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Daily</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('weekdays'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Weekdays</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('weekly'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Weekly</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('monthly'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Monthly</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('yearly'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Yearly</Text>
                  </TouchableOpacity>
                  <View style={[styles.divider, { backgroundColor: '#444' }]} />
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setActiveToolbarMenu(null); setShowCustomRepeatModal(true); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>Customised</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Pending Tags */}
              {renderPendingTags()}

              {/* Input Row */}
              <View style={styles.inputRow}>
                <TouchableOpacity onPress={() => { setIsAddingTask(false); setActiveToolbarMenu(null); setPendingDueDate(null); setPendingReminder(null); setPendingRepeatRule(null); }} style={styles.closeInputBtn}>
                  <Circle color="#666" size={24} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.bottomInput, { color: '#fff' }]}
                  placeholder="Add a task"
                  placeholderTextColor="#666"
                  value={newTaskTitle}
                  onChangeText={setNewTaskTitle}
                  onSubmitEditing={handleAddTask}
                  autoFocus
                />
                <TouchableOpacity onPress={handleAddTask} style={[styles.submitArrow, { backgroundColor: newTaskTitle.trim() ? '#FFFFFF' : '#333' }]}>
                  <ArrowUp color={newTaskTitle.trim() ? '#000000' : '#666'} size={20} />
                </TouchableOpacity>
              </View>

              {/* Toolbar */}
              <View style={styles.toolbarRow}>
                <TouchableOpacity style={[styles.toolbarButton, pendingDueDate && styles.toolbarButtonActive]} onPress={() => setActiveToolbarMenu(activeToolbarMenu === 'date' ? null : 'date')}>
                  <Calendar color={pendingDueDate ? '#fff' : '#888'} size={18} />
                  <Text style={[styles.toolbarText, pendingDueDate && { color: '#fff' }]}>Due date</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolbarButton, pendingReminder && styles.toolbarButtonActive]} onPress={() => setActiveToolbarMenu(activeToolbarMenu === 'reminder' ? null : 'reminder')}>
                  <Bell color={pendingReminder ? '#fff' : '#888'} size={18} />
                  <Text style={[styles.toolbarText, pendingReminder && { color: '#fff' }]}>Remind me</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolbarButton, pendingRepeatRule && styles.toolbarButtonActive]} onPress={() => setActiveToolbarMenu(activeToolbarMenu === 'repeat' ? null : 'repeat')}>
                  <Repeat color={pendingRepeatRule ? '#fff' : '#888'} size={18} />
                  <Text style={[styles.toolbarText, pendingRepeatRule && { color: '#fff' }]}>Repeat</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.fab, {
                bottom: Math.max(insets.bottom + 16, 20)
              }]}
              onPress={() => setIsAddingTask(true)}
            >
              <Plus color="#000000" size={28} />
            </TouchableOpacity>
          )}
        </KeyboardAvoidingView>

        {/* ─── Native Date Picker (Due Date) ────────── */}
        {showDatePicker && (
          <Modal transparent animationType="slide">
            <View style={styles.pickerModalOverlay}>
              <View style={styles.pickerModalContent}>
                <View style={styles.pickerHeader}>
                  <Text style={styles.pickerTitle}>Pick a due date</Text>
                  <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                    <X color="#fff" size={24} />
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={pendingDueDate || new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant="dark"
                  minimumDate={new Date()}
                  onChange={onDatePickerChange}
                  style={{ width: '100%' }}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity style={styles.pickerDoneBtn} onPress={() => { setPendingDueDate(pendingDueDate || new Date()); setShowDatePicker(false); }}>
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Modal>
        )}

        {/* ─── Native Date+Time Picker (Reminder) ──── */}
        {showReminderDatePicker && (
          <Modal transparent animationType="slide">
            <View style={styles.pickerModalOverlay}>
              <View style={styles.pickerModalContent}>
                <View style={styles.pickerHeader}>
                  <Text style={styles.pickerTitle}>Pick date & time</Text>
                  <TouchableOpacity onPress={() => setShowReminderDatePicker(false)}>
                    <X color="#fff" size={24} />
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={reminderPickerDate}
                  mode={Platform.OS === 'ios' ? 'datetime' : 'date'}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant="dark"
                  minimumDate={new Date()}
                  onChange={Platform.OS === 'ios'
                    ? (e, d) => { if (d) setReminderPickerDate(d); }
                    : onReminderDateChange
                  }
                  style={{ width: '100%' }}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity style={styles.pickerDoneBtn} onPress={() => { setPendingReminder(reminderPickerDate); setShowReminderDatePicker(false); }}>
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Modal>
        )}

        {/* Android Time Picker (second step) */}
        {showReminderTimePicker && Platform.OS === 'android' && (
          <DateTimePicker
            value={reminderPickerDate}
            mode="time"
            display="default"
            onChange={onReminderTimeChange}
          />
        )}

        {/* ─── Custom Repeat Modal ───────────────────── */}
        <Modal visible={showCustomRepeatModal} transparent animationType="slide">
          <View style={styles.pickerModalOverlay}>
            <View style={styles.customRepeatModal}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Custom repeat</Text>
                <TouchableOpacity onPress={() => setShowCustomRepeatModal(false)}>
                  <X color="#fff" size={24} />
                </TouchableOpacity>
              </View>

              {/* Repeat every ___ [unit] */}
              <Text style={styles.customLabel}>Repeat every</Text>
              <View style={styles.customRow}>
                <TextInput
                  style={styles.customNumberInput}
                  value={customRepeatEvery}
                  onChangeText={setCustomRepeatEvery}
                  keyboardType="number-pad"
                  maxLength={3}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.unitScroll}>
                  {UNIT_OPTIONS.map(unit => (
                    <TouchableOpacity
                      key={unit}
                      style={[styles.unitChip, customRepeatUnit === unit && { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' }]}
                      onPress={() => setCustomRepeatUnit(unit)}
                    >
                      <Text style={[styles.unitChipText, customRepeatUnit === unit && { color: '#000000' }]}>{unit}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Day selector (only for weeks) */}
              {customRepeatUnit === 'weeks' && (
                <>
                  <Text style={[styles.customLabel, { marginTop: 20 }]}>On these days</Text>
                  <View style={styles.dayRow}>
                    {DAY_LABELS.map(day => (
                      <TouchableOpacity
                        key={day}
                        style={[styles.dayChip, customRepeatDays.includes(day) && { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' }]}
                        onPress={() => toggleDay(day)}
                      >
                        <Text style={[styles.dayChipText, customRepeatDays.includes(day) && { color: '#000000' }]}>{day}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <TouchableOpacity style={[styles.pickerDoneBtn, { marginTop: 24 }]} onPress={saveCustomRepeat}>
                <Text style={styles.pickerDoneText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </View>

      {/* Sidebar */}
      <GlassSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        profile={profile}
        handleLogout={() => { navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] }); supabase.auth.signOut(); }}
        navigation={navigation}
        currentRoute="Today"
      />
      {/* AIAuraOverlay */}
      <AIAuraOverlay 
        visible={showAura} 
        onClose={() => setShowAura(false)} 
        userId={userId}
        tasks={sortedTasks}
        savedPlan={generatedPlan}
        onPlanGenerated={(plan) => {
          setGeneratedPlan(plan);
          if (userId) {
            Storage.set(`generated_plan_${userId}`, plan);
            Storage.set(`generated_plan_date_${userId}`, new Date().toDateString());
          }
        }}
        onToggleTask={toggleTask}
      />
    </BackgroundWrapper>
  );
};

// ─── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    paddingHorizontal: 16, 
    marginBottom: 12, 
    zIndex: 10,
  },
  iconButton: { 
    padding: 6 
  },
  dropdown: {
    position: 'absolute', 
    top: 40, 
    right: 0, 
    width: 220, 
    backgroundColor: '#1A1A1A',
    borderRadius: 12, 
    borderWidth: 1,
    borderColor: '#333',
    shadowColor: "#000", 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.5, 
    shadowRadius: 8, 
    elevation: 10, 
    zIndex: 100,
  },
  dropdownItem: {
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    paddingVertical: 12, 
    paddingHorizontal: 16,
  },
  dropdownText: { 
    fontSize: 15, 
    fontWeight: '500',
    color: '#FFFFFF' 
  },
  divider: { 
    height: 1, 
    width: '100%',
    backgroundColor: '#333' 
  },
  titleContainer: { 
    paddingHorizontal: 20, 
    marginBottom: 24 
  },
  titleRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 8, 
    flexWrap: 'wrap', 
    marginTop: 2 
  },
  title: { 
    fontSize: 32, 
    fontWeight: '700', 
    marginBottom: 4,
    color: '#FFFFFF',
    letterSpacing: 0.5 
  },
  subtitle: { 
    fontSize: 16, 
    fontWeight: '500', 
    opacity: 0.8,
    color: '#FFFFFF' 
  },
  sortBadge: {
    flexDirection: 'row', 
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10, 
    paddingVertical: 4, 
    borderRadius: 16,
  },
  sortBadgeText: { 
    color: '#FFFFFF', 
    fontSize: 11, 
    fontWeight: '600' 
  },
  scroll: { 
    paddingHorizontal: 16, 
    paddingBottom: 100 
  },

  // Completed Section
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  completedHeaderText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // Task Card
  taskCard: {
    backgroundColor: 'rgba(20, 20, 22, 0.85)',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  cardIndicator: {
    width: 3.5,
    height: 20,
    borderRadius: 2,
    marginRight: 6,
    backgroundColor: 'transparent',
  },
  taskCardImportant: {
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  taskCardCompleted: {
    opacity: 0.45,
    backgroundColor: 'rgba(20, 20, 22, 0.45)',
    borderColor: 'transparent',
  },
  checkbox: { 
    marginRight: 12,
    marginTop: 0,
  },
  emptyCircle: {
    width: 20, 
    height: 20, 
    borderRadius: 10, 
    borderWidth: 2,
  },
  taskContent: { 
    flex: 1, 
    paddingRight: 8 
  },
  taskTitle: { 
    fontSize: 15, 
    fontWeight: '500', 
    lineHeight: 20,
    color: '#FFFFFF' 
  },
  taskCompleted: { 
    color: '#888888' 
  },

  // Meta Row (inline, single line)
  taskMetaRow: {
    flexDirection: 'row', 
    alignItems: 'center', 
    flexWrap: 'wrap',
    marginTop: 4, 
    gap: 6,
  },
  metaPill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#1A1A1C',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 4,
  },
  metaLabel: { 
    fontSize: 11, 
    fontWeight: '500',
    color: '#888',
  },

  // Right Actions Column
  taskActions: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 12,
    marginTop: 2,
  },
  iconButtonSmall: { 
    padding: 4,
  },

  emptyState: { 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingTop: 60 
  },
  emptyText: { 
    fontSize: 15,
    color: '#666666' 
  },

  // FAB
  fab: {
    position: 'absolute', 
    bottom: 20, 
    right: 20, 
    width: 60, 
    height: 60, 
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', 
    justifyContent: 'center',
    shadowColor: "#000", 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.4, 
    shadowRadius: 8, 
    elevation: 10,
  },

  // Bottom Input
  bottomInputWrapper: {
    paddingTop: 16,
    paddingHorizontal: 16,
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 20,
  },
  inputRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 4, 
    paddingVertical: 4, 
    marginBottom: 12, 
    gap: 10 
  },
  closeInputBtn: { 
    padding: 2 
  },
  bottomInput: { 
    flex: 1, 
    fontSize: 17, 
    paddingVertical: 8,
    color: '#FFFFFF' 
  },
  submitArrow: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  // Pending Tags
  pendingTags: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginBottom: 8, 
    gap: 6,
    paddingHorizontal: 4 
  },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  tagText: { fontSize: 12, fontWeight: '600' },

  // Toolbar
  toolbarRow: { 
    flexDirection: 'row', 
    paddingBottom: 4, 
    gap: 16,
    paddingHorizontal: 4 
  },
  toolbarButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 5 
  },
  toolbarButtonActive: { 
    opacity: 1 
  },
  toolbarText: { 
    color: '#999', 
    fontSize: 13, 
    fontWeight: '600' 
  },

  // Toolbar Menus
  toolbarMenu: {
    position: 'absolute', 
    bottom: 80,
    backgroundColor: '#1A1A1A', 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#333',
    overflow: 'hidden', 
    zIndex: 100, 
    minWidth: 260,
    shadowColor: "#000", 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.5, 
    shadowRadius: 12, 
    elevation: 15,
  },
  toolbarMenuItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 14, 
    paddingHorizontal: 16 
  },
  toolbarMenuIcon: { 
    marginRight: 12 
  },
  toolbarMenuText: { 
    color: '#FFFFFF', 
    fontSize: 15, 
    fontWeight: '500' 
  },

  // Picker Modals
  pickerModalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.75)', 
    justifyContent: 'flex-end' 
  },
  pickerModalContent: { 
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20, 
    borderTopRightRadius: 20, 
    padding: 20, 
    paddingBottom: 32 
  },
  pickerHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  pickerTitle: { 
    color: '#FFFFFF', 
    fontSize: 19, 
    fontWeight: '700' 
  },
  pickerDoneBtn: { 
    alignItems: 'center', 
    paddingVertical: 14, 
    borderRadius: 12, 
    marginTop: 16,
    backgroundColor: '#FFFFFF' 
  },
  pickerDoneText: { 
    color: '#000000', 
    fontSize: 16, 
    fontWeight: '700' 
  },

  // Custom Repeat Modal
  customRepeatModal: { 
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20, 
    borderTopRightRadius: 20, 
    padding: 20, 
    paddingBottom: 32 
  },
  customLabel: { 
    color: '#999', 
    fontSize: 13, 
    fontWeight: '600', 
    marginBottom: 10 
  },
  customRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 12 
  },
  customNumberInput: {
    width: 60, 
    height: 48, 
    backgroundColor: '#2A2A2A', 
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    color: '#FFFFFF', 
    fontSize: 20, 
    fontWeight: '700', 
    textAlign: 'center',
  },
  unitScroll: { 
    flex: 1 
  },
  unitChip: {
    paddingHorizontal: 16, 
    paddingVertical: 10, 
    borderRadius: 20,
    backgroundColor: '#2A2A2A', 
    borderWidth: 1,
    borderColor: '#333',
    marginRight: 8,
  },
  unitChipText: { 
    color: '#999', 
    fontSize: 14, 
    fontWeight: '600' 
  },
  dayRow: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    gap: 8 
  },
  dayChip: {
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    borderWidth: 1.5, 
    borderColor: '#444',
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: '#2A2A2A',
  },
  dayChipText: { 
    color: '#999', 
    fontSize: 13, 
    fontWeight: '600' 
  },
  aiPlannerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  aiPlannerButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

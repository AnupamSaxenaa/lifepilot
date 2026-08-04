import DateTimePicker from '@react-native-community/datetimepicker';
import {
    Bell,
    Calendar,
    CalendarClock,
    CalendarDays,
    CheckCircle2,
    ChevronDown, ChevronRight,
    Circle,
    Menu, MoreVertical, Star,
    X
} from 'lucide-react-native';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Modal,
    Platform,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    useColorScheme,
    View
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassSidebar } from '../components/GlassSidebar';
import { ScribbleStrike } from '../components/ScribbleStrike';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { useWidgetTaskSync } from '../hooks/useWidgetTaskSync';
import { cacheTasks, loadProfile, loadTasks, toggleTaskImportance, updateTask } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';

const THEME_COLOR = '#FFFFFF';

const SkeletonTask = () => {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.taskCard, style, { backgroundColor: '#121212', borderColor: '#27272A' }]}>
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#27272A', marginRight: 14, marginTop: 2 }} />
      <View style={{ flex: 1, paddingRight: 8 }}>
        <View style={{ width: '60%', height: 16, borderRadius: 4, backgroundColor: '#27272A', marginBottom: 12 }} />
        <View style={{ width: '40%', height: 12, borderRadius: 4, backgroundColor: '#27272A' }} />
      </View>
    </Animated.View>
  );
};

// Extracted + memoized so toggling/rescheduling one task doesn't force every
// other row in the section to rebuild its JSX tree — only the row whose own
// props actually changed re-renders.
const PlannedTaskRow = memo(function PlannedTaskRow({ task, theme, todayStart, isOverdue, onToggle, onPress, onReschedule, onToggleImportant, formatDate }) {
  const { t } = useTranslation();
  return (
    <View style={[
      styles.taskCard,
      theme?.surface && { backgroundColor: theme.surface },
      task.is_completed && styles.taskCardCompleted,
    ]}>
      {/* Checkbox */}
      <TouchableOpacity onPress={() => onToggle(task.id, task.is_completed)} style={styles.checkbox}>
        {task.is_completed ? (
          <CheckCircle2 color={theme.textMuted} size={24} />
        ) : (
          <Circle color={theme.text} size={24} />
        )}
      </TouchableOpacity>

      {/* Title & Meta */}
      <TouchableOpacity
        style={styles.taskContent}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <ScribbleStrike isCompleted={task.is_completed} color={theme.textMuted}>
          <Text style={[styles.taskTitle, task.is_completed && styles.taskCompletedText]}>
            {task.title}
          </Text>
        </ScribbleStrike>

        <View style={styles.taskMetaRow}>
          <View style={styles.metaPill}>
            <Calendar color={isOverdue ? '#A1A1AA' : '#888'} size={11} />
            <Text style={[styles.metaLabel, isOverdue && { color: '#A1A1AA' }]}>
              {formatDate(task.due_date)}
            </Text>
          </View>
          {task.reminder_time && (
            <View style={styles.metaPill}>
              <Bell color="#888" size={11} />
              <Text style={styles.metaLabel}>
                {new Date(task.reminder_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Reschedule Button or Star Toggle */}
      <View style={styles.cardActions}>
        {isOverdue && (
          <TouchableOpacity
            style={styles.reschedulePill}
            onPress={onReschedule}
            activeOpacity={0.7}
          >
            <CalendarClock color="#A1A1AA" size={14} />
            <Text style={styles.rescheduleText}>{t('planned.reschedule')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onToggleImportant} style={{ padding: 4, marginLeft: 8 }}>
          <Star color={task.is_important ? '#fff' : '#444'} fill={task.is_important ? '#fff' : 'transparent'} size={20} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export const PlannedScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  useAppTheme().themeVersion;
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [showMenu, setShowMenu] = useState(false);

  // Widget → app sync: reflect widget task toggles on resume / while foregrounded.
  useWidgetTaskSync(userId, (fresh) => setTasks(fresh));
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCacheLoaded, setIsCacheLoaded] = useState(false);
  const [completingTaskIds, setCompletingTaskIds] = useState([]);

  // Reschedule state
  const [rescheduleTaskId, setRescheduleTaskId] = useState(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pendingDate, setPendingDate] = useState(new Date());

  // Collapsed sections state
  const [collapsedSections, setCollapsedSections] = useState({
    overdue: false,
    today: false,
    tomorrow: false,
    thisWeek: false,
    later: false,
  });

  const formatDate = (d) => {
    if (!d) return null;
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      
      const [cachedProfile, cachedTasks] = await Promise.all([
        loadProfile(session.user.id, (fresh) => setProfile(fresh)),
        loadTasks(session.user.id, (fresh) => {
          setTasks(fresh);
          setLoading(false);
          setIsCacheLoaded(true);
        })
      ]);

      if (cachedProfile) setProfile(cachedProfile);
      
      if (cachedTasks) {
        setTasks(cachedTasks);
        setLoading(false);
        setIsCacheLoaded(true);
      }
    };
    init();
  }, []);

  const toggleTask = async (taskId, currentStatus) => {
    const nextStatus = !currentStatus;

    if (nextStatus) {
      // Completing task - show animation
      setCompletingTaskIds(prev => [...prev, taskId]);
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, is_completed: true, completed_at: new Date().toISOString() } : t
      ));

      setTimeout(async () => {
        if (userId) {
          // ✅ FIX: Load fresh tasks RIGHT NOW
          const latestTasks = await Storage.get(`tasks_${userId}`) || [];
          const completedAt = new Date().toISOString();
          const updatedAll = latestTasks.map(t =>
            t.id === taskId ? { ...t, is_completed: true, completed_at: completedAt } : t
          );
          
          await cacheTasks(userId, updatedAll);
          
          syncToSupabase('tasks', 'update',
            { is_completed: true, completed_at: completedAt },
            { column: 'id', value: taskId }
          );
          
          const targetTask = latestTasks.find(t => t.id === taskId);
          let xpAmount = 10;
          if (targetTask) {
            if (targetTask.priority === 3) xpAmount = 50;
            else if (targetTask.priority === 2) xpAmount = 40;
            else if (targetTask.priority === 0) xpAmount = 5;
          }
          await Gamification.addXP(userId, xpAmount);
        }
        setCompletingTaskIds(prev => prev.filter(id => id !== taskId));
      }, 500);
    } else {
      // Un-completing task - instant
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, is_completed: false, completed_at: null } : t
      ));
      
      if (userId) {
        // ✅ FIX: Load fresh tasks
        const latestTasks = await Storage.get(`tasks_${userId}`) || [];
        const updatedAll = latestTasks.map(t =>
          t.id === taskId ? { ...t, is_completed: false, completed_at: null } : t
        );
        
        await cacheTasks(userId, updatedAll);
        
        syncToSupabase('tasks', 'update',
          { is_completed: false, completed_at: null },
          { column: 'id', value: taskId }
        );
        
        const targetTask = latestTasks.find(t => t.id === taskId);
        let xpAmount = 10;
        if (targetTask) {
          if (targetTask.priority === 3) xpAmount = 50;
          else if (targetTask.priority === 2) xpAmount = 40;
          else if (targetTask.priority === 0) xpAmount = 5;
        }
        await Gamification.addXP(userId, -xpAmount);
      }
    }
  };

  const toggleImportant = async (taskId, currentImportant) => {
    const nextImportant = !currentImportant;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, is_important: nextImportant } : t));

    if (userId) {
      const allTasks = await Storage.get(`tasks_${userId}`);
      if (allTasks) {
        await toggleTaskImportance(userId, allTasks, taskId, currentImportant);
      }
    }
  };

  const handleReschedulePress = (taskId, currentDate) => {
    setRescheduleTaskId(taskId);
    setPendingDate(currentDate ? new Date(currentDate) : new Date());
    setShowRescheduleModal(true);
  };

  const executeReschedule = async (taskId, date) => {
    const dateStr = date.toISOString();
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, due_date: dateStr } : t));

    if (userId) {
      const allTasks = await Storage.get(`tasks_${userId}`);
      if (allTasks) {
        await updateTask(userId, allTasks, taskId, { due_date: dateStr });
      }
    }
    
    setShowRescheduleModal(false);
    setRescheduleTaskId(null);
  };

  const onDatePickerChange = (event, selectedDate) => {
    if (selectedDate) {
      if (Platform.OS === 'android') {
        setShowDatePicker(false);
        executeReschedule(rescheduleTaskId, selectedDate);
      } else {
        setPendingDate(selectedDate);
      }
    } else if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
  };

  const toggleSection = (sectionKey) => {
    setCollapsedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const shareList = async () => {
    setShowMenu(false);
    const planned = tasks.filter(t => t.due_date && (!t.is_completed || completingTaskIds.includes(t.id)));
    if (planned.length === 0) return;
    
    const lines = planned.map((taskItem, i) => {
      let line = `${i + 1}. [${taskItem.is_completed ? 'x' : ' '}] ${taskItem.title}`;
      const extras = [];
      if (taskItem.due_date) extras.push(t('planned.shareDuePrefix', { date: formatDate(taskItem.due_date) }));
      if (taskItem.reminder_time) extras.push(t('planned.shareReminderPrefix', { time: new Date(taskItem.reminder_time).toLocaleTimeString() }));
      if (extras.length > 0) line += ` (${extras.join(' | ')})`;
      return line;
    }).join('\n');
    
    const message = `${t('planned.shareListHeader')}\n\n${lines}`;
    try {
      await Share.share({ message });
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  // Group tasks chronologically
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  const endOfWeek = new Date(todayStart);
  endOfWeek.setDate(todayStart.getDate() + 7);

  const activePlanned = tasks.filter(t => t.due_date && (!t.is_completed || completingTaskIds.includes(t.id)));

  const groups = {
    overdue: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: []
  };

  activePlanned.forEach(t => {
    const d = new Date(t.due_date);
    d.setHours(0, 0, 0, 0);
    const time = d.getTime();

    if (time < todayStart.getTime()) {
      groups.overdue.push(t);
    } else if (time === todayStart.getTime()) {
      groups.today.push(t);
    } else if (time === tomorrowStart.getTime()) {
      groups.tomorrow.push(t);
    } else if (time > tomorrowStart.getTime() && time <= endOfWeek.getTime()) {
      groups.thisWeek.push(t);
    } else {
      groups.later.push(t);
    }
  });

  const renderSectionHeader = (title, count, color, sectionKey) => {
    const isCollapsed = collapsedSections[sectionKey];
    return (
      <TouchableOpacity 
        style={styles.sectionHeader} 
        onPress={() => toggleSection(sectionKey)}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={styles.sectionTitle}>{title}</Text>
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeText}>{count}</Text>
          </View>
        </View>
        {isCollapsed ? (
          <ChevronRight color="#888" size={18} />
        ) : (
          <ChevronDown color="#888" size={18} />
        )}
      </TouchableOpacity>
    );
  };

  const renderTask = (task) => {
    const isOverdue = new Date(task.due_date) < todayStart && !task.is_completed;
    return (
      <PlannedTaskRow
        key={task.id}
        task={task}
        theme={theme}
        todayStart={todayStart}
        isOverdue={isOverdue}
        onToggle={toggleTask}
        onPress={() => navigation.navigate('TaskDetail', { task, userId })}
        onReschedule={() => handleReschedulePress(task.id, task.due_date)}
        onToggleImportant={() => toggleImportant(task.id, task.is_important)}
        formatDate={formatDate}
      />
    );
  };

  const renderSection = (title, list, color, sectionKey) => {
    if (list.length === 0) return null;
    const isCollapsed = collapsedSections[sectionKey];

    return (
      <View style={styles.sectionContainer} key={sectionKey}>
        {renderSectionHeader(title, list.length, color, sectionKey)}
        {!isCollapsed && (
          <View style={styles.sectionBody}>
            {list.map(task => renderTask(task))}
          </View>
        )}
      </View>
    );
  };

  return (
    <BackgroundWrapper>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconBtn}>
            <Menu color={THEME_COLOR} size={26} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(true)} style={styles.iconBtn}>
            <MoreVertical color={THEME_COLOR} size={26} />
          </TouchableOpacity>
        </View>

        <View style={styles.titleContainer}>
          <Text style={styles.headerTitle}>{t('planned.title')}</Text>
        </View>

        {/* 3-Dots Menu Overlay */}
        {showMenu && (
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
            <View style={[styles.menuCard, { top: Math.max(insets.top, 20) + 50 }]}>
              <TouchableOpacity style={styles.menuItem} onPress={shareList}>
                <Text style={styles.menuText}>{t('planned.printOrSendCopy')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}

        {/* List Content */}
        {!isCacheLoaded ? (
          <View style={{ marginTop: 16, paddingHorizontal: 16 }}>
            <SkeletonTask />
            <SkeletonTask />
            <SkeletonTask />
            <SkeletonTask />
          </View>
        ) : activePlanned.length === 0 ? (
          <View style={styles.emptyState}>
            <CalendarDays color="#333" size={60} style={{ marginBottom: 16 }} />
            <Text style={styles.emptyText}>{t('planned.emptyTitle')}</Text>
            <Text style={styles.emptySub}>{t('planned.emptySubtitle')}</Text>
          </View>
        ) : (
          <ScrollView 
            style={{ flex: 1 }} 
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            {renderSection(t('planned.sectionOverdue'), groups.overdue, '#A1A1AA', 'overdue')}
            {renderSection(t('planned.sectionToday'), groups.today, '#FFFFFF', 'today')}
            {renderSection(t('planned.sectionTomorrow'), groups.tomorrow, '#E4E4E7', 'tomorrow')}
            {renderSection(t('planned.sectionThisWeek'), groups.thisWeek, '#a1a1aa', 'thisWeek')}
            {renderSection(t('planned.sectionLater'), groups.later, '#4b5563', 'later')}
          </ScrollView>
        )}

        {/* Reschedule Modal (Sleek Dark Bottom Sheet) */}
        {showRescheduleModal && (
          <Modal transparent animationType="slide" visible={showRescheduleModal} onRequestClose={() => setShowRescheduleModal(false)}>
            <TouchableOpacity style={styles.rescheduleOverlay} activeOpacity={1} onPress={() => setShowRescheduleModal(false)}>
              <View style={styles.rescheduleSheet}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>{t('planned.rescheduleModalTitle')}</Text>

                <TouchableOpacity 
                  style={styles.sheetOption} 
                  onPress={() => executeReschedule(rescheduleTaskId, new Date())}
                >
                  <Calendar color="#FFFFFF" size={20} />
                  <Text style={styles.sheetOptionText}>{t('planned.sheetOptionToday')}</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.sheetOption} 
                  onPress={() => executeReschedule(rescheduleTaskId, new Date(Date.now() + 86400000))}
                >
                  <CalendarDays color="#9CA3AF" size={20} />
                  <Text style={styles.sheetOptionText}>{t('planned.sheetOptionTomorrow')}</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.sheetOption} 
                  onPress={() => setShowDatePicker(true)}
                >
                  <CalendarClock color="#A1A1AA" size={20} />
                  <Text style={styles.sheetOptionText}>{t('planned.sheetOptionPickDate')}</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.sheetOption, styles.cancelBtn]} 
                  onPress={() => setShowRescheduleModal(false)}
                >
                  <Text style={styles.cancelText}>{t('planned.sheetOptionCancel')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>
        )}

        {/* Date Picker Modal for Rescheduling */}
        {showDatePicker && (
          <Modal transparent animationType="slide" visible={showDatePicker}>
            <View style={styles.pickerModalOverlay}>
              <View style={styles.pickerModalContent}>
                <View style={styles.pickerHeader}>
                  <Text style={styles.pickerTitle}>{t('planned.pickerTitle')}</Text>
                  <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                    <X color="#fff" size={24} />
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={pendingDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant="dark"
                  minimumDate={new Date()}
                  onChange={onDatePickerChange}
                  style={{ width: '100%' }}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity 
                    style={styles.pickerDoneBtn} 
                    onPress={() => {
                      executeReschedule(rescheduleTaskId, pendingDate);
                      setShowDatePicker(false);
                    }}
                  >
                    <Text style={styles.pickerDoneText}>{t('planned.doneButton')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Modal>
        )}

        {/* Sidebar */}
        <GlassSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          profile={profile}
          handleLogout={() => {
            navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
            supabase.auth.signOut();
          }}
          navigation={navigation}
          currentRoute="Planned"
        />
      </SafeAreaView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 48,
  },
  iconBtn: { padding: 8 },
  titleContainer: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  headerTitle: {
    fontFamily: 'PlaywriteGBJ_400Regular',
    fontSize: 28,
    color: '#FFFFFF',
    fontWeight: '400',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionContainer: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionBadge: {
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 10,
  },
  sectionBadgeText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionBody: {
    marginTop: 8,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(24, 24, 27, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 12,
    marginBottom: 8,
  },
  taskCardCompleted: {
    borderColor: 'transparent',
    backgroundColor: 'rgba(24, 24, 27, 0.3)',
  },
  checkbox: {
    marginRight: 12,
    alignSelf: 'flex-start',
    marginTop: 0,
  },
  taskContent: {
    flex: 1,
    paddingRight: 8,
  },
  taskTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  taskCompletedText: {
    color: '#888888',
  },
  taskMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
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
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reschedulePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(161, 161, 170, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(161, 161, 170, 0.25)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 4,
  },
  rescheduleText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginBottom: 80,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySub: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  menuOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  menuCard: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#1E1E1E',
    borderRadius: 14,
    padding: 8,
    borderWidth: 1,
    borderColor: '#333',
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  menuText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  // Reschedule Bottom Sheet
  rescheduleOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  rescheduleSheet: {
    backgroundColor: '#121212',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#27272A',
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 12,
    gap: 14,
  },
  sheetOptionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelBtn: {
    borderColor: 'transparent',
    marginTop: 8,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  // Picker modals
  pickerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  pickerModalContent: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pickerTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
  },
  pickerDoneBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
  },
  pickerDoneText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
});

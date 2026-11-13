import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowUp, Bell, Calendar, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, FileText, Flag, GripVertical, ListChecks, Menu, MoreVertical, Plus, Repeat, Share2, Star, Sun, Trash2, Users, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, BackHandler, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { NestableDraggableFlatList, NestableScrollContainer, ScaleDecorator } from 'react-native-draggable-flatlist';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIAuraOverlay } from '../components/AIAuraOverlay';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassSidebar } from '../components/GlassSidebar';
import { LevelUpModal } from '../components/LevelUpModal';
import { ScribbleStrike } from '../components/ScribbleStrike';
import { ActivityTimeline, AvatarStack, ConflictSheet, ShareListSheet, SyncStatusStrip } from '../components/collaboration';
import { getPriorityColor, PRIORITY_CONFIG, shouldShowFlag } from '../config/priorityConfig';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { useWidgetTaskSync } from '../hooks/useWidgetTaskSync';
import { loadCollaboration, loadSpaceActivity, loadSpaceDetail, refreshCollaboration } from '../lib/collaborationManager';
import { addTask as dmAddTask, cacheTasks, deleteList, deleteTask as dmDeleteTask, getCurrentUserId, getCurrentUserIdSync, getTasksSync, loadLists, loadProfile, loadTasks, renameList, reorderTasks, toggleTaskCompletion, toggleTaskImportance, updateTask } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';
import { cancelTaskReminder, scheduleTaskReminder } from '../utils/notifications';
import { savePlanForToday } from '../utils/planStore';
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
const sameId = (left, right) => left != null && right != null && String(left) === String(right);

const SkeletonTask = () => {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);
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


const memberIdentity = (member = {}) => member.profile || member.profiles || member;
const memberId = (member) => member?.user_id || member?.id;
const memberName = (member) => {
  const identity = memberIdentity(member);
  return identity.display_name || identity.displayName || identity.username || identity.email || 'Member';
};
const memberInitials = (member) => memberName(member)
  .trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';

// Extracted + memoized so dragging/toggling one row doesn't force React to
// rebuild every other row's JSX tree from scratch on each render.
const CustomListTaskRow = memo(function CustomListTaskRow({ task, theme, members = [], isReadOnly = false, isCompleting, drag, isActive, onPress, onToggle, onToggleToday, onToggleImportant, onDelete }) {
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const hasNotes = task.notes && task.notes.trim().length > 0;
  const hasMeta = task.due_date || task.reminder_time || task.repeat_rule || hasSubtasks || hasNotes || task.space_id;
  const assignee = members.find((member) => sameId(memberId(member), task.assigned_to));
  const syncError = task._sync_status === 'error' || task._sync_status === 'failed'
    ? task._sync_error?.message || task.sync_error || task.error || 'Sync error'
    : null;
  const syncText = task._sync_status === 'pending' ? 'Pending sync' : syncError;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const isOverdue = task.due_date && new Date(task.due_date) < todayStart && !task.is_completed;
  const completedSubs = hasSubtasks ? task.subtasks.filter(s => s.is_completed).length : 0;
  const totalSubs = hasSubtasks ? task.subtasks.length : 0;

  return (
    <ScaleDecorator>
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={onPress}
        onLongPress={isReadOnly ? undefined : drag}
        disabled={isActive}
        accessibilityRole="button"
        accessibilityLabel={`${task.title}${isReadOnly ? ', read only' : ''}`}
        accessibilityHint={isReadOnly ? 'Task changes are disabled for viewers.' : 'Opens task details.'}
        accessibilityState={{ disabled: isReadOnly, busy: isCompleting }}
        style={[
          styles.taskCard,
          theme?.surface && { backgroundColor: theme.surface },
          task.is_important && styles.taskCardImportant,
          task.is_completed && styles.taskCardCompleted,
          isActive && { backgroundColor: 'rgba(255,255,255,0.08)', elevation: 12 }
        ]}>

        {/* Left: drag handle + checkbox */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {!task.is_completed && !isCompleting && !isReadOnly && (
            <TouchableOpacity onPressIn={drag} style={{ padding: 4, marginRight: 2 }} accessibilityLabel="Reorder task">
              <GripVertical color="#71717A" size={20} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={onToggle}
            disabled={isCompleting || isReadOnly}
            accessibilityRole="checkbox"
            accessibilityLabel={`${task.is_completed ? 'Mark incomplete' : 'Mark complete'}: ${task.title}`}
            accessibilityState={{ checked: Boolean(task.is_completed), disabled: isReadOnly, busy: isCompleting }}
            style={[
              styles.checkbox,
              (task.is_completed || isCompleting || isReadOnly) && { marginLeft: 28 }
            ]}
          >
            {(task.is_completed || isCompleting) ? (
              <CheckCircle2 color="#34D399" size={24} />
            ) : (
              <Circle color={theme.text} size={24} />
            )}
          </TouchableOpacity>
        </View>

        {/* Center: title + meta */}
        <View style={styles.taskContent}>
          <ScribbleStrike isCompleted={task.is_completed || isCompleting} shouldAnimate={isCompleting} color={theme.textMuted}>
            <Text
              style={[
                styles.taskTitle,
                { color: isCompleting ? '#666' : (task.is_completed ? '#666' : '#fff') },
                (task.is_completed || isCompleting) && styles.taskCompleted,
              ]}
            >
              {task.title}
            </Text>
          </ScribbleStrike>

          {hasMeta && (
            <View style={styles.taskMetaRow}>
              {shouldShowFlag(task.priority) && (
                <View style={styles.metaPill}>
                  <Flag color={getPriorityColor(task.priority)} size={11} fill={getPriorityColor(task.priority)} />
                </View>
              )}
              {task.due_date && (
                <View style={styles.metaPill}>
                  <Calendar color={isOverdue ? '#FB7185' : '#888'} size={11} />
                  <Text style={[styles.metaLabel, isOverdue && { color: '#FB7185' }]}>
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
              {task.space_id && (
                <View style={styles.assigneeMeta} accessibilityLabel={task.assigned_to ? `Assigned to ${assignee ? memberName(assignee) : 'member'}` : 'Unassigned'}>
                  <View style={styles.assigneeAvatar}>
                    <Text style={styles.assigneeInitials}>{assignee ? memberInitials(assignee) : '—'}</Text>
                  </View>
                  <Text numberOfLines={1} style={styles.assigneeName}>{assignee ? memberName(assignee) : 'Unassigned'}</Text>
                </View>
              )}
              {syncText ? (
                <Text accessibilityLiveRegion="polite" style={[styles.taskSyncText, syncError && styles.taskSyncError]}>{syncText}</Text>
              ) : null}
            </View>
          )}
        </View>

        {/* Right: star + delete + My Day */}
        <View style={styles.taskActions}>
          <TouchableOpacity onPress={onToggleToday} disabled={isReadOnly} accessibilityRole="button" accessibilityLabel="Toggle My Day" accessibilityState={{ disabled: isReadOnly }} style={[styles.iconButtonSmall, isReadOnly && styles.mutationDisabled]}>
            <Sun
              color={task.added_to_today ? '#FBBF24' : '#71717A'}
              fill={task.added_to_today ? '#FBBF24' : 'transparent'}
              size={18}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggleImportant} disabled={isReadOnly} accessibilityRole="button" accessibilityLabel="Toggle important" accessibilityState={{ disabled: isReadOnly }} style={[styles.iconButtonSmall, isReadOnly && styles.mutationDisabled]}>
            <Star
              color={task.is_important ? '#FFFFFF' : '#71717A'}
              fill={task.is_important ? '#FFFFFF' : 'transparent'}
              size={18}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} disabled={isReadOnly} accessibilityRole="button" accessibilityLabel="Delete task" accessibilityState={{ disabled: isReadOnly }} style={[styles.iconButtonSmall, isReadOnly && styles.mutationDisabled]}>
            <Trash2 color="#71717A" size={18} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </ScaleDecorator>
  );
});

export const CustomListScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { listId, listName, spaceId: routeSpaceId } = route?.params || {};

  const [localListName, setLocalListName] = useState(listName || t('customList.defaultListName'));
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameText, setRenameText] = useState(listName || '');

  useAppTheme();
  // Force dark theme only
  const theme = COLORS.dark;
  const insets = useSafeAreaInsets();

  // ─── Core State ───────────────────────────────────────
  const [userId, setUserId] = useState(null);
  const [tasks, setTasks] = useState(() => getTasksSync(getCurrentUserIdSync()) || []);
  const latestTasksRef = useRef(tasks);
  useEffect(() => {
    latestTasksRef.current = tasks;
  }, [tasks]);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [profile, setProfile] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showAura, setShowAura] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [activeToolbarMenu, setActiveToolbarMenu] = useState(null);

  const [collaboration, setCollaboration] = useState({ spaces: [], members: {}, lists: [] });
  const [activity, setActivity] = useState([]);
  const [collaborationCacheResolved, setCollaborationCacheResolved] = useState(false);
  const [activeSharedTab, setActiveSharedTab] = useState('tasks');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [showConflictSheet, setShowConflictSheet] = useState(false);

  const currentList = useMemo(
    () => (collaboration.lists || []).find((list) => sameId(list?.id, listId)) || null,
    [collaboration.lists, listId],
  );
  const resolvedSpaceId = routeSpaceId || currentList?.space_id
    || tasks.find((task) => sameId(task?.list_id, listId) && task?.space_id)?.space_id
    || null;
  const isSharedList = resolvedSpaceId != null && String(resolvedSpaceId).length > 0;
  const currentSpace = useMemo(
    () => (collaboration.spaces || []).find((space) => sameId(space?.id, resolvedSpaceId))
      || (isSharedList ? { id: resolvedSpaceId, name: 'Shared space' } : null),
    [collaboration.spaces, isSharedList, resolvedSpaceId],
  );
  const sharedMembers = useMemo(
    () => (isSharedList ? collaboration.members?.[String(resolvedSpaceId)] || [] : []),
    [collaboration.members, isSharedList, resolvedSpaceId],
  );
  const currentMembership = sharedMembers.find((member) => sameId(memberId(member), userId));
  const currentRole = String(currentMembership?.role || '').toLowerCase();
  // Shared mutations are enabled only from the cached/server member directory.
  // Route params can be stale or crafted and therefore never grant write access.
  const isViewer = isSharedList && !['owner', 'editor'].includes(currentRole);

  const applyCollaboration = useCallback((incoming) => {
    if (!incoming || typeof incoming !== 'object') return;
    const incomingLists = Array.isArray(incoming.lists) ? incoming.lists : [];
    const sharedList = incomingLists.find((list) => sameId(list?.id, listId));
    const candidateSpaceId = routeSpaceId || sharedList?.space_id || null;
    setCollaboration((previous) => ({
      spaces: Array.isArray(incoming.spaces) ? incoming.spaces : previous.spaces,
      members: incoming.members && typeof incoming.members === 'object' ? incoming.members : previous.members,
      lists: incomingLists.length ? incomingLists : previous.lists,
    }));
    if (sharedList?.name) setLocalListName(sharedList.name);
    if (candidateSpaceId && Array.isArray(incoming.tasks)) {
      setTasks(incoming.tasks);
    }
    if (candidateSpaceId && incoming.activity && typeof incoming.activity === 'object') {
      setActivity(incoming.activity[String(candidateSpaceId)] || []);
    }
    setCollaborationCacheResolved(true);
  }, [listId, routeSpaceId]);

  // Widget → app sync: reflect widget task toggles on resume / while foregrounded.
  useWidgetTaskSync(userId, (fresh) => setTasks(fresh));
  const [levelUpData, setLevelUpData] = useState(null);
  const completingTimeouts = useRef({});
  const [showCompleted, setShowCompleted] = useState(true);
  const [completingTaskIds, setCompletingTaskIds] = useState([]);

  // ─── New Task Metadata ────────────────────────────────
  const [pendingDueDate, setPendingDueDate] = useState(null);
  const [pendingReminder, setPendingReminder] = useState(null);
  const [pendingRepeatRule, setPendingRepeatRule] = useState(null);
  const [pendingPriority, setPendingPriority] = useState(1);

  // ─── Keyboard state for Android fallback ──────────────
  const [, setAndroidKeyboardHeight] = useState(0);

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
  // Seeded from the synchronous warm cache: a returning navigation has real
  // rows on the first frame, so the skeletons no longer flash before content.
  const [isCacheLoaded, setIsCacheLoaded] = useState(() => !!getTasksSync(getCurrentUserIdSync()));
  
  useEffect(() => {
    const init = async () => {
      const resolvedUserId = await getCurrentUserId();
      if (!resolvedUserId) return;
      setUserId(resolvedUserId);

      // Load collaboration and personal caches concurrently. Collaboration owns
      // shared list/space/member/task I/O and refreshes silently in the background.
      const [cachedProfile, cachedSort, cachedTasks, cachedPlan, cachedPlanDate, cachedCollaboration] = await Promise.all([
        loadProfile(resolvedUserId, (fresh) => setProfile(fresh)),
        Storage.get(`sortBy_custom_${listId}`),
        loadTasks(resolvedUserId, (fresh) => {
          if (Array.isArray(fresh)) setTasks(fresh);
          setIsCacheLoaded(true);
        }),
        Storage.get(`generated_plan_${resolvedUserId}`),
        Storage.get(`generated_plan_date_${resolvedUserId}`),
        loadCollaboration(resolvedUserId, applyCollaboration),
      ]);

      applyCollaboration(cachedCollaboration);

      if (cachedProfile) setProfile(cachedProfile);
      if (cachedSort) setSortBy(cachedSort);
      setIsSortLoaded(true);
      
      // Restore saved plan so it survives app restarts, but wipe it if it's from a previous day
      const todayString = new Date().toDateString();
      if (cachedPlan && cachedPlanDate === todayString) {
        setGeneratedPlan(cachedPlan);
      } else if (cachedPlan) {
        Storage.remove(`generated_plan_${resolvedUserId}`);
        Storage.remove(`generated_plan_date_${resolvedUserId}`);
      }
      
      if (cachedTasks) {
        setTasks(cachedTasks);
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
  }, [applyCollaboration, listId]);

  useEffect(() => {
    if (!userId || !isSharedList || resolvedSpaceId == null) return undefined;
    let active = true;
    const applyDetail = (detail) => {
      if (!active || !detail) return;
      setCollaboration((previous) => ({
        spaces: detail.space
          ? [detail.space, ...previous.spaces.filter((space) => String(space?.id) !== String(detail.space.id))]
          : previous.spaces,
        members: { ...previous.members, [String(resolvedSpaceId)]: detail.members || [] },
        lists: Array.isArray(detail.lists)
          ? [...previous.lists.filter((list) => String(list?.space_id) !== String(resolvedSpaceId)), ...detail.lists]
          : previous.lists,
      }));
      if (Array.isArray(detail.tasks)) {
        setTasks((previous) => [
          ...previous.filter((task) => String(task?.space_id) !== String(resolvedSpaceId)),
          ...detail.tasks,
        ]);
        setIsCacheLoaded(true);
      }
      const detailList = detail.lists?.find((list) => sameId(list?.id, listId));
      if (detailList?.name) setLocalListName(detailList.name);
    };
    loadSpaceDetail(userId, resolvedSpaceId, applyDetail).then(applyDetail).catch(() => {});
    loadSpaceActivity(userId, resolvedSpaceId, (fresh) => {
      if (active) setActivity(fresh || []);
    }).then((cached) => {
      if (active) setActivity(cached || []);
    }).catch(() => {});
    return () => { active = false; };
  }, [isSharedList, listId, resolvedSpaceId, userId]);

  const refreshSharedWorkspace = useCallback(async (spaceIdOverride = null) => {
    if (!userId) return null;
    const fresh = await refreshCollaboration(userId);
    applyCollaboration(fresh);
    const refreshedList = (fresh?.lists || []).find((list) => sameId(list?.id, listId));
    const targetSpaceId = spaceIdOverride || routeSpaceId || refreshedList?.space_id || resolvedSpaceId;
    if (targetSpaceId != null) {
      setActivity(fresh?.activity?.[String(targetSpaceId)] || []);
    }
    return fresh;
  }, [applyCollaboration, listId, resolvedSpaceId, routeSpaceId, userId]);

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

  // Save this custom list's sort preference independently.
  useEffect(() => {
    if (isSortLoaded) {
      Storage.set(`sortBy_custom_${listId}`, sortBy);
    }
  }, [sortBy, isSortLoaded, listId]);

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

  const matchesAssigneeFilter = (task) => {
    if (!isSharedList || assigneeFilter === 'all') return true;
    if (assigneeFilter === 'mine') return sameId(task.assigned_to, userId);
    return task.assigned_to == null || task.assigned_to === '';
  };

  // ─── Sorting — only active tasks for draggable list ──
  const todayStr = new Date().toDateString();

  const getSortedActiveTasks = () => {
    // Keep task in active list while its scribble animation is playing.
    const active = tasks.filter((task) => sameId(task.list_id, listId)
      && matchesAssigneeFilter(task)
      && (!task.is_completed || completingTaskIds.some((id) => sameId(id, task.id))));
    const sortGroup = (arr) => {
      const s = [...arr];
      switch (sortBy) {
        case 'importance':
          s.sort((a, b) => {
            const pa = a.priority ?? 1;
            const pb = b.priority ?? 1;
            if (pb !== pa) return pb - pa;
            return (b.is_important ? 1 : 0) - (a.is_important ? 1 : 0);
          });
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
    const active = tasks.filter((task) => sameId(task.list_id, listId)
      && matchesAssigneeFilter(task)
      && (!task.is_completed || completingTaskIds.some((id) => sameId(id, task.id))));
    const completed = tasks.filter((task) => sameId(task.list_id, listId)
      && matchesAssigneeFilter(task)
      && task.is_completed
      && !completingTaskIds.some((id) => sameId(id, task.id)));
    const sortGroup = (arr) => {
      const s = [...arr];
      switch (sortBy) {
        case 'importance':
          s.sort((a, b) => {
            const pa = a.priority ?? 1;
            const pb = b.priority ?? 1;
            if (pb !== pa) return pb - pa;
            return (b.is_important ? 1 : 0) - (a.is_important ? 1 : 0);
          });
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
  const completedTodayTasks = tasks.filter((task) => {
    if (!sameId(task.list_id, listId) || !matchesAssigneeFilter(task)) return false;
    if (!task.is_completed) return false;
    const completedDate = task.completed_at ? new Date(task.completed_at).toDateString() : null;
    return completedDate === todayStr;
  });

  // Clear completed handler
  const handleClearCompleted = async () => {
    setIsMenuOpen(false);
    if (isViewer) return;
    const currentTasks = latestTasksRef.current;
    const completed = currentTasks.filter((task) => sameId(task.list_id, listId) && task.is_completed);
    if (completed.length === 0 || !userId) return;
    // Pass each result into the next deletion so unrelated lists and prior
    // deletions remain intact in both React state and the shared cache.
    let evolvingTasks = currentTasks;
    for (const task of completed) {
      evolvingTasks = await dmDeleteTask(userId, evolvingTasks, task.id);
    }
    latestTasksRef.current = evolvingTasks;
    setTasks(evolvingTasks);
  };

  // ─── Print / Share ────────────────────────────────────
  const handlePrintList = async () => {
    setIsMenuOpen(false);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const lines = getSortedTasks().map(taskItem => {
      const status = taskItem.is_completed ? '✅' : (taskItem.is_important ? '⭐' : '⬜');
      let line = `${status} ${taskItem.title}`;
      if (taskItem.due_date)      line += `\n   📅 ${t('customList.shareDuePrefix', { date: formatDate(taskItem.due_date) })}`;
      if (taskItem.reminder_time) line += `\n   🔔 ${t('customList.shareRemindPrefix', { datetime: formatDateTime(taskItem.reminder_time) })}`;
      if (taskItem.repeat_rule)   line += `\n   🔁 ${t('customList.shareRepeatPrefix', { rule: taskItem.repeat_rule })}`;
      return line;
    });
    const message = `📋 ${t('customList.shareHeader', { date: today })}\n${'─'.repeat(32)}\n\n${lines.join('\n\n')}`;
    try {
      await Share.share({ message, title: t('customList.shareTitle', { date: today }) });
    } catch (e) {
      console.log('Share error', e);
    }
  };

  const SORT_LABELS = {
    created_at: null,
    importance: t('customList.sortByImportance'),
    due_date: t('customList.sortByDueDate'),
    alphabetical: t('customList.sortAlphabetical'),
  };

  const handleDeleteList = () => {
    setIsMenuOpen(false);
    if (isViewer || isSharedList) return;
    Alert.alert(
      t('customList.deleteListAlertTitle'),
      t('customList.deleteListAlertMessage', { listName: localListName }),
      [
        { text: t('common.cancel'), style: "cancel" },
        { 
          text: t('customList.deleteButton'), 
          style: "destructive",
          onPress: async () => {
            if (userId) {
              const lists = await loadLists(userId);
              await deleteList(userId, lists || [], listId);
              // Optimistically delete tasks for this list locally/remote. Each
              // call receives the prior result so the deletion set evolves.
              const tasksToDelete = latestTasksRef.current.filter((task) => sameId(task.list_id, listId));
              let evolvingTasks = latestTasksRef.current;
              for (const task of tasksToDelete) {
                evolvingTasks = await dmDeleteTask(userId, evolvingTasks, task.id);
              }
              latestTasksRef.current = evolvingTasks;
              setTasks(evolvingTasks);
              navigation.replace('Dashboard');
            }
          }
        }
      ]
    );
  };

  const handleRenameList = async () => {
    if (isViewer) return;
    const nextName = renameText.trim();
    if (!nextName) {
      setShowRenameModal(false);
      return;
    }
    if (userId) {
      const lists = await loadLists(userId);
      const renameSource = (lists || []).map((list) => (
        isSharedList && sameId(list.id, listId)
          ? { ...list, space_id: list.space_id || resolvedSpaceId }
          : list
      ));
      const updatedLists = await renameList(userId, renameSource, listId, nextName);
      setCollaboration((previous) => ({ ...previous, lists: updatedLists || previous.lists }));
      setLocalListName(nextName);
    }
    setShowRenameModal(false);
  };

  // ─── CRUD ─────────────────────────────────────────────
  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !userId || isViewer) return;

    const taskData = {
      title: newTaskTitle.trim(),
      due_date: pendingDueDate ? pendingDueDate.toISOString() : null,
      reminder_time: pendingReminder ? pendingReminder.toISOString() : null,
      repeat_rule: pendingRepeatRule,
      priority: pendingPriority,
      list_id: listId,
      ...(isSharedList ? { space_id: resolvedSpaceId } : {}),
    };

    // DataManager owns both personal and shared optimistic/cache paths. Shared
    // tasks are delegated to CollaborationManager and never use direct table sync.
    const newTasks = await dmAddTask(userId, latestTasksRef.current, taskData, (synced, realTask) => {
      latestTasksRef.current = synced;
      setTasks(synced);
      if (realTask.reminder_time && !realTask.space_id) {
        scheduleTaskReminder(realTask.id, realTask.title, realTask.reminder_time);
      }
    });
    latestTasksRef.current = newTasks;
    setTasks(newTasks);

    setNewTaskTitle('');
    setPendingDueDate(null);
    setPendingReminder(null);
    setPendingRepeatRule(null);
    setPendingPriority(1);
    setActiveToolbarMenu(null);
    setIsAddingTask(false);
  };

  const applyPersonalCompletionRewards = async (task, isCompleting, updatedTasks) => {
    // Shared completion accounting is server-authoritative, including XP.
    if (!task || isSharedList || task.space_id) return updatedTasks;
    const xpAmount = task.xp_awarded != null ? task.xp_awarded : Gamification.xpForTask(task);
    const rewardedTasks = updatedTasks.map((item) => sameId(item.id, task.id)
      ? { ...item, xp_awarded: isCompleting ? xpAmount : null }
      : item);
    await cacheTasks(userId, rewardedTasks);
    if (isCompleting) {
      const oldState = await Gamification.checkStreak(userId);
      const newState = await Gamification.addXP(userId, xpAmount);
      if (newState && newState.level > (oldState?.level || 1)) {
        setLevelUpData({ oldLevel: oldState?.level || 1, newLevel: newState.level });
      }
    } else {
      await Gamification.addXP(userId, -xpAmount);
    }
    return rewardedTasks;
  };

  const toggleTask = async (id, currentStatus) => {
    if (!userId || isViewer) return;
    const isCompleting = !currentStatus;

    if (isCompleting) {
      // Preserve the scribble animation, then hand the actual mutation to the
      // data layer so shared idempotency and completion accounting stay central.
      setCompletingTaskIds((previous) => [...previous, id]);
      completingTimeouts.current[id] = setTimeout(async () => {
        const taskBefore = latestTasksRef.current.find((item) => sameId(item.id, id));
        let updated = await toggleTaskCompletion(userId, latestTasksRef.current, id, currentStatus);
        latestTasksRef.current = updated;
        setTasks(updated);
        updated = await applyPersonalCompletionRewards(taskBefore, true, updated);
        latestTasksRef.current = updated;
        setTasks(updated);
        setCompletingTaskIds((previous) => previous.filter((taskId) => !sameId(taskId, id)));
        delete completingTimeouts.current[id];
        const task = updated.find((item) => sameId(item.id, id));
        if (task?.reminder_time && !task.space_id) cancelTaskReminder(id);
      }, 800);
      return;
    }

    if (completingTimeouts.current[id]) {
      clearTimeout(completingTimeouts.current[id]);
      delete completingTimeouts.current[id];
      // The completion mutation/XP award had not fired yet, so cancellation is
      // purely local and must not deduct personal XP or enqueue a false update.
      setCompletingTaskIds((previous) => previous.filter((taskId) => !sameId(taskId, id)));
      return;
    }
    setCompletingTaskIds((previous) => previous.filter((taskId) => !sameId(taskId, id)));
    const taskBefore = latestTasksRef.current.find((item) => sameId(item.id, id));
    let updated = await toggleTaskCompletion(userId, latestTasksRef.current, id, currentStatus);
    latestTasksRef.current = updated;
    setTasks(updated);
    updated = await applyPersonalCompletionRewards(taskBefore, false, updated);
    latestTasksRef.current = updated;
    setTasks(updated);
    const task = updated.find((item) => sameId(item.id, id));
    if (task?.reminder_time && !task.space_id) {
      scheduleTaskReminder(id, task.title, task.reminder_time);
    }
  };

  const toggleImportant = async (id, currentStatus) => {
    if (isViewer) return;
    const updated = await toggleTaskImportance(userId, latestTasksRef.current, id, currentStatus);
    latestTasksRef.current = updated;
    setTasks(updated);
  };

  const deleteTaskHandler = async (id) => {
    if (isViewer) return;
    const target = latestTasksRef.current.find((task) => sameId(task.id, id));
    if (!target?.space_id) cancelTaskReminder(id);
    const updated = await dmDeleteTask(userId, latestTasksRef.current, id);
    latestTasksRef.current = updated;
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

  // ─── In-list drag/reorder ─────────────────────────────
  const handleCustomListDragEnd = ({ data }) => {
    if (isViewer) return;
    requestAnimationFrame(() => {
      if (sortBy !== 'custom') setSortBy('custom');
      const orderMap = new Map(data.map((task, index) => [String(task.id), index]));
      const mergedTasks = latestTasksRef.current.map((task) => (
        orderMap.has(String(task.id))
          ? { ...task, order_index: orderMap.get(String(task.id)) }
          : task
      ));
      latestTasksRef.current = mergedTasks;
      setTasks(mergedTasks);
      // Preserve space_id/version metadata so DataManager delegates shared
      // reorder operations to CollaborationManager instead of personal sync.
      const changedTasks = data.map((task, index) => ({ ...task, order_index: index }));
      reorderTasks(userId, mergedTasks, changedTasks);
    });
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
                  { key: 'importance', label: t('customList.menuSortByImportance') },
                  { key: 'due_date',   label: t('customList.menuSortByDueDate') },
                  { key: 'alphabetical', label: t('customList.menuSortAlphabetically') },
                  { key: 'created_at', label: t('customList.menuSortByCreationDate') },
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
                  <Text style={[styles.dropdownText, { color: '#fff' }]}>{t('customList.shareOrPrintList')}</Text>
                </TouchableOpacity>
                {!isSharedList ? (
                  <TouchableOpacity
                    style={styles.dropdownItem}
                    onPress={() => { setIsMenuOpen(false); setShowShareSheet(true); }}
                    accessibilityRole="button"
                    accessibilityLabel="Share list with people"
                  >
                    <Text style={[styles.dropdownText, { color: '#fff' }]}>Share with people</Text>
                    <Share2 color="#D4D4D8" size={16} />
                  </TouchableOpacity>
                ) : null}
                {completedTodayTasks.length > 0 && !isViewer && (
                  <>
                    <View style={[styles.divider, { backgroundColor: '#444' }]} />
                    <TouchableOpacity style={styles.dropdownItem} onPress={handleClearCompleted}>
                      <Text style={[styles.dropdownText, { color: '#ff4b4b' }]}>{t('customList.clearCompleted')}</Text>
                    </TouchableOpacity>
                  </>
                )}
                <View style={[styles.divider, { backgroundColor: '#444' }]} />
                <TouchableOpacity
                  style={[styles.dropdownItem, isViewer && styles.mutationDisabled]}
                  disabled={isViewer}
                  accessibilityState={{ disabled: isViewer }}
                  onPress={() => { setIsMenuOpen(false); setRenameText(localListName); setShowRenameModal(true); }}
                >
                  <Text style={[styles.dropdownText, { color: '#fff' }]}>{t('customList.renameListLabel')}</Text>
                </TouchableOpacity>
                {!isSharedList ? (
                  <TouchableOpacity style={styles.dropdownItem} onPress={handleDeleteList}>
                    <Text style={[styles.dropdownText, { color: '#FB7185' }]}>{t('customList.deleteListLabel')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>
        </View>
        </View>

        {/* Title + active sort badge */}
        <View style={styles.titleContainer}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={[styles.title, { color: '#fff' }]}>{localListName.toUpperCase()}</Text>
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

        {isSharedList ? (
          <View style={styles.sharedPanel}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setShowConflictSheet(true)}
              accessibilityRole="button"
              accessibilityLabel="Open shared sync details"
              style={styles.syncStatusButton}
            >
              <SyncStatusStrip spaceId={resolvedSpaceId} />
            </TouchableOpacity>
            <View style={styles.sharedSummaryRow}>
              <TouchableOpacity
                activeOpacity={0.72}
                onPress={() => setShowShareSheet(true)}
                accessibilityRole="button"
                accessibilityLabel={`View members and access. ${sharedMembers.length} member${sharedMembers.length === 1 ? '' : 's'}.`}
                accessibilityHint={currentRole === 'owner' ? 'View people, roles, invitations, and owner controls.' : 'View everyone in this shared space and what each role can do.'}
                style={styles.sharedIdentity}
              >
                <AvatarStack members={sharedMembers} size={26} max={4} />
                <Text numberOfLines={1} style={styles.sharedSpaceName}>{currentSpace?.name || 'Shared space'}</Text>
                {currentRole ? <Text style={styles.roleLabel}>{String(currentRole).toUpperCase()}</Text> : null}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowShareSheet(true)}
                accessibilityRole="button"
                accessibilityLabel={`View members and access. ${sharedMembers.length} member${sharedMembers.length === 1 ? '' : 's'}.`}
                accessibilityHint={currentRole === 'owner' ? 'You can manage people and invitations.' : 'Member management is available only to the owner.'}
                style={styles.shareButton}
              >
                <Users color="#D4D4D8" size={15} />
                <Text style={styles.shareButtonText}>People · {sharedMembers.length}</Text>
              </TouchableOpacity>
            </View>
            {isViewer ? (
              <Text accessibilityRole="text" style={styles.viewerNotice}>Viewer access · task and list changes are disabled</Text>
            ) : null}
            <View style={styles.segmentedControl} accessibilityRole="tablist">
              {['tasks', 'activity'].map((tab) => (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setActiveSharedTab(tab)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeSharedTab === tab }}
                  style={[styles.segment, activeSharedTab === tab && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, activeSharedTab === tab && styles.segmentTextActive]}>{tab === 'tasks' ? 'Tasks' : 'Activity'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {activeSharedTab === 'tasks' ? (
              <View style={styles.filterRow} accessibilityRole="radiogroup">
                {[['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned']].map(([value, label]) => (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setAssigneeFilter(value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: assigneeFilter === value }}
                    style={[styles.filterChip, assigneeFilter === value && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterText, assigneeFilter === value && styles.filterTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'} 
          style={styles.container}
        >

          {/* Task list / shared activity */}
          {isSharedList && activeSharedTab === 'activity' ? (
            <ScrollView style={styles.activityScroll} contentContainerStyle={styles.activityContent} showsVerticalScrollIndicator={false}>
              <ActivityTimeline items={activity} members={sharedMembers} />
            </ScrollView>
          ) : !isCacheLoaded && !(isSharedList && collaborationCacheResolved) ? (
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
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('customList.emptyTasksMessage')}</Text>
                </View>
              ) : null}

              {sortedTasks.length === 0 && completedTodayTasks.length > 0 ? (
                <View style={[styles.emptyState, { flex: 0, paddingVertical: 40 }]}>
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('customList.allCaughtUp')}</Text>
                </View>
              ) : null}

              {sortedTasks.length > 0 && (
                <NestableDraggableFlatList
                data={sortedTasks}
                keyExtractor={(item) => String(item.id)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
                activationDistance={8}
                autoscrollThreshold={60}
                maxToRenderPerBatch={10}
                updateCellsBatchingPeriod={50}
                initialNumToRender={10}
                windowSize={5}
                onDragEnd={handleCustomListDragEnd}
                renderItem={({ item: task, drag, isActive }) => (
                  <CustomListTaskRow
                    task={task}
                    theme={theme}
                    members={sharedMembers}
                    isReadOnly={isViewer}
                    isCompleting={completingTaskIds.some((id) => sameId(id, task.id))}
                    drag={drag}
                    isActive={isActive}
                    onPress={() => navigation.navigate('TaskDetail', { task, userId, readOnly: isViewer })}
                    onToggle={() => toggleTask(task.id, task.is_completed || completingTaskIds.some((id) => sameId(id, task.id)))}
                    onToggleToday={async () => {
                      if (isViewer) return;
                      const updated = await updateTask(userId, latestTasksRef.current, task.id, { added_to_today: !task.added_to_today });
                      latestTasksRef.current = updated;
                      setTasks(updated);
                    }}
                    onToggleImportant={() => toggleImportant(task.id, task.is_important)}
                    onDelete={() => deleteTaskHandler(task.id)}
                  />
                )}
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
                      {t('customList.completedCount', { count: completedTodayTasks.length })}
                    </Text>
                  </TouchableOpacity>

                  {showCompleted && completedTodayTasks.map(task => {
                    const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                    const hasNotes = task.notes && task.notes.trim().length > 0;
                    const hasMeta = task.due_date || task.reminder_time || task.repeat_rule || hasSubtasks || hasNotes || true;
                    const completedSubs = hasSubtasks ? task.subtasks.filter(s => s.is_completed).length : 0;
                    const totalSubs = hasSubtasks ? task.subtasks.length : 0;
                    const assignee = sharedMembers.find((member) => sameId(memberId(member), task.assigned_to));
                    const syncText = task._sync_status === 'pending'
                      ? 'Pending sync'
                      : (task._sync_status === 'error' || task._sync_status === 'failed')
                        ? task._sync_error?.message || task.sync_error || 'Sync error'
                        : null;

                    const completedAgo = task.completed_at
                      ? (() => {
                          const diff = Date.now() - new Date(task.completed_at).getTime();
                          const mins = Math.floor(diff / 60000);
                          if (mins < 1) return t('customList.completedJustNow');
                          if (mins < 60) return t('customList.completedMinutesAgo', { mins });
                          const hrs = Math.floor(mins / 60);
                          return t('customList.completedHoursAgo', { hrs });
                        })()
                      : null;

                    return (
                      <Animated.View key={String(task.id)} entering={FadeIn.duration(300)}>
                        <TouchableOpacity
                          activeOpacity={0.75}
                          onPress={() => navigation.navigate('TaskDetail', { task, userId, readOnly: isViewer })}
                          accessibilityHint={isViewer ? 'Read only. Task changes are disabled.' : 'Opens task details.'}
                          accessibilityState={{ disabled: isViewer }}
                          style={[styles.taskCard, styles.taskCardCompleted]}
                        >
                          {/* Removed green indicator bar */}

                          <TouchableOpacity
                            onPress={() => toggleTask(task.id, task.is_completed)}
                            disabled={isViewer}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: true, disabled: isViewer }}
                            style={[styles.checkbox, { marginLeft: 28 }]}
                          >
                            <CheckCircle2 color="#34D399" size={24} />
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
                                    <Check color="#34D399" size={11} />
                                    <Text style={[styles.metaLabel, { color: '#34D399' }]}>{completedAgo}</Text>
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
                                {task.space_id ? (
                                  <View style={styles.assigneeMeta}>
                                    <View style={styles.assigneeAvatar}><Text style={styles.assigneeInitials}>{assignee ? memberInitials(assignee) : '—'}</Text></View>
                                    <Text numberOfLines={1} style={styles.assigneeName}>{assignee ? memberName(assignee) : 'Unassigned'}</Text>
                                  </View>
                                ) : null}
                                {syncText ? <Text style={[styles.taskSyncText, task._sync_status !== 'pending' && styles.taskSyncError]}>{syncText}</Text> : null}
                              </View>
                            )}
                          </View>

                          <TouchableOpacity
                            onPress={() => toggleImportant(task.id, task.is_important)}
                            disabled={isViewer}
                            accessibilityRole="button"
                            accessibilityLabel="Toggle important"
                            accessibilityState={{ disabled: isViewer }}
                            style={[styles.iconButtonSmall, isViewer && styles.mutationDisabled]}
                          >
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
          {(!isSharedList || activeSharedTab === 'tasks') && (isViewer ? (
            <View style={[styles.readOnlyFooter, { bottom: Math.max(insets.bottom + 16, 20) }]} accessibilityRole="text">
              <Text style={styles.readOnlyFooterText}>Viewer access · changes disabled</Text>
            </View>
          ) : isAddingTask ? (
            <View style={[styles.bottomInputWrapper, {
              paddingBottom: Math.max(insets.bottom, 16),
            }]}>

              {/* Due Date Pop-up */}
              {activeToolbarMenu === 'date' && (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.toolbarMenu, { bottom: 85, left: 16 }]}>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingDueDate(getToday()); setActiveToolbarMenu(null); }}>
                    <Calendar color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.dueDateToday', { day: getDayName(new Date()) })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingDueDate(getTomorrow()); setActiveToolbarMenu(null); }}>
                    <Calendar color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.dueDateTomorrow', { day: getDayName(getTomorrow()) })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingDueDate(getNextMonday()); setActiveToolbarMenu(null); }}>
                    <Calendar color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.dueDateNextWeek')}</Text>
                  </TouchableOpacity>
                  <View style={[styles.divider, { backgroundColor: '#444' }]} />
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setActiveToolbarMenu(null); setShowDatePicker(true); }}>
                    <Calendar color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.pickADate')}</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Reminder Pop-up */}
              {activeToolbarMenu === 'reminder' && (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.toolbarMenu, { bottom: 85, left: 60 }]}>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingReminder(getReminderLaterToday()); setActiveToolbarMenu(null); }}>
                    <Bell color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.reminderLaterToday', { time: getReminderLaterToday().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingReminder(getReminderTomorrow()); setActiveToolbarMenu(null); }}>
                    <Bell color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.reminderTomorrow', { day: getDayName(getTomorrow()) })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingReminder(getReminderNextWeek()); setActiveToolbarMenu(null); }}>
                    <Bell color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.reminderNextWeek')}</Text>
                  </TouchableOpacity>
                  <View style={[styles.divider, { backgroundColor: '#444' }]} />
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setActiveToolbarMenu(null); setReminderPickerDate(new Date()); setShowReminderDatePicker(true); }}>
                    <Bell color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.pickDateTime')}</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Repeat Pop-up */}
              {activeToolbarMenu === 'repeat' && (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.toolbarMenu, { bottom: 85, right: 16 }]}>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('daily'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.repeatDaily')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('weekdays'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.repeatWeekdays')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('weekly'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.repeatWeekly')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('monthly'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.repeatMonthly')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setPendingRepeatRule('yearly'); setActiveToolbarMenu(null); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.repeatYearly')}</Text>
                  </TouchableOpacity>
                  <View style={[styles.divider, { backgroundColor: '#444' }]} />
                  <TouchableOpacity style={styles.toolbarMenuItem} onPress={() => { setActiveToolbarMenu(null); setShowCustomRepeatModal(true); }}>
                    <Repeat color="#fff" size={20} style={styles.toolbarMenuIcon} />
                    <Text style={styles.toolbarMenuText}>{t('customList.repeatCustomised')}</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Priority Pop-up */}
              {activeToolbarMenu === 'priority' && (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.toolbarMenu, { bottom: 85, right: 16 }]}>
                  {Object.entries(PRIORITY_CONFIG).reverse().map(([value, config]) => (
                    <TouchableOpacity key={value} style={styles.toolbarMenuItem} onPress={() => { setPendingPriority(Number(value)); setActiveToolbarMenu(null); }}>
                      <Flag color={config.color} size={20} fill={Number(value) !== 1 ? config.color : 'transparent'} style={styles.toolbarMenuIcon} />
                      <Text style={styles.toolbarMenuText}>{config.label}</Text>
                      {pendingPriority === Number(value) && <Text style={{ color: '#fff', marginLeft: 'auto' }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
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
                  placeholder={t('customList.addTaskPlaceholder')}
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
                  <Text style={[styles.toolbarText, pendingDueDate && { color: '#fff' }]}>{t('customList.toolbarDueDate')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolbarButton, pendingReminder && styles.toolbarButtonActive]} onPress={() => setActiveToolbarMenu(activeToolbarMenu === 'reminder' ? null : 'reminder')}>
                  <Bell color={pendingReminder ? '#fff' : '#888'} size={18} />
                  <Text style={[styles.toolbarText, pendingReminder && { color: '#fff' }]}>{t('customList.toolbarRemindMe')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolbarButton, pendingRepeatRule && styles.toolbarButtonActive]} onPress={() => setActiveToolbarMenu(activeToolbarMenu === 'repeat' ? null : 'repeat')}>
                  <Repeat color={pendingRepeatRule ? '#fff' : '#888'} size={18} />
                  <Text style={[styles.toolbarText, pendingRepeatRule && { color: '#fff' }]}>{t('customList.toolbarRepeat')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolbarButton, pendingPriority !== 1 && styles.toolbarButtonActive]} onPress={() => setActiveToolbarMenu(activeToolbarMenu === 'priority' ? null : 'priority')}>
                  <Flag color={pendingPriority !== 1 ? getPriorityColor(pendingPriority) : '#888'} size={18} fill={pendingPriority !== 1 ? getPriorityColor(pendingPriority) : 'transparent'} />
                  <Text style={[styles.toolbarText, pendingPriority !== 1 && { color: '#fff' }]}>{t('customList.toolbarPriority')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.fab, {
                bottom: Math.max(insets.bottom + 16, 20)
              }]}
              onPress={() => setIsAddingTask(true)}
              accessibilityRole="button"
              accessibilityLabel="Add task"
            >
              <Plus color="#000000" size={28} />
            </TouchableOpacity>
          ))}
        </KeyboardAvoidingView>

        {/* ─── Native Date Picker (Due Date) ────────── */}
        {showDatePicker && (
          <Modal transparent animationType="slide">
            <View style={styles.pickerModalOverlay}>
              <View style={styles.pickerModalContent}>
                <View style={styles.pickerHeader}>
                  <Text style={styles.pickerTitle}>{t('customList.pickDueDateTitle')}</Text>
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
                    <Text style={styles.pickerDoneText}>{t('customList.doneButton')}</Text>
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
                  <Text style={styles.pickerTitle}>{t('customList.pickDateTimeTitle')}</Text>
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
                    <Text style={styles.pickerDoneText}>{t('customList.doneButton')}</Text>
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
                <Text style={styles.pickerTitle}>{t('customList.customRepeatTitle')}</Text>
                <TouchableOpacity onPress={() => setShowCustomRepeatModal(false)}>
                  <X color="#fff" size={24} />
                </TouchableOpacity>
              </View>

              {/* Repeat every ___ [unit] */}
              <Text style={styles.customLabel}>{t('customList.repeatEveryLabel')}</Text>
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
                  <Text style={[styles.customLabel, { marginTop: 20 }]}>{t('customList.onTheseDaysLabel')}</Text>
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
                <Text style={styles.pickerDoneText}>{t('common.save')}</Text>
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
        currentRoute="CustomList"
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
          savePlanForToday(userId, plan);
        }}
        onToggleTask={toggleTask}
      />
      {/* Rename List Modal */}
      <Modal visible={showRenameModal} animationType="fade" transparent={true} onRequestClose={() => setShowRenameModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ width: '85%', backgroundColor: '#1E1E1E', borderColor: '#333', borderWidth: 1, borderRadius: 16, padding: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{t('customList.renameListLabel')}</Text>
              <TouchableOpacity onPress={() => setShowRenameModal(false)}>
                <X color="#aaa" size={24} />
              </TouchableOpacity>
            </View>
            <View style={{ paddingBottom: 10 }}>
              <TextInput
                style={{ color: '#fff', backgroundColor: '#2A2A2A', padding: 12, borderRadius: 8, fontSize: 16 }}
                value={renameText}
                onChangeText={setRenameText}
                autoFocus
                placeholder={t('customList.listNamePlaceholder')}
                placeholderTextColor="#666"
                selectionColor={COLORS.dark.primary}
                onSubmitEditing={handleRenameList}
              />
              <TouchableOpacity 
                style={{ backgroundColor: COLORS.dark.primary, padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 16 }} 
                onPress={handleRenameList}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{t('customList.renameButton')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ShareListSheet
        visible={showShareSheet}
        onClose={() => setShowShareSheet(false)}
        userId={userId}
        space={currentSpace}
        list={currentList || {
          id: listId,
          name: localListName,
          ...(isSharedList ? { space_id: resolvedSpaceId } : {}),
        }}
        members={sharedMembers}
        onChanged={async (result) => {
          const changedSpaceId = result?.space_id || resolvedSpaceId;
          await refreshSharedWorkspace(changedSpaceId);
          if (changedSpaceId != null) {
            const cachedActivity = await loadSpaceActivity(userId, changedSpaceId, setActivity);
            setActivity(cachedActivity || []);
          }
        }}
      />

      <ConflictSheet
        visible={showConflictSheet}
        onClose={() => setShowConflictSheet(false)}
        spaceId={resolvedSpaceId}
        onRefresh={() => refreshSharedWorkspace(resolvedSpaceId)}
      />

      <LevelUpModal
        isVisible={!!levelUpData}
        oldLevel={levelUpData?.oldLevel || 1}
        newLevel={levelUpData?.newLevel || 2}
        onClose={() => setLevelUpData(null)}
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
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 44,
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    paddingVertical: 10,
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
    paddingHorizontal: 16,
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
  sharedPanel: {
    marginHorizontal: 16,
    marginBottom: 14,
    gap: 10,
  },
  syncStatusButton: { minHeight: 44, justifyContent: 'center' },
  sharedSummaryRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sharedIdentity: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sharedSpaceName: { flexShrink: 1, color: '#D4D4D8', fontSize: 12, fontWeight: '400' },
  roleLabel: { color: '#71717A', fontSize: 9, fontWeight: '600', letterSpacing: 0.8 },
  shareButton: {
    minHeight: 44,
    paddingHorizontal: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3F3F46',
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  shareButtonText: { color: '#D4D4D8', fontSize: 12, fontWeight: '400' },
  viewerNotice: { color: '#A1A1AA', fontSize: 11, fontWeight: '300' },
  segmentedControl: {
    minHeight: 44,
    padding: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3F3F46',
    borderRadius: 10,
    flexDirection: 'row',
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: '#27272A' },
  segmentText: { color: '#71717A', fontSize: 12, fontWeight: '400' },
  segmentTextActive: { color: '#F4F4F5' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3F3F46',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: { borderColor: '#A1A1AA', backgroundColor: '#18181B' },
  filterText: { color: '#71717A', fontSize: 11, fontWeight: '400' },
  filterTextActive: { color: '#E4E4E7' },
  activityScroll: { flex: 1 },
  activityContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },
  readOnlyFooter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3F3F46',
    borderRadius: 18,
    backgroundColor: '#18181B',
  },
  readOnlyFooterText: { color: '#A1A1AA', fontSize: 11, fontWeight: '400' },
  mutationDisabled: { opacity: 0.35 },
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
    marginTop: 5,
    rowGap: 4,
    columnGap: 6,
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
  assigneeMeta: {
    flexBasis: '100%',
    maxWidth: '100%',
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  assigneeAvatar: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#52525B',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181B',
  },
  assigneeInitials: { color: '#A1A1AA', fontSize: 7, fontWeight: '500' },
  assigneeName: { flexShrink: 1, color: '#A1A1AA', fontSize: 10, fontWeight: '400' },
  taskSyncText: { color: '#71717A', fontSize: 10, fontWeight: '400' },
  taskSyncError: { color: '#FCA5A5' },

  // Right Actions Column
  taskActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 0,
  },
  iconButtonSmall: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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

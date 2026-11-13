import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import {
    ArrowLeft,
    Bell,
    Calendar,
    Check,
    CheckCircle2,
    Circle,
    FileText,
    Flag,
    Plus,
    Repeat,
    Star, Sun,
    Trash2, UserRound, X,
    Zap
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, { FadeIn, Layout, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import {
    AssigneePicker,
    CommentThread,
    getMemberName,
    SyncStatusStrip,
} from '../components/collaboration';
import { getPriorityColor, getPriorityLabel, PRIORITY_CONFIG } from '../config/priorityConfig';
import { useTheme } from '../context/ThemeContext';
import {
    deleteSharedTask,
    loadSpaceDetail,
    loadTaskComments,
    updateSharedTask,
} from '../lib/collaborationManager';
import { subscribeCollaboration } from '../lib/collaborationRealtime';
import {
    deleteTask as dmDeleteTask,
    getCurrentUserId,
    resolveTaskById,
    toggleTaskCompletion,
    toggleTaskImportance,
    updateTask,
} from '../lib/dataManager';
import { Gamification } from '../utils/gamification';
import { cancelTaskReminder, scheduleTaskReminder } from '../utils/notifications';
import { Storage } from '../utils/storage';

// ─── Helpers ────────────────────────────────────────────
const formatDate = (d, t) => {
  if (!d) return null;
  const date = new Date(d);
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return t('taskDetail.today');
  if (date.toDateString() === tomorrow.toDateString()) return t('taskDetail.tomorrow');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const formatDateTime = (d, t) => {
  if (!d) return null;
  const date = new Date(d);
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  let dayPart;
  if (date.toDateString() === today.toDateString()) dayPart = t('taskDetail.today');
  else if (date.toDateString() === tomorrow.toDateString()) dayPart = t('taskDetail.tomorrow');
  else dayPart = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayPart}, ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
};

const formatCreatedAt = (d, t) => {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return t('taskDetail.justNow');
  if (diffMins < 60) return t('taskDetail.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('taskDetail.hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('taskDetail.daysAgo', { count: diffDays });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const getRepeatOptions = (t) => [
  { label: t('taskDetail.repeatDaily'), value: 'daily' },
  { label: t('taskDetail.repeatWeekdays'), value: 'weekdays' },
  { label: t('taskDetail.repeatWeekly'), value: 'weekly' },
  { label: t('taskDetail.repeatMonthly'), value: 'monthly' },
  { label: t('taskDetail.repeatYearly'), value: 'yearly' },
];

const normalizeId = (value) => (value == null || value === '' ? null : String(value));
const idsEqual = (left, right) => {
  const leftId = normalizeId(left);
  const rightId = normalizeId(right);
  return leftId != null && rightId != null && leftId === rightId;
};
const createSubtaskId = (taskId, existing) => {
  const prefix = `sub_${normalizeId(taskId) || 'task'}_`;
  const used = new Set((Array.isArray(existing) ? existing : []).map((item) => normalizeId(item?.id)));
  let sequence = used.size + 1;
  while (used.has(`${prefix}${sequence}`)) sequence += 1;
  return `${prefix}${sequence}`;
};
const normalizeTask = (value, fallbackSpaceId = null) => {
  if (!value || value.id == null) return null;
  return {
    ...value,
    id: normalizeId(value.id),
    space_id: normalizeId(value.space_id ?? fallbackSpaceId),
    assigned_to: normalizeId(value.assigned_to),
  };
};

export const TaskDetailScreen = ({ route, navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const ACCENT = theme.accent || '#FFFFFF';
  const ON_ACCENT = theme.onAccent || '#0B0B0D';
  const styles = useMemo(() => makeStyles(ACCENT, ON_ACCENT), [ACCENT, ON_ACCENT]);
  const routeParams = route?.params || {};
  const routeUserId = normalizeId(routeParams.userId);
  const routeSpaceId = normalizeId(routeParams.spaceId);
  const initialTask = useMemo(() => {
    if (routeParams.task?.id == null) return null;
    if (routeParams.taskId != null && !idsEqual(routeParams.taskId, routeParams.task.id)) return null;
    return normalizeTask(routeParams.task, routeSpaceId);
  }, [routeParams.task, routeParams.taskId, routeSpaceId]);
  const resolvedTaskId = normalizeId(routeParams.taskId ?? initialTask?.id);
  const REPEAT_OPTIONS = useMemo(() => getRepeatOptions(t), [t]);

  const [resolvedUserId, setResolvedUserId] = useState(routeUserId);
  const [task, setTask] = useState(initialTask);
  const [isResolving, setIsResolving] = useState(!initialTask);
  const [members, setMembers] = useState([]);
  const [comments, setComments] = useState([]);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [pendingMutation, setPendingMutation] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [noteText, setNoteText] = useState(initialTask?.notes || '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(initialTask?.title || '');

  // Subtask state
  const [subtasks, setSubtasks] = useState(initialTask?.subtasks || []);
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const subtaskInputRef = useRef(null);

  // Picker states
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [reminderStep, setReminderStep] = useState('date');
  const [pickerDate, setPickerDate] = useState(new Date());
  const [showRepeatMenu, setShowRepeatMenu] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const titleInputRef = useRef(null);

  const adoptTask = useCallback((nextTask, fallbackSpaceId = routeSpaceId) => {
    const normalized = normalizeTask(nextTask, fallbackSpaceId);
    setTask(normalized);
    if (!normalized) return;
    setNoteText(normalized.notes || '');
    setEditTitle(normalized.title || '');
    setSubtasks(Array.isArray(normalized.subtasks) ? normalized.subtasks : []);
  }, [routeSpaceId]);

  // The app-level collaboration coordinator owns the backend subscription. This
  // screen listens only to its sanitized events, then re-reads the local cache.
  useEffect(() => {
    if (!resolvedUserId || !resolvedTaskId) return undefined;
    const subscriptionSpaceId = normalizeId(task?.space_id ?? routeSpaceId);
    return subscribeCollaboration((event) => {
      if (event?.userId && !idsEqual(event.userId, resolvedUserId)) return;
      if (event?.type === 'refresh') {
        setRefreshEpoch((value) => value + 1);
        return;
      }
      if (event?.type === 'membership_revoked' && idsEqual(event.spaceId, subscriptionSpaceId)) {
        setRefreshEpoch((value) => value + 1);
        return;
      }
      if (event?.type !== 'row') return;
      const affectsTask = event.table === 'tasks' && idsEqual(event.row?.id, resolvedTaskId);
      const affectsComments = event.table === 'task_comments' && idsEqual(event.row?.task_id, resolvedTaskId);
      const affectsMembers = event.table === 'space_members'
        && idsEqual(event.row?.space_id, subscriptionSpaceId);
      if (affectsTask || affectsComments || affectsMembers) {
        setRefreshEpoch((value) => value + 1);
      }
    });
  }, [resolvedTaskId, resolvedUserId, routeSpaceId, task?.space_id]);

  // A route snapshot paints immediately. On focus and relevant realtime events,
  // resolve the user through dataManager and re-read task/member/comment caches
  // before their loaders perform silent background refreshes.
  useFocusEffect(useCallback(() => {
    let active = true;
    const preserveResolvedTask = Boolean(initialTask || refreshEpoch > 0);

    const loadSharedCaches = async (userId, spaceId, taskId) => {
      if (spaceId == null) {
        if (active) {
          setMembers([]);
          setComments([]);
        }
        return;
      }
      const [detail, cachedComments] = await Promise.all([
        loadSpaceDetail(userId, spaceId, (fresh) => {
          if (active) setMembers(fresh?.members || []);
        }),
        loadTaskComments(userId, taskId, (fresh) => {
          if (active) setComments(Array.isArray(fresh) ? fresh : []);
        }),
      ]);
      if (active) {
        setMembers(detail?.members || []);
        setComments(Array.isArray(cachedComments) ? cachedComments : []);
      }
    };

    const refresh = async () => {
      const userId = routeUserId || normalizeId(await getCurrentUserId());
      if (!active) return;
      setResolvedUserId(userId);
      if (!userId || resolvedTaskId == null) {
        if (!preserveResolvedTask) setTask(null);
        setIsResolving(false);
        return;
      }

      const cachedTask = await resolveTaskById(userId, resolvedTaskId, (freshTask) => {
        if (!active) return;
        adoptTask(freshTask);
        const freshSpaceId = normalizeId(freshTask?.space_id ?? routeSpaceId);
        loadSharedCaches(userId, freshSpaceId, resolvedTaskId).catch(() => {});
      });
      if (!active) return;
      if (cachedTask) adoptTask(cachedTask);
      else if (!preserveResolvedTask) setTask(null);
      const spaceId = normalizeId(cachedTask?.space_id ?? initialTask?.space_id ?? routeSpaceId);
      await loadSharedCaches(userId, spaceId, resolvedTaskId);
      if (active) setIsResolving(false);
    };

    refresh().catch(() => {
      if (active) {
        if (!preserveResolvedTask) setTask(null);
        setIsResolving(false);
      }
    });
    return () => { active = false; };
  }, [adoptTask, initialTask, refreshEpoch, resolvedTaskId, routeSpaceId, routeUserId]));

  const sharedSpaceId = normalizeId(task?.space_id ?? routeSpaceId);
  const isShared = sharedSpaceId != null;
  const currentMember = isShared
    ? members.find((member) => idsEqual(member?.user_id ?? member?.id, resolvedUserId))
    : null;
  const currentRole = String(currentMember?.role || '').toLowerCase();
  const isViewer = isShared && currentRole === 'viewer';
  const permissionsResolved = !isShared || Boolean(currentMember);
  // Cached/server membership is the only write authority. Route snapshots may
  // paint content immediately but can never grant editor permissions.
  const canMutate = Boolean(
    task
    && resolvedUserId
    && permissionsResolved
    && (!isShared || (['owner', 'editor'].includes(currentRole) && routeParams.readOnly !== true)),
  );
  const readOnlyExplanation = isViewer || routeParams.readOnly === true
    ? 'You have viewer access. Editing, assigning, completing, commenting, and deleting are disabled.'
    : 'Checking collaboration permissions. Editing is temporarily disabled.';
  const assignedMember = members.find((member) => (
    idsEqual(member?.user_id ?? member?.id, task?.assigned_to)
  ));
  const taskHasPendingSync = isShared && (pendingMutation || task?._sync_status === 'pending');
  const controlsDisabled = !canMutate || pendingMutation;

  const readCurrentTasks = async () => {
    const cached = await Storage.get(`tasks_${resolvedUserId}`);
    const current = Array.isArray(cached) ? cached : [];
    if (!task || current.some((item) => idsEqual(item.id, task.id))) return current;
    return [task, ...current];
  };

  // ─── Persist helper ───────────────────────────────────
  const handleUpdateField = async (fields) => {
    if (!canMutate || !task || pendingMutation) return false;
    const normalizedFields = Object.prototype.hasOwnProperty.call(fields, 'assigned_to')
      ? { ...fields, assigned_to: normalizeId(fields.assigned_to) }
      : fields;
    setMutationError('');
    setPendingMutation(true);
    setTask((current) => current ? {
      ...current,
      ...normalizedFields,
      ...(isShared ? { _sync_status: 'pending' } : {}),
    } : current);

    try {
      if (isShared) {
        const pendingTask = await updateSharedTask(
          resolvedUserId,
          normalizeId(task.id),
          normalizedFields,
          task.collaboration_version,
        );
        if (pendingTask) adoptTask(pendingTask, sharedSpaceId);
      } else {
        const allTasks = await readCurrentTasks();
        const updatedTasks = await updateTask(
          resolvedUserId,
          allTasks,
          normalizeId(task.id),
          normalizedFields,
        );
        const updatedTask = updatedTasks?.find((item) => idsEqual(item.id, task.id));
        if (updatedTask) adoptTask(updatedTask);
      }
      return true;
    } catch (_error) {
      // Shared managers persist optimistic state before queueing, so never roll
      // back a local copy that may already be safely pending retry.
      setMutationError('The change is saved locally but could not be queued yet. Try again after refresh.');
      return false;
    } finally {
      setPendingMutation(false);
    }
  };

  // ─── Subtask handlers ─────────────────────────────────
  const handleAddSubtask = async () => {
    if (!canMutate || !newSubtaskTitle.trim()) return;
    const newSub = {
      id: createSubtaskId(task?.id, subtasks),
      title: newSubtaskTitle.trim(),
      is_completed: false,
    };
    const updated = [...subtasks, newSub];
    setSubtasks(updated);
    setNewSubtaskTitle('');
    await handleUpdateField({ subtasks: updated });
  };

  const handleToggleSubtask = async (subId) => {
    if (!canMutate) return;
    let becameComplete = false;
    const updated = subtasks.map((subtask) => {
      if (!idsEqual(subtask.id, subId)) return subtask;
      becameComplete = !subtask.is_completed;
      return { ...subtask, is_completed: becameComplete };
    });
    setSubtasks(updated);
    await handleUpdateField({ subtasks: updated });
    // Shared subtask XP is server-owned; retain the personal-task behavior.
    if (!isShared) {
      const delta = becameComplete ? Gamification.xpForSubtask() : -Gamification.xpForSubtask();
      await Gamification.addXP(resolvedUserId, delta);
    }
  };

  const handleDeleteSubtask = async (subId) => {
    if (!canMutate) return;
    const updated = subtasks.filter((subtask) => !idsEqual(subtask.id, subId));
    setSubtasks(updated);
    await handleUpdateField({ subtasks: updated });
  };

  // ─── Task handlers ────────────────────────────────────
  const handleToggleComplete = async () => {
    if (!canMutate || !task || pendingMutation) return;
    const newStatus = !task.is_completed;
    const completedAt = newStatus ? new Date().toISOString() : null;

    if (isShared) {
      // The versioned shared-task RPC owns completion XP and recipient choice.
      await handleUpdateField({ is_completed: newStatus, completed_at: completedAt });
      return;
    }

    const allTasks = await readCurrentTasks();
    const storedTask = allTasks.find((item) => idsEqual(item.id, task.id)) || task;
    const xpAmount = newStatus
      ? Gamification.xpForTask(task)
      : (storedTask.xp_awarded ?? Gamification.xpForTask(task));
    const optimisticFields = {
      is_completed: newStatus,
      completed_at: completedAt,
      xp_awarded: newStatus ? xpAmount : null,
    };
    setTask((current) => current ? { ...current, ...optimisticFields } : current);

    const completedTasks = await toggleTaskCompletion(
      resolvedUserId,
      allTasks,
      normalizeId(task.id),
      task.is_completed,
    );
    await updateTask(resolvedUserId, completedTasks, normalizeId(task.id), {
      xp_awarded: newStatus ? xpAmount : null,
    });
    if (newStatus && task.reminder_time) await cancelTaskReminder(task.id);
    else if (!newStatus && task.reminder_time) {
      await scheduleTaskReminder(task.id, task.title, task.reminder_time);
    }
    await Gamification.addXP(resolvedUserId, newStatus ? xpAmount : -xpAmount);
  };

  const handleToggleImportant = async () => {
    if (!canMutate || !task || pendingMutation) return;
    if (isShared) {
      await handleUpdateField({ is_important: !task.is_important });
      return;
    }
    setTask((current) => current ? { ...current, is_important: !current.is_important } : current);
    const allTasks = await readCurrentTasks();
    await toggleTaskImportance(
      resolvedUserId,
      allTasks,
      normalizeId(task.id),
      task.is_important,
    );
  };

  const handleTitleSave = async () => {
    setIsEditingTitle(false);
    Keyboard.dismiss();
    if (!task) return;
    if (canMutate && editTitle.trim() && editTitle.trim() !== task.title) {
      await handleUpdateField({ title: editTitle.trim() });
    } else {
      setEditTitle(task.title || '');
    }
  };

  const handleSetDueDate = async (date) => {
    setShowDatePicker(false);
    if (date && canMutate) {
      const dueDate = new Date(date); dueDate.setHours(23, 59, 0, 0);
      await handleUpdateField({ due_date: dueDate.toISOString() });
    }
  };

  const handleRemoveDueDate = () => handleUpdateField({ due_date: null });

  const handleSetReminder = async (date) => {
    if (!canMutate || !task) return;
    if (reminderStep === 'date') { setPickerDate(date); setReminderStep('time'); return; }
    setShowReminderPicker(false); setReminderStep('date');
    if (date) {
      const finalDate = new Date(pickerDate);
      finalDate.setHours(date.getHours(), date.getMinutes(), 0, 0);
      await handleUpdateField({ reminder_time: finalDate.toISOString() });
      // Shared reminders are scheduled by collaborationManager for only the
      // current assignee (or the eligible unassigned-task actor).
      if (!isShared) await scheduleTaskReminder(task.id, task.title, finalDate.toISOString());
    }
  };

  const handleRemoveReminder = async () => {
    if (!canMutate || !task) return;
    if (!isShared) await cancelTaskReminder(task.id);
    await handleUpdateField({ reminder_time: null });
  };

  const handleSetRepeat = async (rule) => {
    setShowRepeatMenu(false);
    await handleUpdateField({ repeat_rule: rule });
  };

  const handleRemoveRepeat = () => handleUpdateField({ repeat_rule: null });

  const handleSaveNotes = async () => {
    Keyboard.dismiss();
    if (canMutate && task && noteText !== (task.notes || '')) {
      await handleUpdateField({ notes: noteText });
    }
  };

  const handleDelete = () => {
    if (!canMutate || !task || pendingMutation) return;
    Alert.alert(t('taskDetail.deleteTaskTitle'), t('taskDetail.deleteTaskMessage', { title: task.title }), [
      { text: t('taskDetail.cancel'), style: 'cancel' },
      {
        text: t('taskDetail.deleteButton'), style: 'destructive',
        onPress: async () => {
          setMutationError('');
          setPendingMutation(true);
          try {
            if (isShared) {
              await deleteSharedTask(
                resolvedUserId,
                normalizeId(task.id),
                task.collaboration_version,
              );
            } else {
              await cancelTaskReminder(task.id);
              const allTasks = await readCurrentTasks();
              await dmDeleteTask(resolvedUserId, allTasks, normalizeId(task.id));
            }
            navigation.goBack();
          } catch (_error) {
            setMutationError('The task could not be queued for deletion. Your cached copy is unchanged.');
            setPendingMutation(false);
          }
        },
      },
    ]);
  };

  const handleGoBack = async () => {
    if (canMutate && task && noteText !== (task.notes || '')) {
      await handleUpdateField({ notes: noteText });
    }
    navigation.goBack();
  };

  const handleAssigneeSelect = async (assigneeId) => {
    if (!canMutate || pendingMutation) return;
    // handleUpdateField paints the normalized assignee before the queue write.
    await handleUpdateField({ assigned_to: normalizeId(assigneeId) });
  };

  // Subtask stats
  const completedSubtasks = subtasks.filter((subtask) => subtask.is_completed).length;
  const totalSubtasks = subtasks.length;

  if (!task) {
    return (
      <BackgroundWrapper>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
            <ArrowLeft color="#fff" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('taskDetail.headerTitle')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyState} accessibilityLiveRegion="polite">
          <Text style={styles.emptyStateTitle}>
            {isResolving ? 'Task is not cached on this device' : 'Task not found'}
          </Text>
          <Text style={styles.emptyStateText}>
            {isResolving
              ? 'Checking for an available copy in the background…'
              : 'It may have been deleted or is no longer available to you.'}
          </Text>
        </View>
      </BackgroundWrapper>
    );
  }

  return (
    <BackgroundWrapper>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* ─── Header ─────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
          <TouchableOpacity onPress={handleGoBack} style={styles.headerBtn}>
            <ArrowLeft color="#fff" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('taskDetail.headerTitle')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {isShared && (
            <View style={styles.syncStripWrap}>
              <SyncStatusStrip spaceId={sharedSpaceId} />
              {taskHasPendingSync && (
                <Text accessibilityLiveRegion="polite" style={styles.pendingText}>
                  {pendingMutation ? 'Saving locally…' : 'Changes pending sync'}
                </Text>
              )}
              {!canMutate && (
                <View accessible accessibilityRole="text" style={styles.readOnlyBanner}>
                  <Text style={styles.readOnlyText}>{readOnlyExplanation}</Text>
                </View>
              )}
              {mutationError ? (
                <Text accessibilityLiveRegion="assertive" style={styles.mutationErrorText}>
                  {mutationError}
                </Text>
              ) : null}
            </View>
          )}

          {/* ─── Task Title Row ───────────────────────── */}
          <View style={[styles.titleRow, controlsDisabled && styles.disabledControl]}>
            <TouchableOpacity disabled={!canMutate} onPress={handleToggleComplete} style={styles.titleCheckbox}>
              {task.is_completed
                ? <CheckCircle2 color="#34D399" size={28} />
                : <Circle color="#fff" size={28} />}
            </TouchableOpacity>
            <View style={styles.titleContent}>
              {isEditingTitle && canMutate ? (
                <TextInput
                  ref={titleInputRef} value={editTitle} onChangeText={setEditTitle}
                  onBlur={handleTitleSave} onSubmitEditing={handleTitleSave}
                  style={styles.titleInput} autoFocus multiline blurOnSubmit
                />
              ) : (
                <TouchableOpacity disabled={!canMutate} onPress={() => setIsEditingTitle(true)}>
                  <Text style={[styles.titleText, task.is_completed && styles.titleCompleted]}>{task.title}</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity disabled={!canMutate} onPress={handleToggleImportant} style={styles.titleStar}>
              <Star color={task.is_important ? '#FBBF24' : '#555'} fill={task.is_important ? '#FBBF24' : 'transparent'} size={24} />
            </TouchableOpacity>
          </View>

          {/* ─── Subtasks Section ─────────────────────── */}
          <View style={styles.subtasksSection}>
            {subtasks.map((sub) => (
              <Animated.View
                key={sub.id}
                entering={FadeIn.duration(200)}
                layout={Layout.springify()}
                style={styles.subtaskRow}
              >
                <TouchableOpacity disabled={!canMutate} onPress={() => handleToggleSubtask(sub.id)} style={styles.subtaskCheckbox}>
                  {sub.is_completed
                    ? <CheckCircle2 color="#34D399" size={20} />
                    : <Circle color="#555" size={20} />}
                </TouchableOpacity>
                <Text style={[styles.subtaskText, sub.is_completed && styles.subtaskCompleted]}>{sub.title}</Text>
                {canMutate && (
                  <TouchableOpacity onPress={() => handleDeleteSubtask(sub.id)} style={styles.subtaskDelete}>
                    <X color="#444" size={16} />
                  </TouchableOpacity>
                )}
              </Animated.View>
            ))}

            {canMutate && (isAddingSubtask ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.subtaskInputRow}>
                <Circle color="#555" size={20} style={{ marginRight: 12 }} />
                <TextInput
                  ref={subtaskInputRef} value={newSubtaskTitle} onChangeText={setNewSubtaskTitle}
                  placeholder={t('taskDetail.addStepPlaceholder')} placeholderTextColor="#555"
                  style={styles.subtaskInput} autoFocus onSubmitEditing={handleAddSubtask}
                  blurOnSubmit={false} returnKeyType="done"
                />
                <TouchableOpacity
                  onPress={() => { handleAddSubtask(); setIsAddingSubtask(false); Keyboard.dismiss(); }}
                  style={styles.subtaskDoneBtn}
                >
                  <Check color="#4da6ff" size={20} />
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <TouchableOpacity style={styles.addSubtaskBtn} onPress={() => setIsAddingSubtask(true)}>
                <Plus color="#4da6ff" size={20} style={{ marginRight: 12 }} />
                <Text style={styles.addSubtaskText}>
                  {totalSubtasks > 0 ? t('taskDetail.nextStep') : t('taskDetail.addStep')}
                </Text>
              </TouchableOpacity>
            ))}

            {totalSubtasks > 0 && (
              <View style={styles.subtaskProgress}>
                <View style={styles.progressBarBg}>
                  <Animated.View style={[styles.progressBarFill, { width: `${(completedSubtasks / totalSubtasks) * 100}%` }]} />
                </View>
                <Text style={styles.progressText}>
                  {t('taskDetail.subtaskProgress', { completed: completedSubtasks, total: totalSubtasks })}
                </Text>
              </View>
            )}
          </View>

          {/* ─── Focus Mode Button ──────────────────────── */}
          <TouchableOpacity
            disabled={!canMutate}
            style={[styles.focusModeBtn, !canMutate && styles.disabledControl]}
            onPress={() => navigation.navigate('FocusMode', { task, userId: resolvedUserId })}
          >
            <Zap color={ON_ACCENT} size={20} fill={ON_ACCENT} style={{ marginRight: 10 }} />
            <Text style={styles.focusModeBtnText}>{t('taskDetail.startFocusMode')}</Text>
          </TouchableOpacity>

          {isShared && (
            <TouchableOpacity
              disabled={!canMutate}
              style={[styles.assigneeRow, !canMutate && styles.disabledControl]}
              onPress={() => setShowAssigneePicker(true)}
            >
              <UserRound color="#888" size={22} style={styles.optionIcon} />
              <View style={styles.optionTextContainer}>
                <Text style={styles.detailLabel}>Assignee</Text>
                <Text style={styles.assigneeName}>
                  {assignedMember ? getMemberName(assignedMember) : 'Unassigned'}
                </Text>
              </View>
              <Text style={styles.assigneeAction}>{canMutate ? 'Change' : 'View only'}</Text>
            </TouchableOpacity>
          )}

          {/* ─── Options List ─────────────────────────── */}
          <View
            pointerEvents={canMutate ? 'auto' : 'none'}
            style={[styles.optionsSection, !canMutate && styles.disabledControl]}
          >
            {/* Added to My Day */}
            <TouchableOpacity 
              style={styles.optionRow} 
              onPress={() => handleUpdateField({ added_to_today: !task.added_to_today })}
            >
              <Sun color={task.added_to_today ? '#4da6ff' : '#888'} size={22} style={styles.optionIcon} />
              <View style={styles.optionTextContainer}>
                <Text style={[styles.optionText, task.added_to_today && { color: '#4da6ff' }]}>
                  {task.added_to_today ? t('taskDetail.addedToMyDay') : t('taskDetail.addToMyDay')}
                </Text>
              </View>
              {task.added_to_today && (
                <TouchableOpacity onPress={() => handleUpdateField({ added_to_today: false })} style={styles.optionAction}>
                  <X color="#666" size={18} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            <View style={styles.separator} />

            {/* Remind Me */}
            <TouchableOpacity style={styles.optionRow} onPress={() => {
              if (task.reminder_time) return;
              setPickerDate(new Date()); setReminderStep('date'); setShowReminderPicker(true);
            }}>
              <Bell color={task.reminder_time ? '#4da6ff' : '#888'} size={22} style={styles.optionIcon} />
              <View style={styles.optionTextContainer}>
                <Text style={[styles.optionText, task.reminder_time && { color: '#4da6ff' }]}>{t('taskDetail.remindMe')}</Text>
                {task.reminder_time && <Text style={styles.optionSubtext}>{formatDateTime(task.reminder_time, t)}</Text>}
              </View>
              {task.reminder_time && (
                <TouchableOpacity onPress={handleRemoveReminder} style={styles.optionAction}><X color="#666" size={18} /></TouchableOpacity>
              )}
            </TouchableOpacity>
            <View style={styles.separator} />

            {/* Due Date */}
            <TouchableOpacity style={styles.optionRow} onPress={() => {
              if (task.due_date) return;
              setPickerDate(new Date()); setShowDatePicker(true);
            }}>
              <Calendar color={task.due_date ? '#4da6ff' : '#888'} size={22} style={styles.optionIcon} />
              <View style={styles.optionTextContainer}>
                <Text style={[styles.optionText, task.due_date && { color: '#4da6ff' }]}>
                  {task.due_date ? t('taskDetail.dueDate') : t('taskDetail.addDueDate')}
                </Text>
                {task.due_date && <Text style={styles.optionSubtext}>{formatDate(task.due_date, t)}</Text>}
              </View>
              {task.due_date && (
                <TouchableOpacity onPress={handleRemoveDueDate} style={styles.optionAction}><X color="#666" size={18} /></TouchableOpacity>
              )}
            </TouchableOpacity>
            <View style={styles.separator} />

            {/* Repeat */}
            <TouchableOpacity style={styles.optionRow} onPress={() => {
              if (task.repeat_rule) return;
              setShowRepeatMenu(true);
            }}>
              <Repeat color={task.repeat_rule ? '#4da6ff' : '#888'} size={22} style={styles.optionIcon} />
              <View style={styles.optionTextContainer}>
                <Text style={[styles.optionText, task.repeat_rule && { color: '#4da6ff' }]}>
                  {t('taskDetail.repeat')}
                </Text>
                {task.repeat_rule && (
                  <Text style={styles.optionSubtext}>{task.repeat_rule.charAt(0).toUpperCase() + task.repeat_rule.slice(1)}</Text>
                )}
              </View>
              {task.repeat_rule && (
                <TouchableOpacity onPress={handleRemoveRepeat} style={styles.optionAction}><X color="#666" size={18} /></TouchableOpacity>
              )}
            </TouchableOpacity>
            <View style={styles.separator} />

            {/* Priority */}
            <View style={styles.detailRow}>
              <Flag color={getPriorityColor(task.priority ?? 1)} size={22} fill={(task.priority ?? 1) !== 1 ? getPriorityColor(task.priority ?? 1) : 'transparent'} />
              <TouchableOpacity style={{ flex: 1, marginLeft: 16 }} onPress={() => setShowPriorityMenu(!showPriorityMenu)}>
                <Text style={[styles.detailLabel, { color: '#A1A1AA' }]}>{t('taskDetail.priority')}</Text>
                <Text style={[styles.detailValue, { color: getPriorityColor(task.priority ?? 1) }]}>
                  {getPriorityLabel(task.priority ?? 1)}
                </Text>
              </TouchableOpacity>
            </View>

            {showPriorityMenu && (
              <Animated.View entering={FadeIn.duration(200)} style={{ backgroundColor: '#1C1C1E', borderRadius: 12, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden' }}>
                {Object.entries(PRIORITY_CONFIG).reverse().map(([value, config]) => (
                  <TouchableOpacity
                    key={value}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: '#333' }}
                    onPress={() => {
                      handleUpdateField({ priority: Number(value) });
                      setShowPriorityMenu(false);
                    }}
                  >
                    <Flag color={config.color} size={20} fill={Number(value) !== 1 ? config.color : 'transparent'} />
                    <Text style={{ color: '#fff', fontSize: 16, marginLeft: 14, flex: 1 }}>{config.label}</Text>
                    {(task.priority ?? 1) === Number(value) && <Check color={config.color} size={20} />}
                  </TouchableOpacity>
                ))}
              </Animated.View>
            )}
          </View>

          {/* ─── Notes ────────────────────────────────── */}
          <View style={[styles.notesSection, !canMutate && styles.disabledControl]}>
            <View style={styles.noteHeader}>
              <FileText color="#888" size={16} />
              <Text style={styles.noteHeaderText}>{t('taskDetail.noteLabel')}</Text>
            </View>
            <TextInput
              value={noteText} onChangeText={setNoteText} onBlur={handleSaveNotes}
              editable={canMutate}
              placeholder={t('taskDetail.addNotePlaceholder')} placeholderTextColor="#555"
              style={styles.noteInput} multiline textAlignVertical="top"
            />
          </View>

          {isShared && resolvedUserId && (
            <View style={styles.commentsSection}>
              <View style={styles.commentsHeader}>
                <Text style={styles.commentsTitle}>Comments</Text>
                {!canMutate && <Text style={styles.readOnlyText}>View only</Text>}
              </View>
              <CommentThread
                userId={resolvedUserId}
                taskId={normalizeId(task.id)}
                comments={comments}
                members={members}
                onCommentsChange={setComments}
                readOnly={!canMutate}
              />
            </View>
          )}

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={styles.bottomTimestamp}>
              {t('taskDetail.createdAt', { time: formatCreatedAt(task.created_at, t) })}
            </Text>
            <TouchableOpacity disabled={!canMutate} onPress={handleDelete} style={[styles.deleteBtn, !canMutate && styles.disabledControl]}>
              <Trash2 color="#A1A1AA" size={22} />
            </TouchableOpacity>
          </View>
        </ScrollView>

        {isShared && (
          <AssigneePicker
            visible={showAssigneePicker}
            onClose={() => setShowAssigneePicker(false)}
            members={members}
            value={task.assigned_to}
            onSelect={handleAssigneeSelect}
            disabled={!canMutate}
          />
        )}

        {/* ─── Date Picker ────────────────────────────── */}
        {showDatePicker && (
          <DateTimePicker
            value={pickerDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(e, date) => {
              if (Platform.OS === 'android') { setShowDatePicker(false); if (e.type === 'set' && date) handleSetDueDate(date); }
              else { if (date) setPickerDate(date); }
            }}
            minimumDate={new Date()} themeVariant="dark"
          />
        )}
        {showDatePicker && Platform.OS === 'ios' && (
          <View style={styles.iosPickerButtons}>
            <TouchableOpacity onPress={() => setShowDatePicker(false)} style={styles.iosPickerBtn}><Text style={styles.iosPickerBtnText}>{t('taskDetail.cancel')}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => handleSetDueDate(pickerDate)} style={styles.iosPickerBtn}><Text style={[styles.iosPickerBtnText, { color: '#4da6ff' }]}>{t('taskDetail.done')}</Text></TouchableOpacity>
          </View>
        )}

        {/* ─── Reminder Picker ────────────────────────── */}
        {showReminderPicker && (
          <DateTimePicker
            value={pickerDate} mode={reminderStep === 'date' ? 'date' : 'time'}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(e, date) => {
              if (Platform.OS === 'android') {
                if (e.type === 'dismissed') { setShowReminderPicker(false); setReminderStep('date'); return; }
                if (date) handleSetReminder(date);
              } else { if (date) setPickerDate(date); }
            }}
            minimumDate={reminderStep === 'date' ? new Date() : undefined} themeVariant="dark"
          />
        )}
        {showReminderPicker && Platform.OS === 'ios' && (
          <View style={styles.iosPickerButtons}>
            <TouchableOpacity onPress={() => { setShowReminderPicker(false); setReminderStep('date'); }} style={styles.iosPickerBtn}><Text style={styles.iosPickerBtnText}>{t('taskDetail.cancel')}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => handleSetReminder(pickerDate)} style={styles.iosPickerBtn}><Text style={[styles.iosPickerBtnText, { color: '#4da6ff' }]}>{reminderStep === 'date' ? t('taskDetail.next') : t('taskDetail.done')}</Text></TouchableOpacity>
          </View>
        )}

        {/* ─── Repeat Sheet ───────────────────────────── */}
        {showRepeatMenu && (
          <>
            <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowRepeatMenu(false)} />
            <Animated.View entering={SlideInDown.duration(250)} exiting={SlideOutDown.duration(200)} style={[styles.repeatSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>{t('taskDetail.repeat')}</Text>
              {REPEAT_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.value} style={styles.sheetOption} onPress={() => handleSetRepeat(opt.value)}>
                  <Repeat color="#fff" size={20} style={{ marginRight: 16 }} />
                  <Text style={styles.sheetOptionText}>{opt.label}</Text>
                  {task.repeat_rule === opt.value && <Check color="#4da6ff" size={20} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              ))}
            </Animated.View>
          </>
        )}
      </KeyboardAvoidingView>
    </BackgroundWrapper>
  );
};

const makeStyles = (ACCENT, ON_ACCENT) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 12 },
  headerBtn: { padding: 8 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  emptyState: { flex: 1, alignItems: 'flex-start', paddingHorizontal: 32, paddingTop: 24 },
  emptyStateTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  emptyStateText: { color: '#777', fontSize: 13, lineHeight: 19, marginTop: 7, maxWidth: 360 },
  disabledControl: { opacity: 0.55 },
  syncStripWrap: { marginTop: 8, gap: 7 },
  pendingText: { color: '#A1A1AA', fontSize: 12, fontWeight: '500' },
  readOnlyBanner: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  readOnlyText: { color: '#A1A1AA', fontSize: 12, lineHeight: 18, fontWeight: '500' },
  mutationErrorText: { color: '#FCA5A5', fontSize: 12, lineHeight: 18 },

  // Title
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 20 },
  titleCheckbox: { marginRight: 14, marginTop: 2 },
  titleContent: { flex: 1, paddingRight: 12 },
  titleText: { color: '#fff', fontSize: 22, fontWeight: '600', lineHeight: 30 },
  titleCompleted: { color: '#666', textDecorationLine: 'line-through' },
  titleInput: { color: '#fff', fontSize: 22, fontWeight: '600', lineHeight: 30, padding: 0, borderBottomWidth: 2, borderBottomColor: '#4da6ff', paddingBottom: 4 },
  titleStar: { padding: 4, marginTop: 2 },

  // Subtasks
  subtasksSection: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  subtaskCheckbox: { marginRight: 12 },
  subtaskText: { flex: 1, color: '#ddd', fontSize: 15, fontWeight: '400' },
  subtaskCompleted: { color: '#555', textDecorationLine: 'line-through' },
  subtaskDelete: { padding: 6, marginLeft: 4 },
  subtaskInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  subtaskInput: { flex: 1, color: '#fff', fontSize: 15, padding: 0, marginRight: 8 },
  subtaskDoneBtn: { padding: 6 },
  addSubtaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  addSubtaskText: { color: '#4da6ff', fontSize: 15, fontWeight: '500' },
  subtaskProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 10,
  },
  progressBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: '#4da6ff',
    borderRadius: 2,
  },
  progressText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'right',
  },

  // Focus Mode
  focusModeBtn: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  focusModeBtnText: { color: ON_ACCENT, fontSize: 15, fontWeight: '600' },
  assigneeRow: {
    minHeight: 68,
    marginBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  assigneeName: { color: '#E4E4E7', fontSize: 16, fontWeight: '500', marginTop: 2 },
  assigneeAction: { color: '#A1A1AA', fontSize: 12, fontWeight: '500' },

  // Options
  optionsSection: { marginTop: 0, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, overflow: 'hidden' },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16 },
  optionIcon: { marginRight: 16 },
  optionTextContainer: { flex: 1 },
  optionText: { color: '#aaa', fontSize: 16, fontWeight: '400' },
  optionSubtext: { color: '#666', fontSize: 13, marginTop: 2 },
  optionAction: { padding: 6, marginLeft: 8 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)', marginLeft: 54 },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16 },
  detailLabel: { color: '#A1A1AA', fontSize: 13, fontWeight: '500', marginBottom: 2 },
  detailValue: { fontSize: 16, fontWeight: '600' },

  // Notes
  notesSection: {
    marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 16,
    minHeight: 100,
  },
  noteHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  noteHeaderText: { color: '#888', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  noteInput: { color: '#ccc', fontSize: 15, lineHeight: 22, padding: 0 },
  commentsSection: { marginTop: 20 },
  commentsHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentsTitle: { color: '#888', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },

  // Bottom
  bottomBar: {
    minHeight: 64,
    marginTop: 20,
    marginHorizontal: -20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0A0A0A',
  },
  bottomTimestamp: { color: '#71717A', fontSize: 13, fontWeight: '400' },
  deleteBtn: { padding: 8 },

  // Pickers
  iosPickerButtons: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#1a1a1a' },
  iosPickerBtn: { padding: 8 },
  iosPickerBtnText: { color: '#aaa', fontSize: 16, fontWeight: '600' },

  // Repeat Sheet
  menuOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  repeatSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingHorizontal: 16 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#444', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12, paddingHorizontal: 4 },
  sheetOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)' },
  sheetOptionText: { color: '#ddd', fontSize: 16, fontWeight: '500' },
});

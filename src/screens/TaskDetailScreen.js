import DateTimePicker from '@react-native-community/datetimepicker';
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
    Trash2, X,
    Zap
} from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
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
import { getPriorityColor, getPriorityLabel, PRIORITY_CONFIG } from '../config/priorityConfig';
import { useTheme } from '../context/ThemeContext';
import { cacheTasks, deleteTask as dmDeleteTask, toggleTaskImportance, updateTask } from '../lib/dataManager';
import { syncToSupabase } from '../lib/syncQueue';
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

export const TaskDetailScreen = ({ route, navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const ACCENT = useTheme().theme.accent;
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);
  const { task: initialTask, userId } = route.params;
  const REPEAT_OPTIONS = useMemo(() => getRepeatOptions(t), [t]);

  const [task, setTask] = useState(initialTask);
  const [noteText, setNoteText] = useState(initialTask.notes || '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(initialTask.title);
  
  // Subtask state
  const [subtasks, setSubtasks] = useState(initialTask.subtasks || []);
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

  // ─── Persist helper ───────────────────────────────────
  const handleUpdateField = async (fields) => {
    const updatedTask = { ...task, ...fields };
    setTask(updatedTask);
    const allTasks = await Storage.get(`tasks_${userId}`);
    if (allTasks) {
      await updateTask(userId, allTasks, task.id, fields);
    }
  };

  // ─── Subtask handlers ─────────────────────────────────
  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;
    const newSub = {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: newSubtaskTitle.trim(),
      is_completed: false,
    };
    const updated = [...subtasks, newSub];
    setSubtasks(updated);
    setNewSubtaskTitle('');
    await handleUpdateField({ subtasks: updated });
  };

  const handleToggleSubtask = async (subId) => {
    let becameComplete = false;
    const updated = subtasks.map(s => {
      if (s.id !== subId) return s;
      becameComplete = !s.is_completed;
      return { ...s, is_completed: !s.is_completed };
    });
    setSubtasks(updated);
    await handleUpdateField({ subtasks: updated });
    // Small step XP (also triggers the +/− XP popup via addXP).
    if (userId) {
      const delta = becameComplete ? Gamification.xpForSubtask() : -Gamification.xpForSubtask();
      await Gamification.addXP(userId, delta);
    }
  };

  const handleDeleteSubtask = async (subId) => {
    const updated = subtasks.filter(s => s.id !== subId);
    setSubtasks(updated);
    await handleUpdateField({ subtasks: updated });
  };

  // ─── Task handlers ────────────────────────────────────
  const handleToggleComplete = async () => {
    const newStatus = !task.is_completed;
    const completedAt = newStatus ? new Date().toISOString() : null;
    
    setTask(prev => ({ ...prev, is_completed: newStatus, completed_at: completedAt }));
    
    // ✅ FIX: Load fresh tasks, update only this task
    const latestTasks = await Storage.get(`tasks_${userId}`) || [];
    const storedTask = latestTasks.find(t => t.id === task.id) || task;

    // On complete: grant priority-based XP and remember the exact amount.
    // On uncomplete: deduct that same remembered amount (fallback to priority).
    const xpAmount = newStatus
      ? Gamification.xpForTask(task)
      : ((storedTask.xp_awarded != null) ? storedTask.xp_awarded : Gamification.xpForTask(task));

    const updated = latestTasks.map(t =>
      t.id === task.id 
        ? { ...t, is_completed: newStatus, completed_at: completedAt, xp_awarded: newStatus ? xpAmount : null }
        : t
    );
    
    await cacheTasks(userId, updated);
    
    syncToSupabase('tasks', 'update',
      { is_completed: newStatus, completed_at: completedAt },
      { column: 'id', value: task.id }
    );
    
    if (newStatus && task.reminder_time) cancelTaskReminder(task.id);
    else if (!newStatus && task.reminder_time) scheduleTaskReminder(task.id, task.title, task.reminder_time);
    
    await Gamification.addXP(userId, newStatus ? xpAmount : -xpAmount);
  };

  const handleToggleImportant = async () => {
    const newStatus = !task.is_important;
    setTask(prev => ({ ...prev, is_important: newStatus }));
    const allTasks = await Storage.get(`tasks_${userId}`);
    if (allTasks) await toggleTaskImportance(userId, allTasks, task.id, task.is_important);
  };

  const handleTitleSave = async () => {
    setIsEditingTitle(false);
    Keyboard.dismiss();
    if (editTitle.trim() && editTitle.trim() !== task.title) {
      await handleUpdateField({ title: editTitle.trim() });
    } else {
      setEditTitle(task.title);
    }
  };

  const handleSetDueDate = async (date) => {
    setShowDatePicker(false);
    if (date) {
      const d = new Date(date); d.setHours(23, 59, 0, 0);
      await handleUpdateField({ due_date: d.toISOString() });
    }
  };

  const handleRemoveDueDate = () => handleUpdateField({ due_date: null });

  const handleSetReminder = async (date) => {
    if (reminderStep === 'date') { setPickerDate(date); setReminderStep('time'); return; }
    setShowReminderPicker(false); setReminderStep('date');
    if (date) {
      const finalDate = new Date(pickerDate);
      finalDate.setHours(date.getHours(), date.getMinutes(), 0, 0);
      await handleUpdateField({ reminder_time: finalDate.toISOString() });
      scheduleTaskReminder(task.id, task.title, finalDate.toISOString());
    }
  };

  const handleRemoveReminder = async () => {
    cancelTaskReminder(task.id);
    await handleUpdateField({ reminder_time: null });
  };

  const handleSetRepeat = async (rule) => {
    setShowRepeatMenu(false);
    await handleUpdateField({ repeat_rule: rule });
  };

  const handleRemoveRepeat = () => handleUpdateField({ repeat_rule: null });

  const handleSaveNotes = async () => {
    Keyboard.dismiss();
    await handleUpdateField({ notes: noteText });
  };

  const handleDelete = () => {
    Alert.alert(t('taskDetail.deleteTaskTitle'), t('taskDetail.deleteTaskMessage', { title: task.title }), [
      { text: t('taskDetail.cancel'), style: 'cancel' },
      {
        text: t('taskDetail.deleteButton'), style: 'destructive',
        onPress: async () => {
          cancelTaskReminder(task.id);
          const allTasks = await Storage.get(`tasks_${userId}`);
          if (allTasks) await dmDeleteTask(userId, allTasks, task.id);
          navigation.goBack();
        },
      },
    ]);
  };

  const handleGoBack = async () => {
    if (noteText !== (initialTask.notes || '')) {
      await handleUpdateField({ notes: noteText });
    }
    navigation.goBack();
  };

  // Subtask stats
  const completedSubtasks = subtasks.filter(s => s.is_completed).length;
  const totalSubtasks = subtasks.length;

  return (
    <BackgroundWrapper>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── Task Title Row ───────────────────────── */}
          <View style={styles.titleRow}>
            <TouchableOpacity onPress={handleToggleComplete} style={styles.titleCheckbox}>
              {task.is_completed
                ? <CheckCircle2 color="#34D399" size={28} />
                : <Circle color="#fff" size={28} />}
            </TouchableOpacity>
            <View style={styles.titleContent}>
              {isEditingTitle ? (
                <TextInput
                  ref={titleInputRef} value={editTitle} onChangeText={setEditTitle}
                  onBlur={handleTitleSave} onSubmitEditing={handleTitleSave}
                  style={styles.titleInput} autoFocus multiline blurOnSubmit
                />
              ) : (
                <TouchableOpacity onPress={() => setIsEditingTitle(true)}>
                  <Text style={[styles.titleText, task.is_completed && styles.titleCompleted]}>{task.title}</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity onPress={handleToggleImportant} style={styles.titleStar}>
              <Star color={task.is_important ? '#FBBF24' : '#555'} fill={task.is_important ? '#FBBF24' : 'transparent'} size={24} />
            </TouchableOpacity>
          </View>

          {/* ─── Subtasks Section ─────────────────────── */}
          <View style={styles.subtasksSection}>
            {subtasks.map((sub, index) => (
              <Animated.View
                key={sub.id}
                entering={FadeIn.duration(200)}
                layout={Layout.springify()}
                style={styles.subtaskRow}
              >
                <TouchableOpacity onPress={() => handleToggleSubtask(sub.id)} style={styles.subtaskCheckbox}>
                  {sub.is_completed
                    ? <CheckCircle2 color="#34D399" size={20} />
                    : <Circle color="#555" size={20} />}
                </TouchableOpacity>
                <Text style={[styles.subtaskText, sub.is_completed && styles.subtaskCompleted]}>
                  {sub.title}
                </Text>
                <TouchableOpacity onPress={() => handleDeleteSubtask(sub.id)} style={styles.subtaskDelete}>
                  <X color="#444" size={16} />
                </TouchableOpacity>
              </Animated.View>
            ))}

            {/* Add Subtask */}
            {isAddingSubtask ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.subtaskInputRow}>
                <Circle color="#555" size={20} style={{ marginRight: 12 }} />
                <TextInput
                  ref={subtaskInputRef}
                  value={newSubtaskTitle}
                  onChangeText={setNewSubtaskTitle}
                  placeholder={t('taskDetail.addStepPlaceholder')}
                  placeholderTextColor="#555"
                  style={styles.subtaskInput}
                  autoFocus
                  onSubmitEditing={() => {
                    handleAddSubtask();
                    // Keep input open for adding more
                  }}
                  blurOnSubmit={false}
                  returnKeyType="done"
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
            )}

            {/* Progress bar */}
            {totalSubtasks > 0 && (
              <View style={styles.subtaskProgress}>
                <View style={styles.progressBarBg}>
                  <Animated.View
                    style={[styles.progressBarFill, { width: `${(completedSubtasks / totalSubtasks) * 100}%` }]}
                  />
                </View>
                <Text style={styles.progressText}>
                  {t('taskDetail.subtaskProgress', { completed: completedSubtasks, total: totalSubtasks })}
                </Text>
              </View>
            )}
          </View>

          {/* ─── Focus Mode Button ──────────────────────── */}
          <TouchableOpacity 
            style={styles.focusModeBtn} 
            onPress={() => navigation.navigate('FocusMode', { task })}
          >
            <Zap color="#fff" size={20} fill="#fff" style={{ marginRight: 10 }} />
            <Text style={styles.focusModeBtnText}>{t('taskDetail.startFocusMode')}</Text>
          </TouchableOpacity>

          {/* ─── Options List ─────────────────────────── */}
          <View style={styles.optionsSection}>
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
          <View style={styles.notesSection}>
            <View style={styles.noteHeader}>
              <FileText color="#888" size={16} />
              <Text style={styles.noteHeaderText}>{t('taskDetail.noteLabel')}</Text>
            </View>
            <TextInput
              value={noteText} onChangeText={setNoteText} onBlur={handleSaveNotes}
              placeholder={t('taskDetail.addNotePlaceholder')} placeholderTextColor="#555"
              style={styles.noteInput} multiline textAlignVertical="top"
            />
          </View>
        </ScrollView>

        {/* ─── Bottom Bar ─────────────────────────────── */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.bottomTimestamp}>
            {t('taskDetail.createdAt', { time: formatCreatedAt(task.created_at, t) })}
          </Text>
          <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
            <Trash2 color="#888" size={22} />
          </TouchableOpacity>
        </View>

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

const makeStyles = (ACCENT) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerBtn: { padding: 8 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },

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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  focusModeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

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
  detailLabel: { fontSize: 13, fontWeight: '500', marginBottom: 2 },
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

  // Bottom
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0a0a0a',
  },
  bottomTimestamp: { color: '#555', fontSize: 13, fontWeight: '400' },
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

/**
 * LifePilot — Morning Focus ("Today's Focus")
 * Compact, offline-first morning command center. Task reads and writes stay
 * behind dataManager; weather and device calendar are optional enhancements.
 */
import { useFocusEffect } from '@react-navigation/native';
import {
    CalendarDays,
    CheckCircle2,
    Circle,
    Clock3,
    CloudRain,
    Droplets,
    Flag,
    NotebookPen,
    Plus,
    Sun,
    Sunrise,
    Sunset,
    Thermometer,
    Wind,
} from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPriorityColor, PRIORITY_LEVELS, shouldShowFlag } from '../config/priorityConfig';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { getDailyMotivation } from '../features/alarm/motivation';
import { getCurrentWeather } from '../features/alarm/weather';
import { addTask, getCurrentUserId, loadTasks, updateTask } from '../lib/dataManager';
import { readableOn } from '../theme/contrast';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';

let Calendar = null;
try {
  Calendar = require('expo-calendar');
} catch (_error) {
  Calendar = null;
}

const startOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const isSameDay = (value, day = new Date()) => {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toDateString() === day.toDateString();
};

const isInTodayScope = (task) => {
  if (task.is_completed) {
    return isSameDay(task.completed_at) || isSameDay(task.due_date) || isSameDay(task.reminder_time);
  }
  if (task.added_to_today) return true;
  if (task.due_date && new Date(task.due_date) <= endOfDay()) return true;
  if (task.reminder_time && new Date(task.reminder_time) <= endOfDay()) return true;
  return !task.list_id && !task.due_date && !task.reminder_time;
};

const isOverdue = (task) => (
  !task.is_completed
  && task.due_date
  && !Number.isNaN(new Date(task.due_date).getTime())
  && new Date(task.due_date) < startOfDay()
);

const isHighPriority = (task) => (
  task.priority === PRIORITY_LEVELS.URGENT || task.priority === PRIORITY_LEVELS.HIGH
);

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const formatDeadline = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const SummaryItem = ({ label, value, color, styles }) => (
  <View style={styles.summaryItem}>
    <Text style={[styles.summaryValue, color && { color }]}>{value}</Text>
    <Text style={styles.summaryLabel} numberOfLines={1}>{label}</Text>
  </View>
);

const TaskRow = ({
  task,
  color,
  detail,
  onOpen,
  onComplete,
  onQuickNote,
  noteActive,
  noteText,
  onChangeNote,
  onSaveNote,
  t,
  accent,
  styles,
}) => (
  <View style={styles.taskWrap}>
    <View style={styles.row}>
      <TouchableOpacity
        accessibilityLabel={t('alarmMorning.completeTask')}
        hitSlop={8}
        onPress={() => onComplete(task)}
        style={styles.iconAction}
      >
        <Circle color={color || '#71717A'} size={20} />
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityLabel={t('alarmMorning.openTask')}
        activeOpacity={0.7}
        onPress={() => onOpen(task)}
        style={styles.rowBody}
      >
        <Text style={styles.rowTitle} numberOfLines={2}>{task.title}</Text>
        {!!detail && <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text>}
      </TouchableOpacity>
      {shouldShowFlag(task.priority) && (
        <Flag color={getPriorityColor(task.priority)} size={13} fill={getPriorityColor(task.priority)} />
      )}
      <TouchableOpacity
        accessibilityLabel={t('alarmMorning.quickNote')}
        hitSlop={8}
        onPress={() => onQuickNote(task)}
        style={styles.iconAction}
      >
        <NotebookPen color={task.notes ? accent : '#71717A'} size={17} />
      </TouchableOpacity>
    </View>
    {noteActive && (
      <View style={styles.inlineEditor}>
        <TextInput
          autoFocus
          multiline
          onChangeText={onChangeNote}
          placeholder={t('alarmMorning.quickNotePlaceholder')}
          placeholderTextColor="#71717A"
          style={styles.inlineInput}
          value={noteText}
        />
        <TouchableOpacity onPress={() => onSaveNote(task)} style={[styles.smallButton, { backgroundColor: accent }]}>
          <Text style={styles.smallButtonText}>{t('alarmMorning.saveNote')}</Text>
        </TouchableOpacity>
      </View>
    )}
  </View>
);

export const MorningFocusScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useAppTheme();
  const accent = theme?.accent || COLORS.dark.accent;
  const onAccent = theme?.onAccent || readableOn(accent);
  const styles = useMemo(() => makeStyles({
    accent,
    onAccent,
    background: theme?.bg || COLORS.dark.background || '#09090B',
    surface: theme?.surface || COLORS.dark.surface || '#141417',
  }), [accent, onAccent, theme?.bg, theme?.surface]);

  const [userId, setUserId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const tasksRef = useRef([]);
  const [weather, setWeather] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [noteTaskId, setNoteTaskId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const { greeting, affirmation } = getDailyMotivation(t);

  const setTaskState = useCallback((next) => {
    const safeTasks = next || [];
    tasksRef.current = safeTasks;
    setTasks(safeTasks);
  }, []);

  const load = useCallback(async () => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    setUserId(uid);
    const cached = await loadTasks(uid, setTaskState);
    setTaskState(cached);
  }, [setTaskState]);

  const loadCalendarPreview = useCallback(async () => {
    if (!Calendar?.getCalendarPermissions || !Calendar?.getCalendars || !Calendar?.listEvents) return;
    try {
      const permission = await Calendar.getCalendarPermissions();
      if (permission?.status !== 'granted') return;
      const calendars = await Calendar.getCalendars(Calendar.EntityTypes?.EVENT);
      if (!calendars?.length) return;
      const events = await Calendar.listEvents(
        calendars.map((calendar) => calendar.id),
        startOfDay(),
        endOfDay(),
      );
      setCalendarEvents((events || []).sort(
        (a, b) => new Date(a.startDate) - new Date(b.startDate),
      ).slice(0, 4));
    } catch (_error) {
      setCalendarEvents([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      getCurrentWeather().then(setWeather).catch(() => setWeather(null));
      loadCalendarPreview();
    }, [load, loadCalendarPreview]),
  );

  const todayTasks = useMemo(() => tasks.filter(isInTodayScope), [tasks]);
  const completed = useMemo(() => todayTasks.filter((task) => task.is_completed), [todayTasks]);
  const incomplete = useMemo(() => todayTasks.filter((task) => !task.is_completed), [todayTasks]);
  const overdue = useMemo(() => incomplete.filter(isOverdue), [incomplete]);
  const highPriority = useMemo(
    () => incomplete.filter((task) => !isOverdue(task) && isHighPriority(task)),
    [incomplete],
  );
  const pending = useMemo(
    () => incomplete.filter((task) => !isOverdue(task) && !isHighPriority(task)),
    [incomplete],
  );
  const highPriorityCount = useMemo(() => incomplete.filter(isHighPriority).length, [incomplete]);
  const upcomingDeadlines = useMemo(() => tasks
    .filter((task) => !task.is_completed && task.due_date && new Date(task.due_date) > endOfDay())
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 3), [tasks]);
  const productivityScore = useMemo(() => {
    if (!todayTasks.length) return 100;
    const completionRate = (completed.length / todayTasks.length) * 100;
    return Math.max(0, Math.min(100, Math.round(completionRate - (overdue.length * 5))));
  }, [completed.length, overdue.length, todayTasks.length]);

  const completeTask = useCallback(async (task) => {
    if (!userId || task.is_completed) return;
    const completedAt = new Date().toISOString();
    const xp = Gamification.xpForTask(task);
    const fields = { is_completed: true, completed_at: completedAt };
    const optimistic = tasksRef.current.map((item) => (
      item.id === task.id ? { ...item, ...fields, xp_awarded: xp } : item
    ));
    setTaskState(optimistic);
    const persisted = await updateTask(userId, optimistic, task.id, fields);
    setTaskState(persisted);
    Gamification.addXP(userId, xp).catch(() => {});
  }, [setTaskState, userId]);

  const openTask = useCallback((task) => {
    navigation.navigate('TaskDetail', { task, userId });
  }, [navigation, userId]);

  const openQuickNote = useCallback((task) => {
    setNoteTaskId((current) => current === task.id ? null : task.id);
    setNoteText(task.notes || '');
  }, []);

  const saveQuickNote = useCallback(async (task) => {
    if (!userId) return;
    const fields = { notes: noteText.trim() };
    const optimistic = tasksRef.current.map((item) => item.id === task.id ? { ...item, ...fields } : item);
    setTaskState(optimistic);
    setNoteTaskId(null);
    Keyboard.dismiss();
    const persisted = await updateTask(userId, optimistic, task.id, fields);
    setTaskState(persisted);
  }, [noteText, setTaskState, userId]);

  const createTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title || !userId) return;
    setNewTaskTitle('');
    setIsAddingTask(false);
    Keyboard.dismiss();
    let syncedTasks = null;
    const next = await addTask(userId, tasksRef.current, {
      title,
      added_to_today: true,
      due_date: null,
      reminder_time: null,
      repeat_rule: null,
      priority: PRIORITY_LEVELS.NORMAL,
    }, (synced) => {
      syncedTasks = synced;
      setTaskState(synced);
    });
    setTaskState(syncedTasks || next);
  }, [newTaskTitle, setTaskState, userId]);

  const rowProps = {
    accent,
    noteActive: false,
    noteText,
    onChangeNote: setNoteText,
    onComplete: completeTask,
    onOpen: openTask,
    onQuickNote: openQuickNote,
    onSaveNote: saveQuickNote,
    t,
  };
  const renderRowProps = (task) => ({ ...rowProps, noteActive: noteTaskId === task.id });
  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const renderTaskRows = (items, color, detailForTask) => items.map((task) => (
    <TaskRow
      key={task.id}
      {...renderRowProps(task)}
      task={task}
      color={color}
      detail={detailForTask?.(task)}
      styles={styles}
    />
  ));

  const weatherDetails = weather ? [
    { key: 'rain', icon: CloudRain, label: t('alarmMorning.rain'), value: weather.rainProbability == null ? null : `${Math.round(weather.rainProbability)}%` },
    { key: 'humidity', icon: Droplets, label: t('alarmMorning.humidity'), value: weather.humidity == null ? null : `${Math.round(weather.humidity)}%` },
    { key: 'wind', icon: Wind, label: t('alarmMorning.wind'), value: weather.windSpeed == null ? null : `${Math.round(weather.windSpeed)} km/h` },
    { key: 'uv', icon: Sun, label: t('alarmMorning.uvIndex'), value: weather.uvIndex == null ? null : `${Math.round(weather.uvIndex)}` },
    { key: 'sunrise', icon: Sunrise, label: t('alarmMorning.sunrise'), value: formatTime(weather.sunrise) || null },
    { key: 'sunset', icon: Sunset, label: t('alarmMorning.sunset'), value: formatTime(weather.sunset) || null },
  ].filter((item) => item.value != null) : [];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Sunrise color={accent} size={25} />
          <Text style={styles.headerLabel}>{t('alarmMorning.focusTitle')}</Text>
        </View>
        <Text style={styles.greeting}>{greeting}</Text>
        <Text style={styles.date}>{dateStr}</Text>

        <View style={styles.affirmationCard}>
          <Text style={styles.affirmation}>{affirmation}</Text>
        </View>

        <View style={styles.summaryGrid}>
          <SummaryItem label={t('alarmMorning.pending')} value={incomplete.length} styles={styles} />
          <SummaryItem label={t('alarmMorning.completed')} value={completed.length} color="#34D399" styles={styles} />
          <SummaryItem label={t('alarmMorning.highPriority')} value={highPriorityCount} color="#FBBF24" styles={styles} />
          <SummaryItem label={t('alarmMorning.overdue')} value={overdue.length} color="#FB7185" styles={styles} />
        </View>
        <View style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>{t('alarmMorning.productivity')}</Text>
          <Text style={[styles.scoreValue, { color: accent }]}>{productivityScore}%</Text>
        </View>

        {isAddingTask ? (
          <View style={styles.createRow}>
            <TextInput
              autoFocus
              onChangeText={setNewTaskTitle}
              onSubmitEditing={createTask}
              placeholder={t('alarmMorning.newTaskPlaceholder')}
              placeholderTextColor="#71717A"
              returnKeyType="done"
              style={styles.createInput}
              value={newTaskTitle}
            />
            <TouchableOpacity disabled={!newTaskTitle.trim()} onPress={createTask} style={[styles.addButton, { backgroundColor: accent }]}>
              <Plus color={onAccent} size={19} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setIsAddingTask(true)} style={styles.createAction}>
            <Plus color={accent} size={17} />
            <Text style={[styles.createActionText, { color: accent }]}>{t('alarmMorning.createTask')}</Text>
          </TouchableOpacity>
        )}

        {weather?.temperature != null && (
          <View style={styles.infoCard}>
            <View style={styles.weatherHero}>
              <Thermometer color={accent} size={22} />
              <Text style={styles.weatherTemp}>{Math.round(weather.temperature)}°</Text>
              <View style={styles.weatherHeroText}>
                <Text style={styles.weatherFeels}>{t('alarmWeather.feelsLike', { temp: Math.round(weather.feelsLike ?? weather.temperature) })}</Text>
                {weather.suggestionKey && <Text style={styles.weatherSuggestion}>{t(weather.suggestionKey)}</Text>}
              </View>
            </View>
            {!!weatherDetails.length && (
              <>
                <Text style={styles.cardTitle}>{t('alarmMorning.weatherDetails')}</Text>
                <View style={styles.detailGrid}>
                  {weatherDetails.map((item) => {
                    const Icon = item.icon;
                    return (
                      <View key={item.key} style={styles.detailItem}>
                        <Icon color="#A1A1AA" size={14} />
                        <Text style={styles.detailLabel}>{item.label}</Text>
                        <Text style={styles.detailValue}>{item.value}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </View>
        )}

        {!!calendarEvents.length && (
          <View style={styles.infoCard}>
            <View style={styles.cardHeader}>
              <CalendarDays color={accent} size={18} />
              <Text style={styles.cardTitle}>{t('alarmMorning.calendarToday')}</Text>
            </View>
            {calendarEvents.map((event) => (
              <View key={`${event.id}-${event.startDate}`} style={styles.eventRow}>
                <Text style={styles.eventTime}>{event.allDay ? t('alarmMorning.allDay') : formatTime(event.startDate)}</Text>
                <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
              </View>
            ))}
          </View>
        )}

        {!incomplete.length ? (
          <View style={styles.emptyWrap}>
            <CheckCircle2 color={accent} size={34} />
            <Text style={styles.emptyText}>{t('alarmMorning.allClear')}</Text>
          </View>
        ) : (
          <>
            {!!overdue.length && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: '#FB7185' }]}>{t('alarmMorning.overdue')} · {overdue.length}</Text>
                {renderTaskRows(overdue, '#FB7185')}
              </View>
            )}
            {!!highPriority.length && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: accent }]}>{t('alarmMorning.highPriority')} · {highPriority.length}</Text>
                {renderTaskRows(highPriority, accent)}
              </View>
            )}
            {!!pending.length && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('alarmMorning.pending')} · {pending.length}</Text>
                {renderTaskRows(pending)}
              </View>
            )}
          </>
        )}

        {!!upcomingDeadlines.length && (
          <View style={styles.section}>
            <View style={styles.cardHeader}>
              <Clock3 color={accent} size={18} />
              <Text style={styles.sectionTitle}>{t('alarmMorning.upcomingDeadlines')}</Text>
            </View>
            {renderTaskRows(upcomingDeadlines, accent, (task) => formatDeadline(task.due_date))}
          </View>
        )}

        <TouchableOpacity style={[styles.startBtn, { backgroundColor: accent }]} activeOpacity={0.85} onPress={() => navigation.goBack()}>
          <Text style={styles.startBtnText}>{t('alarmMorning.startDay')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const makeStyles = ({ accent, onAccent, background, surface }) => StyleSheet.create({
  container: { flex: 1, backgroundColor: background },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 },
  headerLabel: { color: accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  greeting: { color: '#FFF', fontSize: 28, fontWeight: '800' },
  date: { color: '#A1A1AA', fontSize: 13, marginTop: 2 },
  affirmationCard: { marginTop: 15, padding: 14, borderRadius: 15, backgroundColor: surface, borderWidth: 1, borderColor: `${accent}33` },
  affirmation: { color: '#E4E4E7', fontSize: 15, fontWeight: '500', lineHeight: 22, fontStyle: 'italic' },
  summaryGrid: { flexDirection: 'row', gap: 7, marginTop: 12 },
  summaryItem: { flex: 1, minWidth: 0, backgroundColor: surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 5, alignItems: 'center' },
  summaryValue: { color: '#F4F4F5', fontSize: 19, fontWeight: '800' },
  summaryLabel: { color: '#A1A1AA', fontSize: 9, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 3 },
  scoreLabel: { color: '#A1A1AA', fontSize: 12, fontWeight: '700' },
  scoreValue: { fontSize: 14, fontWeight: '900' },
  createAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 13, borderWidth: 1, borderColor: `${accent}55`, borderRadius: 13, paddingVertical: 10 },
  createActionText: { fontSize: 13, fontWeight: '800' },
  createRow: { flexDirection: 'row', gap: 8, marginTop: 13 },
  createInput: { flex: 1, color: '#FFF', backgroundColor: surface, borderRadius: 13, borderWidth: 1, borderColor: `${accent}55`, paddingHorizontal: 13, paddingVertical: 10, fontSize: 14 },
  addButton: { width: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  infoCard: { marginTop: 14, padding: 13, backgroundColor: surface, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2A2A30' },
  weatherHero: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weatherTemp: { color: '#FFF', fontSize: 27, fontWeight: '400' },
  weatherHeroText: { flex: 1 },
  weatherFeels: { color: '#A1A1AA', fontSize: 12, fontWeight: '600' },
  weatherSuggestion: { color: '#C7C7C7', fontSize: 11, fontWeight: '700', marginTop: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  cardTitle: { color: '#A1A1AA', fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 9, marginBottom: 5 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 7 },
  detailItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailLabel: { color: '#71717A', fontSize: 10, flex: 1 },
  detailValue: { color: '#E4E4E7', fontSize: 11, fontWeight: '700', marginRight: 7 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2A2A30' },
  eventTime: { color: accent, fontSize: 10, fontWeight: '800', width: 63 },
  eventTitle: { color: '#E4E4E7', fontSize: 13, flex: 1 },
  section: { marginTop: 18 },
  sectionTitle: { color: '#A1A1AA', fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
  taskWrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272A' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9 },
  iconAction: { padding: 2 },
  rowBody: { flex: 1 },
  rowTitle: { color: '#EDEDED', fontSize: 14, fontWeight: '600' },
  rowDetail: { color: '#71717A', fontSize: 10, marginTop: 2 },
  inlineEditor: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, paddingBottom: 9 },
  inlineInput: { flex: 1, minHeight: 40, maxHeight: 86, color: '#FFF', backgroundColor: surface, borderRadius: 10, borderWidth: 1, borderColor: `${accent}44`, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12 },
  smallButton: { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9 },
  smallButtonText: { color: onAccent, fontSize: 11, fontWeight: '900' },
  emptyWrap: { alignItems: 'center', paddingVertical: 30, gap: 10 },
  emptyText: { color: '#A1A1AA', fontSize: 14, fontWeight: '500', textAlign: 'center' },
  startBtn: { marginTop: 27, paddingVertical: 14, borderRadius: 24, alignItems: 'center' },
  startBtnText: { color: onAccent, fontSize: 15, fontWeight: '900' },
});

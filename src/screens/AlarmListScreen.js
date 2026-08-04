import notifee from '@notifee/react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Archive, ArrowLeft, BarChart3, Copy, Download, MoonStar, Plus, RotateCcw, Search, Star, Sunrise, Trash2, Upload } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, FlatList, Modal, Platform, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { NestableDraggableFlatList, NestableScrollContainer } from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { getAvailableAsync as getAvailableChallengesAsync } from '../features/alarm/challenges';
import { ALARM_CATEGORIES, DEFAULT_VISUAL_CONFIG, deriveRecurrenceFromLegacy, normalizeAlarm } from '../features/alarm/data/alarmModel';
import { mergeVisibleAlarmOrder } from '../features/alarm/data/alarmOrder';
import { applyHolidaySkips, SUPPORTED_HOLIDAY_COUNTRIES } from '../features/alarm/holidays';
import { startAlarmAudio, stopAlarmAudio } from '../features/alarm/ring/audioPlayer';
import { cancelAllAlarms, rescheduleAlarm } from '../features/alarm/scheduler/alarmScheduler';
import { nextOccurrences } from '../features/alarm/scheduler/recurrenceEngine';
import { exportAlarmConfig, importAlarmConfig, loadAlarmDefaults, resetAllAlarmData, saveAlarmDefaults } from '../features/alarm/settings';
import { BUILT_IN_SOUNDS, selectConfiguredSound, SOUND_CATEGORIES } from '../features/alarm/soundLibrary';
import { findLabelColor, LABEL_PRESETS, VIBRATION_OPTIONS } from '../features/alarm/ui/alarmOptions';
import { AlarmReliabilityBanner } from '../features/alarm/ui/AlarmReliabilityBanner';
import { formatRecurrence } from '../features/alarm/ui/recurrenceLabel';
import { RecurrencePicker } from '../features/alarm/ui/RecurrencePicker';
import {
    addAlarm,
    deleteAlarm,
    getCurrentUserId,
    loadAlarms,
    patchAlarmLocal,
    recordWakeSession,
    reorderAlarms,
    resetAlarms,
    updateAlarm
} from '../lib/dataManager';
import { COLORS } from '../theme/theme';
import { syncAlarmsToNotifications } from '../utils/AlarmManager';
import { Storage } from '../utils/storage';

export const AlarmListScreen = ({ navigation }) => {
  const { t } = useTranslation();
  // Subscribe to theme changes (COLORS is mutated in place by ThemeContext,
  // so this forces a repaint when the equipped accent changes) — Task 13.4.
  useAppTheme();
  const accent = COLORS.dark.accent;
  const [userId, setUserId] = useState(null);
  const [alarms, setAlarms] = useState([]);
  const [sortOrder, setSortOrder] = useState('time'); // 'time', 'active'

  
  const [isModalVisible, setModalVisible] = useState(false);
  const [editingAlarm, setEditingAlarm] = useState(null);
  
  // Modal State
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [title, setTitle] = useState(t('alarmList.defaultAlarmName'));
  const [vibrate, setVibrate] = useState(true);
  const [soundUri, setSoundUri] = useState('default');
  const [soundName, setSoundName] = useState(t('alarmList.defaultSoundName'));
  const [soundVolume, setSoundVolume] = useState(100);
  const [fadeInSeconds, setFadeInSeconds] = useState(0);
  const [favoriteSound, setFavoriteSound] = useState(false);
  const [soundCategory, setSoundCategory] = useState('nature');
  const [soundSelection, setSoundSelection] = useState([]);
  const [soundRotateMode, setSoundRotateMode] = useState('fixed');
  const [favoriteSoundIds, setFavoriteSoundIds] = useState([]);
  const [recurrence, setRecurrence] = useState({ mode: 'daily', time: '06:00' });
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [labelKey, setLabelKey] = useState(null);
  const [labelText, setLabelText] = useState('');
  const [labelColor, setLabelColor] = useState('#FFFFFF');
  const [clockStyle, setClockStyle] = useState(DEFAULT_VISUAL_CONFIG.clockStyle);
  const [backgroundMode, setBackgroundMode] = useState(DEFAULT_VISUAL_CONFIG.backgroundMode);
  const [palette, setPalette] = useState(DEFAULT_VISUAL_CONFIG.palette);
  const [vibrationPattern, setVibrationPattern] = useState('strong');
  const [snoozeDisabled, setSnoozeDisabled] = useState(false);
  const [snoozeMax, setSnoozeMax] = useState(3);
  const [snoozeDefaultMin, setSnoozeDefaultMin] = useState(5);
  const [snoozeProgressive, setSnoozeProgressive] = useState(false);
  const [smartWakeEnabled, setSmartWakeEnabled] = useState(false);
  const [smartWakeWindow, setSmartWakeWindow] = useState(30);
  const [description, setDescription] = useState('');
  const [missionSteps, setMissionSteps] = useState([]);
  const [availableChallenges, setAvailableChallenges] = useState([]);
  const [category, setCategory] = useState(null);
  const [groupId, setGroupId] = useState('');
  const [skipPublicHolidays, setSkipPublicHolidays] = useState(false);
  const [holidayCountry, setHolidayCountry] = useState('IN');
  const [ambientLeadMin, setAmbientLeadMin] = useState(0); // 0 = off
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [backupAlarmEnabled, setBackupAlarmEnabled] = useState(false);

  // Dashboard: search / archive visibility / grouping
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [groupMode, setGroupMode] = useState('none');
  const [vacationExpanded, setVacationExpanded] = useState(false);
  const [vacationStart, setVacationStart] = useState(new Date());
  const [vacationEnd, setVacationEnd] = useState(new Date());
  const [vacationPickerTarget, setVacationPickerTarget] = useState(null);
  const [pauseDate, setPauseDate] = useState(new Date());
  const [showPauseDatePicker, setShowPauseDatePicker] = useState(false);

  // User Settings
  const [use24HourFormat, setUse24HourFormat] = useState(false);

  // Empty State Animation
  const [snoozeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(snoozeAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(snoozeAnim, { toValue: 0, duration: 2000, useNativeDriver: true })
      ])
    ).start();
  }, [snoozeAnim]);

  useEffect(() => {
    const init = async () => {
      const formatSetting = await Storage.get('time_format_24');
      if (formatSetting === 'true') setUse24HourFormat(true);

      const uid = await getCurrentUserId();
      if (uid) {
        setUserId(uid);
        const applyLoaded = (rows) => setAlarms((rows || []).map(normalizeAlarm));
        const [fetchedAlarms, storedFavorites] = await Promise.all([
          loadAlarms(uid, applyLoaded),
          Storage.get(`alarm_sound_favorites_${uid}`),
        ]);
        applyLoaded(fetchedAlarms);
        setFavoriteSoundIds(Array.isArray(storedFavorites) ? storedFavorites : []);
      }
    };
    init();
  }, []);

  useEffect(() => {
    const checkPermissions = async () => {
      if (Platform.OS === 'android') {
        const settings = await notifee.getNotificationSettings();
        if (settings.android?.canUseFullScreenIntent === false) {
          try {
            await IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.MANAGE_APP_USE_FULL_SCREEN_INTENT
            );
          } catch (e) {
            console.log('IntentLauncher error:', e);
          }
        }
      }
    };
    checkPermissions();
  }, []);

  const toggleTimeFormat = async () => {
    const newFormat = !use24HourFormat;
    setUse24HourFormat(newFormat);
    await Storage.set('time_format_24', newFormat ? 'true' : 'false');
  };

  useEffect(() => {
    if (alarms && alarms.length >= 0) {
      syncAlarmsToNotifications(alarms);
    }
  }, [alarms]);

  const isArchived = (a) => !!(a.flags && a.flags.archived);
  const isFavorite = (a) => !!(a.flags && a.flags.favorite);
  const toLocalIsoDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const searchFiltered = alarms.filter((a) => {
    if (!showArchived && isArchived(a)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const labelName = a.label?.text || a.label?.key || '';
    return (
      (a.title || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q) ||
      labelName.toLowerCase().includes(q) ||
      (a.category || '').toLowerCase().includes(q) ||
      (a.group_id || '').toLowerCase().includes(q)
    );
  });

  const sortedAlarms = [...searchFiltered].sort((a, b) => {
    if (sortOrder === 'custom') {
      return (a.order_index ?? 9999) - (b.order_index ?? 9999);
    }
    const favDiff = (isFavorite(b) ? 1 : 0) - (isFavorite(a) ? 1 : 0);
    if (favDiff !== 0) return favDiff;
    if (sortOrder === 'time') return a.time.localeCompare(b.time);
    if (sortOrder === 'active') {
      return (b.is_active === a.is_active) ? a.time.localeCompare(b.time) : (b.is_active ? 1 : -1);
    }
    return 0;
  });

  const upcomingBucket = (alarm) => {
    const rule = alarm.recurrence || deriveRecurrenceFromLegacy(alarm.time, alarm.days_of_week);
    const today = toLocalIsoDate(new Date());
    if (rule.pausedUntil && rule.pausedUntil > today) return 'paused';
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const skippedSoon = (rule.skipDates || []).some((date) => date >= today && date <= toLocalIsoDate(weekEnd));
    if (skippedSoon) return 'skipped';
    const next = nextOccurrences(rule, new Date(), 1)[0];
    if (!next) return 'skipped';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (toLocalIsoDate(next) === today) return 'today';
    if (toLocalIsoDate(next) === toLocalIsoDate(tomorrow)) return 'tomorrow';
    return 'thisWeek';
  };

  const groupKeyForAlarm = (alarm) => {
    if (groupMode === 'category') return alarm.category || 'ungrouped';
    if (groupMode === 'custom') return alarm.group_id || 'ungrouped';
    if (groupMode === 'upcoming') return upcomingBucket(alarm);
    return null;
  };

  const groupTitle = (key) => {
    if (groupMode === 'category' && key !== 'ungrouped') return t(`alarmCategories.${key}`, key);
    if (groupMode === 'custom' && key !== 'ungrouped') return key;
    return t(`alarmPremium.group.${key}`);
  };

  const groupedRows = (() => {
    if (groupMode === 'none' || sortOrder === 'custom') return sortedAlarms;
    const groups = new Map();
    sortedAlarms.forEach((alarm) => {
      const key = groupKeyForAlarm(alarm);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(alarm);
    });
    const order = groupMode === 'upcoming'
      ? ['today', 'tomorrow', 'thisWeek', 'skipped', 'paused']
      : Array.from(groups.keys()).sort((a, b) => groupTitle(a).localeCompare(groupTitle(b)));
    return order.flatMap((key) => groups.has(key)
      ? [{ id: `group-${groupMode}-${key}`, _isGroupHeader: true, title: groupTitle(key) }, ...groups.get(key)]
      : []);
  })();

  // Persist manual drag order through order_index, a legacy synced column.
  // Replacing only visible slots keeps filtered or archived alarms in the full list.
  const handleReorder = async ({ data }) => {
    if (!userId) return;
    const { merged, changed } = mergeVisibleAlarmOrder(alarms, data);
    setAlarms(merged);
    await reorderAlarms(userId, merged, changed);
  };


  const handleSave = async () => {
    if (!userId) return;
    
    const h = selectedTime.getHours().toString().padStart(2, '0');
    const m = selectedTime.getMinutes().toString().padStart(2, '0');
    const timeStr = `${h}:${m}`;

    // Anchor single-shot alarms to one calendar date so they can never roll
    // forward to tomorrow after firing. Holiday dates remain separate from
    // manual skips and are refreshed whenever the alarm is saved.
    let ruleWithTime = { ...recurrence, time: timeStr };
    if (ruleWithTime.mode === 'once') {
      const occurrence = new Date();
      occurrence.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
      if (occurrence.getTime() <= Date.now()) occurrence.setDate(occurrence.getDate() + 1);
      const y = occurrence.getFullYear();
      const mo = String(occurrence.getMonth() + 1).padStart(2, '0');
      const d = String(occurrence.getDate()).padStart(2, '0');
      ruleWithTime.onceDate = `${y}-${mo}-${d}`;
    }
    ruleWithTime = await applyHolidaySkips(ruleWithTime, skipPublicHolidays ? holidayCountry : null);

    const rotateSet = soundRotateMode === 'fixed' ? null : soundSelection;
    const rotationIndex = soundRotateMode === 'rotate'
      ? ((editingAlarm?.sound_config?.rotationIndex ?? -1) + 1) % Math.max(1, soundSelection.length)
      : 0;
    const draftSoundConfig = {
      uri: soundUri,
      name: soundName,
      volume: soundVolume,
      fadeInMs: fadeInSeconds * 1000,
      favorite: favoriteSound,
      rotateSet,
      rotateMode: soundRotateMode,
      rotationIndex,
    };
    const selectedSoundUri = selectConfiguredSound(draftSoundConfig, `${editingAlarm?.id || title}:${timeStr}`);
    const selectedBuiltIn = BUILT_IN_SOUNDS.find((sound) => sound.id === selectedSoundUri);
    const selectedSoundName = selectedBuiltIn ? t(`alarmPremium.sounds.${selectedBuiltIn.nameKey}`) : soundName;
    const normalized = normalizeAlarm({
      time: timeStr,
      title,
      recurrence: ruleWithTime,
      vibrate,
      sound_uri: selectedSoundUri,
      sound_name: selectedSoundName,
      sound_config: { ...draftSoundConfig, uri: selectedSoundUri, name: selectedSoundName },
      snooze_config: {
        disabled: snoozeDisabled,
        maxCount: snoozeMax,
        defaultMin: snoozeDefaultMin,
        presets: Array.from(new Set([5, 10, 15, 20, 30, 45, 60, snoozeDefaultMin])).sort((a, b) => a - b),
        progressive: snoozeProgressive,
      },
      smart_wake: { enabled: smartWakeEnabled, windowMin: smartWakeWindow },
    });

    // Migration 0011 is intentionally not assumed deployed in production.
    // Legacy columns sync now; rich settings remain cache-first through the
    // data layer and are ready to enable for cloud sync after migration approval.
    const legacyFields = {
      time: timeStr,
      title,
      days_of_week: normalized.days_of_week,
      vibrate: vibrationPattern !== 'none',
      sound_uri: selectedSoundUri,
      sound_name: selectedSoundName,
      is_active: editingAlarm?.is_active ?? true,
    };
    const richLocal = {
      recurrence: normalized.recurrence,
      vibration_pattern: vibrationPattern,
      sound_config: normalized.sound_config,
      label: (labelText.trim() || labelKey)
        ? { key: labelKey, text: labelText.trim() || null, color: labelColor || findLabelColor(labelKey) }
        : null,
      visual_config: { clockStyle, backgroundMode, palette },
      category,
      group_id: groupId.trim() || null,
      snooze_config: normalized.snooze_config,
      description: description.trim() || null,
      mission: missionSteps,
      smart_wake: normalized.smart_wake,
      ambient: { enabled: ambientLeadMin > 0, leadMin: ambientLeadMin || 10, visual: 'sunrise', soundscape: null },
      flags: { ...(editingAlarm?.flags || {}), emergency: emergencyMode, backupAlarm: backupAlarmEnabled },
    };

    let updated;
    let targetId;
    if (editingAlarm) {
      targetId = editingAlarm.id;
      updated = await updateAlarm(userId, alarms, editingAlarm.id, legacyFields);
    } else {
      const prevIds = new Set(alarms.map((a) => a.id));
      updated = await addAlarm(userId, alarms, { ...legacyFields, sound: true });
      const added = updated.find((a) => !prevIds.has(a.id));
      targetId = added ? added.id : null;
    }

    // Patch rich, local-only fields through dataManager without assuming the
    // production migration exists yet.
    if (targetId) {
      updated = await patchAlarmLocal(userId, updated, targetId, richLocal);
    }
    setAlarms(updated);
    setModalVisible(false);
  };

  const handleDelete = async () => {
    if (!editingAlarm || !userId) return;
    const updated = await deleteAlarm(userId, alarms, editingAlarm.id);
    setAlarms(updated);
    setModalVisible(false);
  };

  const applyDefaultsToEditor = async (showConfirmation = false) => {
    const defaults = await loadAlarmDefaults(userId);
    const sound = defaults.sound_config || {};
    setVibrate(defaults.vibration_pattern !== 'none');
    setVibrationPattern(defaults.vibration_pattern || 'strong');
    setSoundUri(sound.uri || 'default');
    setSoundName(sound.name || t('alarmList.defaultSoundName'));
    setSoundVolume(sound.volume ?? 100);
    setFadeInSeconds(Math.round((sound.fadeInMs || 0) / 1000));
    setFavoriteSound(!!sound.favorite);
    setSoundSelection(Array.isArray(sound.rotateSet) ? sound.rotateSet : (sound.uri && sound.uri !== 'default' ? [sound.uri] : []));
    setSoundRotateMode(sound.rotateMode || 'fixed');
    setSnoozeDisabled(!!defaults.snooze_config?.disabled);
    setSnoozeMax(defaults.snooze_config?.maxCount ?? 3);
    setSnoozeDefaultMin(defaults.snooze_config?.defaultMin ?? 5);
    setSnoozeProgressive(!!defaults.snooze_config?.progressive);
    setMissionSteps(Array.isArray(defaults.mission) ? defaults.mission : []);
    setCategory(defaults.category || null);
    if (showConfirmation) Alert.alert('', t('alarmPremium.defaultsApplied'));
  };

  const openNewAlarmModal = async () => {
    setEditingAlarm(null);
    const d = new Date();
    d.setHours(6, 0, 0, 0); // Default to 06:00 AM
    setSelectedTime(d);
    setTitle(t('alarmList.defaultAlarmName'));
    setSoundUri('default');
    setSoundName(t('alarmList.defaultSoundName'));
    setSoundVolume(100);
    setFadeInSeconds(0);
    setFavoriteSound(false);
    setSoundSelection([]);
    setSoundRotateMode('fixed');
    setRecurrence({ mode: 'daily', time: '06:00' });
    setLabelKey(null);
    setLabelText('');
    setLabelColor('#FFFFFF');
    setClockStyle(DEFAULT_VISUAL_CONFIG.clockStyle);
    setBackgroundMode(DEFAULT_VISUAL_CONFIG.backgroundMode);
    setPalette(DEFAULT_VISUAL_CONFIG.palette);
    setDescription('');
    setMissionSteps([]);
    setCategory(null);
    setGroupId('');
    setSkipPublicHolidays(false);
    setHolidayCountry('IN');
    setAvailableChallenges(await getAvailableChallengesAsync());
    setAmbientLeadMin(0);
    setSmartWakeEnabled(false);
    setSmartWakeWindow(30);
    setEmergencyMode(false);
    setBackupAlarmEnabled(false);
    setPauseDate(new Date());

    // Apply all locally stored global defaults to the new alarm editor.
    await applyDefaultsToEditor();

    setModalVisible(true);
  };

  const openEditAlarmModal = async (alarm) => {
    setEditingAlarm(alarm);
    
    const [hours, minutes] = alarm.time.split(':');
    const d = new Date();
    d.setHours(parseInt(hours, 10));
    d.setMinutes(parseInt(minutes, 10));
    
    setSelectedTime(d);
    setTitle(alarm.title || t('alarmList.defaultAlarmName'));
    setVibrate(alarm.vibrate ?? true);
    setSoundUri(alarm.sound_config?.uri || alarm.sound_uri || 'default');
    setSoundName(alarm.sound_config?.name || alarm.sound_name || t('alarmList.defaultSoundName'));
    setSoundVolume(alarm.sound_config?.volume ?? 100);
    setFadeInSeconds(Math.round((alarm.sound_config?.fadeInMs || 0) / 1000));
    setFavoriteSound(!!alarm.sound_config?.favorite);
    const configuredSound = alarm.sound_config?.uri || alarm.sound_uri || 'default';
    setSoundSelection(Array.isArray(alarm.sound_config?.rotateSet)
      ? alarm.sound_config.rotateSet
      : (BUILT_IN_SOUNDS.some((sound) => sound.id === configuredSound) ? [configuredSound] : []));
    setSoundRotateMode(alarm.sound_config?.rotateMode || 'fixed');
    // Seed recurrence from the alarm's rule, or derive it from legacy days.
    setRecurrence(alarm.recurrence || deriveRecurrenceFromLegacy(alarm.time, alarm.days_of_week));
    setLabelKey(alarm.label?.key || null);
    setLabelText(alarm.label?.text || '');
    setLabelColor(alarm.label?.color || findLabelColor(alarm.label?.key) || '#FFFFFF');
    const visualConfig = normalizeAlarm(alarm).visual_config;
    setClockStyle(visualConfig.clockStyle);
    setBackgroundMode(visualConfig.backgroundMode);
    setPalette(visualConfig.palette);
    setVibrationPattern(alarm.vibration_pattern || (alarm.vibrate === false ? 'none' : 'strong'));
    setSnoozeDisabled(!!(alarm.snooze_config && alarm.snooze_config.disabled));
    setSnoozeMax(alarm.snooze_config && alarm.snooze_config.maxCount != null ? alarm.snooze_config.maxCount : 3);
    setSnoozeDefaultMin(alarm.snooze_config?.defaultMin ?? 5);
    setSnoozeProgressive(!!alarm.snooze_config?.progressive);
    setDescription(alarm.description || '');
    setMissionSteps(Array.isArray(alarm.mission) ? alarm.mission : []);
    setCategory(alarm.category || null);
    setGroupId(alarm.group_id || '');
    setSkipPublicHolidays(!!alarm.recurrence?.skipPublicHolidays);
    setHolidayCountry(alarm.recurrence?.holidayCountry || 'IN');
    setAvailableChallenges(await getAvailableChallengesAsync());
    setAmbientLeadMin(alarm.ambient && alarm.ambient.enabled ? (alarm.ambient.leadMin || 10) : 0);
    setSmartWakeEnabled(!!alarm.smart_wake?.enabled);
    setSmartWakeWindow(alarm.smart_wake?.windowMin || 30);
    setEmergencyMode(!!(alarm.flags && alarm.flags.emergency));
    setBackupAlarmEnabled(!!(alarm.flags && alarm.flags.backupAlarm));
    const pausedUntil = alarm.recurrence?.pausedUntil;
    setPauseDate(pausedUntil ? new Date(`${pausedUntil}T12:00:00`) : new Date());
    setModalVisible(true);
  };

  const toggleAlarmActive = async (alarmId, currentActive) => {
    if (!userId) return;
    // Optimistic UI
    setAlarms(prev => prev.map(a => a.id === alarmId ? { ...a, is_active: !currentActive } : a));
    // Save to DB
    const updated = await updateAlarm(userId, alarms, alarmId, { is_active: !currentActive });
    setAlarms(updated);
  };

  // Favorite / archive are cosmetic, LOCAL-ONLY flags (like recurrence) — no
  // legacy column exists for them, so they're patched into cache directly
  // rather than routed through updateAlarm's Supabase sync.
  const patchLocalFlags = async (alarmId, flagPatch) => {
    if (!userId) return;
    const target = alarms.find((a) => a.id === alarmId);
    if (!target) return;
    const flags = { ...(target.flags || {}), ...flagPatch };
    const updated = await patchAlarmLocal(userId, alarms, alarmId, { flags });
    setAlarms(updated);
  };

  const toggleFavorite = (alarm) => patchLocalFlags(alarm.id, { favorite: !(alarm.flags && alarm.flags.favorite) });
  const toggleArchived = (alarm) => patchLocalFlags(alarm.id, { archived: !(alarm.flags && alarm.flags.archived) });

  const toggleMissionStep = (descriptor) => {
    setMissionSteps((steps) => {
      const exists = steps.some((step) => step.id === descriptor.id);
      if (exists) return steps.filter((step) => step.id !== descriptor.id);
      return [...steps, { id: descriptor.id, difficulty: descriptor.defaultDifficulty || 'medium', config: {} }];
    });
  };

  const setMissionDifficulty = (id, difficulty) => {
    setMissionSteps((steps) => steps.map((step) => step.id === id ? { ...step, difficulty } : step));
  };

  const moveMissionStep = (index, direction) => {
    setMissionSteps((steps) => {
      const target = index + direction;
      if (target < 0 || target >= steps.length) return steps;
      const next = [...steps];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const duplicateAlarm = async (alarm) => {
    if (!userId) return;
    // Only sync LEGACY columns (see handleSave note); rich fields are copied
    // locally afterward so the duplicate behaves identically without risking
    // a fatal schema error on columns the server may not have yet.
    const legacyFields = {
      time: alarm.time,
      title: alarm.title ? t('alarmPremium.copyTitle', { title: alarm.title }) : null,
      days_of_week: alarm.days_of_week,
      vibrate: alarm.vibrate,
      sound_uri: alarm.sound_uri,
      sound_name: alarm.sound_name,
      sound: true,
      is_active: alarm.is_active ?? true,
    };
    const prevIds = new Set(alarms.map((a) => a.id));
    let updated = await addAlarm(userId, alarms, legacyFields);
    const added = updated.find((a) => !prevIds.has(a.id));
    if (added) {
      const richLocal = {
        recurrence: alarm.recurrence,
        vibration_pattern: alarm.vibration_pattern,
        sound_config: alarm.sound_config,
        label: alarm.label,
        visual_config: alarm.visual_config,
        snooze_config: alarm.snooze_config,
        category: alarm.category,
        group_id: alarm.group_id,
        description: alarm.description,
        mission: alarm.mission,
        smart_wake: alarm.smart_wake,
        ambient: alarm.ambient,
        flags: { ...(alarm.flags || {}), favorite: false, archived: false },
      };
      updated = await patchAlarmLocal(userId, updated, added.id, richLocal);
    }
    setAlarms(updated);
  };

  const skipNextOccurrence = async (alarm) => {
    if (!userId) return;
    const rule = alarm.recurrence || deriveRecurrenceFromLegacy(alarm.time, alarm.days_of_week);
    const next = nextOccurrences(rule, new Date(), 1)[0];
    if (!next) return;
    const nextDate = toLocalIsoDate(next);
    const skipDates = Array.from(new Set([...(rule.skipDates || []), nextDate])).sort();
    const recurrencePatch = { ...rule, skipDates };
    const updated = await patchAlarmLocal(userId, alarms, alarm.id, { recurrence: recurrencePatch });
    setAlarms(updated);
    await rescheduleAlarm({ ...alarm, recurrence: recurrencePatch });
    await recordWakeSession(userId, {
      alarm_id: alarm.id,
      triggered_at: next.toISOString(),
      outcome: 'skipped',
      snooze_count: 0,
      challenge_ids: [],
    });
  };

  const pauseAlarmForDays = async (alarm, days) => {
    if (!userId) return;
    const rule = alarm.recurrence || deriveRecurrenceFromLegacy(alarm.time, alarm.days_of_week);
    const resume = new Date();
    resume.setDate(resume.getDate() + days);
    const recurrencePatch = { ...rule, pausedUntil: toLocalIsoDate(resume) };
    const updated = await patchAlarmLocal(userId, alarms, alarm.id, { recurrence: recurrencePatch });
    setAlarms(updated);
    setEditingAlarm((current) => current?.id === alarm.id ? { ...current, recurrence: recurrencePatch } : current);
    await rescheduleAlarm({ ...alarm, recurrence: recurrencePatch });
  };

  const pauseAlarmUntil = async (alarm, date) => {
    if (!userId || !alarm || !(date instanceof Date)) return;
    const rule = alarm.recurrence || deriveRecurrenceFromLegacy(alarm.time, alarm.days_of_week);
    const recurrencePatch = { ...rule, pausedUntil: toLocalIsoDate(date) };
    const updated = await patchAlarmLocal(userId, alarms, alarm.id, { recurrence: recurrencePatch });
    setAlarms(updated);
    setEditingAlarm((current) => current?.id === alarm.id ? { ...current, recurrence: recurrencePatch } : current);
    await rescheduleAlarm({ ...alarm, recurrence: recurrencePatch });
  };

  const applyVacationMode = async () => {
    if (!userId) return;
    const start = new Date(vacationStart);
    const end = new Date(vacationEnd);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (end < start) {
      Alert.alert(t('alarmPremium.vacationMode'), t('alarmPremium.invalidDateRange'));
      return;
    }
    const rangeDates = [];
    for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      rangeDates.push(toLocalIsoDate(day));
    }
    let updated = alarms;
    for (const alarm of alarms) {
      if (alarm.flags?.emergency) continue;
      const rule = alarm.recurrence || deriveRecurrenceFromLegacy(alarm.time, alarm.days_of_week);
      const recurrencePatch = {
        ...rule,
        skipDates: Array.from(new Set([...(rule.skipDates || []), ...rangeDates])).sort(),
        vacationMode: { startDate: toLocalIsoDate(start), endDate: toLocalIsoDate(end) },
      };
      updated = await patchAlarmLocal(userId, updated, alarm.id, { recurrence: recurrencePatch });
      await rescheduleAlarm({ ...alarm, recurrence: recurrencePatch });
    }
    setAlarms(updated);
    setVacationExpanded(false);
    Alert.alert('', t('alarmPremium.vacationApplied'));
  };

  const resumeAlarmNow = async (alarm) => {
    if (!userId) return;
    const rule = alarm.recurrence || deriveRecurrenceFromLegacy(alarm.time, alarm.days_of_week);
    const recurrencePatch = { ...rule, pausedUntil: null };
    const updated = await patchAlarmLocal(userId, alarms, alarm.id, { recurrence: recurrencePatch });
    setAlarms(updated);
    await rescheduleAlarm({ ...alarm, recurrence: recurrencePatch });
  };

  // ── Backup / Export / Import / Reset (Task 9.2) ───────────────────────────
  const handleExport = async () => {
    if (!userId) return;
    try {
      const config = await exportAlarmConfig(userId, alarms);
      await Share.share({ message: JSON.stringify(config, null, 2), title: t('alarmList.headerTitle') });
    } catch (e) {
      console.log('[AlarmList] export failed:', e?.message || e);
    }
  };

  const handleImport = async () => {
    if (!userId) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (result.canceled || !result.assets || !result.assets.length) return;
      const raw = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const config = JSON.parse(raw);
      const updated = await importAlarmConfig(userId, alarms, config, addAlarm);
      setAlarms(updated);
      Alert.alert(
        t('alarmBackup.importComplete'),
        t('alarmBackup.importedCount', { count: config.alarms?.length || 0 }),
      );
    } catch (e) {
      console.log('[AlarmList] import failed:', e?.message || e);
      Alert.alert(t('alarmBackup.importFailed'), t('alarmBackup.invalidBackup'));
    }
  };

  const handleResetAll = () => {
    Alert.alert(
      t('alarmBackup.resetTitle'),
      t('alarmBackup.resetMessage'),
      [
        { text: t('alarmList.cancel'), style: 'cancel' },
        {
          text: t('alarmBackup.resetAction'),
          style: 'destructive',
          onPress: async () => {
            if (!userId) return;
            await cancelAllAlarms();
            await resetAlarms(userId, alarms);
            await resetAllAlarmData(userId);
            setAlarms([]);
          },
        },
      ],
    );
  };

  const formatTimeDisplay = (time24) => {
    if (!time24) return '';
    const [hStr, mStr] = time24.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr ? mStr.padStart(2, '0') : '00';
    
    if (use24HourFormat) {
      return `${h.toString().padStart(2, '0')}:${m}`;
    } else {
      const ampm = h >= 12 ? t('alarmPremium.periodPm') : t('alarmPremium.periodAm');
      h = h % 12;
      if (h === 0) h = 12;
      return `${h}:${m} ${ampm}`;
    }
  };

  const toggleLibraryFavorite = async (soundId) => {
    const next = favoriteSoundIds.includes(soundId)
      ? favoriteSoundIds.filter((id) => id !== soundId)
      : [...favoriteSoundIds, soundId];
    setFavoriteSoundIds(next);
    if (userId) await Storage.set(`alarm_sound_favorites_${userId}`, next);
  };

  const toggleSoundSelection = (sound) => {
    setSoundSelection((current) => {
      const selected = current.includes(sound.id);
      const next = soundRotateMode === 'fixed'
        ? [sound.id]
        : (selected ? current.filter((id) => id !== sound.id) : [...current, sound.id]);
      if (soundRotateMode === 'fixed' || (!selected && next.length === 1)) {
        setSoundUri(sound.id);
        setSoundName(t(`alarmPremium.sounds.${sound.nameKey}`));
      }
      return next;
    });
  };

  const previewAlarmSound = async (uri, volume) => {
    stopAlarmAudio();
    const started = await startAlarmAudio({ soundUri: uri, volume, fadeInMs: 0 });
    if (!started) {
      Alert.alert(t('alarmSound.previewUnavailableTitle'), t('alarmSound.previewUnavailableMessage'));
      return;
    }
    setTimeout(() => stopAlarmAudio(), 4000);
  };

  const pickCustomSound = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const directory = `${FileSystem.documentDirectory}alarm-sounds/`;
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
        const safeName = (asset.name || `alarm-${Date.now()}.audio`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const durableUri = `${directory}${Date.now()}-${safeName}`;
        await FileSystem.copyAsync({ from: asset.uri, to: durableUri });
        setSoundUri(durableUri);
        setSoundName(asset.name || t('alarmSound.customSound'));
        setSoundSelection([]);
        setSoundRotateMode('fixed');
      }
    } catch (error) {
      console.log('Error picking audio:', error);
    }
  };

  const renderAlarmCard = ({ item, drag, isActive }) => {
    if (item._isGroupHeader) {
      return <Text style={styles.groupHeader}>{item.title}</Text>;
    }
    const rule = item.recurrence || deriveRecurrenceFromLegacy(item.time, item.days_of_week);
    const activeDaysText = formatRecurrence(rule, t);
    const archived = isArchived(item);
    const favorite = isFavorite(item);

    return (
      <TouchableOpacity
        style={[styles.card, (!item.is_active || archived) && styles.cardInactive]}
        activeOpacity={0.8}
        onPress={() => openEditAlarmModal(item)}
        onLongPress={drag}
        disabled={isActive}
      >
        <View style={styles.cardHeader}>
          {item.label && item.label.color && (
            <View style={[styles.cardLabelDot, { backgroundColor: item.label.color }]} />
          )}
          <Text style={[styles.daysText, !item.is_active && styles.textInactive]}>
            {activeDaysText} {item.title && ` • ${item.title}`} {item.label?.text && ` • ${item.label.text}`}
          </Text>
          {(item.group_id || item.category) && (
            <Text style={styles.groupBadge}>{item.group_id || t(`alarmCategories.${item.category}`)}</Text>
          )}
          {favorite && <Star color="#FBBF24" size={13} fill="#FBBF24" style={{ marginLeft: 6 }} />}
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.timeText, !item.is_active && styles.textInactive]}>
            {formatTimeDisplay(item.time)}
          </Text>
          <View style={styles.cardActions}>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); toggleFavorite(item); }}
              style={styles.cardActionBtn}
              accessibilityRole="button"
              accessibilityLabel={favorite ? t('alarmList.unfavoriteButton') : t('alarmList.favoriteButton')}
            >
              <Star color={favorite ? '#FBBF24' : '#71717A'} size={17} fill={favorite ? '#FBBF24' : 'none'} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); duplicateAlarm(item); }}
              style={styles.cardActionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('alarmList.duplicateButton')}
            >
              <Copy color="#71717A" size={17} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); toggleArchived(item); }}
              style={styles.cardActionBtn}
              accessibilityRole="button"
              accessibilityLabel={archived ? t('alarmList.unarchiveButton') : t('alarmList.archiveButton')}
            >
              <Archive color={archived ? accent : '#71717A'} size={17} />
            </TouchableOpacity>
            <Switch
              value={item.is_active}
              onValueChange={() => toggleAlarmActive(item.id, item.is_active)}
              trackColor={{ false: '#333', true: '#34D399' }}
              thumbColor="#FFF"
            />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('alarmPremium.backAccessibility')}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('alarmList.headerTitle')}</Text>
        
        <TouchableOpacity onPress={toggleTimeFormat} style={styles.formatToggle}>
          <Text style={styles.formatToggleText}>{use24HourFormat ? t('alarmList.format24h') : t('alarmList.format12h')}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          onPress={() => setSortOrder((prev) => (prev === 'time' ? 'active' : prev === 'active' ? 'custom' : 'time'))}
          style={[styles.formatToggle, { marginLeft: 8 }]}
        >
          <Text style={styles.formatToggleText}>
            {sortOrder === 'time' ? t('alarmList.sortByTime') : sortOrder === 'active' ? t('alarmList.sortByActive') : t('alarmList.sortByCustom')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('MorningFocus')} style={[styles.formatToggle, { marginLeft: 8 }]} accessibilityRole="button" accessibilityLabel={t('alarmPremium.focusAccessibility')}>
          <Sunrise color={accent} size={16} />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('AlarmInsights')} style={[styles.formatToggle, { marginLeft: 8 }]} accessibilityRole="button" accessibilityLabel={t('alarmPremium.insightsAccessibility')}>
          <BarChart3 color={accent} size={16} />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowSearch((v) => !v)} style={[styles.formatToggle, { marginLeft: 8 }]} accessibilityRole="button" accessibilityLabel={t('alarmPremium.searchAccessibility')}>
          <Search color={accent} size={16} />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleExport} style={[styles.formatToggle, { marginLeft: 8 }]} accessibilityRole="button" accessibilityLabel={t('alarmPremium.exportAccessibility')}>
          <Download color={accent} size={16} />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleImport} style={[styles.formatToggle, { marginLeft: 8 }]} accessibilityRole="button" accessibilityLabel={t('alarmPremium.importAccessibility')}>
          <Upload color={accent} size={16} />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleResetAll} style={[styles.formatToggle, { marginLeft: 8 }]} accessibilityRole="button" accessibilityLabel={t('alarmPremium.resetAccessibility')}>
          <RotateCcw color="#FB7185" size={16} />
        </TouchableOpacity>

      </View>

      {showSearch && (
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('alarmList.searchPlaceholder')}
            placeholderTextColor="#666"
            autoFocus
          />
          <TouchableOpacity onPress={() => setShowArchived((v) => !v)} style={styles.archiveToggle}>
            <Text style={styles.archiveToggleText}>{showArchived ? t('alarmList.hideArchived') : t('alarmList.showArchived')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <AlarmReliabilityBanner />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dashboardChips}>
        {['none', 'category', 'custom', 'upcoming'].map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.dashboardChip, groupMode === mode && { borderColor: accent }]}
            onPress={() => setGroupMode(mode)}
          >
            <Text style={[styles.dashboardChipText, groupMode === mode && { color: accent }]}>
              {t(`alarmPremium.groupBy.${mode}`)}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.dashboardChip} onPress={() => setVacationExpanded((value) => !value)}>
          <Text style={styles.dashboardChipText}>{t('alarmPremium.vacationMode')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {vacationExpanded && (
        <View style={styles.vacationPanel}>
          <TouchableOpacity style={styles.chip} onPress={() => setVacationPickerTarget('start')}>
            <Text style={styles.chipTxt}>{t('alarmPremium.vacationStart', { date: toLocalIsoDate(vacationStart) })}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chip} onPress={() => setVacationPickerTarget('end')}>
            <Text style={styles.chipTxt}>{t('alarmPremium.vacationEnd', { date: toLocalIsoDate(vacationEnd) })}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, { borderColor: accent }]} onPress={applyVacationMode}>
            <Text style={[styles.chipTxt, { color: accent }]}>{t('alarmPremium.apply')}</Text>
          </TouchableOpacity>
          {vacationPickerTarget && (
            <DateTimePicker
              value={vacationPickerTarget === 'start' ? vacationStart : vacationEnd}
              mode="date"
              minimumDate={new Date()}
              onChange={(event, date) => {
                setVacationPickerTarget(null);
                if (event.type !== 'set' || !date) return;
                if (vacationPickerTarget === 'start') setVacationStart(date);
                else setVacationEnd(date);
              }}
            />
          )}
        </View>
      )}

      {sortedAlarms.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Animated.View style={{ 
            transform: [{ 
              translateY: snoozeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -15] }) 
            }] 
          }}>
            <MoonStar color="#3F3F46" size={64} />
          </Animated.View>
          <Text style={styles.emptyText}>{alarms.length === 0 ? t('alarmList.emptyState') : t('alarmList.noResults')}</Text>
        </View>
      ) : sortOrder === 'custom' ? (
        <NestableScrollContainer style={{ flex: 1 }}>
          <NestableDraggableFlatList
            data={sortedAlarms}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            onDragEnd={handleReorder}
            renderItem={renderAlarmCard}
          />
        </NestableScrollContainer>
      ) : (
        <FlatList
          data={groupedRows}
          keyExtractor={item => String(item.id)}
          renderItem={renderAlarmCard}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={openNewAlarmModal}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('alarmPremium.addAccessibility')}
      >
        <Plus color="#FFF" size={32} />
      </TouchableOpacity>

      {/* Edit/Create Modal */}
      <Modal visible={isModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={{ paddingVertical: 10 }}>
              <Text style={styles.modalCancel}>{t('alarmList.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} style={{ paddingVertical: 10 }}>
              <Text style={[styles.modalSave, { color: accent }]}>{t('alarmList.scheduleAlarmButton')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

          <TouchableOpacity 
            style={styles.timeDisplayBtn} 
            onPress={() => setShowPicker(true)}
          >
            <Text style={styles.timeDisplayTxt}>
              {formatTimeDisplay(`${selectedTime.getHours().toString().padStart(2, '0')}:${selectedTime.getMinutes().toString().padStart(2, '0')}`)}
            </Text>
          </TouchableOpacity>

          {showPicker && (
            <DateTimePicker
              value={selectedTime}
              mode="time"
              is24Hour={use24HourFormat}
              onChange={(e, date) => {
                setShowPicker(false);
                if (e.type === 'set' && date) {
                  setSelectedTime(date);
                }
              }}
              textColor="#FFF"
            />
          )}

          <TouchableOpacity style={styles.repeatRow} onPress={() => setShowRecurrence(true)} activeOpacity={0.7}>
            <Text style={styles.settingLabel}>{t('alarmList.repeatLabel')}</Text>
            <Text style={[styles.settingInput, { color: accent }]} numberOfLines={1}>
              {formatRecurrence(
                { ...recurrence, time: `${selectedTime.getHours().toString().padStart(2, '0')}:${selectedTime.getMinutes().toString().padStart(2, '0')}` },
                t,
              )}
            </Text>
          </TouchableOpacity>

          <View style={styles.settingsGroup}>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('alarmList.alarmNameLabel')}</Text>
              <TextInput 
                style={styles.settingInput} 
                value={title} 
                onChangeText={setTitle} 
                placeholder={t('alarmList.defaultAlarmName')} 
                placeholderTextColor="#666" 
                maxLength={20}
              />
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('alarmList.descriptionLabel')}</Text>
              <TextInput
                style={styles.settingInput}
                value={description}
                onChangeText={setDescription}
                placeholder={t('alarmList.descriptionPlaceholder')}
                placeholderTextColor="#666"
                maxLength={60}
              />
            </View>
            <View style={styles.optionBlock}>
              <Text style={styles.settingLabel}>{t('alarmList.soundLabel')}</Text>
              <View style={styles.chipsWrap}>
                {['fixed', 'random', 'rotate'].map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.chip, soundRotateMode === mode && { backgroundColor: accent, borderColor: accent }]}
                    onPress={() => {
                      setSoundRotateMode(mode);
                      if (mode === 'fixed' && soundSelection.length > 1) setSoundSelection([soundSelection[0]]);
                    }}
                  >
                    <Text style={[styles.chipTxt, soundRotateMode === mode && styles.chipTxtActive]}>{t(`alarmPremium.soundMode.${mode}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.soundCategories}>
                {SOUND_CATEGORIES.map((key) => (
                  <TouchableOpacity key={key} style={[styles.chip, soundCategory === key && { borderColor: accent }]} onPress={() => setSoundCategory(key)}>
                    <Text style={[styles.chipTxt, soundCategory === key && { color: accent }]}>{t(`alarmPremium.soundCategories.${key}`)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.soundGrid}>
                {BUILT_IN_SOUNDS
                  .filter((sound) => sound.category === soundCategory)
                  .sort((a, b) => Number(favoriteSoundIds.includes(b.id)) - Number(favoriteSoundIds.includes(a.id)))
                  .map((sound) => {
                    const selected = soundSelection.includes(sound.id);
                    const favored = favoriteSoundIds.includes(sound.id);
                    return (
                      <View key={sound.id} style={styles.soundChoice}>
                        <TouchableOpacity
                          style={[styles.chip, selected && { backgroundColor: accent, borderColor: accent }]}
                          onPress={() => toggleSoundSelection(sound)}
                          onLongPress={() => previewAlarmSound(sound.id, soundVolume)}
                          accessibilityLabel={t('alarmPremium.soundAccessibility', { sound: t(`alarmPremium.sounds.${sound.nameKey}`) })}
                        >
                          <Text style={[styles.chipTxt, selected && styles.chipTxtActive]}>{t(`alarmPremium.sounds.${sound.nameKey}`)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => toggleLibraryFavorite(sound.id)} accessibilityRole="button" accessibilityLabel={t('alarmPremium.favoriteSoundAccessibility')}>
                          <Star color={favored ? '#FBBF24' : '#71717A'} size={16} fill={favored ? '#FBBF24' : 'none'} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
              </View>
              <View style={styles.chipsWrap}>
                <TouchableOpacity style={[styles.chip, soundUri === 'default' && !soundSelection.length && { borderColor: accent }]} onPress={() => { setSoundUri('default'); setSoundName(t('alarmList.defaultSoundName')); setSoundSelection([]); setSoundRotateMode('fixed'); }}>
                  <Text style={styles.chipTxt}>{t('alarmSound.systemDefault')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.chip} onPress={pickCustomSound}>
                  <Text style={styles.chipTxt}>{t('alarmSound.chooseCustom')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.chip} onPress={() => previewAlarmSound(selectConfiguredSound({ uri: soundUri, rotateSet: soundSelection, rotateMode: soundRotateMode }, title), soundVolume)}>
                  <Text style={styles.chipTxt}>{t('alarmSound.preview')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.ambientSubtitle} numberOfLines={1}>{soundName}</Text>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>{t('alarmSound.volume')}</Text>
                <View style={styles.stepperMini}>
                  <TouchableOpacity onPress={() => setSoundVolume(Math.max(10, soundVolume - 10))} style={styles.stepMiniBtn}><Text style={styles.stepMiniTxt}>−</Text></TouchableOpacity>
                  <Text style={styles.stepMiniVal}>{t('alarmPremium.percentValue', { value: soundVolume })}</Text>
                  <TouchableOpacity onPress={() => setSoundVolume(Math.min(100, soundVolume + 10))} style={styles.stepMiniBtn}><Text style={styles.stepMiniTxt}>+</Text></TouchableOpacity>
                </View>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>{t('alarmSound.fadeIn')}</Text>
                <View style={styles.chipsWrap}>
                  {[0, 10, 30, 60].map((seconds) => (
                    <TouchableOpacity key={seconds} style={[styles.chip, fadeInSeconds === seconds && { backgroundColor: accent, borderColor: accent }]} onPress={() => setFadeInSeconds(seconds)}>
                      <Text style={[styles.chipTxt, fadeInSeconds === seconds && styles.chipTxtActive]}>{seconds === 0 ? t('alarmList.ambientOff') : t('alarmPremium.secondsShort', { count: seconds })}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>{t('alarmSound.favorite')}</Text>
                <Switch value={favoriteSound} onValueChange={setFavoriteSound} trackColor={{ false: '#333', true: '#34D399' }} thumbColor="#FFF" />
              </View>
            </View>
            {/* Vibration pattern */}
            <View style={styles.optionBlock}>
              <Text style={styles.settingLabel}>{t('alarmOptions.vibrationTitle')}</Text>
              <View style={styles.chipsWrap}>
                {VIBRATION_OPTIONS.map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={[styles.chip, vibrationPattern === v && { backgroundColor: accent, borderColor: accent }]}
                    onPress={() => setVibrationPattern(v)}
                  >
                    <Text style={[styles.chipTxt, vibrationPattern === v && styles.chipTxtActive]}>{t(`alarmOptions.vibration.${v}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Label (preset or custom text + color) */}
            <View style={styles.optionBlock}>
              <Text style={styles.settingLabel}>{t('alarmOptions.labelTitle')}</Text>
              <View style={styles.chipsWrap}>
                <TouchableOpacity style={[styles.chip, !labelKey && !labelText && styles.chipActive]} onPress={() => { setLabelKey(null); setLabelText(''); }}>
                  <Text style={[styles.chipTxt, !labelKey && !labelText && styles.chipTxtActive]}>{t('alarmOptions.labelNone')}</Text>
                </TouchableOpacity>
                {LABEL_PRESETS.map((l) => (
                  <TouchableOpacity
                    key={l.key}
                    style={[styles.chip, labelKey === l.key && !labelText && { backgroundColor: l.color, borderColor: l.color }]}
                    onPress={() => { setLabelKey(l.key); setLabelText(''); setLabelColor(l.color); }}
                  >
                    <View style={[styles.labelDot, { backgroundColor: l.color }]} />
                    <Text style={[styles.chipTxt, labelKey === l.key && !labelText && styles.chipTxtActive]}>{t(`alarmOptions.labels.${l.key}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.settingInput, styles.customLabelInput]}
                value={labelText}
                onChangeText={(value) => { setLabelText(value); if (value) setLabelKey(null); }}
                placeholder={t('alarmPremium.customLabelPlaceholder')}
                placeholderTextColor="#666"
                maxLength={24}
              />
              <View style={styles.colorRow}>
                {['#FFFFFF', '#38BDF8', '#56B4E9', '#34D399', '#C7C7C7', '#E69F00', '#FB7185', '#FB923C'].map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[styles.colorChoice, { backgroundColor: color }, labelColor === color && styles.colorChoiceActive]}
                    onPress={() => setLabelColor(color)}
                    accessibilityRole="button"
                    accessibilityLabel={t('alarmPremium.labelColorAccessibility', { color })}
                  />
                ))}
              </View>
            </View>

            <View style={styles.optionBlock}>
              <Text style={styles.settingLabel}>{t('alarmPremium.visualTitle')}</Text>
              <Text style={styles.ambientSubtitle}>{t('alarmPremium.clockStyle')}</Text>
              <View style={styles.chipsWrap}>
                {['minimal', 'material', 'glass'].map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.chip, clockStyle === value && { backgroundColor: accent, borderColor: accent }]}
                    onPress={() => setClockStyle(value)}
                  >
                    <Text style={[styles.chipTxt, clockStyle === value && styles.chipTxtActive]}>
                      {t(`alarmPremium.clockStyles.${value}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.ambientSubtitle}>{t('alarmPremium.backgroundMode')}</Text>
              <View style={styles.chipsWrap}>
                {['dark', 'light', 'dynamic'].map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.chip, backgroundMode === value && { backgroundColor: accent, borderColor: accent }]}
                    onPress={() => setBackgroundMode(value)}
                  >
                    <Text style={[styles.chipTxt, backgroundMode === value && styles.chipTxtActive]}>
                      {t(`alarmPremium.backgroundModes.${value}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.ambientSubtitle}>{t('alarmPremium.accessiblePalette')}</Text>
              <View style={styles.chipsWrap}>
                {['standard', 'deuteranopia', 'tritanopia', 'highContrast'].map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.chip, palette === value && { backgroundColor: accent, borderColor: accent }]}
                    onPress={() => setPalette(value)}
                  >
                    <Text style={[styles.chipTxt, palette === value && styles.chipTxtActive]}>
                      {t(`alarmPremium.palettes.${value}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.optionBlock}>
              <Text style={styles.settingLabel}>{t('alarmCategories.title')}</Text>
              <View style={styles.chipsWrap}>
                <TouchableOpacity style={[styles.chip, !category && { backgroundColor: accent, borderColor: accent }]} onPress={() => setCategory(null)}>
                  <Text style={[styles.chipTxt, !category && styles.chipTxtActive]}>{t('alarmCategories.none')}</Text>
                </TouchableOpacity>
                {ALARM_CATEGORIES.map((key) => (
                  <TouchableOpacity key={key} style={[styles.chip, category === key && { backgroundColor: accent, borderColor: accent }]} onPress={() => setCategory(key)}>
                    <Text style={[styles.chipTxt, category === key && styles.chipTxtActive]}>{t(`alarmCategories.${key}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.settingInput, { textAlign: 'left', marginTop: 12 }]}
                value={groupId}
                onChangeText={setGroupId}
                placeholder={t('alarmCategories.groupPlaceholder')}
                placeholderTextColor="#666"
                maxLength={30}
              />
            </View>

            <View style={styles.defaultsRow}>
              <TouchableOpacity
                style={styles.saveDefaultBtn}
                onPress={async () => {
                  await saveAlarmDefaults(userId, {
                    vibration_pattern: vibrationPattern,
                    sound_config: normalizeAlarm({ sound_config: {
                      uri: soundUri,
                      name: soundName,
                      volume: soundVolume,
                      fadeInMs: fadeInSeconds * 1000,
                      favorite: favoriteSound,
                      rotateSet: soundRotateMode === 'fixed' ? null : soundSelection,
                      rotateMode: soundRotateMode,
                    } }).sound_config,
                    snooze_config: normalizeAlarm({ snooze_config: {
                      disabled: snoozeDisabled,
                      maxCount: snoozeMax,
                      defaultMin: snoozeDefaultMin,
                      presets: [...new Set([5, 10, 15, 20, 30, 45, 60, snoozeDefaultMin])],
                      progressive: snoozeProgressive,
                    } }).snooze_config,
                    mission: missionSteps,
                  });
                  Alert.alert('', t('alarmOptions.savedAsDefault'));
                }}
              >
                <Text style={styles.saveDefaultText}>{t('alarmOptions.saveAsDefault')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveDefaultBtn} onPress={() => applyDefaultsToEditor(true)}>
                <Text style={styles.saveDefaultText}>{t('alarmPremium.applyDefaults')}</Text>
              </TouchableOpacity>
            </View>

            {/* Smart wake window */}
            <View style={styles.optionBlock}>
              <View style={styles.settingRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.settingLabel}>{t('alarmPremium.smartWakeTitle')}</Text>
                  <Text style={styles.ambientSubtitle}>{t('alarmPremium.smartWakeHint')}</Text>
                </View>
                <Switch value={smartWakeEnabled} onValueChange={setSmartWakeEnabled} trackColor={{ false: '#333', true: '#34D399' }} thumbColor="#FFF" />
              </View>
              {smartWakeEnabled && (
                <View style={styles.chipsWrap}>
                  {[10, 20, 30, 45, 60].map((minutes) => (
                    <TouchableOpacity key={minutes} style={[styles.chip, smartWakeWindow === minutes && { backgroundColor: accent, borderColor: accent }]} onPress={() => setSmartWakeWindow(minutes)}>
                      <Text style={[styles.chipTxt, smartWakeWindow === minutes && styles.chipTxtActive]}>{t('alarmPremium.minutesShort', { count: minutes })}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Ambient pre-wake */}
            <View style={styles.optionBlock}>
              <Text style={styles.settingLabel}>{t('alarmList.ambientTitle')}</Text>
              <Text style={styles.ambientSubtitle}>
                {ambientLeadMin > 0 ? t('alarmList.ambientSubtitle', { minutes: ambientLeadMin }) : ''}
              </Text>
              <View style={styles.chipsWrap}>
                {[0, 5, 10, 15, 20, 30].map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.chip, ambientLeadMin === m && { backgroundColor: accent, borderColor: accent }]}
                    onPress={() => setAmbientLeadMin(m)}
                  >
                    <Text style={[styles.chipTxt, ambientLeadMin === m && styles.chipTxtActive]}>
                      {m === 0 ? t('alarmList.ambientOff') : t('alarmPremium.minutesShort', { count: m })}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Public holiday skipping (Task 15.6) */}
            <View style={styles.optionBlock}>
              <View style={styles.settingRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.settingLabel}>{t('alarmHolidays.title')}</Text>
                  <Text style={styles.ambientSubtitle}>{t('alarmHolidays.subtitle')}</Text>
                </View>
                <Switch value={skipPublicHolidays} onValueChange={setSkipPublicHolidays} trackColor={{ false: '#333', true: '#34D399' }} thumbColor="#FFF" />
              </View>
              {skipPublicHolidays && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {SUPPORTED_HOLIDAY_COUNTRIES.map((countryOption) => (
                    <TouchableOpacity
                      key={countryOption.code}
                      style={[styles.chip, holidayCountry === countryOption.code && { backgroundColor: accent, borderColor: accent }]}
                      onPress={() => setHolidayCountry(countryOption.code)}
                    >
                      <Text style={[styles.chipTxt, holidayCountry === countryOption.code && styles.chipTxtActive]}>
                        {countryOption.i18nKey ? t(countryOption.i18nKey, countryOption.name) : countryOption.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Ordered multi-step dismiss mission builder */}
            <View style={styles.optionBlock}>
              <Text style={styles.settingLabel}>{t('alarmChallenges.title')}</Text>
              <Text style={styles.ambientSubtitle}>{t('alarmChallenges.multiStepHint')}</Text>
              <View style={styles.chipsWrap}>
                <TouchableOpacity
                  style={[styles.chip, missionSteps.length === 0 && { backgroundColor: accent, borderColor: accent }]}
                  onPress={() => setMissionSteps([])}
                >
                  <Text style={[styles.chipTxt, missionSteps.length === 0 && styles.chipTxtActive]}>{t('alarmChallenges.none')}</Text>
                </TouchableOpacity>
                {availableChallenges.map((descriptor) => {
                  const selected = missionSteps.some((step) => step.id === descriptor.id);
                  return (
                    <TouchableOpacity
                      key={descriptor.id}
                      style={[styles.chip, selected && { backgroundColor: accent, borderColor: accent }]}
                      onPress={() => toggleMissionStep(descriptor)}
                    >
                      <Text style={[styles.chipTxt, selected && styles.chipTxtActive]}>{t(`alarmChallenges.${descriptor.id}`, descriptor.id)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {missionSteps.map((step, index) => (
                <View key={`${step.id}-${index}`} style={styles.missionStepCard}>
                  <View style={styles.missionStepHeader}>
                    <Text style={styles.missionStepTitle}>{index + 1}. {t(`alarmChallenges.${step.id}`, step.id)}</Text>
                    <View style={styles.missionStepActions}>
                      <TouchableOpacity disabled={index === 0} onPress={() => moveMissionStep(index, -1)}><Text style={styles.missionArrow}>↑</Text></TouchableOpacity>
                      <TouchableOpacity disabled={index === missionSteps.length - 1} onPress={() => moveMissionStep(index, 1)}><Text style={styles.missionArrow}>↓</Text></TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.chipsWrap}>
                    {['simple', 'medium', 'hard', 'expert'].map((difficulty) => (
                      <TouchableOpacity key={difficulty} style={[styles.chip, step.difficulty === difficulty && { borderColor: accent }]} onPress={() => setMissionDifficulty(step.id, difficulty)}>
                        <Text style={[styles.chipTxt, step.difficulty === difficulty && { color: accent }]}>{t(`alarmChallenges.difficulty.${difficulty}`)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
              {missionSteps.some((step) => step.id === 'qrCode') && (
                <TouchableOpacity style={styles.saveDefaultBtn} onPress={() => navigation.navigate('AlarmQrCodes')}>
                  <Text style={[styles.saveDefaultText, { color: accent }]}>{t('alarmQrCodes.title')}</Text>
                </TouchableOpacity>
              )}
              {missionSteps.some((step) => step.id === 'nfc') && (
                <TouchableOpacity style={styles.saveDefaultBtn} onPress={() => navigation.navigate('AlarmNfcTags')}>
                  <Text style={[styles.saveDefaultText, { color: accent }]}>{t('alarmNfcTags.title')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Emergency mode + backup alarm (Task 14) */}
            <View style={styles.settingRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.settingLabel}>{t('alarmEmergency.emergencyTitle')}</Text>
                <Text style={styles.ambientSubtitle}>{t('alarmEmergency.emergencySubtitle')}</Text>
              </View>
              <Switch
                value={emergencyMode}
                onValueChange={setEmergencyMode}
                trackColor={{ false: '#333', true: '#A1A1AA' }}
                thumbColor="#FFF"
              />
            </View>
            <View style={styles.settingRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.settingLabel}>{t('alarmEmergency.backupTitle')}</Text>
                <Text style={styles.ambientSubtitle}>{t('alarmEmergency.backupSubtitle')}</Text>
              </View>
              <Switch
                value={backupAlarmEnabled}
                onValueChange={setBackupAlarmEnabled}
                trackColor={{ false: '#333', true: '#34D399' }}
                thumbColor="#FFF"
              />
            </View>

            {/* Snooze config */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('alarmOptions.snoozeTitle')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {!snoozeDisabled && (
                  <View style={styles.stepperMini}>
                    <TouchableOpacity onPress={() => setSnoozeMax(Math.max(1, snoozeMax - 1))} style={styles.stepMiniBtn}>
                      <Text style={styles.stepMiniTxt}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepMiniVal}>{t('alarmOptions.snoozeMax', { count: snoozeMax })}</Text>
                    <TouchableOpacity onPress={() => setSnoozeMax(Math.min(10, snoozeMax + 1))} style={styles.stepMiniBtn}>
                      <Text style={styles.stepMiniTxt}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <Switch
                  value={!snoozeDisabled}
                  onValueChange={(v) => setSnoozeDisabled(!v)}
                  trackColor={{ false: '#333', true: '#34D399' }}
                  thumbColor="#FFF"
                />
              </View>
            </View>
            {!snoozeDisabled && (
              <View style={styles.optionBlock}>
                <Text style={styles.ambientSubtitle}>{t('alarmOptions.defaultSnooze')}</Text>
                <View style={styles.chipsWrap}>
                  {[5, 10, 15, 20, 30, 45, 60].map((minutes) => (
                    <TouchableOpacity
                      key={minutes}
                      style={[styles.chip, snoozeDefaultMin === minutes && { backgroundColor: accent, borderColor: accent }]}
                      onPress={() => setSnoozeDefaultMin(minutes)}
                    >
                      <Text style={[styles.chipTxt, snoozeDefaultMin === minutes && styles.chipTxtActive]}>{t('alarmPremium.minutesShort', { count: minutes })}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>{t('alarmPremium.customSnooze')}</Text>
                  <View style={styles.inlineInputRow}>
                    <TextInput
                      style={styles.numberInput}
                      value={String(snoozeDefaultMin)}
                      onChangeText={(value) => setSnoozeDefaultMin(Math.max(1, Math.min(120, parseInt(value, 10) || 1)))}
                      keyboardType="number-pad"
                      maxLength={3}
                      accessibilityLabel={t('alarmPremium.customSnoozeAccessibility')}
                    />
                    <Text style={styles.ambientSubtitle}>{t('alarmPremium.minutesUnit')}</Text>
                  </View>
                </View>
                <View style={styles.settingRow}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={styles.settingLabel}>{t('alarmOptions.progressive')}</Text>
                    <Text style={styles.ambientSubtitle}>{t('alarmOptions.progressiveHint')}</Text>
                  </View>
                  <Switch value={snoozeProgressive} onValueChange={setSnoozeProgressive} trackColor={{ false: '#333', true: '#34D399' }} thumbColor="#FFF" />
                </View>
              </View>
            )}
          </View>

          {editingAlarm && (
            <View style={styles.optionBlock}>
              <Text style={styles.settingLabel}>{t('alarmList.skipPauseTitle')}</Text>
              {editingAlarm.recurrence?.pausedUntil ? (
                <View style={styles.pausedRow}>
                  <Text style={styles.pausedText}>
                    {t('alarmList.pausedUntil', { date: editingAlarm.recurrence.pausedUntil })}
                  </Text>
                  <TouchableOpacity style={styles.chip} onPress={() => resumeAlarmNow(editingAlarm)}>
                    <Text style={styles.chipTxt}>{t('alarmList.resumeNow')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.chipsWrap}>
                  <TouchableOpacity style={styles.chip} onPress={() => skipNextOccurrence(editingAlarm)}>
                    <Text style={styles.chipTxt}>{t('alarmList.skipNext')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.chip} onPress={() => pauseAlarmForDays(editingAlarm, 1)}>
                    <Text style={styles.chipTxt}>{t('alarmList.pause1Day')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.chip} onPress={() => pauseAlarmForDays(editingAlarm, 3)}>
                    <Text style={styles.chipTxt}>{t('alarmList.pause3Days')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.chip} onPress={() => pauseAlarmForDays(editingAlarm, 7)}>
                    <Text style={styles.chipTxt}>{t('alarmList.pause1Week')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.chip} onPress={() => setShowPauseDatePicker(true)}>
                    <Text style={styles.chipTxt}>{t('alarmPremium.customPauseDate')}</Text>
                  </TouchableOpacity>
                  {showPauseDatePicker && (
                    <DateTimePicker
                      value={pauseDate}
                      mode="date"
                      minimumDate={new Date()}
                      onChange={(event, date) => {
                        setShowPauseDatePicker(false);
                        if (event.type === 'set' && date) {
                          setPauseDate(date);
                          pauseAlarmUntil(editingAlarm, date);
                        }
                      }}
                    />
                  )}
                </View>
              )}
            </View>
          )}

          {editingAlarm && (
            <TouchableOpacity
              style={styles.duplicateBtn}
              onPress={() => { duplicateAlarm(editingAlarm); setModalVisible(false); }}
            >
              <Copy color="#FFFFFF" size={20} />
              <Text style={styles.duplicateText}>{t('alarmList.duplicateButton')}</Text>
            </TouchableOpacity>
          )}

          {editingAlarm && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <Trash2 color="#FB7185" size={20} />
              <Text style={styles.deleteText}>{t('alarmList.deleteButton')}</Text>
            </TouchableOpacity>
          )}

          </ScrollView>

          <RecurrencePicker
            visible={showRecurrence}
            value={recurrence}
            time={`${selectedTime.getHours().toString().padStart(2, '0')}:${selectedTime.getMinutes().toString().padStart(2, '0')}`}
            accent={accent}
            onClose={() => setShowRecurrence(false)}
            onChange={setRecurrence}
          />

        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  backBtn: { padding: 8, marginLeft: -8 },
  headerTitle: { fontSize: 24, fontWeight: '600', color: '#FFF' },
  formatToggle: { backgroundColor: '#27272A', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  formatToggleText: { color: '#FFFFFF', fontWeight: '600', fontSize: 12 },
  listContainer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 100 },
  groupHeader: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginTop: 10, marginBottom: 8 },
  dashboardChips: { paddingHorizontal: 20, paddingBottom: 8, gap: 8 },
  dashboardChip: { borderRadius: 14, borderWidth: 1, borderColor: '#27272A', backgroundColor: '#18181B', paddingHorizontal: 10, paddingVertical: 6 },
  dashboardChipText: { color: '#A1A1AA', fontSize: 11, fontWeight: '700' },
  vacationPanel: { marginHorizontal: 20, marginBottom: 8, padding: 10, borderRadius: 14, backgroundColor: '#18181B', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { backgroundColor: '#18181B', borderRadius: 24, padding: 20, marginBottom: 16 },
  cardInactive: { opacity: 0.6 },
  cardHeader: { marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
  cardLabelDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  daysText: { color: '#A1A1AA', fontSize: 14, fontWeight: '500', flexShrink: 1 },
  groupBadge: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', marginLeft: 8, textTransform: 'uppercase' },
  cardBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginRight: 4 },
  cardActionBtn: { padding: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 10 },
  searchInput: { flex: 1, backgroundColor: '#18181B', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, color: '#FFF', fontSize: 15 },
  archiveToggle: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: '#18181B' },
  archiveToggleText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  timeText: { fontSize: 48, fontWeight: '300', color: '#FFF' },
  textInactive: { color: '#71717A' },
  fab: { position: 'absolute', bottom: 32, alignSelf: 'center', backgroundColor: '#3F3F46', width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 100 },
  emptyText: { color: '#71717A', fontSize: 18, marginTop: 20, fontWeight: '500' },

  modalContainer: { flex: 1, backgroundColor: '#09090B', paddingHorizontal: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20 },
  modalCancel: { color: '#A1A1AA', fontSize: 18 },
  modalSave: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  
  timeDisplayBtn: { alignSelf: 'center', marginVertical: 40 },
  timeDisplayTxt: { fontSize: 72, fontWeight: '300', color: '#FFF' },
  
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 30 },
  dayCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#18181B', justifyContent: 'center', alignItems: 'center' },
  dayCircleActive: { backgroundColor: '#FFFFFF' },
  dayText: { color: '#FFF', fontSize: 16, fontWeight: '500' },
  dayTextActive: { color: '#000', fontWeight: '700' },
  
  repeatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#18181B', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 18, marginTop: 20 },
  settingsGroup: { backgroundColor: '#18181B', borderRadius: 16, padding: 16, marginTop: 20 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  settingLabel: { color: '#FFF', fontSize: 16 },
  settingInput: { color: '#FFFFFF', fontSize: 16, textAlign: 'right', minWidth: 100 },
  optionBlock: { paddingVertical: 12 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1E1E22', borderWidth: 1, borderColor: '#2A2A2F' },
  chipActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  chipTxt: { color: '#CFCFD4', fontSize: 13, fontWeight: '600' },
  chipTxtActive: { color: '#000', fontWeight: '800' },
  labelDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  customLabelInput: { textAlign: 'left', marginTop: 12, minWidth: 0, backgroundColor: '#121216', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  colorRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  colorChoice: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  colorChoiceActive: { borderColor: '#FFF' },
  soundCategories: { gap: 8, paddingVertical: 10 },
  soundGrid: { gap: 8 },
  soundChoice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  defaultsRow: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberInput: { minWidth: 58, color: '#FFFFFF', backgroundColor: '#121216', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, textAlign: 'center', fontWeight: '700' },
  pausedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, backgroundColor: '#1E1E22', borderRadius: 14, padding: 12 },
  pausedText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', flex: 1, marginRight: 10 },
  ambientSubtitle: { color: '#71717A', fontSize: 12, marginTop: 4, marginBottom: 8 },
  stepperMini: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1E1E22', borderRadius: 16, paddingHorizontal: 6, paddingVertical: 2 },
  stepMiniBtn: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  stepMiniTxt: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  stepMiniVal: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', minWidth: 52, textAlign: 'center' },
  saveDefaultBtn: { alignSelf: 'flex-start', marginTop: 4, marginBottom: 4 },
  saveDefaultText: { color: '#71717A', fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  missionStepCard: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: '#121216', borderWidth: 1, borderColor: '#27272A' },
  missionStepHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  missionStepTitle: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  missionStepActions: { flexDirection: 'row', gap: 16 },
  missionArrow: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', paddingHorizontal: 4 },
  
  duplicateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 40, padding: 16, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 16 },
  duplicateText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, padding: 16, backgroundColor: 'rgba(251, 113, 133, 0.1)', borderRadius: 16 },
  deleteText: { color: '#FB7185', fontSize: 16, fontWeight: '600' }
});

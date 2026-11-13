// ─── Schedule Modal ───────────────────────────────────────
// Context-aware Mindful Lock: define time windows where blocking
// mode auto-switches (e.g. "Strict, Mon-Fri 9am-5pm"), with zero
// need to remember to toggle it manually.
// ─────────────────────────────────────────────────────────

import DateTimePicker from '@react-native-community/datetimepicker';
import { BrainCircuit, Clock3, Lock, Plus, Trash2, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text, TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import {
    addSchedule,
    getSchedules,
    removeSchedule,
    updateSchedule,
} from '../utils/mindfulLock';

const BG = '#000000';
const SURFACE = '#0A0A0A';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';

const DAYS = [
  { key: 0, labelKey: 'scheduleModal.dayShortSun' },
  { key: 1, labelKey: 'scheduleModal.dayShortMon' },
  { key: 2, labelKey: 'scheduleModal.dayShortTue' },
  { key: 3, labelKey: 'scheduleModal.dayShortWed' },
  { key: 4, labelKey: 'scheduleModal.dayShortThu' },
  { key: 5, labelKey: 'scheduleModal.dayShortFri' },
  { key: 6, labelKey: 'scheduleModal.dayShortSat' },
];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const timeToMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const formatTime = (time, t) => {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? t('scheduleModal.pm') : t('scheduleModal.am');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};
const dateToHHMM = (date) => {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};
const hhmmToDate = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

export const ScheduleModal = ({ isVisible, onClose, userId, onChange }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const ACCENT = theme.accent;
  const ON_ACCENT = theme.onAccent || '#0B0B0D';
  const styles = useMemo(() => makeStyles(ACCENT, ON_ACCENT), [ACCENT, ON_ACCENT]);
  const [schedules, setSchedules] = useState([]);
  const [showBuilder, setShowBuilder] = useState(false);

  // Builder state (new schedule)
  const [days, setDays] = useState(WEEKDAYS);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [mode, setMode] = useState('strict');
  const [pickerTarget, setPickerTarget] = useState(null); // iOS inline picker only

  const openTimePicker = (target) => {
    if (Platform.OS === 'android') {
      // Imperative native dialog — opens ONCE and returns the result via
      // callback, so it never re-mounts/reverts like the declarative
      // component does on Android. Lazy require keeps the import-sorter from
      // stripping the named export (a recurring bug in this project).
      const { DateTimePickerAndroid } = require('@react-native-community/datetimepicker');
      const current = target === 'start' ? start : end;
      DateTimePickerAndroid.open({
        value: hhmmToDate(current),
        mode: 'time',
        is24Hour: false,
        onChange: (event, selectedDate) => {
          if (event?.type === 'set' && selectedDate) {
            const hhmm = dateToHHMM(selectedDate);
            if (target === 'start') setStart(hhmm); else setEnd(hhmm);
          }
        },
      });
    } else {
      setPickerTarget(target);
    }
  };

  const load = async () => {
    if (!userId) return;
    const list = await getSchedules(userId);
    setSchedules(list);
  };

  useEffect(() => {
    if (!isVisible || !userId) return undefined;
    let active = true;

    // Make the asynchronous storage boundary explicit and ignore a late response
    // after the sheet closes or switches users. Existing rows stay visible while
    // this refresh runs, preserving the cache-first experience.
    getSchedules(userId).then((list) => {
      if (active) setSchedules(list);
    }).catch(() => {});

    return () => { active = false; };
  }, [isVisible, userId]);

  const toggleDay = (d) => {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  };

  const resetBuilder = () => {
    setDays(WEEKDAYS);
    setStart('09:00');
    setEnd('17:00');
    setMode('strict');
    setShowBuilder(false);
  };

  const handleSave = async () => {
    if (days.length === 0) {
      Alert.alert(t('scheduleModal.pickDayTitle'), t('scheduleModal.pickDayMessage'));
      return;
    }
    if (timeToMinutes(start) === timeToMinutes(end)) {
      Alert.alert(t('scheduleModal.invalidWindowTitle'), t('scheduleModal.invalidWindowMessage'));
      return;
    }
    await addSchedule(userId, { days, start, end, mode });
    resetBuilder();
    await load();
    onChange?.();
  };

  const handleToggleEnabled = async (schedule) => {
    await updateSchedule(userId, schedule.id, { enabled: !schedule.enabled });
    await load();
    onChange?.();
  };

  const handleDelete = (schedule) => {
    Alert.alert(t('scheduleModal.removeScheduleTitle'), t('scheduleModal.removeScheduleMessage'), [
      { text: t('scheduleModal.cancel'), style: 'cancel' },
      {
        text: t('scheduleModal.delete'), style: 'destructive', onPress: async () => {
          await removeSchedule(userId, schedule.id);
          await load();
          onChange?.();
        },
      },
    ]);
  };

  const daysLabel = (dayArr) => {
    if (!dayArr || dayArr.length === 0 || dayArr.length === 7) return t('scheduleModal.everyDay');
    const sorted = [...dayArr].sort();
    if (JSON.stringify(sorted) === JSON.stringify(WEEKDAYS)) return t('scheduleModal.weekdays');
    if (JSON.stringify(sorted) === JSON.stringify(WEEKENDS)) return t('scheduleModal.weekends');
    return sorted.map((d) => t(DAYS[d].labelKey)).join(' ');
  };

  return (
    <Modal visible={isVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('scheduleModal.headerTitle')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X color={MUTED} size={24} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>
            {t('scheduleModal.intro')}
          </Text>

          {/* Existing schedules */}
          {schedules.map((s) => (
            <View key={s.id} style={styles.scheduleCard}>
              <View style={styles.scheduleIconWrap}>
                {s.mode === 'strict' ? <Lock color="#A1A1AA" size={18} /> : <BrainCircuit color={ACCENT} size={18} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scheduleTitle}>
                  {s.mode === 'strict' ? t('scheduleModal.strict') : t('scheduleModal.mindfulCoach')} · {daysLabel(s.days)}
                </Text>
                <Text style={styles.scheduleTime}>{formatTime(s.start, t)} – {formatTime(s.end, t)}</Text>
              </View>
              <Switch
                value={s.enabled !== false}
                onValueChange={() => handleToggleEnabled(s)}
                trackColor={{ false: '#27272a', true: ACCENT + '55' }}
                thumbColor={s.enabled !== false ? ACCENT : '#52525b'}
              />
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(s)}>
                <Trash2 color="#52525b" size={16} />
              </TouchableOpacity>
            </View>
          ))}

          {schedules.length === 0 && !showBuilder && (
            <View style={styles.emptyState}>
              <Clock3 color="#3F3F46" size={32} />
              <Text style={styles.emptyText}>{t('scheduleModal.emptyTitle')}</Text>
              <Text style={styles.emptySubtext}>{t('scheduleModal.emptySubtext')}</Text>
            </View>
          )}

          {/* Builder */}
          {showBuilder ? (
            <View style={styles.builder}>
              <Text style={styles.builderLabel}>{t('scheduleModal.daysLabel')}</Text>
              <View style={styles.dayRow}>
                {DAYS.map((d) => (
                  <TouchableOpacity
                    key={d.key}
                    style={[styles.dayChip, days.includes(d.key) && styles.dayChipActive]}
                    onPress={() => toggleDay(d.key)}
                  >
                    <Text style={[styles.dayChipText, days.includes(d.key) && styles.dayChipTextActive]}>{t(d.labelKey)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.presetRow}>
                <TouchableOpacity style={styles.presetBtn} onPress={() => setDays(WEEKDAYS)}>
                  <Text style={styles.presetBtnText}>{t('scheduleModal.weekdays')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.presetBtn} onPress={() => setDays(WEEKENDS)}>
                  <Text style={styles.presetBtnText}>{t('scheduleModal.weekends')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.presetBtn} onPress={() => setDays(ALL_DAYS)}>
                  <Text style={styles.presetBtnText}>{t('scheduleModal.everyDay')}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.builderLabel}>{t('scheduleModal.timeWindowLabel')}</Text>
              <View style={styles.timeRow}>
                <TouchableOpacity style={styles.timeBtn} onPress={() => openTimePicker('start')}>
                  <Text style={styles.timeBtnLabel}>{t('scheduleModal.start')}</Text>
                  <Text style={styles.timeBtnValue}>{formatTime(start, t)}</Text>
                </TouchableOpacity>
                <Text style={styles.timeArrow}>→</Text>
                <TouchableOpacity style={styles.timeBtn} onPress={() => openTimePicker('end')}>
                  <Text style={styles.timeBtnLabel}>{t('scheduleModal.end')}</Text>
                  <Text style={styles.timeBtnValue}>{formatTime(end, t)}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.builderLabel}>{t('scheduleModal.modeLabel')}</Text>
              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, mode === 'strict' && styles.modeBtnStrictActive]}
                  onPress={() => setMode('strict')}
                >
                  <Lock color={mode === 'strict' ? '#A1A1AA' : MUTED} size={16} />
                  <Text style={[styles.modeBtnText, mode === 'strict' && { color: '#A1A1AA' }]}>{t('scheduleModal.strict')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, mode === 'cbt' && styles.modeBtnCoachActive]}
                  onPress={() => setMode('cbt')}
                >
                  <BrainCircuit color={mode === 'cbt' ? ACCENT : MUTED} size={16} />
                  <Text style={[styles.modeBtnText, mode === 'cbt' && { color: ACCENT }]}>{t('scheduleModal.coach')}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.builderActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={resetBuilder}>
                  <Text style={styles.cancelBtnText}>{t('scheduleModal.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                  <Text style={styles.saveBtnText}>{t('scheduleModal.saveSchedule')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowBuilder(true)} activeOpacity={0.8}>
              <Plus color={ACCENT} size={18} />
              <Text style={styles.addBtnText}>{t('scheduleModal.addSchedule')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {pickerTarget && Platform.OS === 'ios' && (
          <DateTimePicker
            value={hhmmToDate(pickerTarget === 'start' ? start : end)}
            mode="time"
            is24Hour={false}
            display="spinner"
            onChange={(event, selectedDate) => {
              const target = pickerTarget;
              if (event?.type === 'set' && selectedDate) {
                const hhmm = dateToHHMM(selectedDate);
                if (target === 'start') setStart(hhmm); else setEnd(hhmm);
              }
              setPickerTarget(null);
            }}
          />
        )}
      </View>
    </Modal>
  );
};

const makeStyles = (ACCENT, ON_ACCENT) => StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: 2, color: TEXT },
  intro: { color: MUTED, fontSize: 14, lineHeight: 21, marginBottom: 20 },
  scheduleCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 14, marginBottom: 10, gap: 10,
  },
  scheduleIconWrap: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#121214',
    alignItems: 'center', justifyContent: 'center',
  },
  scheduleTitle: { color: TEXT, fontSize: 14, fontWeight: '700' },
  scheduleTime: { color: MUTED, fontSize: 12, marginTop: 2 },
  deleteBtn: { padding: 4 },
  emptyState: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { color: MUTED, fontSize: 14, fontWeight: '600' },
  emptySubtext: { color: '#3F3F46', fontSize: 12 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: ACCENT, borderRadius: 14, paddingVertical: 16, marginTop: 8,
    backgroundColor: ACCENT + '14',
  },
  addBtnText: { color: ACCENT, fontSize: 14, fontWeight: '700' },
  builder: {
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 18, marginTop: 8,
  },
  builderLabel: { color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10, marginTop: 14 },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayChip: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#121214',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER,
  },
  dayChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  dayChipText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  dayChipTextActive: { color: ON_ACCENT },
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  presetBtn: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#121214',
    borderWidth: 1, borderColor: BORDER,
  },
  presetBtnText: { color: MUTED, fontSize: 11, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeBtn: {
    flex: 1, backgroundColor: '#121214', borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  timeBtnLabel: { color: MUTED, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  timeBtnValue: { color: TEXT, fontSize: 16, fontWeight: '700' },
  timeArrow: { color: MUTED, fontSize: 16 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#121214', borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingVertical: 12,
  },
  modeBtnStrictActive: { borderColor: '#A1A1AA', backgroundColor: 'rgba(161, 161, 170,0.08)' },
  modeBtnCoachActive: { borderColor: ACCENT, backgroundColor: ACCENT + '14' },
  modeBtnText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  builderActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
  cancelBtnText: { color: MUTED, fontSize: 14, fontWeight: '700' },
  saveBtn: { flex: 2, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT },
  saveBtnText: { color: ON_ACCENT, fontSize: 14, fontWeight: '800' },
});

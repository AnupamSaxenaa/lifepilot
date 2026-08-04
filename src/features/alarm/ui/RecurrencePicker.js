/**
 * LifePilot — RecurrencePicker
 * ------------------------------------------------------------------
 * A themed modal for choosing an alarm's repeat rule. Produces a recurrence
 * rule object (see alarmModel.js) via `onChange`. Pure UI — no persistence.
 *
 * Props:
 *   visible   boolean
 *   value     current recurrence rule (optional)
 *   time      'HH:mm' (carried into the produced rule)
 *   accent    accent color (from the app theme)
 *   onClose   () => void
 *   onChange  (rule) => void   // called on Done
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { weekdayShortName } from './recurrenceLabel';

const MODES = ['once', 'daily', 'weekdays', 'weekends', 'weekly', 'everyNDays', 'monthly', 'nthWeekday', 'lastWeekday', 'odd', 'even'];

const clampInt = (val, min, max, fallback) => {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const Stepper = ({ label, val, min, max, onChange }) => (
  <View style={styles.stepperRow}>
    <Text style={styles.rowLabel}>{label}</Text>
    <View style={styles.stepper}>
      <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(Math.max(min, val - 1))}>
        <Text style={styles.stepBtnTxt}>−</Text>
      </TouchableOpacity>
      <TextInput
        style={styles.stepInput}
        keyboardType="number-pad"
        value={String(val)}
        onChangeText={(txt) => onChange(clampInt(txt, min, max, val))}
      />
      <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(Math.min(max, val + 1))}>
        <Text style={styles.stepBtnTxt}>+</Text>
      </TouchableOpacity>
    </View>
  </View>
);

export const RecurrencePicker = ({ visible, value, time = '06:00', accent = '#FFFFFF', onClose, onChange }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState('daily');
  const [daysOfWeek, setDaysOfWeek] = useState([false, false, false, false, false, false, false]);
  const [interval, setIntervalVal] = useState(2);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [nth, setNth] = useState(1);
  const [weekday, setWeekday] = useState(0);

  // Seed from incoming value whenever the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const v = value || {};
    // Synchronizing modal draft state from the saved rule on open is an
    // intentional prop-to-editor reset, not an external subscription loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(MODES.includes(v.mode) ? v.mode : 'daily');
    setDaysOfWeek(Array.isArray(v.daysOfWeek) && v.daysOfWeek.length === 7 ? [...v.daysOfWeek] : [false, false, false, false, false, false, false]);
    setIntervalVal(v.interval && v.interval >= 1 ? v.interval : 2);
    setDayOfMonth(v.dayOfMonth && v.dayOfMonth >= 1 ? v.dayOfMonth : 1);
    setNth(v.nth && v.nth >= 1 ? v.nth : 1);
    setWeekday(v.weekday >= 0 && v.weekday <= 6 ? v.weekday : 0);
  }, [value, visible]);

  const buildRule = () => {
    const base = { mode, time };
    switch (mode) {
      case 'weekly': return { ...base, daysOfWeek: [...daysOfWeek], interval: 1 };
      case 'everyNDays': return { ...base, interval: clampInt(interval, 1, 365, 2) };
      case 'monthly': return { ...base, dayOfMonth: clampInt(dayOfMonth, 1, 31, 1) };
      case 'nthWeekday': return { ...base, nth: clampInt(nth, 1, 5, 1), weekday };
      case 'lastWeekday': return { ...base, weekday };
      default: return base; // once/daily/weekdays/weekends/odd/even
    }
  };

  const handleDone = () => {
    onChange && onChange(buildRule());
    onClose && onClose();
  };

  const toggleDay = (i) => {
    setDaysOfWeek((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('alarmRecurrence.title')}</Text>
          <TouchableOpacity onPress={handleDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.done, { color: accent }]}>{t('alarmRecurrence.done')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          {MODES.map((m) => (
            <TouchableOpacity key={m} style={styles.modeRow} onPress={() => setMode(m)} activeOpacity={0.7}>
              <Text style={styles.modeLabel}>{t(`alarmRecurrence.${m}`)}</Text>
              <View style={[styles.radio, { borderColor: accent }]}>
                {mode === m && <View style={[styles.radioDot, { backgroundColor: accent }]} />}
              </View>
            </TouchableOpacity>
          ))}

          {/* Contextual controls */}
          {mode === 'weekly' && (
            <View style={styles.daysRow}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.dayCircle, daysOfWeek[i] && { backgroundColor: accent }]}
                  onPress={() => toggleDay(i)}
                >
                  <Text style={[styles.dayTxt, daysOfWeek[i] && styles.dayTxtActive]}>{weekdayShortName(i).slice(0, 1)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {mode === 'everyNDays' && (
            <Stepper label={t('alarmRecurrence.intervalLabel')} val={interval} min={1} max={365} onChange={setIntervalVal} />
          )}

          {mode === 'monthly' && (
            <Stepper label={t('alarmRecurrence.dayOfMonthLabel')} val={dayOfMonth} min={1} max={31} onChange={setDayOfMonth} />
          )}

          {mode === 'nthWeekday' && (
            <>
              <Stepper label={t('alarmRecurrence.nthLabel')} val={nth} min={1} max={5} onChange={setNth} />
              <View style={styles.daysRow}>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.dayCircle, weekday === i && { backgroundColor: accent }]}
                    onPress={() => setWeekday(i)}
                  >
                    <Text style={[styles.dayTxt, weekday === i && styles.dayTxtActive]}>{weekdayShortName(i).slice(0, 1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {mode === 'lastWeekday' && (
            <View style={styles.daysRow}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.dayCircle, weekday === i && { backgroundColor: accent }]}
                  onPress={() => setWeekday(i)}
                >
                  <Text style={[styles.dayTxt, weekday === i && styles.dayTxtActive]}>{weekdayShortName(i).slice(0, 1)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: '#111114', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  done: { fontSize: 17, fontWeight: '700' },
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#26262B' },
  modeLabel: { color: '#EDEDED', fontSize: 16 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 16 },
  dayCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1E1E22', justifyContent: 'center', alignItems: 'center' },
  dayTxt: { color: '#CFCFD4', fontSize: 14, fontWeight: '600' },
  dayTxtActive: { color: '#000', fontWeight: '800' },
  stepperRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
  rowLabel: { color: '#EDEDED', fontSize: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1E1E22', justifyContent: 'center', alignItems: 'center' },
  stepBtnTxt: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  stepInput: { color: '#FFF', fontSize: 18, fontWeight: '700', minWidth: 48, textAlign: 'center', padding: 0 },
});

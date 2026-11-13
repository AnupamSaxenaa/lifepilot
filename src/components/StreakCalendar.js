import { Check, ChevronLeft, ChevronRight, Snowflake, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const STATUS = {
  active: { key: 'streakCalendar.maintained', fallback: 'Maintained', color: '#F4F4F5' },
  frozen: { key: 'streakCalendar.freezeUsed', fallback: 'Freeze used', color: '#93C5FD' },
  broken: { key: 'streakCalendar.streakBroke', fallback: 'Streak broke', color: '#FDA4AF' },
  missed: { key: 'streakCalendar.missed', fallback: 'Missed', color: '#71717A' },
};

const parseDayKey = (key) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return new Date();
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const dayKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const sameMonth = (left, right) => (
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
);

const DayMark = ({ type }) => {
  if (type === 'active') return <Check color={STATUS.active.color} size={10} strokeWidth={2.3} />;
  if (type === 'frozen') return <Snowflake color={STATUS.frozen.color} size={10} strokeWidth={1.9} />;
  if (type === 'broken') return <X color={STATUS.broken.color} size={10} strokeWidth={2.2} />;
  return type === 'missed' ? <View style={styles.missedDot} /> : null;
};

export const StreakCalendar = ({ history = [], today, palette }) => {
  const { t } = useTranslation();
  const label = (type) => t(STATUS[type].key, { defaultValue: STATUS[type].fallback });
  const resolvedToday = today || dayKey(new Date());
  const todayDate = useMemo(() => parseDayKey(resolvedToday), [resolvedToday]);
  // Derived from an offset instead of mirrored state, so the grid follows the
  // real current month across a date rollover with no effect-driven resync.
  const [monthOffset, setMonthOffset] = useState(0);
  const visibleMonth = useMemo(
    () => new Date(todayDate.getFullYear(), todayDate.getMonth() + monthOffset, 1),
    [monthOffset, todayDate],
  );

  const historyByDay = useMemo(() => new Map(
    (Array.isArray(history) ? history : []).map((event) => [event.date, event]),
  ), [history]);

  const days = useMemo(() => {
    const start = new Date(visibleMonth);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [visibleMonth]);

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(visibleMonth);
  const weekdayLabels = useMemo(() => {
    const sunday = new Date(2024, 0, 7);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + index);
      return new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(date);
    });
  }, []);
  const canMoveForward = monthOffset < 0;

  const moveMonth = (amount) => {
    setMonthOffset((current) => Math.min(0, current + amount));
  };

  return (
    <View style={[styles.card, { borderColor: palette.border }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: palette.muted }]}>
            {t('streakCalendar.title', { defaultValue: 'Streak history' }).toUpperCase()}
          </Text>
          <Text style={[styles.monthTitle, { color: palette.text }]}>{monthLabel}</Text>
        </View>
        <View style={styles.monthActions}>
          <TouchableOpacity
            onPress={() => moveMonth(-1)}
            style={[styles.monthButton, { borderColor: palette.border }]}
            accessibilityRole="button"
            accessibilityLabel={t('streakCalendar.previousMonth', { defaultValue: 'Previous month' })}
          >
            <ChevronLeft color={palette.muted} size={17} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => moveMonth(1)}
            disabled={!canMoveForward}
            style={[styles.monthButton, { borderColor: palette.border, opacity: canMoveForward ? 1 : 0.3 }]}
            accessibilityRole="button"
            accessibilityLabel={t('streakCalendar.nextMonth', { defaultValue: 'Next month' })}
          >
            <ChevronRight color={palette.muted} size={17} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.weekRow}>
        {weekdayLabels.map((label, index) => (
          <Text key={`${label}-${index}`} style={[styles.weekday, { color: palette.muted }]}>{label}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((date) => {
          const key = dayKey(date);
          const event = historyByDay.get(key);
          const type = event?.type;
          const status = STATUS[type];
          const inMonth = sameMonth(date, visibleMonth);
          const isToday = key === resolvedToday;
          const isFuture = date > todayDate;
          const dayLabel = status
            ? `${date.toLocaleDateString()}, ${label(type)}${event?.xpSpent ? `, ${event.xpSpent} XP` : ''}`
            : date.toLocaleDateString();

          return (
            <View
              key={key}
              accessible
              accessibilityLabel={dayLabel}
              style={styles.daySlot}
            >
              <View
                style={[
                  styles.day,
                  type === 'active' && styles.dayActive,
                  type === 'frozen' && styles.dayFrozen,
                  type === 'broken' && styles.dayBroken,
                  isToday && { borderColor: palette.text },
                  (!inMonth || isFuture) && styles.dayOutside,
                ]}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    { color: inMonth ? palette.text : palette.muted },
                    type && { color: status.color },
                  ]}
                >
                  {date.getDate()}
                </Text>
                <View style={styles.dayMark}><DayMark type={type} /></View>
              </View>
            </View>
          );
        })}
      </View>

      <View style={[styles.legend, { borderTopColor: palette.border }]}>
        {Object.entries(STATUS).map(([type, item]) => (
          <View key={type} style={styles.legendItem}>
            <View style={[styles.legendMark, { borderColor: item.color }]}><DayMark type={type} /></View>
            <Text style={[styles.legendText, { color: palette.muted }]}>{label(type)}</Text>
          </View>
        ))}
      </View>
      {!(Array.isArray(history) && history.some((event) => event.type === 'frozen' || event.type === 'broken')) ? (
        <Text style={[styles.historyNote, { color: palette.muted }]}>
          {t('streakCalendar.historyNote', {
            defaultValue: 'History starts from this app version; earlier freeze and break days were not recorded.',
          })}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { marginTop: 18, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  eyebrow: { fontSize: 9, fontWeight: '600', letterSpacing: 1.25 },
  monthTitle: { fontSize: 18, lineHeight: 24, fontWeight: '400', letterSpacing: -0.35, marginTop: 3 },
  monthActions: { flexDirection: 'row', gap: 8 },
  monthButton: { width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row', marginBottom: 5 },
  weekday: { width: '14.2857%', textAlign: 'center', fontSize: 10, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  daySlot: { width: '14.2857%', aspectRatio: 0.92, alignItems: 'center', justifyContent: 'center' },
  day: { width: 34, height: 38, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  dayActive: { backgroundColor: 'rgba(244,244,245,0.08)', borderColor: 'rgba(244,244,245,0.26)' },
  dayFrozen: { backgroundColor: 'rgba(147,197,253,0.09)', borderColor: 'rgba(147,197,253,0.38)' },
  dayBroken: { backgroundColor: 'rgba(253,164,175,0.07)', borderColor: 'rgba(253,164,175,0.34)' },
  dayOutside: { opacity: 0.28 },
  dayNumber: { fontSize: 11, fontWeight: '500', lineHeight: 14 },
  dayMark: { height: 11, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  missedDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: STATUS.missed.color },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendMark: { width: 18, height: 18, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  legendText: { fontSize: 10.5 },
  historyNote: { fontSize: 10.5, lineHeight: 15, marginTop: 11 },
});
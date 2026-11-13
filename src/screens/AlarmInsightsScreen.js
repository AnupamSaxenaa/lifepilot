/**
 * LifePilot — Alarm Insights
 * ------------------------------------------------------------------
 * Premium wake analytics derived entirely from dataManager's offline cache.
 * Cached alarms/history paint first; background refreshes update silently.
 */
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Award, CheckCircle2, Flame, Lightbulb, Target, TrendingUp, Trophy } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { buildMonthlyOutcomeMap, computeAlarmStats } from '../features/alarm/data/historyModel';
import { getSmartSuggestions } from '../features/alarm/suggestions';
import { getCurrentUserId, loadAlarmHistory, loadAlarms } from '../lib/dataManager';

const SUCCESS = '#34D399';
const WARNING = '#FBBF24';
const ERROR = '#FB7185';
const STREAK = '#FB923C';
const WEEKLY_GOAL = 5;
const MONTHLY_GOAL = 20;

const validTime = (item) => {
  const time = new Date(item?.triggered_at).getTime();
  return Number.isFinite(time) ? time : null;
};

const countSuccessfulDays = (items) => new Set(
  (items || [])
    .filter((item) => item.outcome === 'dismissed' && validTime(item) !== null)
    .map((item) => new Date(item.triggered_at).toDateString()),
).size;

const startOfWeek = (date) => {
  const result = new Date(date);
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  result.setHours(0, 0, 0, 0);
  return result;
};

const buildTrend = (items, unit, count, now, locale) => {
  const buckets = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    let start;
    let end;
    let label;
    if (unit === 'week') {
      start = startOfWeek(now);
      start.setDate(start.getDate() - offset * 7);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      label = start.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
    } else {
      start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      label = start.toLocaleDateString(locale, { month: 'short' });
    }
    const records = (items || []).filter((item) => {
      const time = validTime(item);
      return time !== null && time >= start.getTime() && time < end.getTime();
    });
    const decided = records.filter((item) => ['dismissed', 'missed', 'skipped'].includes(item.outcome));
    const successes = decided.filter((item) => item.outcome === 'dismissed').length;
    buckets.push({ label, rate: decided.length ? successes / decided.length : 0, total: decided.length });
  }
  return buckets;
};

const StatCard = ({ label, value, accent }) => (
  <View style={styles.statCard}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={[styles.statLabel, accent && { color: accent }]}>{label}</Text>
  </View>
);

const ProgressCard = ({ icon, title, completed, target, accent, t }) => {
  const ratio = Math.min(completed / target, 1);
  return (
    <View style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <View style={[styles.progressIcon, { backgroundColor: `${accent}1F` }]}>{icon}</View>
        <View style={styles.progressCopy}>
          <Text style={styles.progressTitle}>{title}</Text>
          <Text style={styles.progressValue}>{t('alarmInsights.goalProgress', { completed, target })}</Text>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { backgroundColor: accent, width: `${ratio * 100}%` }]} />
      </View>
    </View>
  );
};

const TrendStrip = ({ title, buckets, accent }) => (
  <View style={styles.trendSection}>
    <Text style={styles.trendLabel}>{title}</Text>
    <View style={styles.trendBars}>
      {buckets.map((bucket, index) => (
        <View key={`${bucket.label}-${index}`} style={styles.trendColumn}>
          <Text style={styles.trendValue}>{bucket.total ? `${Math.round(bucket.rate * 100)}%` : '—'}</Text>
          <View style={styles.trendTrack}>
            <View
              style={[
                styles.trendFill,
                { backgroundColor: accent, height: bucket.total ? `${Math.max(bucket.rate * 100, 6)}%` : '3%' },
                !bucket.total && styles.trendFillEmpty,
              ]}
            />
          </View>
          <Text numberOfLines={1} style={styles.trendAxisLabel}>{bucket.label}</Text>
        </View>
      ))}
    </View>
  </View>
);

export const AlarmInsightsScreen = ({ navigation }) => {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const accent = theme.accent;
  const onAccent = theme.onAccent || '#0B0B0D';
  const [history, setHistory] = useState([]);
  const [alarms, setAlarms] = useState([]);
  const [period, setPeriod] = useState('week');

  const load = useCallback(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const [cachedHistory, cachedAlarms] = await Promise.all([
      loadAlarmHistory(userId, setHistory),
      loadAlarms(userId, setAlarms),
    ]);
    setHistory(cachedHistory || []);
    setAlarms(cachedAlarms || []);
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const [now] = useState(() => new Date());
  const periodHistory = useMemo(() => {
    if (period === 'all') return history;
    const start = new Date(now);
    if (period === 'week') start.setDate(start.getDate() - 7);
    else start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return history.filter((item) => {
      const time = validTime(item);
      return time !== null && time >= start.getTime();
    });
  }, [history, now, period]);

  const stats = useMemo(() => computeAlarmStats(periodHistory), [periodHistory]);
  const allStats = useMemo(() => computeAlarmStats(history), [history]);
  const monthMap = useMemo(
    () => buildMonthlyOutcomeMap(history, now.getFullYear(), now.getMonth()),
    [history, now],
  );
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const rankedDays = [...stats.dayOfWeekSuccessRates]
    .filter((day) => day.total > 0)
    .sort((a, b) => b.rate - a.rate);
  const bestDay = rankedDays[0] || null;
  const worstDay = rankedDays.length > 1 ? rankedDays[rankedDays.length - 1] : null;
  const lateWakeRate = periodHistory.length
    ? periodHistory.filter((item) => (item.dismiss_duration_ms || 0) > 5 * 60 * 1000).length / periodHistory.length
    : 0;
  const snoozeControl = Math.max(0, 1 - stats.averageSnoozeCount / 3);
  const morningScore = Math.max(0, Math.min(100, Math.round(
    stats.completionRate * 55 + stats.wakeConsistency * 25 + snoozeControl * 20,
  )));

  const alarmTitles = useMemo(() => new Map(
    alarms.map((alarm) => [String(alarm.id), alarm.title || alarm.label?.text || t('alarmList.defaultAlarmName')]),
  ), [alarms, t]);
  const mostSnoozedTitle = stats.mostSnoozedAlarm
    ? alarmTitles.get(String(stats.mostSnoozedAlarm.alarmId)) || t('alarmList.defaultAlarmName')
    : null;

  const currentWeekStart = startOfWeek(now);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weeklySuccesses = countSuccessfulDays(history.filter((item) => (validTime(item) || 0) >= currentWeekStart.getTime()));
  const monthlySuccesses = countSuccessfulDays(history.filter((item) => (validTime(item) || 0) >= currentMonthStart.getTime()));
  const noSnoozeWins = history.filter((item) => item.outcome === 'dismissed' && !(item.snooze_count > 0)).length;
  const challengeWins = history.filter(
    (item) => item.outcome === 'dismissed' && Array.isArray(item.challenge_ids) && item.challenge_ids.length > 0,
  ).length;
  const badges = [
    { key: 'firstWake', progress: countSuccessfulDays(history), target: 1 },
    { key: 'weekWarrior', progress: allStats.longestStreak, target: 7 },
    { key: 'noSnooze', progress: noSnoozeWins, target: 5 },
    { key: 'challengeMaster', progress: challengeWins, target: 10 },
  ];
  const challengeHistory = [...periodHistory]
    .filter((item) => Array.isArray(item.challenge_ids) && item.challenge_ids.length > 0)
    .sort((a, b) => (validTime(b) || 0) - (validTime(a) || 0))
    .slice(0, 5);
  const weeklyTrend = useMemo(
    () => buildTrend(history, 'week', 8, now, i18n.language),
    [history, i18n.language, now],
  );
  const monthlyTrend = useMemo(
    () => buildTrend(history, 'month', 6, now, i18n.language),
    [history, i18n.language, now],
  );
  const suggestions = useMemo(() => getSmartSuggestions(history), [history]);

  const outcomeColor = (outcome) => {
    if (outcome === 'dismissed') return SUCCESS;
    if (outcome === 'snoozed') return WARNING;
    if (outcome === 'missed') return ERROR;
    return '#71717A';
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('alarmInsights.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.periodRow}>
          {['week', 'month', 'all'].map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.periodChip, period === option && { backgroundColor: accent }]}
              onPress={() => setPeriod(option)}
            >
              <Text style={[styles.periodText, period === option && [styles.periodTextActive, { color: onAccent }]]}>
                {t(`alarmInsights.period.${option}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {stats.totalSessions === 0 ? (
          <View style={styles.emptyWrap}>
            <TrendingUp color="#71717A" size={40} />
            <Text style={styles.emptyText}>{t('alarmInsights.noData')}</Text>
          </View>
        ) : (
          <>
            <View style={[styles.scoreCard, { borderColor: `${accent}70` }]}>
              <View style={[styles.scoreOrb, { borderColor: accent, backgroundColor: `${accent}14` }]}>
                <Text style={[styles.scoreValue, { color: accent }]}>{morningScore}</Text>
                <Text style={styles.scoreOutOf}>/ 100</Text>
              </View>
              <View style={styles.scoreCopy}>
                <Text style={styles.scoreTitle}>{t('alarmInsights.morningScore')}</Text>
                <Text style={styles.scoreDetail}>{t('alarmInsights.morningScoreDetail')}</Text>
              </View>
            </View>

            <View style={styles.statsGrid}>
              <StatCard label={t('alarmInsights.completionRate')} value={`${Math.round(stats.completionRate * 100)}%`} accent={SUCCESS} />
              <StatCard label={t('alarmInsights.wakeConsistency')} value={`${Math.round(stats.wakeConsistency * 100)}%`} accent={accent} />
              <StatCard label={t('alarmInsights.averageWakeTime')} value={stats.averageWakeTime || '—'} />
              <StatCard label={t('alarmInsights.averageSnoozeCount')} value={stats.averageSnoozeCount.toFixed(1)} />
              <StatCard label={t('alarmInsights.longestStreak')} value={`${stats.longestStreak} ${t('alarmInsights.days')}`} accent={STREAK} />
              <StatCard label={t('alarmInsights.totalSessions')} value={stats.totalSessions} />
              <StatCard label={t('alarmInsights.lateWakeFrequency')} value={`${Math.round(lateWakeRate * 100)}%`} />
            </View>

            <Text style={styles.sectionTitle}>{t('alarmInsights.goalsTitle')}</Text>
            <View style={styles.goalGrid}>
              <ProgressCard
                icon={<Target color={accent} size={18} />}
                title={t('alarmInsights.weeklyGoal')}
                completed={weeklySuccesses}
                target={WEEKLY_GOAL}
                accent={accent}
                t={t}
              />
              <ProgressCard
                icon={<Trophy color={WARNING} size={18} />}
                title={t('alarmInsights.monthlyMilestone')}
                completed={monthlySuccesses}
                target={MONTHLY_GOAL}
                accent={WARNING}
                t={t}
              />
            </View>

            <Text style={styles.sectionTitle}>{t('alarmInsights.achievementsTitle')}</Text>
            <View style={styles.badgeGrid}>
              {badges.map((badge) => {
                const unlocked = badge.progress >= badge.target;
                return (
                  <View key={badge.key} style={[styles.badgeCard, !unlocked && styles.badgeLocked]}>
                    <View style={[styles.badgeIcon, unlocked && { borderColor: accent, backgroundColor: `${accent}1A` }]}>
                      {unlocked
                        ? <Award color={accent} size={20} />
                        : <Award color="#52525B" size={20} />}
                    </View>
                    <Text style={styles.badgeTitle}>{t(`alarmInsights.badges.${badge.key}`)}</Text>
                    <Text style={styles.badgeProgress}>
                      {t('alarmInsights.goalProgress', { completed: Math.min(badge.progress, badge.target), target: badge.target })}
                    </Text>
                  </View>
                );
              })}
            </View>

            {stats.longestStreak > 0 && (
              <View style={styles.streakBanner}>
                <Flame color={STREAK} size={20} />
                <Text style={[styles.streakText, { color: STREAK }]}>{stats.longestStreak} {t('alarmInsights.days')}</Text>
              </View>
            )}

            <View style={styles.trendCard}>
              <Text style={styles.sectionTitle}>{t('alarmInsights.trendsTitle')}</Text>
              <TrendStrip title={t('alarmInsights.weeklyTrend')} buckets={weeklyTrend} accent={accent} />
              <TrendStrip title={t('alarmInsights.monthlyTrend')} buckets={monthlyTrend} accent={accent} />
            </View>

            <Text style={styles.sectionTitle}>{t('alarmInsights.calendarTitle')}</Text>
            <View style={styles.calendarGrid}>
              {Array.from({ length: daysInMonth }, (_, index) => {
                const dayNum = index + 1;
                const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                return (
                  <View key={key} style={[styles.calendarCell, { backgroundColor: outcomeColor(monthMap[key]) }]}>
                    <Text style={styles.calendarDayText}>{dayNum}</Text>
                  </View>
                );
              })}
            </View>

            {stats.mostSnoozedAlarm && (
              <View style={styles.insightRow}>
                <Text style={styles.insightLabel}>{t('alarmInsights.mostSnoozed')}</Text>
                <Text style={styles.insightValue}>{mostSnoozedTitle} · {stats.mostSnoozedAlarm.count}×</Text>
              </View>
            )}
            {stats.mostDifficultChallenge && (
              <View style={styles.insightRow}>
                <Text style={styles.insightLabel}>{t('alarmInsights.mostDifficultChallenge')}</Text>
                <Text style={styles.insightValue}>
                  {t(`alarmChallenges.${stats.mostDifficultChallenge.id}`, { defaultValue: stats.mostDifficultChallenge.id })}
                </Text>
              </View>
            )}

            {challengeHistory.length > 0 && (
              <View style={styles.challengeSection}>
                <Text style={styles.sectionTitle}>{t('alarmInsights.challengeHistory')}</Text>
                {challengeHistory.map((item, index) => (
                  <View key={item.id || `${item.triggered_at}-${index}`} style={styles.challengeRow}>
                    <CheckCircle2 color={outcomeColor(item.outcome)} size={18} />
                    <View style={styles.challengeCopy}>
                      <Text style={styles.challengeNames}>
                        {item.challenge_ids.map((id) => t(`alarmChallenges.${id}`, { defaultValue: id })).join(' · ')}
                      </Text>
                      <Text style={styles.challengeDate}>
                        {new Date(item.triggered_at).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                    <Text style={[styles.challengeOutcome, { color: outcomeColor(item.outcome) }]}>
                      {t(`alarmInsights.outcomes.${item.outcome}`, { defaultValue: item.outcome })}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {rankedDays.length > 0 && (
              <View style={styles.reportCard}>
                <Text style={styles.sectionTitle}>{t('alarmInsights.dayPerformance')}</Text>
                {stats.dayOfWeekSuccessRates.map((day) => (
                  <View key={day.dow} style={styles.dayBarRow}>
                    <Text style={styles.dayBarLabel}>{t(`alarmInsights.weekdays.${day.dow}`)}</Text>
                    <View style={styles.dayBarTrack}>
                      <View style={[styles.dayBarFill, { backgroundColor: accent, width: `${Math.round((day.rate || 0) * 100)}%` }]} />
                    </View>
                    <Text style={styles.dayBarValue}>{day.total ? `${Math.round(day.rate * 100)}%` : '—'}</Text>
                  </View>
                ))}
                {bestDay && <Text style={styles.reportText}>{t('alarmInsights.bestDay', { day: t(`alarmInsights.weekdays.${bestDay.dow}`) })}</Text>}
                {worstDay && <Text style={styles.reportText}>{t('alarmInsights.worstDay', { day: t(`alarmInsights.weekdays.${worstDay.dow}`) })}</Text>}
              </View>
            )}

            {suggestions.length > 0 && (
              <View style={styles.suggestionsSection}>
                <Text style={styles.sectionTitle}>{t('alarmSuggestions.title')}</Text>
                {suggestions.map((suggestion, index) => (
                  <View key={`${suggestion.key}-${index}`} style={styles.suggestionRow}>
                    <Lightbulb color={WARNING} size={16} />
                    <Text style={styles.suggestionText}>{t(suggestion.key, suggestion.params)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', paddingVertical: 60, gap: 14 },
  emptyText: { color: '#A1A1AA', fontSize: 14, textAlign: 'center', paddingHorizontal: 30 },
  scoreCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181B', borderWidth: 1, borderRadius: 20, padding: 18, marginBottom: 16, gap: 16 },
  scoreOrb: { width: 88, height: 88, borderRadius: 44, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  scoreValue: { fontSize: 30, lineHeight: 32, fontWeight: '900' },
  scoreOutOf: { color: '#71717A', fontSize: 10, fontWeight: '700' },
  scoreCopy: { flex: 1 },
  scoreTitle: { color: '#FFF', fontSize: 19, fontWeight: '800', marginBottom: 5 },
  scoreDetail: { color: '#A1A1AA', fontSize: 12, lineHeight: 17 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  statCard: { width: '31%', backgroundColor: '#18181B', borderRadius: 16, padding: 14, alignItems: 'center' },
  statValue: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  statLabel: { color: '#A1A1AA', fontSize: 10, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  sectionTitle: { color: '#A1A1AA', fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  goalGrid: { gap: 10, marginBottom: 24 },
  progressCard: { backgroundColor: '#18181B', borderRadius: 16, padding: 14 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  progressIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  progressCopy: { flex: 1 },
  progressTitle: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  progressValue: { color: '#A1A1AA', fontSize: 11, marginTop: 2 },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: '#27272A', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  badgeCard: { width: '48%', backgroundColor: '#18181B', borderRadius: 16, padding: 13 },
  badgeLocked: { opacity: 0.56 },
  badgeIcon: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: '#3F3F46', backgroundColor: '#27272A', alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  badgeTitle: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  badgeProgress: { color: '#A1A1AA', fontSize: 10, marginTop: 3 },
  streakBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(251,146,60,0.1)', borderRadius: 16, padding: 14, marginBottom: 20 },
  streakText: { color: STREAK, fontSize: 15, fontWeight: '700' },
  trendCard: { backgroundColor: '#18181B', borderRadius: 18, padding: 16, marginBottom: 24 },
  trendSection: { marginBottom: 16 },
  trendLabel: { color: '#D4D4D8', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  trendBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  trendColumn: { flex: 1, alignItems: 'center', minWidth: 0 },
  trendValue: { color: '#A1A1AA', fontSize: 8, marginBottom: 3 },
  trendTrack: { width: '75%', height: 52, borderRadius: 4, backgroundColor: '#27272A', overflow: 'hidden', justifyContent: 'flex-end' },
  trendFill: { width: '100%', borderRadius: 4 },
  trendFillEmpty: { backgroundColor: '#3F3F46' },
  trendAxisLabel: { color: '#71717A', fontSize: 8, marginTop: 4, width: '100%', textAlign: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
  calendarCell: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  calendarDayText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  insightRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272A' },
  insightLabel: { color: '#A1A1AA', fontSize: 14, flex: 1 },
  insightValue: { color: '#FFF', fontSize: 14, fontWeight: '700', flex: 1, textAlign: 'right' },
  challengeSection: { marginTop: 24 },
  challengeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#18181B', borderRadius: 14, padding: 12, marginBottom: 8 },
  challengeCopy: { flex: 1 },
  challengeNames: { color: '#F4F4F5', fontSize: 12, fontWeight: '700' },
  challengeDate: { color: '#71717A', fontSize: 10, marginTop: 3 },
  challengeOutcome: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  reportCard: { marginTop: 24, padding: 16, borderRadius: 16, backgroundColor: '#18181B' },
  dayBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
  dayBarLabel: { color: '#A1A1AA', width: 30, fontSize: 11, fontWeight: '700' },
  dayBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#27272A', overflow: 'hidden' },
  dayBarFill: { height: '100%', borderRadius: 4 },
  dayBarValue: { color: '#FFF', width: 34, textAlign: 'right', fontSize: 10 },
  reportText: { color: '#D4D4D8', fontSize: 12, marginTop: 8 },
  suggestionsSection: { marginTop: 24 },
  suggestionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#18181B', borderRadius: 14, padding: 12, marginBottom: 8 },
  suggestionText: { color: '#D4D4D8', fontSize: 13, flex: 1, lineHeight: 18 },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  periodChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#18181B' },
  periodText: { color: '#A1A1AA', fontSize: 12, fontWeight: '700' },
  // Overridden inline with the derived onAccent — the chip fill is the theme
  // accent, which can be dark.
  periodTextActive: { color: '#09090B' },
});

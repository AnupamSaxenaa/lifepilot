// ─── Leaderboard ─────────────────────────────────────────
// Global ranking, separate from friends. Three periods: today, month, year.
//
// Freshness strategy: the rank is computed at READ time by the
// `live_leaderboard` RPC, and a Realtime subscription on user_daily_stats
// re-reads it whenever anyone's totals change. That is what "updates
// constantly" means in practice — a per-millisecond recompute would hammer the
// database for changes no eye can follow, so we react to real events instead,
// which is both faster to appear and far cheaper.
// ─────────────────────────────────────────────────────────
import { ArrowLeft, Crown, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { getCurrentUserId } from '../lib/dataManager';
import {
    PERIODS,
    applySelfStats,
    loadLiveLeaderboard,
    loadMyRank,
    subscribeToLeaderboard,
} from '../lib/hustlersManager';
import { formatHustle, getFocusTotals } from '../utils/focusSessions';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';
import { XpEvents } from '../utils/xpEvents';

const PERIOD_LABEL = { daily: 'TODAY', monthly: 'MONTH', yearly: 'YEAR' };

export const LeaderboardScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [period, setPeriod] = useState('daily');
  const [rows, setRows] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // The signed-in user's own totals, read from local device state. This is what
  // makes ticking a task feel instant: no round trip is involved.
  const [self, setSelf] = useState(null);
  // Coalesces bursts of Realtime events into one read, so ten people finishing
  // sessions at once does not fire ten queries.
  const pendingRef = useRef(null);

  const palette = useMemo(() => ({
    bg: theme?.bg || '#000000',
    text: theme?.text || '#F5F5F7',
    muted: theme?.muted || '#8E8E93',
    border: theme?.hairline || 'rgba(244,244,245,0.16)',
    accent: theme?.accent || '#FFFFFF',
  }), [theme]);

  // Recompute my own row from local state. Cheap (two cached reads) and always
  // reflects the optimistic UI the task list already shows.
  const refreshSelf = useCallback(async (activePeriod = period) => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const [totals, state, profile] = await Promise.all([
      getFocusTotals(uid),
      Gamification.getState(uid),
      Storage.get(`profile_${uid}`),
    ]);
    const focusByPeriod = {
      daily: totals.today,
      monthly: totals.month,
      yearly: totals.year,
    };
    setSelf({
      userId: uid,
      username: profile?.username || '',
      displayName: profile?.display_name || 'You',
      avatarUrl: profile?.avatar_url || null,
      focusSeconds: focusByPeriod[activePeriod] ?? totals.today,
      // Only today's count is tracked locally; longer periods stay server-driven.
      tasksCompleted: activePeriod === 'daily' ? (state?.tasksCompletedToday || 0) : null,
    });
  }, [period]);

  const refresh = useCallback(async (activePeriod = period) => {
    const [cached, rank] = await Promise.all([
      loadLiveLeaderboard(activePeriod, setRows),
      loadMyRank(activePeriod),
    ]);
    setRows((prev) => (prev.length > 0 ? prev : cached));
    setMyRank(rank);
    refreshSelf(activePeriod);
  }, [period, refreshSelf]);

  useEffect(() => {
    let active = true;
    (async () => {
      // Clearing inside the async body avoids a synchronous setState during the
      // effect, which would cascade an extra render on every period switch.
      setRows([]);
      const cached = await loadLiveLeaderboard(period, (fresh) => active && setRows(fresh));
      if (active) {
        setRows(cached);
        await refreshSelf(period);
        setMyRank(await loadMyRank(period));
      }
    })();
    return () => { active = false; };
  }, [period, refreshSelf]);

  useEffect(() => {
    const unsubscribe = subscribeToLeaderboard(() => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => refresh(period), 900);
    });
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      unsubscribe();
    };
  }, [period, refresh]);

  // Every task complete/uncomplete emits an XP event. Reacting to it updates my
  // row in the same frame, then a debounced server refresh confirms it.
  useEffect(() => {
    const unsub = XpEvents.subscribe(() => {
      refreshSelf(period);
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => refresh(period), 1200);
    });
    return unsub;
  }, [period, refresh, refreshSelf]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await refresh(period);
    setRefreshing(false);
  };

  // Server rows for everyone else, local truth for me.
  const visibleRows = useMemo(() => applySelfStats(rows, self), [rows, self]);
  const myLiveRank = useMemo(() => {
    const mine = visibleRows.find((r) => r.is_me);
    if (!mine) return myRank;
    return {
      rank: mine.rank,
      focusSeconds: mine.focus_seconds,
      totalRanked: myRank?.totalRanked ?? visibleRows.length,
    };
  }, [visibleRows, myRank]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.replace('Dashboard');
          }}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft color={palette.text} size={22} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: palette.text }]}>
          {t('leaderboard.title', { defaultValue: 'Leaderboard' })}
        </Text>
        <View style={styles.headerSpacer} />
        <TouchableOpacity
          onPress={handleManualRefresh}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={t('leaderboard.refresh', { defaultValue: 'Refresh' })}
        >
          <RefreshCw color={refreshing ? palette.text : palette.muted} size={18} />
        </TouchableOpacity>
      </View>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            onPress={() => setPeriod(p)}
            style={[
              styles.periodChip,
              { borderColor: palette.border },
              period === p && { borderColor: palette.accent },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: period === p }}
          >
            <Text style={[styles.periodText, { color: period === p ? palette.text : palette.muted }]}>
              {t(`leaderboard.${p}`, { defaultValue: PERIOD_LABEL[p] })}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {myLiveRank ? (
        <View style={[styles.myCard, { borderColor: palette.border }]}>
          <Text style={[styles.microLabel, { color: palette.muted }]}>
            {t('leaderboard.yourStanding', { defaultValue: 'YOUR STANDING' })}
          </Text>
          <View style={styles.myRow}>
            <Text style={[styles.myRank, { color: palette.text }]}>#{myLiveRank.rank}</Text>
            <Text style={[styles.myMeta, { color: palette.muted }]}>
              {t('leaderboard.ofRanked', {
                total: myLiveRank.totalRanked,
                defaultValue: `of ${myLiveRank.totalRanked} hustlers`,
              })}
            </Text>
            <View style={styles.headerSpacer} />
            <Text style={[styles.myHustle, { color: palette.text }]}>{formatHustle(myLiveRank.focusSeconds)}</Text>
          </View>
        </View>
      ) : null}

      <FlatList
        data={visibleRows}
        keyExtractor={(item) => String(item.user_id)}
        removeClippedSubviews
        initialNumToRender={15}
        windowSize={9}
        refreshing={refreshing}
        onRefresh={handleManualRefresh}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View
            style={[
              styles.row,
              { borderColor: palette.border },
              item.is_me && { backgroundColor: `${palette.text}0A` },
            ]}
            accessible
            accessibilityLabel={`Rank ${item.rank}, ${item.display_name || item.username}, ${formatHustle(item.focus_seconds)}`}
          >
            <Text style={[styles.rank, { color: item.rank <= 3 ? palette.text : palette.muted }]}>
              {item.rank}
            </Text>
            {item.rank === 1 ? <Crown color={palette.accent} size={14} /> : null}
            {item.avatar_url ? (
              <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarFallback, { borderColor: palette.border }]}>
                <Text style={[styles.avatarInitial, { color: palette.muted }]}>
                  {(item.display_name || item.username || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.rowCopy}>
              <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                {item.display_name || item.username || 'Hustler'}
                {item.is_me ? ' · you' : ''}
              </Text>
              <Text style={[styles.rowMeta, { color: palette.muted }]} numberOfLines={1}>
                {item.tasks_completed} {t('leaderboard.tasks', { defaultValue: 'tasks' })}
              </Text>
            </View>
            <Text style={[styles.hustle, { color: palette.text }]}>{formatHustle(item.focus_seconds)}</Text>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Crown color={palette.muted} size={26} />
            <Text style={[styles.emptyTitle, { color: palette.text }]}>
              {t('leaderboard.emptyTitle', { defaultValue: 'Nobody ranked yet' })}
            </Text>
            <Text style={[styles.emptyBody, { color: palette.muted }]}>
              {t('leaderboard.emptyBody', { defaultValue: 'Turn on “Appear on global ranking” in Settings, then log a focus session.' })}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4 },
  headerSpacer: { flex: 1 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '400', letterSpacing: -0.4 },
  periodRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  periodChip: { flex: 1, minHeight: 38, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  periodText: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1 },
  myCard: { marginHorizontal: 16, marginBottom: 6, padding: 13, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  microLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 1.3 },
  myRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 5 },
  myRank: { fontSize: 26, fontWeight: '300', letterSpacing: -1 },
  myMeta: { fontSize: 11 },
  myHustle: { fontSize: 15, fontWeight: '500' },
  listContent: { paddingHorizontal: 16, paddingBottom: 36 },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, borderRadius: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rank: { fontSize: 11.5, fontWeight: '600', minWidth: 22 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 13, fontWeight: '500' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: '400', letterSpacing: -0.2 },
  rowMeta: { fontSize: 10.5, marginTop: 2 },
  hustle: { fontSize: 13.5, fontWeight: '500' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '400' },
  emptyBody: { fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 280 },
});

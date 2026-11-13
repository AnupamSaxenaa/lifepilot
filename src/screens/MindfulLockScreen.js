import { useFocusEffect } from '@react-navigation/native';
import {
    AlertTriangle,
    Angry,
    BrainCircuit,
    CheckCircle2,
    ChevronRight,
    Clock3,
    Flame,
    Frown,
    Laugh,
    LockKeyhole,
    LockOpen,
    Meh,
    Menu,
    Plus,
    Settings,
    ShieldCheck,
    Smartphone,
    Smile,
    Trash2,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    AppState,
    Image,
    NativeModules,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DistractionScoreRing } from '../components/DistractionScoreRing';
import { GlassSidebar } from '../components/GlassSidebar';
import { MindfulInterventionOverlay } from '../components/MindfulInterventionOverlay';
import { MindfulReflectionModal } from '../components/MindfulReflectionModal';
import { ScheduleModal } from '../components/ScheduleModal';
import { usePro } from '../context/ProContext';
import { getCurrentUserId, loadProfile } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import {
    canUseSchedules,
    checkMindfulStreak,
    getApps,
    getDistractionScore,
    getEffectiveBlockingMode,
    getProfile,
    getTimeEquivalent,
    getTimeSavedToday,
    getTodaysBudget,
    getTodayStats,
    getUsageSnapshot,
    hasOverlayPermission,
    lockedAppQuota,
    removeApp,
    requestOverlayPermission,
    saveProfile,
    syncAppBlocker,
    withLiveUsage
} from '../utils/mindfulLock';
import { Storage } from '../utils/storage';

const MoodIcon = ({ mood, size = 20, color = '#a1a1aa' }) => {
  const Icon = mood === 0 ? Angry : mood === 1 ? Frown : mood === 2 ? Meh : mood === 3 ? Smile : Laugh;
  return <Icon color={color} size={size} strokeWidth={1.8} />;
};

const Metric = ({ icon: Icon, label, value, color = '#A1A1AA' }) => (
  <View style={styles.metricItem}>
    <Icon color={color} size={17} strokeWidth={1.8} />
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel} numberOfLines={1}>{label}</Text>
  </View>
);

export const MindfulLockScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isNarrow = width < 360;
  const contentWidth = Math.min(width, 720);
  const scoreSize = isNarrow ? 128 : 148;
  const [userId, setUserId] = useState(route?.params?.userId);

  useEffect(() => {
    if (!userId) {
      getCurrentUserId().then((resolvedUserId) => {
        if (resolvedUserId) setUserId(resolvedUserId);
      });
    }
  }, [userId]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [effectiveMode, setEffectiveMode] = useState('cbt');
  const [userProfile, setUserProfile] = useState(null);
  const [apps, setApps] = useState([]);
  const [score, setScore] = useState(50);
  const [todayStats, setTodayStats] = useState({ resisted: 0, used: 0, timeSaved: 0 });
  const [, setTimeSavedEquiv] = useState('');
  const [pastReflections, setPastReflections] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(true);
  const { isPro } = usePro();
  const [overlayGranted, setOverlayGranted] = useState(true);
  // Guards the 1s usage poll so a slow bridge call can't pile up round-trips.
  const usagePollBusy = useRef(false);
  // Lets the poll read the current app list without re-creating the interval
  // (and without the stale-closure/no-op-setState dance it used to do).
  const appsRef = useRef([]);
  const [showIntervention, setShowIntervention] = useState(false);
  const [interventionApp, setInterventionApp] = useState(null);
  const [showReflection, setShowReflection] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    const trigger = route?.params?.triggerInterventionForApp;
    if (!trigger || apps.length === 0) return undefined;

    const timeout = setTimeout(() => {
      const matchedApp = apps.find((app) => (
        String(app.id) === String(trigger)
        || app.packageName === trigger
        || app.name?.toLowerCase() === String(trigger).toLowerCase()
      ));
      const appName = matchedApp?.name || route.params.appName || trigger;
      setInterventionApp(matchedApp || { name: appName, id: trigger });
      setShowIntervention(true);
      navigation.setParams({ triggerInterventionForApp: undefined, appName: undefined });
    }, 0);

    return () => clearTimeout(timeout);
  }, [apps, navigation, route?.params?.appName, route?.params?.triggerInterventionForApp]);

  const loadData = useCallback(async () => {
    if (!userId) return;

    if (Platform.OS === 'android' && NativeModules.AppBlocker?.isAccessibilityServiceEnabled) {
      try {
        const enabled = await NativeModules.AppBlocker.isAccessibilityServiceEnabled();
        setAccessibilityEnabled(!!enabled);
      } catch {
        setAccessibilityEnabled(true);
      }
      // Without "Display over other apps" the service can't foreground the
      // block screen on Android 10+, so the block silently never appears.
      setOverlayGranted(await hasOverlayPermission());
    }

    const [appListRaw, prof, scoreVal, stats, saved, up, reflectionsRaw] = await Promise.all([
      getApps(userId),
      getProfile(userId),
      getDistractionScore(userId),
      getTodayStats(userId),
      getTimeSavedToday(userId),
      loadProfile(userId),
      Storage.get(`mindful_reflections_${userId}`),
    ]);

    const appList = withLiveUsage(appListRaw, await getUsageSnapshot(appListRaw));

    setApps(appList);
    setProfile(prof);
    setEffectiveMode(getEffectiveBlockingMode(prof));
    setScore(scoreVal);
    setTodayStats(stats);
    setTimeSavedEquiv(getTimeEquivalent(saved));
    setUserProfile(up);
    setPastReflections(reflectionsRaw || []);

    const streakProfile = await checkMindfulStreak(userId);
    if (streakProfile) {
      setProfile(streakProfile);
      setEffectiveMode(getEffectiveBlockingMode(streakProfile));
    }
    await syncAppBlocker(userId);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadData();

      let cancelled = false;

      // One 1s loop drives everything on this screen: the allowance countdown,
      // the effective-mode pill, and the per-app usage bars. Usage comes from
      // the native side as a LIVE value (banked + in-flight), so the bars move
      // second-by-second instead of only after a 30s poll landed on a minute
      // boundary.
      const refreshUsage = async () => {
        if (usagePollBusy.current || cancelled) return;
        usagePollBusy.current = true;
        try {
          const current = appsRef.current;
          if (!current.length) return;
          const snapshot = await getUsageSnapshot(current);
          if (cancelled || Object.keys(snapshot).length === 0) return;
          setApps((prev) => withLiveUsage(prev, snapshot));
        } finally {
          usagePollBusy.current = false;
        }
      };

      const tick = setInterval(() => {
        setNow(Date.now());
        setProfile((current) => {
          if (current) setEffectiveMode(getEffectiveBlockingMode(current));
          return current;
        });
        refreshUsage();
      }, 1000);

      return () => {
        cancelled = true;
        clearInterval(tick);
      };
    }, [loadData]),
  );

  useEffect(() => {
    appsRef.current = apps;
  }, [apps]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') loadData();
    });
    return () => subscription.remove();
  }, [loadData]);

  useEffect(() => {
    if (route?.params?.blocked_app) {
      const pkg = route.params.blocked_app;
      const app = apps.find((item) => item.packageName === pkg || item.name.toLowerCase() === pkg);
      const appName = app ? app.name : pkg;
      Alert.alert(
        t('mindfulLock.allowanceExceededTitle'),
        t('mindfulLock.allowanceExceededMessage', { appName }),
        [{ text: t('mindfulLock.gotIt') }],
      );
      navigation.setParams({ blocked_app: undefined });
    }
  }, [apps, navigation, route?.params?.blocked_app, t]);

  const handleRemoveApp = (app) => {
    Alert.alert(t('mindfulLock.removeAppTitle'), t('mindfulLock.removeAppMessage', { appName: app.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('mindfulLock.removeButton'),
        style: 'destructive',
        onPress: async () => {
          await removeApp(userId, app.id);
          loadData();
        },
      },
    ]);
  };

  const handleToggleStrictMode = async (value) => {
    if (value) {
      if (NativeModules.AppBlocker) {
        const isEnabled = await NativeModules.AppBlocker.isAccessibilityServiceEnabled();
        if (!isEnabled) {
          Alert.alert(
            t('mindfulLock.permissionRequiredTitle'),
            t('mindfulLock.permissionRequiredMessage'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('mindfulLock.openSettings'), onPress: () => NativeModules.AppBlocker.openAccessibilitySettings() },
            ],
          );
          return;
        }
      }
      await saveProfile(userId, { blockingMode: 'strict' });
    } else {
      await saveProfile(userId, { blockingMode: 'cbt' });
    }
    loadData();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  };

  // Schedules auto-switch strict mode by time of day — a Pro feature. Existing
  // schedules stay VISIBLE and keep working if a subscription lapses; only
  // opening the editor is gated, so a lapse never silently unblocks apps the
  // user asked to be blocked.
  const handleOpenSchedule = () => {
    if (schedulesUnlocked) {
      setShowSchedule(true);
      return;
    }
    Alert.alert(
      t('mindfulLock.schedulesProTitle'),
      t('mindfulLock.schedulesProMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('mindfulLock.seePlansButton'), onPress: () => navigation.navigate('Paywall') },
      ],
    );
  };

  const openAppPicker = () => navigation.navigate('MindfulLockSetup', {
    userId,
    initialStep: Platform.OS === 'android' ? 3 : 2,
    isAddingMore: true,
  });

  const openIntervention = () => {
    if (apps.length === 0) {
      Alert.alert(t('mindfulLock.noAppsTitle'), t('mindfulLock.noAppsMessage'));
      return;
    }
    setShowIntervention(true);
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const hasReflectedToday = pastReflections.some((reflection) => reflection.createdAt?.startsWith(todayStr));
  const showReflectionBtn = new Date().getHours() >= 20 && !hasReflectedToday;
  const activeScheduleCount = profile?.schedules?.filter((schedule) => schedule.enabled !== false).length || 0;
  const strictActive = effectiveMode === 'strict';
  // Grandfathered: a user who already built schedules keeps editing them even if
  // their subscription lapsed. Taking away access to rules that are actively
  // blocking their apps would be worse than leaving the editor open.
  const schedulesUnlocked = canUseSchedules(isPro) || activeScheduleCount > 0;
  const quota = lockedAppQuota({ isPro, currentCount: apps.length });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, { width: contentWidth }]}>
        <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconButton} accessibilityRole="button">
          <Menu color="#E4E4E7" size={22} strokeWidth={1.8} />
        </TouchableOpacity>
        <View style={styles.headerIdentity}>
          <Text style={styles.headerTitle}>{t('mindfulLock.headerTitle')}</Text>
          <View style={[styles.modePill, strictActive && styles.modePillStrict]}>
            <View style={[styles.modeDot, strictActive && styles.modeDotStrict]} />
            <Text style={[styles.modePillText, strictActive && styles.modePillTextStrict]}>
              {strictActive ? t('mindfulLockSetup.modeStrictName') : t('mindfulLockSetup.modeCbtName')}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('MindfulLockSetup', { userId })}
          style={styles.iconButton}
          accessibilityRole="button"
        >
          <Settings color="#A1A1AA" size={21} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { width: contentWidth, paddingHorizontal: isNarrow ? 14 : 20 },
        ]}
      >
        {Platform.OS === 'android' && !accessibilityEnabled && (
          <TouchableOpacity
            style={styles.accessibilityWarning}
            onPress={() => NativeModules.AppBlocker?.openAccessibilitySettings?.()}
            activeOpacity={0.75}
          >
            <AlertTriangle color="#D6A647" size={20} strokeWidth={1.9} />
            <View style={styles.warningCopy}>
              <Text style={styles.warningTitle}>{t('mindfulLock.accessibilityWarningTitle')}</Text>
              <Text style={styles.warningDescription}>{t('mindfulLock.accessibilityWarningDesc')}</Text>
            </View>
            <ChevronRight color="#8A6A2F" size={18} />
          </TouchableOpacity>
        )}

        {Platform.OS === 'android' && !overlayGranted && (
          <TouchableOpacity
            style={styles.accessibilityWarning}
            onPress={() => requestOverlayPermission()}
            activeOpacity={0.75}
          >
            <AlertTriangle color="#D6A647" size={20} strokeWidth={1.9} />
            <View style={styles.warningCopy}>
              <Text style={styles.warningTitle}>{t('mindfulLock.overlayWarningTitle')}</Text>
              <Text style={styles.warningDescription}>{t('mindfulLock.overlayWarningDesc')}</Text>
            </View>
            <ChevronRight color="#8A6A2F" size={18} />
          </TouchableOpacity>
        )}

        <Animated.View entering={FadeIn.duration(350)} style={styles.overviewCard}>
          <View style={styles.scoreWrap}>
            <DistractionScoreRing score={score} size={scoreSize} strokeWidth={7} />
          </View>
          <View style={styles.overviewCopy}>
            <Text style={styles.eyebrow}>{t('mindfulLock.scoreSubtitle')}</Text>
            <Text style={styles.overviewTitle}>
              {strictActive ? t('mindfulLock.strictBlockActive') : t('mindfulLock.temptedButtonSub')}
            </Text>
            <Text style={styles.overviewDescription}>
              {strictActive
                ? (profile?.blockingMode !== 'strict'
                  ? t('mindfulLock.strictBlockScheduleSub')
                  : t('mindfulLock.strictBlockManualSub'))
                : t('mindfulLockSetup.modeCbtDesc')}
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(70).duration(350)} style={styles.metricsCard}>
          <Metric icon={Clock3} label={t('mindfulLock.statSaved')} value={`${todayStats.timeSaved}m`} />
          <View style={styles.metricDivider} />
          <Metric icon={ShieldCheck} label={t('mindfulLock.statResisted')} value={todayStats.resisted} color="#6FAD8E" />
          <View style={styles.metricDivider} />
          <Metric icon={Flame} label={t('mindfulLock.statStreak')} value={profile?.streak || 0} />
        </Animated.View>

        {strictActive ? (
          <Animated.View entering={FadeInDown.delay(120).duration(350)} style={styles.strictStateCard}>
            <View style={styles.actionIconWrapDark}>
              <LockKeyhole color="#8EB7D9" size={21} strokeWidth={1.8} />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.strictStateTitle}>{t('mindfulLock.strictBlockActive')}</Text>
              <Text style={styles.strictStateDescription}>
                {profile?.blockingMode !== 'strict'
                  ? t('mindfulLock.strictBlockScheduleSub')
                  : t('mindfulLock.strictBlockManualSub')}
              </Text>
            </View>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.delay(120).duration(350)}>
            <TouchableOpacity style={styles.primaryAction} onPress={openIntervention} activeOpacity={0.86}>
              <View style={styles.actionIconWrapLight}>
                <BrainCircuit color="#09090B" size={21} strokeWidth={1.8} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.primaryActionTitle}>{t('mindfulLock.temptedButton')}</Text>
                <Text style={styles.primaryActionDescription}>{t('mindfulLock.temptedButtonSub')}</Text>
              </View>
              <ChevronRight color="#52525B" size={20} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {Platform.OS === 'android' && (
          <Animated.View entering={FadeInDown.delay(170).duration(350)} style={styles.section}>
            <Text style={styles.sectionLabel}>{t('mindfulLock.quickActionsTitle')}</Text>
            <View style={styles.controlCard}>
              <View style={styles.controlRow}>
                <View style={styles.controlIcon}>
                  <LockKeyhole color="#C4C4C8" size={18} strokeWidth={1.7} />
                </View>
                <View style={styles.controlCopy}>
                  <Text style={styles.controlTitle}>{t('mindfulLock.strictBlockerLabel')}</Text>
                  <Text style={styles.controlDescription}>
                    {profile?.blockingMode === 'strict'
                      ? t('mindfulLock.strictBlockerDescActive')
                      : t('mindfulLock.strictBlockerDescInactive')}
                  </Text>
                </View>
                <Switch
                  value={profile?.blockingMode === 'strict'}
                  onValueChange={handleToggleStrictMode}
                  trackColor={{ false: '#2A2A2E', true: '#45657E' }}
                  thumbColor={profile?.blockingMode === 'strict' ? '#E8F1F7' : '#A1A1AA'}
                />
              </View>
              <View style={styles.controlDivider} />
              <TouchableOpacity
                style={styles.controlRow}
                onPress={handleOpenSchedule}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <View style={styles.controlIcon}>
                  <Clock3 color="#C4C4C8" size={18} strokeWidth={1.7} />
                </View>
                <View style={styles.controlCopy}>
                  <View style={styles.controlTitleRow}>
                    <Text style={styles.controlTitle}>{t('mindfulLock.autoScheduleLabel')}</Text>
                    {!schedulesUnlocked && (
                      <View style={styles.proTag}>
                        <Text style={styles.proTagText}>{t('mindfulLock.proTag')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.controlDescription}>
                    {profile?.schedules?.length > 0
                      ? t('mindfulLock.activeRules', { count: activeScheduleCount })
                      : t('mindfulLock.autoScheduleDesc')}
                  </Text>
                </View>
                <ChevronRight color="#71717A" size={19} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.delay(220).duration(350)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>{t('mindfulLock.lockedDistractionsTitle')}</Text>
            <TouchableOpacity style={styles.addButton} onPress={openAppPicker} activeOpacity={0.7}>
              <Plus color="#E4E4E7" size={16} />
              <Text style={styles.addButtonText}>{t('mindfulLock.addButton')}</Text>
              {/* Surface the free-plan quota BEFORE the user hits it, so the
                  limit is discoverable rather than a surprise mid-flow. */}
              {!quota.unlimited && (
                <Text style={styles.addButtonQuota}>
                  {t('mindfulLock.appQuota', { used: quota.used, limit: quota.limit })}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {apps.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <LockOpen color="#A1A1AA" size={24} strokeWidth={1.6} />
              </View>
              <Text style={styles.emptyTitle}>{t('mindfulLock.emptyTitle')}</Text>
              <Text style={styles.emptyDescription}>{t('mindfulLock.emptySubtitle')}</Text>
              <TouchableOpacity style={styles.emptyAction} onPress={openAppPicker} activeOpacity={0.8}>
                <Plus color="#09090B" size={17} strokeWidth={2} />
                <Text style={styles.emptyActionText}>{t('mindfulLock.addButton')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.appList}>
              {apps.map((app, index) => {
                const budget = getTodaysBudget(app);
                // Prefer the precise ms figure so the bar creeps every second;
                // `usageToday` (whole minutes) is only a fallback for iOS /
                // pre-bridge data.
                const usageMs = typeof app.usageMs === 'number'
                  ? app.usageMs
                  : (app.usageToday || 0) * 60000;
                const budgetMs = budget * 60000;
                const usage = Math.floor(usageMs / 60000);
                const progress = budgetMs > 0 ? Math.min(usageMs / budgetMs, 1) : 0;
                const isOverBudget = budgetMs <= 0 ? usageMs > 0 : usageMs >= budgetMs;
                const activeAllowance = app.unblockUntil && app.unblockUntil > now;
                const remainingSec = activeAllowance ? Math.ceil((app.unblockUntil - now) / 1000) : 0;
                const remMM = Math.floor(remainingSec / 60);
                const remSS = String(remainingSec % 60).padStart(2, '0');
                const modeLabel = app.lockMode === 'hard'
                  ? t('mindfulLock.modeHard')
                  : app.lockMode === 'scheduled'
                    ? t('mindfulLock.modeScheduled')
                    : t('mindfulLock.modeAllowance');

                return (
                  <Animated.View
                    key={app.id}
                    entering={FadeInDown.delay(Math.min(index * 40, 240)).duration(280)}
                    style={styles.appCard}
                  >
                    <View style={styles.appCardTop}>
                      {app.icon && app.icon.length > 10 ? (
                        <Image source={{ uri: `data:image/png;base64,${app.icon}` }} style={styles.appIconImage} />
                      ) : (
                        <View style={styles.appIconFallback}>
                          <Text style={styles.appIconEmoji}>{app.icon || '•'}</Text>
                        </View>
                      )}
                      <View style={styles.appIdentity}>
                        <Text style={styles.appName} numberOfLines={1}>{app.name}</Text>
                        <Text style={styles.appMode} numberOfLines={1}>{modeLabel}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => handleRemoveApp(app)}
                        accessibilityRole="button"
                      >
                        <Trash2 color="#71717A" size={17} strokeWidth={1.8} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.usageRow}>
                      <Text style={[styles.usageText, activeAllowance && styles.allowanceText, isOverBudget && styles.overBudgetText]}>
                        {activeAllowance
                          ? t('mindfulLock.timeLeft', { time: `${remMM}:${remSS}` })
                          : t('mindfulLock.usedMinutes', { usage, budget })}
                      </Text>
                      <Text style={styles.usagePercent}>{Math.round(progress * 100)}%</Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${progress * 100}%` },
                          activeAllowance && styles.progressFillAllowance,
                          isOverBudget && styles.progressFillOver,
                        ]}
                      />
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          )}
        </Animated.View>

        {todayStats.todayLog?.length > 0 && (
          <Animated.View entering={FadeInDown.delay(270).duration(350)} style={styles.section}>
            <Text style={styles.sectionLabel}>{t('mindfulLock.todayActivityTitle')}</Text>
            <View style={styles.activityCard}>
              {todayStats.todayLog.slice(0, 5).map((entry, index) => {
                const positive = entry.action === 'resisted' || entry.action === 'closed';
                const actionText = entry.action === 'resisted'
                  ? t('mindfulLock.logResisted')
                  : entry.action === 'closed'
                    ? t('mindfulLock.logClosed')
                    : entry.action === 'granted'
                      ? t('mindfulLock.logGranted')
                      : t('mindfulLock.logUsed');
                const xpText = entry.action === 'resisted'
                  ? t('mindfulLock.xpResisted')
                  : entry.action === 'closed'
                    ? t('mindfulLock.xpClosed')
                    : entry.action === 'granted'
                      ? t('mindfulLock.xpGranted')
                      : entry.action === 'used'
                        ? t('mindfulLock.xpUsed')
                        : '';
                return (
                  <View key={entry.id} style={[styles.activityRow, index > 0 && styles.activityRowBorder]}>
                    <View style={styles.activityIcon}>
                      {positive
                        ? <CheckCircle2 color="#6FAD8E" size={17} strokeWidth={1.9} />
                        : <Smartphone color="#8C8C92" size={16} strokeWidth={1.8} />}
                    </View>
                    <View style={styles.activityCopy}>
                      <Text style={styles.activityText} numberOfLines={2}>
                        {actionText} {entry.appName}{entry.duration ? ` (${entry.duration}m)` : ''}
                      </Text>
                      <Text style={styles.activityTime}>
                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <Text style={[styles.activityXp, !positive && styles.activityXpNegative]}>{xpText}</Text>
                  </View>
                );
              })}
            </View>
          </Animated.View>
        )}

        {showReflectionBtn && (
          <TouchableOpacity style={styles.reflectionAction} onPress={() => setShowReflection(true)} activeOpacity={0.75}>
            <Text style={styles.reflectionActionText}>{t('mindfulLock.reflectionButton')}</Text>
            <ChevronRight color="#71717A" size={19} />
          </TouchableOpacity>
        )}

        {pastReflections.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('mindfulLock.pastReflectionsTitle')}</Text>
            <View style={styles.reflectionList}>
              {pastReflections.map((reflection) => (
                <View key={reflection.id} style={styles.reflectionCard}>
                  <View style={styles.reflectionHeader}>
                    <Text style={styles.reflectionDate}>
                      {new Date(reflection.createdAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </Text>
                    <MoodIcon mood={reflection.mood} color="#A1A1AA" />
                  </View>
                  <Text style={reflection.note ? styles.reflectionNote : styles.reflectionNoteEmpty}>
                    {reflection.note || t('mindfulLock.noNoteAdded')}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
        <View style={styles.scrollEnd} />
      </ScrollView>

      <MindfulInterventionOverlay
        isVisible={showIntervention}
        onClose={() => {
          setShowIntervention(false);
          setInterventionApp(null);
          loadData();
        }}
        userId={userId}
        initialApp={interventionApp}
      />
      <MindfulReflectionModal
        isVisible={showReflection}
        onClose={() => {
          setShowReflection(false);
          loadData();
        }}
        userId={userId}
        todayStats={todayStats}
        onSuccess={loadData}
      />
      <ScheduleModal
        isVisible={showSchedule}
        onClose={() => setShowSchedule(false)}
        userId={userId}
        onChange={loadData}
      />
      <GlassSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        navigation={navigation}
        currentRoute="MindfulLock"
        profile={userProfile}
        handleLogout={handleLogout}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070708' },
  header: {
    minHeight: 58,
    paddingHorizontal: 12,
    paddingBottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIdentity: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerTitle: { color: '#FAFAFA', fontSize: 17, fontWeight: '500', letterSpacing: -0.25 },
  modePill: {
    marginTop: 4,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#18181B',
  },
  modePillStrict: { backgroundColor: '#15202A' },
  modeDot: { width: 5, height: 5, borderRadius: 3, marginRight: 6, backgroundColor: '#6FAD8E' },
  modeDotStrict: { backgroundColor: '#8EB7D9' },
  modePillText: { color: '#A1A1AA', fontSize: 10, fontWeight: '500' },
  modePillTextStrict: { color: '#AFC9DD' },
  scrollContent: { alignSelf: 'center', paddingTop: 6 },
  accessibilityWarning: {
    minHeight: 68,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#4A3B20',
    backgroundColor: '#15130E',
  },
  warningCopy: { flex: 1, marginHorizontal: 11 },
  warningTitle: { color: '#E2C27E', fontSize: 13, fontWeight: '600' },
  warningDescription: { color: '#9B8B68', fontSize: 11, lineHeight: 16, marginTop: 2 },
  overviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 176,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#202024',
    backgroundColor: '#101012',
    padding: 14,
  },
  scoreWrap: { marginRight: 15 },
  overviewCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  overviewTitle: { color: '#F4F4F5', fontSize: 18, fontWeight: '500', lineHeight: 23, letterSpacing: -0.25 },
  overviewDescription: { color: '#85858B', fontSize: 12, lineHeight: 17, marginTop: 7 },
  metricsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 78,
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1D1D20',
    backgroundColor: '#0D0D0F',
  },
  metricItem: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  metricValue: { color: '#F4F4F5', fontSize: 16, fontWeight: '500', marginTop: 4, lineHeight: 18 },
  metricLabel: { color: '#68686E', fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.55, marginTop: 2 },
  metricDivider: { width: StyleSheet.hairlineWidth, height: 38, backgroundColor: '#29292D' },
  primaryAction: {
    minHeight: 72,
    marginTop: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#F4F4F5',
  },
  actionIconWrapLight: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDDDDF' },
  actionIconWrapDark: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A2A36' },
  actionCopy: { flex: 1, minWidth: 0, marginHorizontal: 12 },
  primaryActionTitle: { color: '#09090B', fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  primaryActionDescription: { color: '#626268', fontSize: 12, marginTop: 2 },
  strictStateCard: {
    minHeight: 72,
    marginTop: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#294256',
    backgroundColor: '#101922',
  },
  strictStateTitle: { color: '#D6E5F0', fontSize: 15, fontWeight: '600' },
  strictStateDescription: { color: '#8197A8', fontSize: 11, lineHeight: 16, marginTop: 2 },
  section: { marginTop: 26 },
  sectionHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { color: '#8B8B91', fontSize: 11, fontWeight: '600', letterSpacing: 1.05, textTransform: 'uppercase', marginBottom: 10 },
  addButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 5 },
  addButtonText: { color: '#D4D4D8', fontSize: 13, fontWeight: '600' },
  controlCard: { borderRadius: 16, borderWidth: 1, borderColor: '#202024', backgroundColor: '#101012', overflow: 'hidden' },
  controlRow: { minHeight: 72, paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center' },
  controlIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#1B1B1E', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  controlCopy: { flex: 1, minWidth: 0, paddingRight: 8 },
  addButtonQuota: { color: '#8C8C92', fontSize: 11, fontWeight: '600', marginLeft: 'auto' },
  controlTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  // This screen uses a module-level StyleSheet with no theme accent, so the tag
  // is a fixed neutral rather than the equipped accent.
  proTag: {
    borderWidth: 1,
    borderColor: 'rgba(228,228,231,0.4)',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  proTagText: { color: '#E4E4E7', fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  controlTitle: { color: '#E4E4E7', fontSize: 14, fontWeight: '500' },
  controlDescription: { color: '#71717A', fontSize: 11, lineHeight: 15, marginTop: 3 },
  controlDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#29292D', marginLeft: 58 },
  emptyState: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 30, borderRadius: 18, borderWidth: 1, borderColor: '#28282C', borderStyle: 'dashed', backgroundColor: '#0C0C0E' },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18181B', marginBottom: 13 },
  emptyTitle: { color: '#E4E4E7', fontSize: 16, fontWeight: '500' },
  emptyDescription: { color: '#71717A', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 5 },
  emptyAction: { minHeight: 44, marginTop: 17, paddingHorizontal: 18, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F4F4F5' },
  emptyActionText: { color: '#09090B', fontSize: 13, fontWeight: '600' },
  appList: { gap: 9 },
  appCard: { borderRadius: 16, borderWidth: 1, borderColor: '#202024', backgroundColor: '#101012', padding: 13 },
  appCardTop: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  appIconImage: { width: 36, height: 36, borderRadius: 9, marginRight: 11 },
  appIconFallback: { width: 36, height: 36, borderRadius: 9, marginRight: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1B1B1E' },
  appIconEmoji: { fontSize: 20 },
  appIdentity: { flex: 1, minWidth: 0 },
  appName: { color: '#F4F4F5', fontSize: 15, fontWeight: '500' },
  appMode: { color: '#707076', fontSize: 10, marginTop: 3 },
  deleteButton: { width: 44, height: 44, marginRight: -8, alignItems: 'center', justifyContent: 'center' },
  usageRow: { marginTop: 12, marginBottom: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  usageText: { color: '#A1A1AA', fontSize: 11, fontWeight: '500' },
  allowanceText: { color: '#76AD91' },
  overBudgetText: { color: '#C88686' },
  usagePercent: { color: '#5F5F65', fontSize: 10 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: '#28282D', overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: '#B6B6BB' },
  progressFillAllowance: { backgroundColor: '#6FAD8E' },
  progressFillOver: { backgroundColor: '#B96F6F' },
  activityCard: { borderRadius: 16, borderWidth: 1, borderColor: '#202024', backgroundColor: '#101012', paddingHorizontal: 13 },
  activityRow: { minHeight: 64, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  activityRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#29292D' },
  activityIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#1A1A1D', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  activityCopy: { flex: 1, minWidth: 0 },
  activityText: { color: '#D4D4D8', fontSize: 12, lineHeight: 16, fontWeight: '500' },
  activityTime: { color: '#626268', fontSize: 10, marginTop: 3 },
  activityXp: { color: '#76AD91', fontSize: 11, fontWeight: '600', marginLeft: 8 },
  activityXpNegative: { color: '#A27A7A' },
  reflectionAction: { minHeight: 56, marginTop: 24, paddingHorizontal: 15, borderRadius: 14, borderWidth: 1, borderColor: '#29292D', backgroundColor: '#101012', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reflectionActionText: { flex: 1, color: '#D4D4D8', fontSize: 13, fontWeight: '500' },
  reflectionList: { gap: 9 },
  reflectionCard: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#202024', backgroundColor: '#101012' },
  reflectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  reflectionDate: { color: '#8B8B91', fontSize: 11, fontWeight: '600' },
  reflectionNote: { color: '#D4D4D8', fontSize: 13, lineHeight: 19 },
  reflectionNoteEmpty: { color: '#626268', fontSize: 12, fontStyle: 'italic' },
  scrollEnd: { height: 40 },
});
// ─── Mindful Lock Dashboard ──────────────────────────────
// Main screen for the Mindful Lock distraction control
// feature. Shows score ring, stats, locked apps, and
// the "I'm Tempted" intervention trigger.
// ─────────────────────────────────────────────────────────

import { useFocusEffect } from '@react-navigation/native';
import {
    AlertTriangle,
    Angry,
    BrainCircuit,
    CheckCircle2,
    ChevronRight,
    Frown,
    Laugh,
    LockOpen,
    Meh,
    Menu,
    Plus,
    Settings,
    Smartphone,
    Smile,
    Trash2
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    AppState,
    Dimensions,
    Image,
    NativeModules, Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text, TouchableOpacity,
    View
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { DistractionScoreRing } from '../components/DistractionScoreRing';
import { GlassSidebar } from '../components/GlassSidebar';
import { MindfulInterventionOverlay } from '../components/MindfulInterventionOverlay';
import { MindfulReflectionModal } from '../components/MindfulReflectionModal';
import { ScheduleModal } from '../components/ScheduleModal';
import { useTheme } from '../context/ThemeContext';
import { loadProfile } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import {
    addApp,
    checkMindfulStreak,
    getApps,
    getDistractionScore,
    getEffectiveBlockingMode,
    getProfile,
    getTimeEquivalent,
    getTimeSavedToday,
    getTodaysBudget,
    getTodayStats,
    removeApp,
    saveProfile,
    syncAppBlocker
} from '../utils/mindfulLock';
import { Storage } from '../utils/storage';

const CustomClockIcon = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 11.6V7h2v3.8l4.6 3.9-.9 1.5z" />
  </Svg>
);

const CustomShieldIcon = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
  </Svg>
);

const CustomFlameIcon = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M13.5 0.67s0.74 2.65 0.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l0.03-0.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5 0.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-0.36 3.6-1.21 4.62-2.58 0.39 1.29 0.59 2.65 0.59 4.04 0 2.65-2.15 4.8-4.8 4.8z" />
  </Svg>
);

// Maps a reflection mood score (0–4) to a vector face icon instead of an emoji.
const MoodIcon = ({ mood, size = 20, color = '#a1a1aa' }) => {
  const Icon = mood === 0 ? Angry : mood === 1 ? Frown : mood === 2 ? Meh : mood === 3 ? Smile : Laugh;
  return <Icon color={color} size={size} strokeWidth={2} />;
};

const { width } = Dimensions.get('window');
export const MindfulLockScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const ACCENT = useTheme().theme.accent;
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);
  const [userId, setUserId] = useState(route?.params?.userId);

  useEffect(() => {
    if (!userId) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id) {
          setUserId(session.user.id);
        }
      });
    }
  }, [userId]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  // The mode actually in effect right now = base mode unless a schedule
  // window is currently active (schedules override; strict wins).
  const [effectiveMode, setEffectiveMode] = useState('cbt');
  const [userProfile, setUserProfile] = useState(null);
  const [apps, setApps] = useState([]);
  const [score, setScore] = useState(50);
  const [todayStats, setTodayStats] = useState({ resisted: 0, used: 0, timeSaved: 0 });
  const [timeSavedEquiv, setTimeSavedEquiv] = useState('');
  const [pastReflections, setPastReflections] = useState([]);

  // Live clock tick (drives allowance countdowns without needing a manual refresh)
  const [now, setNow] = useState(Date.now());
  // Whether the Android accessibility service is currently enabled
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(true);

  // Modals
  const [showIntervention, setShowIntervention] = useState(false);
  const [interventionApp, setInterventionApp] = useState(null);

  useEffect(() => {
    if (route?.params?.triggerInterventionForApp) {
      const appName = route.params.appName || route.params.triggerInterventionForApp;
      setInterventionApp({ name: appName, id: route.params.triggerInterventionForApp });
      setShowIntervention(true);
      navigation.setParams({ triggerInterventionForApp: undefined, appName: undefined });
    }
  }, [route?.params?.triggerInterventionForApp]);
  const [showReflection, setShowReflection] = useState(false);
  const [showAddApp, setShowAddApp] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showEditApp, setShowEditApp] = useState(null);

  // Add app form
  const [newAppName, setNewAppName] = useState('');
  const [newAppIcon, setNewAppIcon] = useState('📱');
  const [newAppBudget, setNewAppBudget] = useState('60');

  const QUICK_ICONS = ['📱', '📸', '🎵', '▶️', '🐦', '🔴', '👻', '📘', '🎮', '💬', '📧', '🛒'];

  const loadData = useCallback(async () => {
    if (!userId) return;

    // Check accessibility FIRST (Android) — independent of everything else so an
    // error below can never suppress the "service is off" warning banner.
    if (Platform.OS === 'android' && NativeModules.AppBlocker?.isAccessibilityServiceEnabled) {
      try {
        const enabled = await NativeModules.AppBlocker.isAccessibilityServiceEnabled();
        setAccessibilityEnabled(!!enabled);
      } catch (e) {
        setAccessibilityEnabled(true); // Don't nag the user on a check error
      }
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

    let appList = appListRaw;
    const AppBlocker = NativeModules.AppBlocker;
    if (Platform.OS === 'android' && AppBlocker && AppBlocker.getUsageToday) {
      appList = await Promise.all(appListRaw.map(async app => {
        try {
          const ms = await AppBlocker.getUsageToday(app.packageName || app.name.toLowerCase());
          return { ...app, usageToday: Math.floor(ms / 60000) };
        } catch (e) {
          return app;
        }
      }));
    }

    setApps(appList);
    setProfile(prof);
    setEffectiveMode(getEffectiveBlockingMode(prof));
    setScore(scoreVal);
    setTodayStats(stats);
    setTimeSavedEquiv(getTimeEquivalent(saved));
    setUserProfile(up);
    setPastReflections(reflectionsRaw || []);

    // Check streak
    await checkMindfulStreak(userId);

    // Force sync the latest rules to native blocker
    await syncAppBlocker(userId);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadData();

      // Live 1-second tick so allowance countdowns update in real time.
      // Also recompute the effective blocking mode so the UI flips the moment
      // a schedule window starts or ends, with no manual reload needed.
      const tick = setInterval(() => {
        setNow(Date.now());
        setProfile(cur => {
          if (cur) setEffectiveMode(getEffectiveBlockingMode(cur));
          return cur;
        });
      }, 1000);

      // Live dynamic update for progress bars
      const interval = setInterval(() => {
        if (Platform.OS === 'android' && NativeModules.AppBlocker?.getUsageToday) {
          setApps(currentApps => {
            if (!currentApps.length) return currentApps;
            
            // Promise.all inside set state isn't great, but we can fire an async function
            const updateLiveUsage = async () => {
              try {
                const updated = await Promise.all(currentApps.map(async app => {
                  try {
                    const ms = await NativeModules.AppBlocker.getUsageToday(app.packageName || app.name.toLowerCase());
                    return { ...app, usageToday: Math.floor(ms / 60000) };
                  } catch (e) { return app; }
                }));
                setApps(updated);
              } catch (e) {}
            };
            updateLiveUsage();
            return currentApps;
          });
        }
      }, 30000); // Check every 30s
      
      return () => {
        clearInterval(tick);
        clearInterval(interval);
      };
    }, [loadData])
  );

  // Instantly refresh usage bars when app comes back to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        loadData();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadData]);

  // Handle deep link from Accessibility Service block
  useEffect(() => {
    if (route?.params?.blocked_app) {
      const pkg = route.params.blocked_app;
      const app = apps.find(a => a.packageName === pkg || a.name.toLowerCase() === pkg);
      const appName = app ? app.name : pkg;
      
      Alert.alert(
        t('mindfulLock.allowanceExceededTitle'),
        t('mindfulLock.allowanceExceededMessage', { appName }),
        [{ text: t('mindfulLock.gotIt') }]
      );
      
      // Clear param so it doesn't fire again on navigation
      navigation.setParams({ blocked_app: undefined });
    }
  }, [route?.params?.blocked_app, apps]);

  // Refresh when returning from intervention
  useEffect(() => {
    if (!showIntervention && !showReflection) {
      loadData();
    }
  }, [showIntervention, showReflection]);

  const handleAddApp = async () => {
    if (!newAppName.trim()) return;

    await addApp(userId, {
      name: newAppName.trim(),
      icon: newAppIcon,
      lockMode: 'allowance',
      dailyBudgetMinutes: parseInt(newAppBudget) || 60,
    });

    setNewAppName('');
    setNewAppIcon('📱');
    setNewAppBudget('60');
    setShowAddApp(false);
    loadData();
  };

  const handleRemoveApp = (app) => {
    Alert.alert(t('mindfulLock.removeAppTitle'), t('mindfulLock.removeAppMessage', { appName: app.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('mindfulLock.removeButton'), style: 'destructive', onPress: async () => {
          await removeApp(userId, app.id);
          loadData();
        }
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
              { text: t('mindfulLock.openSettings'), onPress: () => NativeModules.AppBlocker.openAccessibilitySettings() }
            ]
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

  const todayStr = new Date().toISOString().split('T')[0];
  const hasReflectedToday = pastReflections.some(r => r.createdAt && r.createdAt.startsWith(todayStr));
  const currentHour = new Date().getHours();
  const showReflectionBtn = currentHour >= 20 && !hasReflectedToday;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ─── Header ─── */}
      <View style={[styles.header, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconBtn}>
          <Menu color={ACCENT} size={26} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <BrainCircuit color={ACCENT} size={20} />
          <Text style={styles.headerTitle}>{t('mindfulLock.headerTitle')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('MindfulLockSetup', { userId })}
          style={styles.iconBtn}
        >
          <Settings color="#71717a" size={22} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ─── Accessibility Off Warning ─── */}
        {Platform.OS === 'android' && !accessibilityEnabled && (
          <TouchableOpacity
            style={styles.accessibilityWarning}
            onPress={() => NativeModules.AppBlocker?.openAccessibilitySettings?.()}
            activeOpacity={0.8}
          >
            <AlertTriangle color="#FBBF24" size={20} strokeWidth={2.2} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.accessibilityWarningTitle}>{t('mindfulLock.accessibilityWarningTitle')}</Text>
              <Text style={styles.accessibilityWarningDesc}>
                {t('mindfulLock.accessibilityWarningDesc')}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ─── Distraction Score Ring ─── */}
        <Animated.View entering={FadeIn.duration(500)} style={styles.scoreSection}>
          <DistractionScoreRing score={score} size={180} strokeWidth={10} />
          <Text style={styles.scoreSubtitle}>{t('mindfulLock.scoreSubtitle')}</Text>
        </Animated.View>

        {/* ─── Today's Stats ─── */}
        <View style={styles.statsRow}>
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.statItem}>
            <CustomClockIcon color="#71717a" size={20} />
            <Text style={styles.statValueCompact}>{todayStats.timeSaved}m</Text>
            <Text style={styles.statLabelCompact}>{t('mindfulLock.statSaved')}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(150).duration(400)} style={styles.statItem}>
            <CustomShieldIcon color="#71717a" size={20} />
            <Text style={styles.statValueCompact}>{todayStats.resisted}</Text>
            <Text style={styles.statLabelCompact}>{t('mindfulLock.statResisted')}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.statItem}>
            <CustomFlameIcon color={ACCENT} size={22} />
            <Text style={styles.statValueCompact}>{profile?.streak || 0}</Text>
            <Text style={styles.statLabelCompact}>{t('mindfulLock.statStreak')}</Text>
          </Animated.View>
        </View>

        {/* ─── THE BIG BUTTON ─── (reflects the EFFECTIVE mode, i.e. honors
             an active schedule window, not just the manual base setting) */}
        {effectiveMode !== 'strict' && (
          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
            <TouchableOpacity
              style={styles.temptedBtn}
              onPress={() => {
                if (apps.length === 0) {
                  Alert.alert(t('mindfulLock.noAppsTitle'), t('mindfulLock.noAppsMessage'));
                  return;
                }
                setShowIntervention(true);
              }}
              activeOpacity={0.8}
            >
              <BrainCircuit color="#A78BFA" size={24} />
              <Text style={styles.temptedBtnText}>{t('mindfulLock.temptedButton')}</Text>
              <Text style={styles.temptedBtnSub}>{t('mindfulLock.temptedButtonSub')}</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {effectiveMode === 'strict' && (
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={[styles.temptedBtn, { backgroundColor: '#60A5FA18', borderColor: '#60A5FA', borderWidth: 1 }]}>
            <BrainCircuit color="#60A5FA" size={24} />
            <Text style={styles.temptedBtnText}>{t('mindfulLock.strictBlockActive')}</Text>
            <Text style={styles.temptedBtnSub}>
              {profile?.blockingMode !== 'strict'
                ? t('mindfulLock.strictBlockScheduleSub')
                : t('mindfulLock.strictBlockManualSub')}
            </Text>
          </Animated.View>
        )}

        {/* ─── Quick Actions ─── */}
        {Platform.OS === 'android' && (
          <Animated.View entering={FadeInDown.delay(300).duration(400)}>
            <Text style={styles.sectionTitle}>{t('mindfulLock.quickActionsTitle')}</Text>
            <View style={styles.quickActions}>
              <View style={styles.quickActionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quickActionLabel}>{t('mindfulLock.strictBlockerLabel')}</Text>
                  <Text style={styles.quickActionDesc}>
                    {profile?.blockingMode === 'strict' ? t('mindfulLock.strictBlockerDescActive') : t('mindfulLock.strictBlockerDescInactive')}
                  </Text>
                </View>
                <Switch
                  value={profile?.blockingMode === 'strict'}
                  onValueChange={handleToggleStrictMode}
                  trackColor={{ false: '#27272a', true: '#60A5FA40' }}
                  thumbColor={profile?.blockingMode === 'strict' ? '#60A5FA' : '#52525b'}
                />
              </View>

              <View style={styles.divider} />

              <TouchableOpacity style={styles.quickActionRow} onPress={() => setShowSchedule(true)} activeOpacity={0.7}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quickActionLabel}>{t('mindfulLock.autoScheduleLabel')}</Text>
                  <Text style={styles.quickActionDesc}>
                    {profile?.schedules?.length > 0
                      ? t('mindfulLock.activeRules', { count: profile.schedules.filter(s => s.enabled !== false).length })
                      : t('mindfulLock.autoScheduleDesc')}
                  </Text>
                </View>
                <ChevronRight color="#52525b" size={20} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* ─── Locked Apps ─── */}
        <Animated.View entering={FadeInDown.delay(400).duration(400)}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('mindfulLock.lockedDistractionsTitle')}</Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate('MindfulLockSetup', { 
                userId, 
                initialStep: Platform.OS === 'android' ? 3 : 2, 
                isAddingMore: true 
              })}
            >
              <Plus color={ACCENT} size={16} />
              <Text style={styles.addBtnText}>{t('mindfulLock.addButton')}</Text>
            </TouchableOpacity>
          </View>

          {/* App List */}
          {apps.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <LockOpen color={ACCENT} size={24} strokeWidth={2} />
              </View>
              <Text style={styles.emptyText}>{t('mindfulLock.emptyTitle')}</Text>
              <Text style={styles.emptySubtext}>{t('mindfulLock.emptySubtitle')}</Text>
            </View>
          ) : (
            apps.map((app, index) => {
              const budget = getTodaysBudget(app);
              const usage = app.usageToday || 0;
              const progress = budget > 0 ? Math.min(usage / budget, 1) : 0;
              const isOverBudget = usage >= budget;

              // Live allowance countdown (updates every second via `now`)
              const activeAllowance = app.unblockUntil && app.unblockUntil > now;
              const remainingSec = activeAllowance ? Math.ceil((app.unblockUntil - now) / 1000) : 0;
              const remMM = Math.floor(remainingSec / 60);
              const remSS = String(remainingSec % 60).padStart(2, '0');

              return (
                <Animated.View
                  key={app.id}
                  entering={FadeInDown.delay(index * 50).duration(300)}
                  style={styles.appCard}
                >
                  {app.icon && app.icon.length > 10 ? (
                    <Image 
                      source={{ uri: `data:image/png;base64,${app.icon}` }} 
                      style={{ width: 32, height: 32, borderRadius: 6, marginRight: 14 }} 
                    />
                  ) : (
                    <Text style={styles.appCardIcon}>{app.icon}</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={styles.appCardHeader}>
                      <Text style={styles.appCardName}>{app.name}</Text>
                      {app.bundle && (
                        <Text style={styles.appCardBundle}>{app.bundle}</Text>
                      )}
                    </View>

                    {/* Progress Bar */}
                    <View style={styles.progressBarBg}>
                      <View
                        style={[
                          styles.progressBarFill,
                          {
                            width: `${progress * 100}%`,
                            backgroundColor: isOverBudget ? '#FB7185' : ACCENT,
                          },
                        ]}
                      />
                    </View>

                    <View style={styles.appCardFooter}>
                      {activeAllowance ? (
                        <Text style={[styles.appCardUsage, { color: '#34D399' }]}>
                          {t('mindfulLock.timeLeft', { time: `${remMM}:${remSS}` })}
                        </Text>
                      ) : (
                        <Text style={[styles.appCardUsage, isOverBudget && { color: '#A1A1AA' }]}>
                          {t('mindfulLock.usedMinutes', { usage, budget })}
                        </Text>
                      )}
                      <Text style={styles.appCardMode}>
                        {app.lockMode === 'hard' ? t('mindfulLock.modeHard') :
                          app.lockMode === 'scheduled' ? t('mindfulLock.modeScheduled') : t('mindfulLock.modeAllowance')}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.appCardDelete}
                    onPress={() => handleRemoveApp(app)}
                  >
                    <Trash2 color="#52525b" size={16} />
                  </TouchableOpacity>
                </Animated.View>
              );
            })
          )}
        </Animated.View>

        {/* ─── Today's Activity ─── */}
        {todayStats.todayLog?.length > 0 && (
          <Animated.View entering={FadeInDown.delay(500).duration(400)}>
            <Text style={styles.sectionTitle}>{t('mindfulLock.todayActivityTitle')}</Text>
            {todayStats.todayLog.slice(0, 5).map((entry, i) => (
              <View key={entry.id} style={styles.logEntry}>
                <View style={styles.logIconWrap}>
                  {entry.action === 'resisted' || entry.action === 'closed'
                    ? <CheckCircle2 color="#34D399" size={17} strokeWidth={2.2} />
                    : <Smartphone color="#71717a" size={16} strokeWidth={2.2} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logText}>
                    {entry.action === 'resisted' ? t('mindfulLock.logResisted') : 
                     entry.action === 'closed' ? t('mindfulLock.logClosed') : 
                     entry.action === 'granted' ? t('mindfulLock.logGranted') : t('mindfulLock.logUsed')} {entry.appName}
                    {entry.duration ? ` (${entry.duration}m)` : ''}
                  </Text>
                  <Text style={styles.logTime}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <Text style={[styles.logXP, (entry.action === 'used' || entry.action === 'granted') && { color: '#A1A1AA' }]}>
                  {entry.action === 'resisted' ? t('mindfulLock.xpResisted') :
                   entry.action === 'closed' ? t('mindfulLock.xpClosed') :
                   entry.action === 'granted' ? t('mindfulLock.xpGranted') :
                   entry.action === 'used' ? t('mindfulLock.xpUsed') : ''}
                </Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* ─── Reflection Button (after 8 PM) ─── */}
        {showReflectionBtn && (
          <TouchableOpacity
            style={styles.reflectionBtn}
            onPress={() => setShowReflection(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.reflectionBtnText}>{t('mindfulLock.reflectionButton')}</Text>
          </TouchableOpacity>
        )}

        {/* ─── Past Reflections ─── */}
        {pastReflections.length > 0 && (
          <View style={styles.pastReflectionsContainer}>
            <Text style={styles.pastReflectionsTitle}>{t('mindfulLock.pastReflectionsTitle')}</Text>
            {pastReflections.map((ref) => (
              <View key={ref.id} style={styles.reflectionCard}>
                <View style={styles.reflectionCardHeader}>
                  <Text style={styles.reflectionDate}>
                    {new Date(ref.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  <MoodIcon mood={ref.mood} size={20} color={ACCENT} />
                </View>
                {ref.note ? (
                  <Text style={styles.reflectionNote}>{ref.note}</Text>
                ) : (
                  <Text style={styles.reflectionNoteEmpty}>{t('mindfulLock.noNoteAdded')}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ─── Modals ─── */}
      <MindfulInterventionOverlay
        isVisible={showIntervention}
        onClose={() => {
          setShowIntervention(false);
          setInterventionApp(null);
        }}
        userId={userId}
        initialApp={interventionApp}
      />

      <MindfulReflectionModal
        isVisible={showReflection}
        onClose={() => setShowReflection(false)}
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

      {/* ─── Sidebar ─── */}
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

const makeStyles = (ACCENT) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },

  // ─── Header ───
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  iconBtn: {
    padding: 8,
    width: 44,
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },

  scrollContent: {
    paddingHorizontal: 20,
  },

  // ─── Accessibility Off Warning ───
  accessibilityWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(161, 161, 170, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(161, 161, 170, 0.35)',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  accessibilityWarningTitle: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '700',
  },
  accessibilityWarningDesc: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },

  // ─── Score Ring ───
  scoreSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  scoreSubtitle: {
    color: '#52525b',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 12,
  },

  // ─── Stats Row ───
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 30,
    paddingHorizontal: 10,
  },
  statItem: {
    alignItems: 'center',
    gap: 6,
  },
  statValueCompact: {
    color: '#a3a3a3',
    fontSize: 16,
    fontWeight: '800',
  },
  statLabelCompact: {
    color: '#52525b',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ─── Tempted Button ───
  temptedBtn: {
    backgroundColor: ACCENT,
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  temptedBtnText: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '850',
    marginTop: 8,
    letterSpacing: -0.3,
  },
  temptedBtnSub: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 4,
  },

  quickActions: {
    backgroundColor: '#18181b', // Lighter dark gray so it's not pure black
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 24,
    overflow: 'hidden',
  },
  quickActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  quickActionLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  quickActionDesc: {
    color: '#52525b',
    fontSize: 12,
    marginTop: 2,
  },
  quickActionArrow: {
    color: '#52525b',
    fontSize: 24,
    fontWeight: '300',
  },
  divider: {
    height: 1,
    backgroundColor: '#27272a',
  },

  // ─── Section ───
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#71717a',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    marginBottom: 12,
  },
  addBtnText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '700',
  },

  // ─── Add App Form ───
  addAppForm: {
    backgroundColor: '#121212',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 14,
    marginBottom: 12,
  },
  addAppRow: {},
  iconPicker: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    backgroundColor: '#1a1a1a',
  },
  iconPickerSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: ACCENT,
  },
  addAppInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addAppInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#fff',
    fontSize: 14,
    padding: 12,
  },
  addAppSubmit: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Empty State ───
  emptyState: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0a0a0a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: ACCENT + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyText: {
    color: '#71717a',
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtext: {
    color: '#52525b',
    fontSize: 13,
    marginTop: 4,
  },

  // ─── App Cards ───
  appCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 14,
    marginBottom: 10,
  },
  appCardIcon: {
    fontSize: 28,
    marginRight: 14,
  },
  appCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  appCardName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  appCardBundle: {
    // Was #52525b on #1a1a1a — 2.25:1, unreadable for a package name that the
    // user is meant to be able to identify. #8E8E93 gives 4.9:1.
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  progressBarBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#27272a',
    marginBottom: 6,
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
  },
  appCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  appCardUsage: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '600',
  },
  appCardMode: {
    color: '#52525b',
    fontSize: 11,
    fontWeight: '600',
  },
  appCardDelete: {
    padding: 8,
    marginLeft: 8,
  },

  // ─── Activity Log ───
  logEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b',
  },
  logIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: '#18181b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  logText: {
    color: '#d4d4d8',
    fontSize: 13,
    fontWeight: '600',
  },
  logTime: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 2,
  },
  logXP: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  // ─── Reflection Button ───
  reflectionBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    padding: 18,
    alignItems: 'center',
    marginTop: 20,
  },
  reflectionBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  
  // ─── Past Reflections ───
  pastReflectionsContainer: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  pastReflectionsTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  reflectionCard: {
    backgroundColor: '#121212',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  reflectionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reflectionDate: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '600',
  },
  reflectionMoodEmoji: {
    fontSize: 20,
  },
  reflectionNote: {
    color: '#e4e4e7',
    fontSize: 15,
    lineHeight: 22,
  },
  reflectionNoteEmpty: {
    color: '#52525b',
    fontSize: 14,
    fontStyle: 'italic',
  },
});

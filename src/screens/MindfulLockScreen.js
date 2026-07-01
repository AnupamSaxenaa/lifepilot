// ─── Mindful Lock Dashboard ──────────────────────────────
// Main screen for the Mindful Lock distraction control
// feature. Shows score ring, stats, locked apps, and
// the "I'm Tempted" intervention trigger.
// ─────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  ScrollView, Alert, TextInput, Switch, NativeModules, Platform, Image, AppState
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import {
  Menu, BrainCircuit, Plus, Trash2, Edit3, Clock, Zap,
  Flame, Settings, AlertTriangle, MessageSquare,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { GlassSidebar } from '../components/GlassSidebar';
import { DistractionScoreRing } from '../components/DistractionScoreRing';
import { MindfulInterventionOverlay } from '../components/MindfulInterventionOverlay';
import { MindfulReflectionModal } from '../components/MindfulReflectionModal';
import {
  getApps, getProfile, saveProfile, addApp, removeApp, updateApp,
  getDistractionScore, getTodayStats, getTimeSavedToday, getTimeEquivalent,
  checkMindfulStreak, getTodaysBudget, syncAppBlocker
} from '../utils/mindfulLock';
import { supabase } from '../lib/supabase';
import { loadProfile } from '../lib/dataManager';
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
    <Path d="M11.9 22c-3.9 0-7.3-2.9-7.8-6.8-.2-1.2.1-2.5.8-3.6.5-.8 1.1-1.6 1.8-2.2-1.2.6-2.1 1.5-2.8 2.6-.1.2-.5.1-.6-.2-.3-.6-.3-1.3-.2-1.9C4.5 5.5 8.7 2.3 13.3 2c.2 0 .4.2.3.4-.6 1.5-1.4 2.8-2.3 4-.7.9-1.6 1.7-2.6 2.3 1.9-.3 3.6.4 5 1.7 1.4 1.3 2.2 3.1 2.2 5 0 3.6-3 6.6-6.6 6.6H11.9z" />
  </Svg>
);

const { width } = Dimensions.get('window');
const ACCENT = '#A855F7';

export const MindfulLockScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
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
  const [userProfile, setUserProfile] = useState(null);
  const [apps, setApps] = useState([]);
  const [score, setScore] = useState(50);
  const [todayStats, setTodayStats] = useState({ resisted: 0, used: 0, timeSaved: 0 });
  const [timeSavedEquiv, setTimeSavedEquiv] = useState('');
  const [pastReflections, setPastReflections] = useState([]);

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
  const [showEditApp, setShowEditApp] = useState(null);

  // Add app form
  const [newAppName, setNewAppName] = useState('');
  const [newAppIcon, setNewAppIcon] = useState('📱');
  const [newAppBudget, setNewAppBudget] = useState('60');

  const QUICK_ICONS = ['📱', '📸', '🎵', '▶️', '🐦', '🔴', '👻', '📘', '🎮', '💬', '📧', '🛒'];

  const loadData = useCallback(async () => {
    if (!userId) return;

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
      
      return () => clearInterval(interval);
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
        'Time Allowance Exceeded',
        `Your daily allowance for ${appName} has run out.\n\nTake a deep breath and close the app.`,
        [{ text: 'Got it' }]
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
    Alert.alert('Remove App', `Remove ${app.name} from Mindful Lock?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
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
            'Permission Required',
            'Strict mode requires the Accessibility Service to detect when you open a blocked app. Please enable it in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => NativeModules.AppBlocker.openAccessibilitySettings() }
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
          <Menu color="#A855F7" size={26} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <BrainCircuit color="#A855F7" size={20} />
          <Text style={styles.headerTitle}>Mindful Lock</Text>
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
        {/* ─── Distraction Score Ring ─── */}
        <Animated.View entering={FadeIn.duration(500)} style={styles.scoreSection}>
          <DistractionScoreRing score={score} size={180} strokeWidth={10} />
          <Text style={styles.scoreSubtitle}>Your digital wellbeing</Text>
        </Animated.View>

        {/* ─── Today's Stats ─── */}
        <View style={styles.statsRow}>
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.statItem}>
            <CustomClockIcon color="#52525b" size={18} />
            <Text style={styles.statValueCompact}>{todayStats.timeSaved}m</Text>
            <Text style={styles.statLabelCompact}>Saved</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(150).duration(400)} style={styles.statItem}>
            <CustomShieldIcon color="#52525b" size={18} />
            <Text style={styles.statValueCompact}>{todayStats.resisted}</Text>
            <Text style={styles.statLabelCompact}>Resisted</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.statItem}>
            <CustomFlameIcon color="#52525b" size={18} />
            <Text style={styles.statValueCompact}>{profile?.streak || 0}</Text>
            <Text style={styles.statLabelCompact}>Streak</Text>
          </Animated.View>
        </View>

        {/* ─── THE BIG BUTTON ─── */}
        {profile?.blockingMode !== 'strict' && (
          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
            <TouchableOpacity
              style={styles.temptedBtn}
              onPress={() => {
                if (apps.length === 0) {
                  Alert.alert('No Apps', 'Add at least one distraction app first!');
                  return;
                }
                setShowIntervention(true);
              }}
              activeOpacity={0.8}
            >
              <BrainCircuit color="#fff" size={24} />
              <Text style={styles.temptedBtnText}>I'm Tempted</Text>
              <Text style={styles.temptedBtnSub}>Tap when you feel the urge</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {profile?.blockingMode === 'strict' && (
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={[styles.temptedBtn, { backgroundColor: '#27272a', borderColor: '#EF4444', borderWidth: 1 }]}>
            <BrainCircuit color="#EF4444" size={24} />
            <Text style={styles.temptedBtnText}>Strict Block Active</Text>
            <Text style={styles.temptedBtnSub}>Selected apps are forcibly blocked.</Text>
          </Animated.View>
        )}

        {/* ─── Quick Actions ─── */}
        {Platform.OS === 'android' && (
          <Animated.View entering={FadeInDown.delay(300).duration(400)}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.quickActions}>
              <View style={styles.quickActionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quickActionLabel}>🔒 Strict Blocker</Text>
                  <Text style={styles.quickActionDesc}>
                    {profile?.blockingMode === 'strict' ? 'Forcefully blocking apps' : 'Switch from Mindful Coach to hard block'}
                  </Text>
                </View>
                <Switch
                  value={profile?.blockingMode === 'strict'}
                  onValueChange={handleToggleStrictMode}
                  trackColor={{ false: '#27272a', true: '#EF444440' }}
                  thumbColor={profile?.blockingMode === 'strict' ? '#EF4444' : '#52525b'}
                />
              </View>
            </View>
          </Animated.View>
        )}

        {/* ─── Locked Apps ─── */}
        <Animated.View entering={FadeInDown.delay(400).duration(400)}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Locked Distractions</Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate('MindfulLockSetup', { 
                userId, 
                initialStep: Platform.OS === 'android' ? 3 : 2, 
                isAddingMore: true 
              })}
            >
              <Plus color={ACCENT} size={16} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* App List */}
          {apps.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🔓</Text>
              <Text style={styles.emptyText}>No apps locked yet</Text>
              <Text style={styles.emptySubtext}>Tap "+ Add" to lock your first distraction</Text>
            </View>
          ) : (
            apps.map((app, index) => {
              const budget = getTodaysBudget(app);
              const usage = app.usageToday || 0;
              const progress = budget > 0 ? Math.min(usage / budget, 1) : 0;
              const isOverBudget = usage >= budget;

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
                            backgroundColor: isOverBudget ? '#EF4444' : ACCENT,
                          },
                        ]}
                      />
                    </View>

                    <View style={styles.appCardFooter}>
                      <Text style={[styles.appCardUsage, isOverBudget && { color: '#EF4444' }]}>
                        {usage}/{budget}m used
                      </Text>
                      <Text style={styles.appCardMode}>
                        {app.lockMode === 'hard' ? '🔒 Hard' :
                          app.lockMode === 'scheduled' ? '📅 Scheduled' : '⏰ Allowance'}
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
            <Text style={styles.sectionTitle}>Today's Activity</Text>
            {todayStats.todayLog.slice(0, 5).map((entry, i) => (
              <View key={entry.id} style={styles.logEntry}>
                <Text style={styles.logIcon}>
                  {entry.action === 'resisted' || entry.action === 'closed' ? '✅' : '📱'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logText}>
                    {entry.action === 'resisted' ? 'Resisted' : 
                     entry.action === 'closed' ? 'Walked away from' : 
                     entry.action === 'granted' ? 'Allowed' : 'Used'} {entry.appName}
                    {entry.duration ? ` (${entry.duration}m)` : ''}
                  </Text>
                  <Text style={styles.logTime}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <Text style={[styles.logXP, (entry.action === 'used' || entry.action === 'granted') && { color: '#EF4444' }]}>
                  {entry.action === 'resisted' ? '+25 XP' :
                   entry.action === 'closed' ? '+15 XP' :
                   entry.action === 'granted' ? '-20 XP' :
                   entry.action === 'used' ? '-25 XP' : ''}
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
            <Text style={styles.reflectionBtnText}>📝 End of Day Reflection (+10 XP)</Text>
          </TouchableOpacity>
        )}

        {/* ─── Past Reflections ─── */}
        {pastReflections.length > 0 && (
          <View style={styles.pastReflectionsContainer}>
            <Text style={styles.pastReflectionsTitle}>Past Reflections</Text>
            {pastReflections.map((ref) => (
              <View key={ref.id} style={styles.reflectionCard}>
                <View style={styles.reflectionCardHeader}>
                  <Text style={styles.reflectionDate}>
                    {new Date(ref.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  <Text style={styles.reflectionMoodEmoji}>
                    {ref.mood === 0 ? '😫' : ref.mood === 1 ? '😕' : ref.mood === 2 ? '😐' : ref.mood === 3 ? '🙂' : '😊'}
                  </Text>
                </View>
                {ref.note ? (
                  <Text style={styles.reflectionNote}>{ref.note}</Text>
                ) : (
                  <Text style={styles.reflectionNoteEmpty}>No note added.</Text>
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

const styles = StyleSheet.create({
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
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  temptedBtnText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 8,
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
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
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
  emptyEmoji: {
    fontSize: 36,
    marginBottom: 10,
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
    color: '#52525b',
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
  logIcon: {
    fontSize: 16,
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
    color: '#A855F7',
    fontSize: 12,
    fontWeight: '700',
  },

  // ─── Reflection Button ───
  reflectionBtn: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.2)',
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

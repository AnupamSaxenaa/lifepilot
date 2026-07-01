import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import {
    Award,
    Bell,
    Brain,
    Calendar,
    Heart,
    History,
    Home,
    Inbox,
    Key,
    LayoutGrid,
    List,
    LogOut,
    Plus,
    Settings,
    Star,
    X
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Animated, Dimensions, Linking, Platform, StyleSheet, Switch, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addList, loadLists } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { COLORS } from '../theme/theme';
import {
    isCalendarConnected,
    requestCalendarPermissions,
} from '../utils/calendarSync';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';
import { GamificationGuideModal } from './GamificationGuideModal';
import { GamificationStatsModal } from './GamificationStatsModal';
import { UpdatesModal } from './UpdatesModal';
import { XPAvatarRing } from './XPAvatarRing';

const { width, height } = Dimensions.get('window');
const SIDEBAR_WIDTH = width * 0.75;

export const GlassSidebar = ({ isOpen, onClose, profile, handleLogout, navigation, currentRoute, gamestate: parentGamestate }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  
  const [slideAnim] = useState(() => new Animated.Value(-SIDEBAR_WIDTH));
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [menuItemsAnim] = useState(() => new Animated.Value(0));

  const [todayCount, setTodayCount] = useState(0);
  const [starredCount, setStarredCount] = useState(0);
  const [plannedCount, setPlannedCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [starredOverdueCount, setStarredOverdueCount] = useState(0);
  const [plannedOverdueCount, setPlannedOverdueCount] = useState(0);
  const [listCounts, setListCounts] = useState({});
  const [listOverdueCounts, setListOverdueCounts] = useState({});
  const [isCalendarLinked, setIsCalendarLinked] = useState(false);
  const [userId, setUserId] = useState(null);
  const [customLists, setCustomLists] = useState([]);
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [gamestate, setGamestate] = useState({ xp: 0, level: 1, streak: 0 });
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  
  // Updates State
  const [isUpdatesModalOpen, setIsUpdatesModalOpen] = useState(false);
  const [latestUpdate, setLatestUpdate] = useState(null);
  const [isFetchingUpdate, setIsFetchingUpdate] = useState(false);
  const [hasUnreadUpdate, setHasUnreadUpdate] = useState(false);

  useEffect(() => {
    if (parentGamestate) {
      setGamestate(parentGamestate);
    }
  }, [parentGamestate]);

  useEffect(() => {
    const fetchCounts = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      
      const calState = await isCalendarConnected();
      setIsCalendarLinked(calState);

      const state = await Gamification.getState(session.user.id);
      if (state) setGamestate(state);

      const cached = await Storage.get(`tasks_${session.user.id}`);
      if (cached) {
        const uncompleted = cached.filter(t => !t.is_completed);
        
        const todayStr = new Date().toDateString();
        const todayTasks = uncompleted.filter(t => {
          if (t.added_to_today) return true;

          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);

          if (t.due_date) {
            const dueDate = new Date(t.due_date);
            if (dueDate < todayStart || dueDate.toDateString() === todayStr) return true;
          }

          if (t.reminder_time) {
            const reminderDate = new Date(t.reminder_time);
            if (reminderDate < todayStart || reminderDate.toDateString() === todayStr) return true;
          }

          if (!t.list_id && !t.due_date && !t.reminder_time) return true;
          return false;
        });
        const starredTasks = uncompleted.filter(t => t.is_important);
        
        setTodayCount(todayTasks.length);
        setStarredCount(starredTasks.length);

        // Planned count: uncompleted tasks with a due date
        const plannedTasks = uncompleted.filter(t => t.due_date);
        setPlannedCount(plannedTasks.length);

        // Overdue count: uncompleted tasks where due date is before today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const overdueTasks = uncompleted.filter(t => {
          if (!t.due_date) return false;
          const d = new Date(t.due_date);
          d.setHours(0, 0, 0, 0);
          return d < todayStart;
        });
        setOverdueCount(overdueTasks.length);

        // Starred overdue count
        setStarredOverdueCount(starredTasks.filter(t => {
          if (!t.due_date) return false;
          const d = new Date(t.due_date);
          d.setHours(0, 0, 0, 0);
          return d < todayStart;
        }).length);

        // Planned overdue count
        setPlannedOverdueCount(overdueTasks.length);

        // Per-list counts and overdue counts
        const counts = {};
        const overdueCts = {};
        uncompleted.forEach(t => {
          if (t.list_id) {
            counts[t.list_id] = (counts[t.list_id] || 0) + 1;
            if (t.due_date) {
              const d = new Date(t.due_date);
              d.setHours(0, 0, 0, 0);
              if (d < todayStart) {
                overdueCts[t.list_id] = (overdueCts[t.list_id] || 0) + 1;
              }
            }
          }
        });
        setListCounts(counts);
        setListOverdueCounts(overdueCts);
      }
      
      const fetchedLists = await loadLists(session.user.id, (fresh) => setCustomLists(fresh));
      if (fetchedLists) setCustomLists(fetchedLists);

      // Fetch Latest Update
      try {
        const { data: updateData, error } = await supabase
          .from('app_updates')
          .select('*')
          .eq('is_published', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
          
        if (updateData) {
          setLatestUpdate(updateData);
          const lastReadId = await Storage.get('last_read_update_id');
          if (lastReadId !== updateData.id) {
            setHasUnreadUpdate(true);
          }
        }
      } catch (err) {
        // Table might not exist yet, ignore
      }
    };

    if (isOpen) {
      fetchCounts();
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.stagger(30, [
          Animated.timing(menuItemsAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          })
        ])
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -SIDEBAR_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(menuItemsAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [isOpen]);

  const handleToggleCalendar = async () => {
    console.log('[GlassSidebar] Calendar toggle tapped, current state:', isCalendarLinked);
    
    if (isCalendarLinked) {
      Alert.alert('Calendar Synced', 'Your local calendars are already synced. You can disable this in your OS settings.');
    } else {
      console.log('[GlassSidebar] Requesting calendar permissions...');
      const granted = await requestCalendarPermissions();
      console.log('[GlassSidebar] Permission granted:', granted);
      
      if (granted) {
        setIsCalendarLinked(true);
        Alert.alert('Connected', 'Your device calendars are now synced!');
      } else {
        // OS didn't show dialog — redirect to Settings
        Alert.alert(
          'Permission Required',
          'Please enable Calendar access for LifePilot in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
      }
    }
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) {
      setIsAddingList(false);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const updatedLists = await addList(session.user.id, customLists, newListName.trim());
      setCustomLists(updatedLists);
    }
    setNewListName('');
    setIsAddingList(false);
  };

  const getAvatarSource = () => {
    if (profile?.avatar_url) {
      return { uri: profile.avatar_url };
    }
    const seed = profile?.avatar_seed || profile?.username || 'fallback';
    return { uri: `https://api.dicebear.com/7.x/adventurer/png?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9` };
  };

  const handleOpenUpdates = async () => {
    setIsUpdatesModalOpen(true);
    if (hasUnreadUpdate && latestUpdate) {
      setHasUnreadUpdate(false);
      await Storage.set('last_read_update_id', latestUpdate.id);
    }
  };

  // We use absoluteFill but disable touches when closed
  return (
    <View style={[StyleSheet.absoluteFill, { elevation: 100, zIndex: 100 }]} pointerEvents={isOpen ? 'auto' : 'none'}>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>

      {/* Sidebar Panel */}
      <Animated.View 
        style={[
          styles.sidebar, 
          { 
            backgroundColor: colorScheme === 'dark' ? '#000000' : 'rgba(255, 255, 255, 0.75)',
            borderColor: theme.border,
            transform: [{ translateX: slideAnim }] 
          }
        ]}
      >
        {Platform.OS !== 'android' ? (
           <BlurView intensity={colorScheme === 'dark' ? 60 : 80} tint={colorScheme} style={StyleSheet.absoluteFill} />
        ) : null}
        
        <View style={[styles.content, { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <TouchableOpacity onPress={() => setIsStatsModalOpen(true)} activeOpacity={0.8} style={{ marginBottom: 14 }}>
                <XPAvatarRing 
                  avatarSource={getAvatarSource()} 
                  xp={gamestate.xp} 
                  level={gamestate.level} 
                  size={64} 
                  strokeWidth={3.5} 
                />
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                <TouchableOpacity onPress={handleOpenUpdates} style={[styles.closeBtn, { backgroundColor: theme.surface, borderColor: theme.border, overflow: 'visible' }]}>
                  <Bell color={theme.text} size={20} />
                  {hasUnreadUpdate && <View style={[styles.redDot, { position: 'absolute', top: -2, right: -2, marginRight: 0 }]} />}
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <X color={theme.text} size={20} />
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.profileInfo}>
              <Text style={[styles.displayName, { color: theme.text }]} numberOfLines={1}>
                {profile?.display_name || 'Loading...'}
              </Text>
              <Text style={[styles.username, { color: theme.textMuted }]} numberOfLines={1}>
                @{profile?.username || 'loading'}
              </Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {/* Menu Items */}
          <Animated.ScrollView 
            style={[styles.menu, {
              opacity: menuItemsAnim,
              transform: [{
                translateY: menuItemsAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0]
                })
              }]
            }]} 
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
          >
            {/* Dashboard */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Dashboard' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                if (currentRoute !== 'Dashboard') {
                  navigation.replace('Dashboard');
                } else {
                  onClose();
                }
              }}
            >
              <Home
                color={currentRoute === 'Dashboard' ? theme.primary : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'Dashboard' ? theme.primary : theme.textMuted },
                currentRoute === 'Dashboard' && { fontWeight: '700' },
              ]}>Dashboard</Text>
            </TouchableOpacity>

            {/* Inbox */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'CustomList' && navigation.getState()?.routes?.find(r => r.name === 'CustomList')?.params?.listId === 'inbox' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                navigation.replace('CustomList', { listId: 'inbox', listName: 'Inbox' });
              }}
            >
              <Inbox
                color={currentRoute === 'CustomList' && navigation.getState()?.routes?.find(r => r.name === 'CustomList')?.params?.listId === 'inbox' ? theme.primary : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'CustomList' && navigation.getState()?.routes?.find(r => r.name === 'CustomList')?.params?.listId === 'inbox' ? theme.primary : theme.textMuted },
                currentRoute === 'CustomList' && navigation.getState()?.routes?.find(r => r.name === 'CustomList')?.params?.listId === 'inbox' && { fontWeight: '700' },
                { flex: 1 }
              ]}>Inbox</Text>
            </TouchableOpacity>

            {/* Today */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Today' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                if (currentRoute !== 'Today') {
                  navigation.replace('Today');
                } else {
                  onClose();
                }
              }}
            >
              <LayoutGrid
                color={currentRoute === 'Today' ? theme.primary : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'Today' ? theme.primary : theme.textMuted },
                currentRoute === 'Today' && { fontWeight: '700' },
                { flex: 1 }
              ]}>Today</Text>
              {overdueCount > 0 && (
                <View style={[styles.redDot, { marginRight: 8 }]} />
              )}
              {todayCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{todayCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Starred */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Starred' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                if (currentRoute !== 'Starred') {
                  navigation.replace('Starred');
                } else {
                  onClose();
                }
              }}
            >
              <Star
                color={currentRoute === 'Starred' ? theme.text : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'Starred' ? theme.text : theme.textMuted },
                currentRoute === 'Starred' && { fontWeight: '700' },
                { flex: 1 }
              ]}>Starred</Text>
              {starredOverdueCount > 0 && (
                <View style={[styles.redDot, { marginRight: 8 }]} />
              )}
              {starredCount > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.text }]}>
                  <Text style={[styles.badgeText, { color: theme.background }]}>{starredCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Planned */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Planned' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                if (currentRoute !== 'Planned') {
                  navigation.replace('Planned');
                } else {
                  onClose();
                }
              }}
            >
              <Calendar
                color={currentRoute === 'Planned' ? theme.text : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'Planned' ? theme.text : theme.textMuted },
                currentRoute === 'Planned' && { fontWeight: '700' },
                { flex: 1 }
              ]}>Planned</Text>
              {plannedOverdueCount > 0 && (
                <View style={[styles.redDot, { marginRight: 8 }]} />
              )}
              {plannedCount > 0 && (
                <View style={[styles.badge, { backgroundColor: '#27272A' }]}>
                  <Text style={[styles.badgeText, { color: '#ffffff' }]}>{plannedCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Promises */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Promises' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                if (currentRoute !== 'Promises') {
                  navigation.replace('Promises');
                } else {
                  onClose();
                }
              }}
            >
              <Heart
                color={currentRoute === 'Promises' ? theme.text : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'Promises' ? theme.text : theme.textMuted },
                currentRoute === 'Promises' && { fontWeight: '700' },
                { flex: 1 }
              ]}>Promises</Text>
            </TouchableOpacity>

            {/* Mindful Lock */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'MindfulLock' && { backgroundColor: '#A855F7' + '22' },
              ]}
              onPress={async () => {
                if (currentRoute !== 'MindfulLock') {
                  const { getProfile } = require('../utils/mindfulLock');
                  const prof = userId ? await getProfile(userId) : null;
                  if (prof?.onboardingComplete) {
                    navigation.replace('MindfulLock', { userId });
                  } else {
                    navigation.replace('MindfulLockSetup', { userId });
                  }
                } else {
                  onClose();
                }
              }}
            >
              <Brain
                color={currentRoute === 'MindfulLock' ? '#A855F7' : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'MindfulLock' ? '#A855F7' : theme.textMuted },
                currentRoute === 'MindfulLock' && { fontWeight: '700' },
                { flex: 1 }
              ]}>Mindful Lock</Text>
              <View style={{
                backgroundColor: '#A855F7',
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 2,
                marginRight: 4,
              }}>
                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>NEW</Text>
              </View>
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: theme.border, marginVertical: 8 }]} />

            {/* Custom Lists */}
            {customLists.map((list) => (
              <TouchableOpacity
                key={list.id}
                style={[
                  styles.menuItem,
                  currentRoute === 'CustomList' && navigation.getState()?.routes?.find(r => r.name === 'CustomList')?.params?.listId === list.id && { backgroundColor: theme.primary + '22' },
                ]}
                onPress={() => {
                  navigation.replace('CustomList', { listId: list.id, listName: list.name });
                }}
              >
                <List color={theme.textMuted} size={24} style={styles.menuIcon} />
                <Text style={[styles.menuText, { color: theme.textMuted, flex: 1 }]} numberOfLines={1}>
                  {list.name}
                </Text>
                {(listOverdueCounts[list.id] || 0) > 0 && (
                  <View style={[styles.redDot, { marginRight: 8 }]} />
                )}
                {(listCounts[list.id] || 0) > 0 && (
                  <View style={[styles.badge, { backgroundColor: '#27272A' }]}>
                    <Text style={[styles.badgeText, { color: '#ffffff' }]}>{listCounts[list.id]}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}

            {isAddingList ? (
              <View style={[styles.menuItem, { backgroundColor: theme.surface }]}>
                <List color={theme.textMuted} size={24} style={styles.menuIcon} />
                <TextInput
                  style={[styles.menuText, { color: theme.text, flex: 1, padding: 0 }]}
                  placeholder="List Name"
                  placeholderTextColor={theme.textMuted}
                  autoFocus
                  value={newListName}
                  onChangeText={setNewListName}
                  onSubmitEditing={handleCreateList}
                />
              </View>
            ) : (
              <TouchableOpacity style={styles.menuItem} onPress={() => setIsAddingList(true)}>
                <Plus color={theme.textMuted} size={24} style={styles.menuIcon} />
                <Text style={[styles.menuText, { color: theme.textMuted }]}>New List</Text>
              </TouchableOpacity>
            )}

            <View style={[styles.divider, { backgroundColor: theme.border, marginVertical: 8 }]} />

            {/* History */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'History' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                onClose();
                setTimeout(() => {
                  if (currentRoute !== 'History') {
                    navigation.replace('History');
                  }
                }, 0);
              }}
            >
              <History
                color={currentRoute === 'History' ? theme.text : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'History' ? theme.text : theme.textMuted },
                currentRoute === 'History' && { fontWeight: '700' },
                { flex: 1 }
              ]}>History</Text>
            </TouchableOpacity>

            {/* Calendar Sync Toggle */}
            <View style={styles.menuSection}>
              <Text style={styles.sectionTitle}>Device Sync</Text>
              
              <View style={styles.menuItem}>
                <View style={styles.menuIconContainer}>
                  <Calendar color={isCalendarLinked ? '#4da6ff' : theme.textMuted} size={24} style={styles.menuIcon} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuText, { color: isCalendarLinked ? theme.text : theme.textMuted }]}>Local Calendars</Text>
                  {isCalendarLinked && <Text style={{ color: '#4da6ff', fontSize: 12, marginTop: 2 }}>Synced</Text>}
                </View>
                <Switch 
                  value={isCalendarLinked} 
                  onValueChange={handleToggleCalendar}
                  trackColor={{ false: theme.border, true: '#4da6ff55' }}
                  thumbColor={isCalendarLinked ? '#4da6ff' : theme.textMuted}
                />
              </View>
            </View>

            {/* Gamification Guide */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setIsGuideModalOpen(true)}
            >
              <Award
                color="#A855F7"
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: '#A855F7', fontWeight: '700' },
                { flex: 1 }
              ]}>XP & Rewards</Text>
            </TouchableOpacity>

            {/* Permissions */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Permissions' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                onClose();
                setTimeout(() => {
                  if (currentRoute !== 'Permissions') {
                    navigation.replace('Permissions');
                  }
                }, 0);
              }}
            >
              <Key
                color={currentRoute === 'Permissions' ? theme.primary : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'Permissions' ? theme.primary : theme.textMuted },
                currentRoute === 'Permissions' && { fontWeight: '700' },
              ]}>Permissions Hub</Text>
            </TouchableOpacity>

            {/* Settings */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Settings' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                onClose();
                setTimeout(() => {
                  if (currentRoute !== 'Settings') {
                    navigation.replace('Settings');
                  }
                }, 0);
              }}
            >
              <Settings
                color={currentRoute === 'Settings' ? theme.primary : theme.textMuted}
                size={24}
                style={styles.menuIcon}
              />
              <Text style={[
                styles.menuText,
                { color: currentRoute === 'Settings' ? theme.primary : theme.textMuted },
                currentRoute === 'Settings' && { fontWeight: '700' },
              ]}>Settings</Text>
            </TouchableOpacity>
          </Animated.ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <LogOut color="#EF4444" size={24} style={styles.menuIcon} />
              <Text style={[styles.menuText, { color: "#EF4444", fontWeight: '600' }]}>Log Out</Text>
            </TouchableOpacity>
            
            <View style={{ alignItems: 'center', marginTop: 16 }}>
              <Text style={{ fontSize: 11, color: theme.textMuted, opacity: 0.6, fontWeight: '600', letterSpacing: 0.5 }}>
                JASPER UPDATE V{Constants.expoConfig?.version || Constants.manifest?.version || '1.0.2'}
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>

      <GamificationStatsModal 
        isVisible={isStatsModalOpen} 
        onClose={() => setIsStatsModalOpen(false)} 
        gamestate={gamestate} 
        profile={profile} 
      />

      <GamificationGuideModal
        isVisible={isGuideModalOpen}
        onClose={() => setIsGuideModalOpen(false)}
        gamestate={gamestate}
      />

      <UpdatesModal 
        isVisible={isUpdatesModalOpen} 
        onClose={() => setIsUpdatesModalOpen(false)}
        updateData={latestUpdate}
        isLoading={isFetchingUpdate}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  sidebar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SIDEBAR_WIDTH,
    borderRightWidth: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 20,
    position: 'relative',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2.5,
    backgroundColor: '#1F2937',
    marginBottom: 14,
  },
  profileInfo: {
    paddingRight: 40,
  },
  displayName: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 3,
    letterSpacing: 0.3,
  },
  username: {
    fontSize: 15,
    fontWeight: '500',
    opacity: 0.7,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  divider: {
    height: 1,
    width: '100%',
    marginBottom: 14,
    opacity: 0.6,
  },
  menu: {
    flex: 1,
    paddingHorizontal: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 4,
  },
  menuIcon: {
    marginRight: 16,
  },
  menuText: {
    fontSize: 16,
    fontWeight: '500',
  },
  badge: {
    backgroundColor: '#333',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 14,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    paddingHorizontal: 14,
    paddingVertical: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  menuSection: {
    marginTop: 8,
    marginBottom: 12,
  },
  menuIconContainer: {
    marginRight: 16,
  },
});

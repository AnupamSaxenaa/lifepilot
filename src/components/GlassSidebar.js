import { BlurView } from 'expo-blur';
import {
    Calendar,
    Heart,
    History,
    Home, LayoutGrid,
    List, Inbox,
    LogOut,
    Plus,
    Settings,
    ShieldCheck,
    Star,
    X
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Animated, Dimensions, Image, Platform, StyleSheet, Switch, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addList, loadLists } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { COLORS } from '../theme/theme';
import {
    isCalendarConnected,
    requestCalendarPermissions,
} from '../utils/calendarSync';
import { Storage } from '../utils/storage';

const { width, height } = Dimensions.get('window');
const SIDEBAR_WIDTH = width * 0.75;

export const GlassSidebar = ({ isOpen, onClose, profile, handleLogout, navigation, currentRoute }) => {
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
  const [isCalendarLinked, setIsCalendarLinked] = useState(false);
  const [userId, setUserId] = useState(null);
  const [customLists, setCustomLists] = useState([]);
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListName, setNewListName] = useState('');

  useEffect(() => {
    const fetchCounts = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      
      const calState = await isCalendarConnected();
      setIsCalendarLinked(calState);

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
      }
      
      const fetchedLists = await loadLists(session.user.id, (fresh) => setCustomLists(fresh));
      if (fetchedLists) setCustomLists(fetchedLists);
    };

    if (isOpen) {
      fetchCounts();
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 50,
          friction: 8,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.stagger(30, [
          Animated.timing(menuItemsAnim, {
            toValue: 1,
            duration: 400,
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
        
        // Verify by checking permission again
        setTimeout(async () => {
          const verified = await isCalendarConnected();
          console.log('[GlassSidebar] Verification check:', verified);
          if (!verified) {
            console.warn('[GlassSidebar] WARNING: Permission verification failed!');
          }
        }, 500);
      } else {
        Alert.alert('Permission Denied', 'Please enable calendar access in your OS settings.');
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
            backgroundColor: colorScheme === 'dark' ? 'rgba(0, 0, 0, 0.92)' : 'rgba(255, 255, 255, 0.75)',
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
              <Image source={getAvatarSource()} style={[styles.avatar, { borderColor: theme.border }]} />
              <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <X color={theme.text} size={20} />
              </TouchableOpacity>
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
          >
            {/* Dashboard */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Dashboard' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                onClose();
                if (currentRoute !== 'Dashboard') {
                  navigation.replace('Dashboard');
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
                onClose();
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
                onClose();
                if (currentRoute !== 'Today') {
                  navigation.replace('Today');
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
                onClose();
                if (currentRoute !== 'Starred') {
                  navigation.replace('Starred');
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
                onClose();
                if (currentRoute !== 'Planned') {
                  navigation.replace('Planned');
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
                onClose();
                if (currentRoute !== 'Promises') {
                  navigation.replace('Promises');
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
                  onClose();
                  navigation.replace('CustomList', { listId: list.id, listName: list.name });
                }}
              >
                <List color={theme.textMuted} size={24} style={styles.menuIcon} />
                <Text style={[styles.menuText, { color: theme.textMuted, flex: 1 }]} numberOfLines={1}>
                  {list.name}
                </Text>
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
                if (currentRoute !== 'History') {
                  navigation.replace('History');
                }
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

            {/* Permissions */}
            <TouchableOpacity
              style={[
                styles.menuItem,
                currentRoute === 'Permissions' && { backgroundColor: theme.primary + '22' },
              ]}
              onPress={() => {
                onClose();
                if (currentRoute !== 'Permissions') {
                  navigation.replace('Permissions');
                }
              }}
            >
              <ShieldCheck
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
                if (currentRoute !== 'Settings') {
                  navigation.replace('Settings');
                }
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
          </View>
        </View>
      </Animated.View>
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

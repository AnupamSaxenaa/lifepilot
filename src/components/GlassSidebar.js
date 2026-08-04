import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import {
    Award,
    Bell,
    Brain,
    Calendar,
    GripVertical,
    Heart,
    History,
    Home,
    Inbox,
    LayoutGrid,
    List,
    LogOut,
    MessageSquare,
    Plus,
    Settings,
    Star,
    X
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Dimensions, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, useColorScheme, View } from 'react-native';
import { NestableDraggableFlatList, NestableScrollContainer, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { addList, loadLists, reorderLists } from '../lib/dataManager';
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

const { width } = Dimensions.get('window');
const SIDEBAR_WIDTH = width * 0.78;

/**
 * One row primitive for the whole sidebar. Every entry used to be a bespoke
 * 20-line block with its own active colour and badge style, which is why the
 * panel read as noisy. Active state is now a single language everywhere: a thin
 * accent bar on the leading edge, brighter label, faint surface wash.
 */
const SidebarRow = ({
  icon: Icon,
  label,
  theme,
  onPress,
  active = false,
  count = 0,
  showDot = false,
  tint,
  trailing = null,
  labelStyle,
  accessibilityLabel,
}) => {
  const labelColor = tint || (active ? theme.text : theme.textMuted);
  return (
    <TouchableOpacity
      style={[styles.row, active && { backgroundColor: `${theme.text}0A` }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ selected: active }}
    >
      <View style={[styles.rowRail, active && { backgroundColor: tint || theme.accent }]} />
      <Icon color={tint || (active ? theme.accent : theme.textMuted)} size={19} />
      <Text
        numberOfLines={1}
        style={[styles.rowLabel, { color: labelColor }, active && styles.rowLabelActive, labelStyle]}
      >
        {label}
      </Text>
      {showDot ? <View style={styles.dot} /> : null}
      {count > 0 ? (
        <Text style={[styles.rowCount, { color: active ? theme.text : theme.textMuted }]}>{count}</Text>
      ) : null}
      {trailing}
    </TouchableOpacity>
  );
};

/** Identity of a list collection: ids, names, and order. Used to skip no-op
 *  state updates that would otherwise re-render every draggable row. */
const listsSignature = (lists) => (Array.isArray(lists)
  ? lists.map((list) => `${list?.id}:${list?.name}`).join('|')
  : '');

/** Small tracked caption that replaces bare dividers as the grouping cue. */
const SectionLabel = ({ children, theme }) => (
  <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{children}</Text>
);

export const GlassSidebar = ({ isOpen, onClose, profile, handleLogout, navigation, currentRoute, gamestate: parentGamestate }) => {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  // Forces a re-render whenever the equipped accent/theme changes — COLORS is
  // mutated in place by ThemeContext, so this subscription is required.
  useAppTheme().themeVersion;
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
  // True from drag start until the new order is persisted, so a background
  // list refresh can never overwrite the arrangement mid-gesture.
  const isDraggingListsRef = useRef(false);
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  // Locally fetched progress, used only until the parent supplies its own.
  const [localGamestate, setLocalGamestate] = useState({ xp: 0, level: 1, streak: 0 });
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  
  // Updates State
  const [isUpdatesModalOpen, setIsUpdatesModalOpen] = useState(false);
  const [latestUpdate, setLatestUpdate] = useState(null);
  const [isFetchingUpdate, setIsFetchingUpdate] = useState(false);
  const [hasUnreadUpdate, setHasUnreadUpdate] = useState(false);

  // Derived rather than copied into state via an effect: the Dashboard already
  // owns the authoritative value, so mirroring it caused a cascading re-render.
  const gamestate = parentGamestate || localGamestate;

  /**
   * Commit a list array without making the sidebar flicker.
   *   • A cached read that comes back empty is a cache miss, not "no lists" —
   *     ignore it so reopening never blanks a populated sidebar for a frame.
   *   • Identical id/name/order keeps the previous array reference, so the
   *     draggable list doesn't re-render every cell on each open.
   */
  const applyLists = useCallback((incoming, fromCache) => {
    if (!Array.isArray(incoming)) return;
    if (isDraggingListsRef.current) return; // Never fight an active reorder.
    setCustomLists((prev) => {
      if (fromCache && incoming.length === 0 && prev.length > 0) return prev;
      if (listsSignature(prev) === listsSignature(incoming)) return prev;
      return incoming;
    });
  }, []);

  useEffect(() => {
    const fetchCounts = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      
      const calState = await isCalendarConnected();
      setIsCalendarLinked(calState);

      const state = await Gamification.getState(session.user.id);
      if (state) setLocalGamestate(state);

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
      
      // Server response is authoritative; the cached one must never blank the
      // sidebar while it's still warming up.
      const fetchedLists = await loadLists(session.user.id, (fresh) => applyLists(fresh, false));
      applyLists(fetchedLists, true);

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
      Alert.alert(t('sidebar.calendarSyncedTitle'), t('sidebar.calendarSyncedMessage'));
    } else {
      console.log('[GlassSidebar] Requesting calendar permissions...');
      const granted = await requestCalendarPermissions();
      console.log('[GlassSidebar] Permission granted:', granted);
      
      if (granted) {
        setIsCalendarLinked(true);
        Alert.alert(t('sidebar.connectedTitle'), t('sidebar.connectedMessage'));
      } else {
        // OS didn't show dialog — redirect to Settings
        Alert.alert(
          t('sidebar.permissionRequiredTitle'),
          t('sidebar.permissionRequiredMessage'),
          [
            { text: t('sidebar.cancel'), style: 'cancel' },
            { text: t('sidebar.openSettings'), onPress: () => Linking.openSettings() }
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

  // Which list route is showing, resolved once instead of re-walking the
  // navigation state inside every single row.
  const activeListId = currentRoute === 'CustomList'
    ? navigation.getState()?.routes?.find((r) => r.name === 'CustomList')?.params?.listId
    : null;
  const isInboxActive = activeListId === 'inbox';

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
          {/* ── Identity: avatar and name on one line so the panel starts with
                content instead of a tall block of chrome. ── */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => setIsStatsModalOpen(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.xpAndRewards')}
            >
              <XPAvatarRing
                avatarSource={getAvatarSource()}
                xp={gamestate.xp}
                level={gamestate.level}
                size={46}
                strokeWidth={2.5}
              />
            </TouchableOpacity>

            <View style={styles.profileInfo}>
              <Text style={[styles.displayName, { color: theme.text }]} numberOfLines={1}>
                {profile?.display_name || t('sidebar.loadingName')}
              </Text>
              <Text style={[styles.username, { color: theme.textMuted }]} numberOfLines={1}>
                @{profile?.username || t('sidebar.loadingUsername')}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleOpenUpdates}
              style={styles.headerButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.updatesLabel', { defaultValue: 'Updates' })}
            >
              <Bell color={theme.textMuted} size={19} />
              {hasUnreadUpdate && <View style={styles.headerButtonDot} />}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onClose}
              style={styles.headerButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
            >
              <X color={theme.textMuted} size={19} />
            </TouchableOpacity>
          </View>

          {/* Menu Items */}
          <Animated.View
            style={{
              flex: 1,
              opacity: menuItemsAnim,
              transform: [{
                translateY: menuItemsAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0]
                })
              }]
            }}
          >
            <NestableScrollContainer
              style={styles.menu}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
            >
            <SectionLabel theme={theme}>
              {t('sidebar.groupWorkspace', { defaultValue: 'Workspace' })}
            </SectionLabel>

            <SidebarRow
              icon={Home}
              label={t('sidebar.dashboard')}
              theme={theme}
              active={currentRoute === 'Dashboard'}
              onPress={() => {
                if (currentRoute !== 'Dashboard') navigation.replace('Dashboard');
                else onClose();
              }}
            />

            <SidebarRow
              icon={Inbox}
              label={t('sidebar.inbox')}
              theme={theme}
              active={isInboxActive}
              onPress={() => {
                navigation.replace('CustomList', { listId: 'inbox', listName: t('sidebar.inbox') });
              }}
            />

            <SidebarRow
              icon={LayoutGrid}
              label={t('sidebar.today')}
              theme={theme}
              active={currentRoute === 'Today'}
              count={todayCount}
              showDot={overdueCount > 0}
              onPress={() => {
                if (currentRoute !== 'Today') navigation.replace('Today');
                else onClose();
              }}
            />

            <SidebarRow
              icon={Star}
              label={t('sidebar.starred')}
              theme={theme}
              active={currentRoute === 'Starred'}
              count={starredCount}
              showDot={starredOverdueCount > 0}
              onPress={() => {
                if (currentRoute !== 'Starred') navigation.replace('Starred');
                else onClose();
              }}
            />

            <SidebarRow
              icon={Calendar}
              label={t('sidebar.planned')}
              theme={theme}
              active={currentRoute === 'Planned'}
              count={plannedCount}
              showDot={plannedOverdueCount > 0}
              onPress={() => {
                if (currentRoute !== 'Planned') navigation.replace('Planned');
                else onClose();
              }}
            />

            <SidebarRow
              icon={Heart}
              label={t('sidebar.promises')}
              theme={theme}
              active={currentRoute === 'Promises'}
              onPress={() => {
                if (currentRoute !== 'Promises') navigation.replace('Promises');
                else onClose();
              }}
            />

            <SidebarRow
              icon={Brain}
              label={t('sidebar.mindfulLock')}
              theme={theme}
              active={currentRoute === 'MindfulLock'}
              trailing={(
                <View style={[styles.newDot, { backgroundColor: theme.accent }]} />
              )}
              onPress={async () => {
                if (currentRoute === 'MindfulLock') {
                  onClose();
                  return;
                }
                const { getProfile } = require('../utils/mindfulLock');
                const prof = userId ? await getProfile(userId) : null;
                if (prof?.onboardingComplete) navigation.replace('MindfulLock', { userId });
                else navigation.replace('MindfulLockSetup', { userId });
              }}
            />

            <SectionLabel theme={theme}>
              {t('sidebar.groupLists', { defaultValue: 'Lists' })}
            </SectionLabel>

            {/* Custom Lists — drag rows to keep a permanent sidebar order. */}
            <NestableDraggableFlatList
              data={customLists}
              keyExtractor={(list) => String(list.id)}
              activationDistance={12}
              autoscrollThreshold={48}
              onDragBegin={() => { isDraggingListsRef.current = true; }}
              onDragEnd={({ data }) => {
                // Paint the new order immediately, then persist. The drag flag
                // stays up until persistence finishes so an in-flight refresh
                // can't push the old order back underneath the user.
                setCustomLists(data);
                if (!userId) {
                  isDraggingListsRef.current = false;
                  return;
                }
                reorderLists(userId, data)
                  .then((saved) => {
                    // Adopt the indexed copy directly: applyLists would treat it
                    // as unchanged, and the drag guard is still up here anyway.
                    if (Array.isArray(saved) && saved.length > 0) setCustomLists(saved);
                  })
                  .catch(() => {})
                  .finally(() => { isDraggingListsRef.current = false; });
              }}
              renderItem={({ item: list, drag, isActive }) => (
                <ScaleDecorator>
                  <View style={isActive ? styles.rowDragging : null}>
                    <SidebarRow
                      icon={List}
                      label={list.name}
                      theme={theme}
                      active={activeListId === list.id}
                      count={listCounts[list.id] || 0}
                      showDot={(listOverdueCounts[list.id] || 0) > 0}
                      onPress={() => {
                        navigation.replace('CustomList', { listId: list.id, listName: list.name });
                      }}
                      trailing={(
                        /* The grip is the ONLY drag activator. Row-level long
                           press used to compete with it and with the nested
                           scroll view, which is what produced the jitter. */
                        <TouchableOpacity
                          onPressIn={drag}
                          disabled={isActive}
                          style={styles.listDragHandle}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                          accessibilityRole="button"
                          accessibilityLabel={t('sidebar.reorderList', { defaultValue: 'Reorder list' })}
                        >
                          <GripVertical color={theme.textMuted} size={16} />
                        </TouchableOpacity>
                      )}
                    />
                  </View>
                </ScaleDecorator>
              )}
            />

            {isAddingList ? (
              <View style={[styles.row, { backgroundColor: `${theme.text}0A` }]}>
                <View style={styles.rowRail} />
                <List color={theme.textMuted} size={19} />
                <TextInput
                  style={[styles.rowLabel, { color: theme.text, padding: 0 }]}
                  placeholder={t('sidebar.listNamePlaceholder')}
                  placeholderTextColor={theme.textMuted}
                  autoFocus
                  value={newListName}
                  onChangeText={setNewListName}
                  onSubmitEditing={handleCreateList}
                  returnKeyType="done"
                />
              </View>
            ) : (
              <SidebarRow
                icon={Plus}
                label={t('sidebar.newList')}
                theme={theme}
                onPress={() => setIsAddingList(true)}
              />
            )}

            <SectionLabel theme={theme}>
              {t('sidebar.groupMore', { defaultValue: 'More' })}
            </SectionLabel>

            <SidebarRow
              icon={History}
              label={t('sidebar.history')}
              theme={theme}
              active={currentRoute === 'History'}
              onPress={() => {
                onClose();
                setTimeout(() => {
                  if (currentRoute !== 'History') navigation.replace('History');
                }, 0);
              }}
            />

            <SidebarRow
              icon={Award}
              label={t('sidebar.xpAndRewards')}
              theme={theme}
              onPress={() => setIsGuideModalOpen(true)}
            />

            <SidebarRow
              icon={MessageSquare}
              label={t('sidebar.feedback')}
              theme={theme}
              active={currentRoute === 'Feedback'}
              onPress={() => {
                onClose();
                setTimeout(() => {
                  if (currentRoute !== 'Feedback') navigation.replace('Feedback');
                }, 0);
              }}
            />

            <SidebarRow
              icon={Settings}
              label={t('sidebar.settings')}
              theme={theme}
              active={currentRoute === 'Settings'}
              onPress={() => {
                onClose();
                setTimeout(() => {
                  if (currentRoute !== 'Settings') navigation.replace('Settings');
                }, 0);
              }}
            />

            <View style={styles.menuTailSpace} />
            </NestableScrollContainer>
          </Animated.View>

          {/* ── Footer: sign out, then one condensed credit line ── */}
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <SidebarRow
              icon={LogOut}
              label={t('sidebar.logOut')}
              theme={theme}
              tint="#FB7185"
              onPress={handleLogout}
            />

            <View style={styles.brandRow}>
              <Text style={styles.brandName}>
                <Text style={{ color: theme.textMuted }}>double</Text>
                <Text style={{ color: theme.accent }}>three</Text>
              </Text>
              <Text style={[styles.brandMeta, { color: theme.textMuted }]}>
                {t('sidebar.versionLabel', { version: Constants.expoConfig?.version || Constants.manifest?.version || '1.0.0' })}
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

  // ── Identity ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  profileInfo: { flex: 1 },
  displayName: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '400',
    letterSpacing: -0.2,
  },
  username: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  headerButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FB7185',
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
    marginBottom: 12,
    opacity: 0.7,
  },

  // ── Menu ──
  menu: {
    flex: 1,
    paddingHorizontal: 10,
  },
  menuTailSpace: { height: 12 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    marginTop: 20,
    marginBottom: 8,
  },

  // One row shape for navigation, lists, and sign out.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingRight: 12,
    borderRadius: 10,
    gap: 13,
  },
  // Leading accent bar: the only active-state marker, so nothing needs a
  // heavy filled chip to read as selected.
  rowRail: {
    width: 2,
    height: 18,
    borderRadius: 1,
    marginLeft: 2,
    backgroundColor: 'transparent',
  },
  rowLabel: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  rowLabelActive: { fontWeight: '500' },
  rowCount: { fontSize: 12, fontWeight: '400' },
  rowDragging: {
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  listDragHandle: {
    width: 26,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FB7185',
  },
  newDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },

  // ── Footer ──
  brandRow: { alignItems: 'center', marginTop: 14 },
  brandName: { fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },
  brandMeta: { fontSize: 9.5, fontWeight: '400', letterSpacing: 0.4, marginTop: 3 },
  footer: {
    padding: 20,
    borderTopWidth: 1,
  },
});

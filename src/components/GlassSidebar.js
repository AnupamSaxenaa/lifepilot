import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import {
    Award,
    Bell,
    Brain,
    Calendar,
    ChevronRight,
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
    Users,
    X
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Easing, InteractionManager, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, useColorScheme, useWindowDimensions, View } from 'react-native';
import { NestableDraggableFlatList, NestableScrollContainer, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { loadCollaboration } from '../lib/collaborationManager';
import { addList, getCurrentUserId, loadLists, reorderLists, signOutCurrentUser } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { getSyncState } from '../lib/syncQueue';
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
import { AvatarStack, SyncStatusStrip } from './collaboration';

const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_GUTTER = 24;

const getSidebarWidth = (windowWidth) => {
  const safeWidth = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 360;
  const availableWidth = Math.max(0, safeWidth - SIDEBAR_GUTTER);
  const minimum = Math.min(MIN_SIDEBAR_WIDTH, availableWidth);
  const maximum = Math.min(MAX_SIDEBAR_WIDTH, availableWidth);
  return Math.max(minimum, Math.min(maximum, safeWidth * 0.78));
};

const EMPTY_COLLABORATION = Object.freeze({ spaces: [], members: {}, inbox: [] });
const hasSpace = (list) => list?.space_id != null && String(list.space_id).length > 0;
const normalizedId = (value) => (value == null ? null : String(value));
const normalizedMemberMap = (members) => Object.entries(
  members && typeof members === 'object' && !Array.isArray(members) ? members : {},
).reduce((result, [spaceId, rows]) => {
  result[String(spaceId)] = Array.isArray(rows) ? rows : [];
  return result;
}, {});

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

/** Identity of a list collection: ids, names, ownership, and order. Used to
 * skip no-op state updates that would otherwise re-render every draggable row. */
const listsSignature = (lists) => (Array.isArray(lists)
  ? lists.map((list) => `${normalizedId(list?.id)}:${normalizedId(list?.space_id) || ''}:${list?.name}`).join('|')
  : '');

const mergeListsById = (base, additions) => {
  const merged = new Map((Array.isArray(base) ? base : []).map((list) => [normalizedId(list?.id), list]));
  (Array.isArray(additions) ? additions : []).forEach((list) => {
    if (list?.id != null) merged.set(normalizedId(list.id), list);
  });
  return [...merged.values()];
};

/** Small tracked caption that replaces bare dividers as the grouping cue. */
const SectionLabel = ({ children, theme, trailing = null }) => (
  trailing ? (
    <View style={styles.sectionLabelRow}>
      <Text style={[styles.sectionLabel, styles.sectionLabelInline, { color: theme.textMuted }]}>
        {children}
      </Text>
      {trailing}
    </View>
  ) : (
    <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{children}</Text>
  )
);

/** Case/whitespace-insensitive name comparison. */
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Members / role / sync metadata for a shared list.
 *
 * Pulled out of SharedSpaceHeader so it can also be attached directly to a list
 * row in the collapsed case below, where there is no separate header to hang it on.
 */
const SharedRowMeta = ({ members = [], role, pending, theme }) => (
  <View style={styles.sharedRowMeta}>
    {members.length > 0 ? <AvatarStack members={members} size={16} max={3} /> : null}
    {role ? (
      <View style={[styles.rolePill, { borderColor: `${theme.textMuted}44` }]}>
        <Text style={[styles.rolePillText, { color: theme.textMuted }]}>
          {String(role).toUpperCase()}
        </Text>
      </View>
    ) : null}
    {pending ? (
      <View style={[styles.rolePill, { borderColor: `${theme.textMuted}44` }]}>
        <Text style={[styles.rolePillText, { color: theme.textMuted }]}>PENDING</Text>
      </View>
    ) : null}
  </View>
);

/**
 * Group header for a shared space that contains more than one list, or whose
 * name differs from its single list.
 *
 * Previously this rendered unconditionally with paddingLeft:32 — deeper than the
 * list rows beneath it — so the parent appeared nested inside its own children.
 * A space created alongside one list also shares that list's name, which made the
 * sidebar read as the same list printed twice: once with an OWNER badge, once
 * with a task count. It now sits shallower than its rows, and is skipped entirely
 * when it would only restate the row below it.
 */
const SharedSpaceHeader = ({ space, members, role, pending, theme }) => (
  <View style={styles.sharedSpaceHeader}>
    <Text style={[styles.sharedSpaceName, { color: theme.textMuted }]} numberOfLines={1}>
      {space?.name || 'Shared space'}
    </Text>
    <SharedRowMeta members={members} role={role} pending={pending} theme={theme} />
  </View>
);

// memo: the sidebar lives OUTSIDE each screen's ScrollView, so without this
// every parent state change (each keystroke in an add-task field, each task
// toggle) re-rendered this entire tree on all 11 hosting screens.
export const GlassSidebar = memo(function GlassSidebar({ isOpen, onClose, profile, navigation, currentRoute, gamestate: parentGamestate }) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  // Forces a re-render whenever the equipped accent/theme changes — COLORS is
  // mutated in place by ThemeContext, so this subscription is required.
  useAppTheme().themeVersion;
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const sidebarWidth = useMemo(() => getSidebarWidth(windowWidth), [windowWidth]);
  const sidebarWidthRef = useRef(sidebarWidth);
  const isOpenRef = useRef(isOpen);
  const signingOutRef = useRef(false);
  const handleSafeLogout = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    onClose();
    try {
      // Wait for the old local session and memory identity to be gone before
      // exposing Login; otherwise its late SIGNED_OUT event can erase the next
      // account or leave screens pointed at the previous user's cache.
      await signOutCurrentUser();
      navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
    } catch (error) {
      signingOutRef.current = false;
      Alert.alert(
        t('common.error', { defaultValue: 'Could not sign out' }),
        error?.message || t('common.tryAgain', { defaultValue: 'Please try again.' }),
      );
    }
  }, [navigation, onClose, t]);
  // Mount the heavy panel body only after the first open. Before that the tree
  // (16 rows, two nested lists, three modals, two SVG rings) was reconciled on
  // every parent state change on all 11 screens that host the sidebar.
  const [hasOpened, setHasOpened] = useState(isOpen);
  // Rasterizing is a win DURING motion and a cost at rest, because a cached
  // texture must be re-uploaded whenever the contents change.
  const [isAnimating, setIsAnimating] = useState(false);
  // Remote refresh waits for this, set from the animation's completion callback.
  const [readyToRefresh, setReadyToRefresh] = useState(false);
  const [slideAnim] = useState(() => new Animated.Value(-sidebarWidth));
  const [fadeAnim] = useState(() => new Animated.Value(0));

  const [sidebarCounts, setSidebarCounts] = useState({
    todayCount: 0,
    starredCount: 0,
    plannedCount: 0,
    overdueCount: 0,
    starredOverdueCount: 0,
    plannedOverdueCount: 0,
    listCounts: {},
    listOverdueCounts: {},
  });
  const {
    todayCount,
    starredCount,
    plannedCount,
    overdueCount,
    starredOverdueCount,
    plannedOverdueCount,
    listCounts,
    listOverdueCounts,
  } = sidebarCounts;
  const [isCalendarLinked, setIsCalendarLinked] = useState(false);
  const [userId, setUserId] = useState(null);
  const [customLists, setCustomLists] = useState([]);
  const [collaboration, setCollaboration] = useState(EMPTY_COLLABORATION);
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
  const openStats = useCallback(async () => {
    setIsStatsModalOpen(true);
    if (parentGamestate || !userId) return;
    const latest = await Gamification.getState(userId);
    if (latest) setLocalGamestate(latest);
  }, [parentGamestate, userId]);

  /**
   * Keep the last painted cache while a new cache-first read warms up. Fresh
   * loadLists results remain authoritative for both personal and shared rows.
   */
  const applyLists = useCallback((incoming, fromCache) => {
    if (!Array.isArray(incoming)) return;
    if (isDraggingListsRef.current) return;
    setCustomLists((prev) => {
      if (fromCache && incoming.length === 0 && prev.length > 0) return prev;
      const incomingPersonal = incoming.filter((list) => !hasSpace(list));
      const incomingShared = incoming.filter(hasSpace);
      const previousPersonal = prev.filter((list) => !hasSpace(list));
      const previousShared = prev.filter(hasSpace);
      const nextPersonal = fromCache && incomingPersonal.length === 0 && previousPersonal.length > 0
        ? previousPersonal
        : incomingPersonal;
      const nextShared = fromCache
        ? mergeListsById(previousShared, incomingShared)
        : incomingShared;
      const next = [...nextPersonal, ...nextShared];
      if (listsSignature(prev) === listsSignature(next)) return prev;
      return next;
    });
  }, []);

  const applyCollaboration = useCallback((incoming, authoritative = false) => {
    if (!incoming || typeof incoming !== 'object') return;
    const incomingSpaces = Array.isArray(incoming.spaces) ? incoming.spaces : [];
    const incomingMembers = normalizedMemberMap(incoming.members);
    const incomingInbox = Array.isArray(incoming.inbox) ? incoming.inbox : [];

    setCollaboration((previous) => {
      const keepSpaces = !authoritative && incomingSpaces.length === 0 && previous.spaces.length > 0;
      const keepMembers = !authoritative
        && Object.keys(incomingMembers).length === 0
        && Object.keys(previous.members).length > 0;
      const keepInbox = !authoritative && incomingInbox.length === 0 && previous.inbox.length > 0;
      return {
        spaces: keepSpaces ? previous.spaces : incomingSpaces,
        members: keepMembers ? previous.members : (authoritative
          ? incomingMembers
          : { ...previous.members, ...incomingMembers }),
        inbox: keepInbox ? previous.inbox : incomingInbox,
      };
    });
  }, []);

  const personalLists = useMemo(() => customLists.filter((list) => !hasSpace(list)), [customLists]);
  const sharedGroups = useMemo(() => {
    const sharedLists = customLists.filter(hasSpace);
    const spacesById = new Map((collaboration.spaces || []).map((space) => [normalizedId(space?.id), space]));
    const grouped = new Map();
    sharedLists.forEach((list) => {
      const spaceId = normalizedId(list.space_id);
      if (!grouped.has(spaceId)) grouped.set(spaceId, []);
      grouped.get(spaceId).push(list);
    });
    return [...grouped.entries()].map(([spaceId, lists]) => ({
      spaceId,
      space: spacesById.get(spaceId) || { id: spaceId, name: 'Shared space' },
      lists,
      members: Array.isArray(collaboration.members?.[spaceId]) ? collaboration.members[spaceId] : [],
    }));
  }, [collaboration.members, collaboration.spaces, customLists]);
  const collaborationUnreadCount = useMemo(
    () => (collaboration.inbox || []).filter((notification) => notification?.read_at == null).length,
    [collaboration.inbox],
  );

  const calculateSidebarCounts = useCallback((cachedTasks) => {
    const activeTasks = (Array.isArray(cachedTasks) ? cachedTasks : []).filter((task) => !task.is_completed);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayString = todayStart.toDateString();
    const next = {
      todayCount: 0,
      starredCount: 0,
      plannedCount: 0,
      overdueCount: 0,
      starredOverdueCount: 0,
      plannedOverdueCount: 0,
      listCounts: {},
      listOverdueCounts: {},
    };

    activeTasks.forEach((task) => {
      const dueDate = task.due_date ? new Date(task.due_date) : null;
      if (dueDate) dueDate.setHours(0, 0, 0, 0);
      const reminderDate = task.reminder_time ? new Date(task.reminder_time) : null;
      const overdue = Boolean(dueDate && dueDate < todayStart);
      const today = Boolean(
        task.added_to_today
        || (dueDate && (overdue || dueDate.toDateString() === todayString))
        || (reminderDate && (reminderDate < todayStart || reminderDate.toDateString() === todayString))
        || (!task.list_id && !task.due_date && !task.reminder_time),
      );

      if (today) next.todayCount += 1;
      if (task.is_important) next.starredCount += 1;
      if (task.due_date) next.plannedCount += 1;
      if (overdue) {
        next.overdueCount += 1;
        next.plannedOverdueCount += 1;
        if (task.is_important) next.starredOverdueCount += 1;
      }

      const listId = normalizedId(task.list_id);
      if (listId != null) {
        next.listCounts[listId] = (next.listCounts[listId] || 0) + 1;
        if (overdue) next.listOverdueCounts[listId] = (next.listOverdueCounts[listId] || 0) + 1;
      }
    });
    setSidebarCounts(next);
  }, []);

  // Width changes only. `isOpen` must NOT be a dependency here: layout effects
  // run BEFORE passive effects, so on the render where isOpen flips to false
  // this snapped translateX to -width, and the close animation then ran from
  // -width to -width — a 220ms no-op. The panel teleported away while the
  // backdrop kept fading, which is exactly what read as "closing isn't smooth".
  useLayoutEffect(() => {
    const previousWidth = sidebarWidthRef.current;
    sidebarWidthRef.current = sidebarWidth;
    if (!isOpenRef.current && previousWidth !== sidebarWidth) {
      slideAnim.setValue(-sidebarWidth);
    }
  }, [sidebarWidth, slideAnim]);

  // Warm the sidebar exclusively from local storage when it mounts. Opening it
  // later therefore has no auth refresh, network request, or count state storm
  // competing with the native slide animation.
  useEffect(() => {
    let active = true;
    (async () => {
      const currentUserId = profile?.id || await getCurrentUserId();
      if (!active || !currentUserId) return;
      setUserId(currentUserId);
      const [cachedLists, cachedCollaboration, calendarState, gameState, cachedTasks] = await Promise.all([
        loadLists(currentUserId, null, { refresh: false }),
        loadCollaboration(currentUserId, null, { refresh: false }),
        isCalendarConnected(),
        Gamification.getState(currentUserId),
        Storage.get(`tasks_${currentUserId}`),
      ]);
      if (!active) return;
      applyLists(cachedLists, true);
      applyCollaboration(cachedCollaboration, false);
      setIsCalendarLinked(calendarState);
      if (gameState) setLocalGamestate(gameState);
      calculateSidebarCounts(cachedTasks);
    })().catch(() => {});
    return () => { active = false; };
  }, [applyCollaboration, applyLists, calculateSidebarCounts, profile?.id]);

  // Keep motion to one composited transform plus the backdrop. Animating every
  // menu child made the panel feel as if it settled twice after each gesture.
  useEffect(() => {
    slideAnim.stopAnimation();
    fadeAnim.stopAnimation();

    const opening = isOpen;
    const animation = Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: opening ? 0 : -sidebarWidthRef.current,
        duration: opening ? 260 : 220,
        easing: opening ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: opening ? 1 : 0,
        duration: opening ? 220 : 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    const raf = requestAnimationFrame(() => setIsAnimating(true));
    animation.start(({ finished }) => {
      cancelAnimationFrame(raf);
      setIsAnimating(false);
      // Native-driven timings create no InteractionManager handle, so
      // runAfterInteractions used to resolve on frame 1 of the slide and ran
      // storage reads, two data loads and a Supabase query mid-animation.
      // Keying the refresh off the real completion callback is what actually
      // keeps the JS thread free while the panel moves.
      if (finished && opening) setReadyToRefresh(true);
    });
    return () => {
      cancelAnimationFrame(raf);
      animation.stop();
    };
  }, [fadeAnim, isOpen, slideAnim]);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) {
      const id = requestAnimationFrame(() => setReadyToRefresh(false));
      return () => cancelAnimationFrame(id);
    }
    if (hasOpened) return undefined;
    const id = requestAnimationFrame(() => setHasOpened(true));
    return () => cancelAnimationFrame(id);
  }, [hasOpened, isOpen]);

  // Refresh remote/sidebar metadata only after the opening interaction has
  // completed. Cache remains visible if any request fails or the app is offline.
  useEffect(() => {
    if (!readyToRefresh || !userId) return undefined;
    let active = true;
    const interaction = InteractionManager.runAfterInteractions(() => {
      Promise.all([
        loadLists(userId, (fresh) => active && applyLists(fresh, false)),
        loadCollaboration(userId, (fresh) => active && applyCollaboration(fresh, true)),
        Storage.get(`tasks_${userId}`).then((tasks) => {
          if (active) calculateSidebarCounts(tasks);
        }),
      ]).catch(() => {});

      (async () => {
        if (!getSyncState().online) return;
        try {
          const { data: updateData } = await supabase
            .from('app_updates')
            .select('*')
            .eq('is_published', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (!active || !updateData) return;
          setLatestUpdate(updateData);
          const lastReadId = await Storage.get('last_read_update_id');
          if (active) setHasUnreadUpdate(normalizedId(lastReadId) !== normalizedId(updateData.id));
        } catch {
          // Update metadata is optional and never blocks the cached sidebar.
        }
      })();
    });
    return () => {
      active = false;
      interaction.cancel?.();
    };
  }, [applyCollaboration, applyLists, calculateSidebarCounts, readyToRefresh, userId]);

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
    const currentUserId = userId || await getCurrentUserId();
    if (currentUserId) {
      const sharedLists = customLists.filter(hasSpace);
      const updatedPersonalLists = await addList(currentUserId, personalLists, newListName.trim());
      const mergedLists = [...updatedPersonalLists, ...sharedLists];
      // addList correctly mutates only personal rows; restore shared cache rows
      // that its legacy cache writer does not yet know how to merge.
      await Storage.set(`lists_${currentUserId}`, mergedLists);
      setCustomLists(mergedLists);
    }
    setNewListName('');
    setIsAddingList(false);
  };

  const avatarUrl = profile?.avatar_url;
  const avatarSeed = profile?.avatar_seed || profile?.username || 'fallback';
  const avatarSource = useMemo(() => ({
    uri: avatarUrl || `https://api.dicebear.com/7.x/adventurer/png?seed=${avatarSeed}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
  }), [avatarSeed, avatarUrl]);

  // Which list route is showing, resolved once instead of re-walking the
  // navigation state inside every single row.
  const customListRoute = currentRoute === 'CustomList'
    ? [...(navigation.getState()?.routes || [])].reverse().find((route) => route.name === 'CustomList')
    : null;
  const activeListId = normalizedId(customListRoute?.params?.listId);
  const activeSpaceId = normalizedId(customListRoute?.params?.spaceId);
  const isInboxActive = activeListId === 'inbox';

  const handleOpenCollaborationInbox = () => {
    onClose?.();
    navigation.navigate('CollaborationInbox');
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
        renderToHardwareTextureAndroid={isAnimating}
        shouldRasterizeIOS={isAnimating}
        style={[
          styles.sidebar, 
          { 
            width: sidebarWidth,
            backgroundColor: colorScheme === 'dark' ? '#000000' : 'rgba(255, 255, 255, 0.75)',
            borderColor: theme.border,
            transform: [{ translateX: slideAnim }] 
          }
        ]}
      >
        {Platform.OS !== 'android' ? (
           <BlurView intensity={colorScheme === 'dark' ? 60 : 80} tint={colorScheme} style={StyleSheet.absoluteFill} />
        ) : null}
        
        {hasOpened ? (
        <View style={[styles.content, { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={styles.header}>
            <View style={styles.headerTopLine}>
              <View>
                <Text style={[styles.brandEyebrow, { color: theme.text }]}>LIFEPILOT</Text>
                <Text style={[styles.brandCaption, { color: theme.textMuted }]}>YOUR COMMAND CENTER</Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  onPress={handleOpenUpdates}
                  style={styles.headerButton}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('sidebar.updatesLabel', { defaultValue: 'Updates' })}
                >
                  <Bell color={theme.textMuted} size={18} />
                  {hasUnreadUpdate && <View style={styles.headerButtonDot} />}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.headerButton}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
                >
                  <X color={theme.textMuted} size={18} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              onPress={openStats}
              activeOpacity={0.72}
              style={[
                styles.profileCard,
                { borderColor: theme.border, backgroundColor: `${theme.text}07` },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.xpAndRewards')}
              accessibilityHint={t('sidebar.profileProgressHint', { defaultValue: 'Opens your XP, streak calendar, and rewards' })}
            >
              <XPAvatarRing
                avatarSource={avatarSource}
                xp={gamestate.xp}
                level={gamestate.level}
                size={50}
                strokeWidth={2.4}
              />
              <View style={styles.profileInfo}>
                <Text style={[styles.displayName, { color: theme.text }]} numberOfLines={1}>
                  {profile?.display_name || t('sidebar.loadingName')}
                </Text>
                <Text style={[styles.username, { color: theme.textMuted }]} numberOfLines={1}>
                  @{profile?.username || t('sidebar.loadingUsername')}
                </Text>
              </View>
              <View style={styles.profileMeta}>
                <Text style={[styles.profileMetaPrimary, { color: theme.text }]}>LVL {gamestate.level || 1}</Text>
                <Text style={[styles.profileMetaSecondary, { color: theme.textMuted }]}>{gamestate.streak || 0} DAY</Text>
              </View>
              <ChevronRight color={theme.textMuted} size={17} />
            </TouchableOpacity>
          </View>

          {/* Menu Items */}
          <View style={styles.menuBody}>
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
                navigation.replace('CustomList', {
                  listId: 'inbox',
                  listName: t('sidebar.inbox'),
                  spaceId: null,
                });
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
              {t('sidebar.groupPersonalLists', { defaultValue: 'Personal lists' })}
            </SectionLabel>

            {/* Only personal lists can enter the drag/reorder mutation path. */}
            <NestableDraggableFlatList
              data={personalLists}
              keyExtractor={(list) => String(list.id)}
              activationDistance={12}
              autoscrollThreshold={48}
              onDragBegin={() => { isDraggingListsRef.current = true; }}
              onDragEnd={({ data }) => {
                const sharedLists = customLists.filter(hasSpace);
                setCustomLists([...data, ...sharedLists]);
                if (!userId) {
                  isDraggingListsRef.current = false;
                  return;
                }
                reorderLists(userId, data)
                  .then(async (saved) => {
                    const orderedPersonal = Array.isArray(saved) && saved.length > 0 ? saved : data;
                    const mergedLists = [...orderedPersonal, ...sharedLists];
                    // The personal data manager owns ordering; retain shared
                    // collaboration rows in its legacy all-lists cache.
                    await Storage.set(`lists_${userId}`, mergedLists);
                    setCustomLists(mergedLists);
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
                      active={activeListId === normalizedId(list.id) && activeSpaceId == null}
                      count={listCounts[normalizedId(list.id)] || 0}
                      showDot={(listOverdueCounts[normalizedId(list.id)] || 0) > 0}
                      onPress={() => {
                        navigation.replace('CustomList', {
                          listId: list.id,
                          listName: list.name,
                          spaceId: null,
                        });
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

            {/* Sync state rides on the section label instead of sitting in its
                own block between the inbox row and the first space. As a loose
                centred strip it read as an unexplained "Synced" line belonging to
                nothing in particular. */}
            <SectionLabel theme={theme} trailing={<SyncStatusStrip compact />}>
              {t('sidebar.groupShared', { defaultValue: 'Shared' })}
            </SectionLabel>

            <SidebarRow
              icon={Users}
              label={t('sidebar.collaborationInbox', { defaultValue: 'Collaboration Inbox' })}
              theme={theme}
              active={currentRoute === 'CollaborationInbox'}
              count={collaborationUnreadCount}
              onPress={handleOpenCollaborationInbox}
            />

            {sharedGroups.map((group) => {
              const currentMember = group.members.find(
                (member) => normalizedId(member?.user_id) === normalizedId(userId),
              );
              const pending = group.space?._sync_status === 'pending'
                || group.lists.some((list) => list?._sync_status === 'pending');

              // A space created together with its first list inherits that list's
              // name, so a header here would print the same words as the row
              // directly beneath it — the duplication that made this section look
              // broken. In that case drop the header and move its members and role
              // badge onto the list row itself, so nothing is lost.
              const onlyList = group.lists.length === 1 ? group.lists[0] : null;
              const headerIsRedundant = !!onlyList && sameName(group.space?.name, onlyList.name);

              return (
                <View key={group.spaceId} style={styles.sharedGroup}>
                  {headerIsRedundant ? null : (
                    <SharedSpaceHeader
                      space={group.space}
                      members={group.members}
                      role={currentMember?.role}
                      pending={pending}
                      theme={theme}
                    />
                  )}
                  {group.lists.map((list) => (
                    <SidebarRow
                      key={normalizedId(list.id)}
                      icon={List}
                      label={list.name}
                      theme={theme}
                      active={activeListId === normalizedId(list.id)
                        && activeSpaceId === normalizedId(group.spaceId)}
                      count={listCounts[normalizedId(list.id)] || 0}
                      showDot={(listOverdueCounts[normalizedId(list.id)] || 0) > 0}
                      trailing={headerIsRedundant ? (
                        <SharedRowMeta
                          members={group.members}
                          role={currentMember?.role}
                          pending={pending}
                          theme={theme}
                        />
                      ) : (list?._sync_status === 'pending' ? (
                        <View style={[styles.rolePill, { borderColor: `${theme.textMuted}44` }]}>
                          <Text style={[styles.rolePillText, { color: theme.textMuted }]}>PENDING</Text>
                        </View>
                      ) : null)}
                      onPress={() => {
                        navigation.replace('CustomList', {
                          listId: list.id,
                          listName: list.name,
                          spaceId: group.spaceId,
                        });
                      }}
                    />
                  ))}
                </View>
              );
            })}

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
          </View>

          {/* ── Footer: sign out, then one condensed credit line ── */}
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <SidebarRow
              icon={LogOut}
              label={t('sidebar.logOut')}
              theme={theme}
              tint="#FB7185"
              onPress={handleSafeLogout}
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
        ) : null}
      </Animated.View>

      {hasOpened ? (
      <>
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
      </>
      ) : null}
    </View>
  );
});

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
    borderRightWidth: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },

  // ── Identity ──
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTopLine: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  brandEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 2.1,
  },
  brandCaption: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '500',
    letterSpacing: 1.2,
    marginTop: 1,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  profileCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 11,
  },
  profileInfo: { flex: 1, minWidth: 0 },
  displayName: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.25,
  },
  username: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '400',
    marginTop: 1,
  },
  profileMeta: { alignItems: 'flex-end', marginLeft: 2 },
  profileMetaPrimary: { fontSize: 9.5, fontWeight: '600', letterSpacing: 0.8 },
  profileMetaSecondary: { fontSize: 8.5, fontWeight: '500', letterSpacing: 0.65, marginTop: 3 },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonDot: {
    position: 'absolute',
    top: 5,
    right: 5,
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
  menuBody: { flex: 1 },
  menu: {
    flex: 1,
    paddingHorizontal: 12,
  },
  menuTailSpace: { height: 14 },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.45,
    textTransform: 'uppercase',
    paddingHorizontal: 11,
    marginTop: 18,
    marginBottom: 7,
  },

  // A quiet 46pt navigation rhythm: icon, title, metadata, no bulky cards.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingRight: 11,
    borderRadius: 13,
    gap: 12,
  },
  rowRail: {
    width: 2,
    height: 17,
    borderRadius: 1,
    marginLeft: 1,
    backgroundColor: 'transparent',
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '400',
    letterSpacing: -0.12,
  },
  rowLabelActive: { fontWeight: '500' },
  rowCount: { fontSize: 11, fontWeight: '500', minWidth: 18, textAlign: 'right' },
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
  // Groups get a little breathing room so two shared spaces cannot visually run
  // together into one long undifferentiated list.
  sharedGroup: {
    marginBottom: 2,
  },
  sharedSpaceHeader: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    // 13, not 32: a header must not be indented deeper than the rows it
    // contains, which previously made the space look nested inside its own list.
    paddingLeft: 13,
    paddingRight: 12,
    gap: 7,
  },
  sharedSpaceName: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    opacity: 0.75,
  },
  sharedRowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // A bordered pill instead of bare 8.5pt text: at that size the old label read
  // as a stray word next to the name rather than a status badge.
  rolePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rolePillText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 11,
    // Mirrors the standalone sectionLabel spacing, which the inline variant
    // zeroes out so the label and its trailing status sit on one baseline.
    marginTop: 18,
    marginBottom: 7,
  },
  sectionLabelInline: {
    marginTop: 0,
    marginBottom: 0,
    flexShrink: 1,
  },

  // ── Footer ──
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, marginTop: 8 },
  brandName: { fontSize: 11, fontWeight: '500', letterSpacing: 0.2 },
  brandMeta: { fontSize: 9, fontWeight: '400', letterSpacing: 0.35 },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

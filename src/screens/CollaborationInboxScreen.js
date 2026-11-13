import { useFocusEffect } from '@react-navigation/native';
import {
    AlertTriangle,
    ArrowLeft,
    Bell,
    ChevronRight,
    ListChecks,
    RefreshCw,
    UserPlus,
} from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
    RefreshControl,
    SectionList,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConflictSheet, SyncStatusStrip } from '../components/collaboration';
import { useTheme } from '../context/ThemeContext';
import * as Collaboration from '../lib/collaborationManager';
import { getCurrentUserId } from '../lib/dataManager';

const payloadFor = (notification) => (
  notification?.payload && typeof notification.payload === 'object' ? notification.payload : {}
);

const notificationTitle = (notification) => {
  const payload = payloadFor(notification);
  if (payload.title) return payload.title;
  const labels = {
    'invite.created': 'You’ve been invited',
    'invite.revoked': 'Invitation withdrawn',
    'list.linked': 'A list was shared',
    'list.created': 'New shared list',
    'list.updated': 'Shared list updated',
    'task.created': 'New shared task',
    'task.updated': 'Shared task updated',
    'task.deleted': 'Shared task deleted',
    'comment.created': 'New task comment',
    'comment.updated': 'Task comment updated',
    'comment.mentioned': 'You were mentioned',
    'member.joined': 'A member joined',
    'member.removed': 'Membership updated',
    'member.role_changed': 'Collaboration role changed',
  };
  return labels[notification?.kind] || 'Collaboration update';
};

const notificationMessage = (notification) => {
  const payload = payloadFor(notification);
  return payload.message || payload.body || payload.list_name || payload.task_title
    || payload.name || 'Open to view the latest shared activity.';
};

const relativeDate = (value) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  const elapsed = Math.max(0, Date.now() - date.getTime());
  if (elapsed < 60000) return 'Now';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const replaceNotification = (items, updated) => items.map((item) => (
  String(item.id) === String(updated.id) ? updated : item
));

export const CollaborationInboxScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { theme } = useTheme();
  const mounted = useRef(true);
  const [userId, setUserId] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [resolved, setResolved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [message, setMessage] = useState('');
  const [conflictsVisible, setConflictsVisible] = useState(false);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const canMarkOne = typeof Collaboration.markNotificationRead === 'function';
  const canMarkAll = typeof Collaboration.markAllNotificationsRead === 'function';

  const load = useCallback(async () => {
    const authenticatedUserId = await getCurrentUserId();
    if (!mounted.current) return;
    if (!authenticatedUserId) {
      navigation.replace('Login', { returnTo: 'CollaborationInbox' });
      return;
    }
    setUserId(authenticatedUserId);
    // loadInbox returns local cache first and owns the silent background refresh.
    const cached = await Collaboration.loadInbox(authenticatedUserId, (fresh) => {
      if (mounted.current) setNotifications(fresh || []);
    });
    if (mounted.current) {
      setNotifications(cached || []);
      setResolved(true);
    }
  }, [navigation]);

  useFocusEffect(useCallback(() => {
    mounted.current = true;
    load().catch(() => {
      if (mounted.current) {
        setResolved(true);
        setMessage('Your saved inbox could not be opened.');
      }
    });
    return () => { mounted.current = false; };
  }, [load]));

  const refresh = useCallback(async () => {
    if (!userId || refreshing) return;
    setRefreshing(true);
    setMessage('');
    try {
      const result = await Collaboration.refreshInbox(userId);
      if (mounted.current && result?.ok) setNotifications(result.data || []);
      if (mounted.current && !result?.ok) setMessage('Couldn’t refresh. Showing saved activity.');
    } catch (_error) {
      if (mounted.current) setMessage('Couldn’t refresh. Showing saved activity.');
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [refreshing, userId]);

  const refreshWorkspace = useCallback(async () => {
    if (!userId) return;
    const fresh = await Collaboration.refreshCollaboration(userId);
    if (mounted.current && fresh?.inbox) setNotifications(fresh.inbox);
  }, [userId]);

  const markOneRead = useCallback(async (notification) => {
    if (notification.read_at || !userId || !canMarkOne) return;
    try {
      const updated = await Collaboration.markNotificationRead(userId, notification);
      if (mounted.current && updated) {
        setNotifications((current) => replaceNotification(current, updated));
      }
    } catch (_error) {
      if (mounted.current) setMessage('This activity could not be marked as read.');
    }
  }, [canMarkOne, userId]);

  const markAllRead = useCallback(async () => {
    if (!userId || !canMarkAll || markingAll) return;
    setMarkingAll(true);
    setMessage('');
    try {
      const updated = await Collaboration.markAllNotificationsRead(userId);
      if (mounted.current) setNotifications(updated || []);
    } catch (_error) {
      if (mounted.current) setMessage('Activities could not be marked as read.');
    } finally {
      if (mounted.current) setMarkingAll(false);
    }
  }, [canMarkAll, markingAll, userId]);

  const openNotification = useCallback(async (notification) => {
    await markOneRead(notification);
    const payload = payloadFor(notification);
    const entityType = payload.entity_type || notification.entity_type;
    const entityId = payload.entity_id || notification.entity_id;
    const taskId = payload.task_id || notification.task_id
      || (entityType === 'task' ? entityId : null);
    const listId = payload.list_id || notification.list_id
      || (entityType === 'list' ? entityId : null);
    const spaceId = notification.space_id || payload.space_id;

    if (taskId) {
      navigation.navigate('TaskDetail', { taskId, userId, spaceId });
      return;
    }
    if (listId) {
      navigation.navigate('CustomList', {
        listId,
        listName: payload.list_name || payload.name || 'Shared list',
        userId,
        spaceId,
      });
      return;
    }
    navigation.navigate('Dashboard');
  }, [markOneRead, navigation, userId]);

  const sections = useMemo(() => {
    const sorted = [...notifications].sort((a, b) => (
      new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime()
    ));
    const unread = sorted.filter((item) => !item.read_at);
    const recent = sorted.filter((item) => item.read_at);
    return [
      unread.length ? { title: 'Unread', data: unread } : null,
      recent.length ? { title: 'Recent activity', data: recent } : null,
    ].filter(Boolean);
  }, [notifications]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read_at).length,
    [notifications],
  );

  const renderItem = useCallback(({ item }) => {
    const unread = !item.read_at;
    const payload = payloadFor(item);
    const entityType = payload.entity_type || item.entity_type;
    const Icon = item.kind?.startsWith('invite.')
      ? UserPlus
      : entityType === 'list'
        ? ListChecks
        : Bell;
    return (
      <TouchableOpacity
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${notificationTitle(item)}. ${notificationMessage(item)}`}
        accessibilityHint="Opens the related shared item"
        accessibilityRole="button"
        activeOpacity={0.78}
        onPress={() => openNotification(item)}
        style={[styles.row, unread && styles.unreadRow]}
      >
        <View style={[styles.rowIcon, unread && styles.unreadIcon]}>
          <Icon color={unread ? theme.accent : theme.muted} size={19} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.rowTitle, unread && styles.unreadTitle]}>
              {notificationTitle(item)}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.time}>{relativeDate(item.created_at)}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.5} numberOfLines={2} style={styles.rowMessage}>{notificationMessage(item)}</Text>
        </View>
        {unread ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.unreadDot} /> : null}
        <ChevronRight color={theme.muted} size={17} />
      </TouchableOpacity>
    );
  }, [openNotification, styles, theme.accent, theme.muted]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Dashboard'))}
          style={styles.headerButton}
        >
          <ArrowLeft color={theme.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={styles.title}>Collaboration inbox</Text>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.5} style={styles.subtitle}>{unreadCount} unread</Text>
        </View>
        <TouchableOpacity accessibilityLabel="Refresh notifications" accessibilityRole="button" disabled={refreshing} hitSlop={10} onPress={refresh} style={styles.headerButton}>
          <RefreshCw color={refreshing ? theme.muted : theme.text} size={20} />
        </TouchableOpacity>
      </View>

      <View style={[styles.content, { maxWidth: Math.min(720, width) }]}>
        <TouchableOpacity accessibilityHint="Opens conflict details" accessibilityLabel="Collaboration sync status" accessibilityRole="button" activeOpacity={0.8} onPress={() => setConflictsVisible(true)} style={styles.syncWrap}>
          <SyncStatusStrip />
        </TouchableOpacity>

        <View style={styles.actionsRow}>
          <TouchableOpacity accessibilityRole="button" disabled={!unreadCount || markingAll || !canMarkAll} onPress={markAllRead} style={styles.textButton}>
            <Text maxFontSizeMultiplier={1.5} style={[styles.textButtonLabel, (!unreadCount || !canMarkAll) && styles.disabledText]}>
              {markingAll ? 'Marking read…' : 'Mark all as read'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setConflictsVisible(true)} style={styles.conflictButton}>
            <AlertTriangle color={theme.muted} size={15} />
            <Text maxFontSizeMultiplier={1.5} style={styles.conflictButtonText}>Conflicts</Text>
          </TouchableOpacity>
        </View>

        {message ? <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.6} style={styles.message}>{message}</Text> : null}

        <SectionList
          contentContainerStyle={sections.length ? styles.listContent : styles.emptyContent}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl colors={[theme.accent]} onRefresh={refresh} refreshing={refreshing} tintColor={theme.accent} />}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => <Text accessibilityRole="header" maxFontSizeMultiplier={1.5} style={styles.sectionTitle}>{section.title}</Text>}
          sections={sections}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Bell color={theme.muted} size={28} />
              <Text maxFontSizeMultiplier={1.5} style={styles.emptyTitle}>{resolved ? 'You’re all caught up' : 'Opening saved activity…'}</Text>
              <Text maxFontSizeMultiplier={1.6} style={styles.emptyMessage}>
                {resolved ? 'Shared-list activity and invitations will appear here.' : 'Checking your on-device inbox.'}
              </Text>
            </View>
          )}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      </View>

      <ConflictSheet visible={conflictsVisible} onClose={() => setConflictsVisible(false)} onRefresh={refreshWorkspace} />
    </View>
  );
};

const makeStyles = (theme) => StyleSheet.create({
  screen: { alignItems: 'center', backgroundColor: theme.bg, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', maxWidth: 720, paddingHorizontal: 16, paddingVertical: 11, width: '100%' },
  headerButton: { alignItems: 'center', borderColor: theme.hairline || 'rgba(127,127,127,0.18)', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, height: 36, justifyContent: 'center', width: 36 },
  headerText: { flex: 1, paddingHorizontal: 13 },
  title: { color: theme.text, fontSize: 20, fontWeight: '600' },
  subtitle: { color: theme.muted, fontSize: 12, marginTop: 2 },
  content: { flex: 1, width: '100%' },
  syncWrap: { marginHorizontal: 16, marginTop: 4 },
  actionsRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 16 },
  textButton: { justifyContent: 'center', minHeight: 44, paddingRight: 12 },
  textButtonLabel: { color: theme.text, fontSize: 13, fontWeight: '500' },
  disabledText: { color: theme.muted },
  conflictButton: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 44, paddingLeft: 12 },
  conflictButtonText: { color: theme.muted, fontSize: 13 },
  message: { color: theme.danger || theme.muted, fontSize: 12, paddingBottom: 5, paddingHorizontal: 16 },
  listContent: { paddingBottom: 28, paddingHorizontal: 16 },
  sectionTitle: { color: theme.muted, fontSize: 12, letterSpacing: 0.7, paddingBottom: 8, paddingTop: 12, textTransform: 'uppercase' },
  row: { alignItems: 'center', borderBottomColor: theme.hairline || 'rgba(127,127,127,0.13)', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 78, paddingHorizontal: 10, paddingVertical: 12 },
  unreadRow: { backgroundColor: 'rgba(127,127,127,0.055)', borderRadius: 14 },
  rowIcon: { alignItems: 'center', backgroundColor: 'rgba(127,127,127,0.08)', borderRadius: 18, height: 36, justifyContent: 'center', marginRight: 12, width: 36 },
  unreadIcon: { backgroundColor: 'rgba(127,127,127,0.14)' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitleLine: { alignItems: 'center', flexDirection: 'row' },
  rowTitle: { color: theme.text, flex: 1, fontSize: 14 },
  unreadTitle: { fontWeight: '600' },
  time: { color: theme.muted, fontSize: 11, marginLeft: 8 },
  rowMessage: { color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  unreadDot: { backgroundColor: theme.accent, borderRadius: 3, height: 6, marginHorizontal: 9, width: 6 },
  emptyContent: { flexGrow: 1, paddingHorizontal: 24 },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingBottom: 70 },
  emptyTitle: { color: theme.text, fontSize: 17, marginTop: 14 },
  emptyMessage: { color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 290, textAlign: 'center' },
});

export default CollaborationInboxScreen;
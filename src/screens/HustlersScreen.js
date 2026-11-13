// ─── Hustlers ────────────────────────────────────────────
// Cache-first friend directory with quiet, on-demand controls for adding,
// requests, and sorting. Global rankings live on a separate screen.
// ─────────────────────────────────────────────────────────
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Check, ChevronDown, Inbox, Search, Timer, UserPlus, Users, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HustlerRow } from '../components/HustlerRow';
import { useTheme } from '../context/ThemeContext';
import { getCurrentUserId } from '../lib/dataManager';
import {
    SORTS,
    loadHustlers,
    loadRequests,
    removeHustler,
    respondToRequest,
    searchUsers,
    sendHustlerRequest,
    sortHustlers,
    subscribeToHustlerChanges
} from '../lib/hustlersManager';
import { countOnline } from '../utils/presence';

const Avatar = ({ uri, label, size = 40, palette }) => (
  uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2, borderColor: palette.border }]}>
      <Text style={[styles.avatarInitial, { color: palette.muted }]}>
        {(label || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  )
);

export const HustlersScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [userId, setUserId] = useState(null);
  const [hustlers, setHustlers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sortId, setSortId] = useState('level');
  const [query, setQuery] = useState('');
  const [findQuery, setFindQuery] = useState('');
  const [findResults, setFindResults] = useState([]);
  const [finding, setFinding] = useState(false);
  const [actionId, setActionId] = useState(null);
  // Presence is derived from a timestamp, so labels and ordering must be
  // re-evaluated on a clock even when no network data changes.
  const [presenceTick, setPresenceTick] = useState(0);
  const [panel, setPanel] = useState(null); // add | inbox | sort | null

  const palette = useMemo(() => ({
    bg: theme?.bg || '#000000',
    text: theme?.text || '#F5F5F7',
    muted: theme?.muted || '#8E8E93',
    border: theme?.hairline || 'rgba(244,244,245,0.16)',
    accent: theme?.accent || '#FFFFFF',
    onAccent: theme?.onAccent || theme?.bg || '#000000',
  }), [theme]);

  useEffect(() => {
    let active = true;
    (async () => {
      const uid = await getCurrentUserId();
      if (!active || !uid) return;
      setUserId(uid);
      const [cachedFriends, cachedRequests] = await Promise.all([
        loadHustlers(uid, null, { refresh: false }),
        loadRequests(uid, null, { refresh: false }),
      ]);
      if (!active) return;
      setHustlers(cachedFriends);
      setRequests(cachedRequests);
    })();

    const tick = setInterval(() => setPresenceTick((n) => n + 1), 30 * 1000);
    return () => {
      active = false;
      clearInterval(tick);
    };
  }, []);

  const visible = useMemo(
    () => sortHustlers(hustlers, sortId, query),
    // presenceTick is a dependency on purpose: it re-sorts as people go idle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hustlers, sortId, query, presenceTick],
  );
  const onlineCount = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => countOnline(hustlers), [hustlers, presenceTick],
  );

  const refreshFriends = useCallback(() => {
    if (!userId) return;
    loadHustlers(userId, setHustlers);
    loadRequests(userId, setRequests);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return undefined;
      refreshFriends();
      const stopRealtime = subscribeToHustlerChanges(userId, refreshFriends);
      const poll = setInterval(refreshFriends, 15 * 1000);
      return () => {
        clearInterval(poll);
        stopRealtime();
      };
    }, [refreshFriends, userId]),
  );

  const handleFind = async () => {
    const trimmed = findQuery.trim();
    if (trimmed.length < 2) {
      setFindResults([]);
      return;
    }

    setFinding(true);
    try {
      setFindResults(await searchUsers(trimmed, userId));
    } catch (error) {
      Alert.alert(
        t('hustlers.searchFailedTitle', { defaultValue: 'Search unavailable' }),
        error?.code === 'OFFLINE'
          ? t('hustlers.needsInternet', { defaultValue: 'Connect to the internet to find hustlers.' })
          : t('hustlers.tryAgain', { defaultValue: 'Please try again.' }),
      );
    } finally {
      setFinding(false);
    }
  };

  const handleRequest = async (targetId) => {
    setActionId(`request:${targetId}`);
    try {
      await sendHustlerRequest(userId, targetId);
      setFindResults((prev) => prev.filter((r) => r.userId !== targetId));
      Alert.alert(t('hustlers.requestSent', { defaultValue: 'Request sent' }));
    } catch (error) {
      Alert.alert(
        t('hustlers.requestFailedTitle', { defaultValue: 'Could not send request' }),
        error?.code === 'ALREADY_CONNECTED'
          ? t('hustlers.alreadyConnected', { defaultValue: 'You are already connected or a request is pending.' })
          : t('hustlers.needsInternet', { defaultValue: 'Connect to the internet and try again.' }),
      );
    } finally {
      setActionId(null);
    }
  };

  const handleRespond = async (requestId, accept) => {
    setActionId(`response:${requestId}`);
    try {
      await respondToRequest(userId, requestId, accept);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      refreshFriends();
    } catch {
      Alert.alert(t('hustlers.needsInternet', { defaultValue: 'Connect to the internet and try again.' }));
    } finally {
      setActionId(null);
    }
  };

  const handleRemove = (friend) => {
    Alert.alert(
      t('hustlers.removeTitle', { defaultValue: 'Remove hustler?' }),
      t('hustlers.removeBody', { name: friend.displayName, defaultValue: `${friend.displayName} will no longer see your stats.` }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('hustlers.remove', { defaultValue: 'Remove' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeHustler(userId, friend.userId);
              setHustlers((prev) => prev.filter((h) => h.userId !== friend.userId));
            } catch {
              Alert.alert(t('hustlers.needsInternet', { defaultValue: 'Connect to the internet and try again.' }));
            }
          },
        },
      ],
    );
  };

  const sortLabel = SORTS.find((s) => s.id === sortId)?.label || SORTS[0].label;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            // Sidebar entry uses navigation.replace(), which leaves no history,
            // so goBack() was a no-op. Fall back to the Dashboard.
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
          {t('hustlers.title', { defaultValue: 'Hustlers' })}
        </Text>
      </View>

      <View style={styles.flex}>
        {/* One quiet toolbar; everything complex opens only when requested. */}
        <View style={styles.presenceHeader}>
          <View style={[styles.onlineDot, { backgroundColor: onlineCount > 0 ? '#4ADE80' : palette.muted }]} />
          <Text style={[styles.presenceText, { color: palette.text }]}>
            {t('hustlers.onlineCount', {
              online: onlineCount,
              total: hustlers.length,
              defaultValue: `ONLINE ${onlineCount}/${hustlers.length}`,
            })}
          </Text>
          <View style={styles.toolbarSpacer} />
          <TouchableOpacity
            onPress={() => navigation.navigate('HustleRooms')}
            style={[styles.toolbarButton, { borderColor: palette.border }]}
            accessibilityRole="button"
            accessibilityLabel="Open Hustle Rooms"
          >
            <Timer color={palette.text} size={15} />
            <Text style={[styles.toolbarText, { color: palette.text }]}>ROOMS</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setPanel('add')}
            style={[styles.toolbarButton, { borderColor: palette.border }]}
            accessibilityRole="button"
            accessibilityLabel={t('hustlers.addFriend', { defaultValue: 'Add friend' })}
          >
            <UserPlus color={palette.text} size={16} />
            <Text style={[styles.toolbarText, { color: palette.text }]}>ADD</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setPanel('inbox')}
            style={[styles.inboxButton, { borderColor: palette.border }]}
            accessibilityRole="button"
            accessibilityLabel={t('hustlers.inbox', { defaultValue: 'Friend requests' })}
          >
            <Inbox color={palette.text} size={17} />
            {requests.length > 0 ? (
              <View style={[styles.inboxBadge, { backgroundColor: palette.accent }]}>
                <Text style={[styles.inboxBadgeText, { color: palette.onAccent }]}>
                  {requests.length > 9 ? '9+' : requests.length}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        <View style={styles.controlRow}>
          <View style={[styles.compactSearch, { borderColor: palette.border }]}>
            <Search color={palette.muted} size={14} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('hustlers.filterPlaceholder', { defaultValue: 'Search friends' })}
              placeholderTextColor={palette.muted}
              style={[styles.searchInput, { color: palette.text }]}
            />
          </View>
          <TouchableOpacity
            onPress={() => setPanel('sort')}
            style={[styles.sortButton, { borderColor: palette.border }]}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${sortLabel}`}
          >
            <Text style={[styles.sortButtonText, { color: palette.text }]} numberOfLines={1}>{sortLabel}</Text>
            <ChevronDown color={palette.muted} size={14} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={visible}
          keyExtractor={(item) => item.userId}
          removeClippedSubviews
          initialNumToRender={12}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.listBody}
          renderItem={({ item }) => (
            <HustlerRow
              hustler={item}
              palette={palette}
              onLongPress={() => handleRemove(item)}
            />
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Users color={palette.muted} size={26} />
              <Text style={[styles.emptyTitle, { color: palette.text }]}>
                {t('hustlers.emptyTitle', { defaultValue: 'No hustlers yet' })}
              </Text>
              <Text style={[styles.emptyBody, { color: palette.muted }]}>
                {t('hustlers.emptyBody', { defaultValue: 'Add someone by username and compare hours once they accept.' })}
              </Text>
            </View>
          )}
        />

      </View>

      <Modal
        transparent
        visible={panel !== null}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPanel(null)}
      >
        <View style={styles.panelBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPanel(null)} />
          <View style={[styles.panelSheet, { backgroundColor: palette.bg, borderColor: palette.border }]}>
            <View style={[styles.panelHeader, { borderBottomColor: palette.border }]}>
              <Text style={[styles.panelTitle, { color: palette.text }]}>
                {panel === 'add'
                  ? t('hustlers.addFriend', { defaultValue: 'Add a friend' })
                  : panel === 'inbox'
                    ? t('hustlers.inbox', { defaultValue: 'Friend requests' })
                    : t('hustlers.sortTitle', { defaultValue: 'Sort friends' })}
              </Text>
              <TouchableOpacity onPress={() => setPanel(null)} style={styles.iconButton} accessibilityLabel="Close">
                <X color={palette.muted} size={19} />
              </TouchableOpacity>
            </View>

            {panel === 'add' ? (
              <View style={styles.panelBody}>
                <View style={[styles.panelSearch, { borderColor: palette.border }]}>
                  <Search color={palette.muted} size={15} />
                  <TextInput
                    value={findQuery}
                    onChangeText={(value) => {
                      setFindQuery(value);
                      if (value.trim().length < 2) setFindResults([]);
                    }}
                    onSubmitEditing={handleFind}
                    returnKeyType="search"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    placeholder={t('hustlers.findPlaceholder', { defaultValue: 'Search username' })}
                    placeholderTextColor={palette.muted}
                    style={[styles.searchInput, { color: palette.text }]}
                  />
                  <TouchableOpacity
                    onPress={handleFind}
                    disabled={finding || findQuery.trim().length < 2}
                    style={styles.findButton}
                    accessibilityRole="button"
                    accessibilityLabel={t('hustlers.search', { defaultValue: 'Search users' })}
                  >
                    {finding ? (
                      <ActivityIndicator color={palette.text} size="small" />
                    ) : (
                      <Text style={[styles.findButtonText, { color: palette.text }]}>FIND</Text>
                    )}
                  </TouchableOpacity>
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" style={styles.panelScroll}>
                  {findResults.map((item) => (
                    <View key={item.userId} style={[styles.panelRow, { borderBottomColor: palette.border }]}>
                      <Avatar uri={item.avatarUrl} label={item.displayName} palette={palette} />
                      <View style={styles.rowCopy}>
                        <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>{item.displayName}</Text>
                        <Text style={[styles.rowMeta, { color: palette.muted }]} numberOfLines={1}>@{item.username}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRequest(item.userId)}
                        disabled={actionId !== null}
                        style={[styles.addButton, { borderColor: palette.border }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Send friend request to ${item.displayName}`}
                      >
                        {actionId === `request:${item.userId}` ? (
                          <ActivityIndicator color={palette.text} size="small" />
                        ) : (
                          <Text style={[styles.addText, { color: palette.text }]}>ADD</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  ))}
                  {!finding && findQuery.length >= 2 && findResults.length === 0 ? (
                    <Text style={[styles.panelEmpty, { color: palette.muted }]}>No users found</Text>
                  ) : null}
                </ScrollView>
              </View>
            ) : panel === 'inbox' ? (
              <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelBody}>
                {requests.length === 0 ? (
                  <Text style={[styles.panelEmpty, { color: palette.muted }]}>No pending requests</Text>
                ) : requests.map((r) => (
                  <View key={r.id} style={[styles.panelRow, { borderBottomColor: palette.border }]}>
                    <Avatar uri={r.profiles?.avatar_url} label={r.profiles?.display_name} palette={palette} />
                    <View style={styles.rowCopy}>
                      <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                        {r.profiles?.display_name || r.profiles?.username || 'Hustler'}
                      </Text>
                      <Text style={[styles.rowMeta, { color: palette.muted }]}>@{r.profiles?.username || '—'}</Text>
                    </View>
                    {actionId === `response:${r.id}` ? (
                      <View style={styles.responseBusy}>
                        <ActivityIndicator color={palette.text} size="small" />
                      </View>
                    ) : (
                      <View style={styles.responseActions}>
                        <TouchableOpacity
                          onPress={() => handleRespond(r.id, true)}
                          disabled={actionId !== null}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel="Accept"
                        >
                          <Check color={palette.text} size={19} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleRespond(r.id, false)}
                          disabled={actionId !== null}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel="Reject"
                        >
                          <X color={palette.muted} size={19} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelBody}>
                {SORTS.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => { setSortId(item.id); setPanel(null); }}
                    style={[styles.sortOption, { borderBottomColor: palette.border }]}
                  >
                    <Text style={[styles.sortOptionText, { color: palette.text }]}>{item.label}</Text>
                    {sortId === item.id ? <Check color={palette.text} size={17} /> : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6, gap: 4 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '400', letterSpacing: -0.4 },
  presenceHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 7 },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  presenceText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  toolbarSpacer: { flex: 1 },
  toolbarButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolbarText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.9 },
  inboxButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxBadgeText: { fontSize: 8.5, fontWeight: '700' },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  compactSearch: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 13.5, paddingVertical: 0 },
  sortButton: {
    maxWidth: 136,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sortButtonText: { flexShrink: 1, fontSize: 10.5, fontWeight: '500', letterSpacing: 0.2 },
  listBody: { flexGrow: 1, paddingBottom: 28 },
  panelBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  panelSheet: {
    width: '100%',
    maxHeight: '82%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  panelHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelTitle: { flex: 1, fontSize: 16, fontWeight: '400', letterSpacing: -0.2 },
  panelBody: { paddingHorizontal: 16, paddingBottom: 24 },
  panelSearch: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingLeft: 12,
    paddingRight: 5,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  findButton: { minWidth: 48, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  findButtonText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.9 },
  panelScroll: { maxHeight: 420 },
  panelRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelEmpty: { paddingVertical: 28, textAlign: 'center', fontSize: 12 },
  sortOption: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortOptionText: { fontSize: 13.5, fontWeight: '400' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14.5, fontWeight: '400', letterSpacing: -0.2 },
  rowMeta: { fontSize: 11, marginTop: 2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  avatarInitial: { fontSize: 14, fontWeight: '500' },
  addButton: {
    minWidth: 54,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  responseActions: { flexDirection: 'row', alignItems: 'center' },
  responseBusy: { width: 80, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 44, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '400' },
  emptyBody: { fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 260 },
});

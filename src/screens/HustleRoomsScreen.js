import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Clock3, MessageCircle, Plus, Users } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import {
    formatRoomClock,
    getCurrentUserId,
    getHustleRoomElapsed,
    loadHustleRooms,
    refreshHustleRooms,
    subscribeToHustleRoomsChanges,
} from '../lib/dataManager';

const statusLabel = (status) => ({
  not_started: 'READY',
  running: 'FOCUSING',
  paused: 'PAUSED',
  done: 'DONE',
}[status] || 'READY');

export const HustleRoomsScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const [userId, setUserId] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [tick, setTick] = useState(0);
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
    getCurrentUserId().then(async (uid) => {
      if (!active || !uid) return;
      setUserId(uid);
      const cached = await loadHustleRooms(uid, setRooms);
      if (active) setRooms(cached);
    });
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);


  const refresh = useCallback(() => {
    if (!userId) return;
    refreshHustleRooms(userId).then((result) => {
      if (result.ok) setRooms(result.data);
    }).catch(() => {});
  }, [userId]);

  useFocusEffect(useCallback(() => {
    if (!userId) return undefined;
    refresh();
    const unsubscribe = subscribeToHustleRoomsChanges(userId, refresh);
    const poll = setInterval(refresh, 15000);
    return () => { clearInterval(poll); unsubscribe(); };
  }, [refresh, userId]));

  const renderRoom = ({ item }) => {
    const elapsed = getHustleRoomElapsed(item.myMember, item.durationSeconds);
    const progress = item.durationSeconds > 0 ? Math.min(1, elapsed / item.durationSeconds) : 0;
    return (
      <TouchableOpacity
        style={[styles.roomRow, { borderColor: palette.border }]}
        onPress={() => navigation.navigate('HustleRoom', { roomId: item.id })}
        activeOpacity={0.74}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${statusLabel(item.myMember?.timerStatus)}, ${formatRoomClock(elapsed)} of ${formatRoomClock(item.durationSeconds)}`}
      >
        <View style={styles.roomTopLine}>
          <Text style={[styles.roomName, { color: palette.text }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.roomState, { color: palette.muted }]}>{statusLabel(item.myMember?.timerStatus)}</Text>
        </View>
        <View style={styles.metaLine}>
          <Clock3 color={palette.muted} size={13} />
          <Text style={[styles.metaText, { color: palette.muted }]}>
            {formatRoomClock(elapsed)} / {formatRoomClock(item.durationSeconds)}
          </Text>
          <Users color={palette.muted} size={13} />
          <Text style={[styles.metaText, { color: palette.muted }]}>{item.memberCount}</Text>
          {item.chatEnabled ? <MessageCircle color={palette.muted} size={13} /> : null}
        </View>
        <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: palette.text }]} />
        </View>
      </TouchableOpacity>
    );
  };

  // tick intentionally keeps running-room clocks fresh without network writes.
  void tick;

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
          accessibilityLabel="Back"
        >
          <ArrowLeft color={palette.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: palette.text }]}>Hustle Rooms</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>Focus together. Progress separately.</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateHustleRoom')}
          style={[styles.createButton, { backgroundColor: palette.accent }]}
          accessibilityRole="button"
          accessibilityLabel="Create Hustle Room"
        >
          <Plus color={palette.onAccent} size={18} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        renderItem={renderRoom}
        contentContainerStyle={rooms.length ? styles.list : styles.emptyList}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Users color={palette.muted} size={30} strokeWidth={1.5} />
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No active rooms</Text>
            <Text style={[styles.emptyBody, { color: palette.muted }]}>Create a room, choose friends and work toward the same time target at your own pace.</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('CreateHustleRoom')}
              style={[styles.emptyAction, { borderColor: palette.border }]}
            >
              <Text style={[styles.emptyActionText, { color: palette.text }]}>CREATE ROOM</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { fontSize: 20, fontWeight: '400', letterSpacing: -0.45 },
  subtitle: { marginTop: 2, fontSize: 10.5, letterSpacing: 0.15 },
  createButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 10 },
  emptyList: { flexGrow: 1, paddingHorizontal: 24 },
  roomRow: { padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  roomTopLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  roomName: { flex: 1, fontSize: 16, fontWeight: '400', letterSpacing: -0.25 },
  roomState: { fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  metaText: { fontSize: 11, marginRight: 8 },
  progressTrack: { height: 3, borderRadius: 2, marginTop: 13, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  emptyTitle: { marginTop: 14, fontSize: 17, fontWeight: '400' },
  emptyBody: { maxWidth: 290, marginTop: 7, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  emptyAction: { marginTop: 20, minHeight: 40, paddingHorizontal: 18, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  emptyActionText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
});
import { ArrowLeft, Check, MessageCircle, Users } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePro } from '../context/ProContext';
import { useTheme } from '../context/ThemeContext';
import {
  createHustleRoom,
  getCurrentUserId,
  HUSTLE_ROOM_LIMITS,
  isHustleRoomsOnline,
  loadHustlers,
} from '../lib/dataManager';

export const CreateHustleRoomScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const { isPro } = usePro();
  const [userId, setUserId] = useState(null);
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('90');
  const [chatEnabled, setChatEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
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
      const cached = await loadHustlers(uid, (fresh) => active && setFriends(fresh));
      if (active) setFriends(cached);
    });
    return () => { active = false; };
  }, []);


  const toggleFriend = (friendId) => {
    setSelected((current) => {
      if (current.includes(friendId)) return current.filter((id) => id !== friendId);
      if (current.length >= HUSTLE_ROOM_LIMITS.maxFriends) {
        Alert.alert('Room full', `Choose up to ${HUSTLE_ROOM_LIMITS.maxFriends} friends.`);
        return current;
      }
      return [...current, friendId];
    });
  };

  const handleCreate = async () => {
    if (creating) return;
    // Creating a room is Pro: it holds a realtime channel and presence for every
    // member for the whole session, so the cost scales with creators rather than
    // participants. Joining a room stays free for everyone.
    if (!isPro) {
      Alert.alert(
        'Creating rooms is a Pro feature',
        'Joining a friend\'s room is always free. LifePilot Pro lets you host your own focus rooms.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'See plans', onPress: () => navigation.navigate('Paywall') },
        ],
      );
      return;
    }
    if (!isHustleRoomsOnline()) {
      Alert.alert('Internet required', 'Room creation verifies every friendship online. Your form has been kept.');
      return;
    }
    setCreating(true);
    try {
      const snapshot = await createHustleRoom(userId, {
        name,
        durationMinutes: minutes,
        chatEnabled,
        friendIds: selected,
      });
      navigation.replace('HustleRoom', { roomId: snapshot.room.id });
    } catch (error) {
      Alert.alert('Could not create room', error?.message || 'Please check the details and try again.');
    } finally {
      setCreating(false);
    }
  };

  const parsedMinutes = Math.floor(Number(minutes));
  const valid = name.trim().length > 0
    && name.trim().length <= HUSTLE_ROOM_LIMITS.maxName
    && parsedMinutes >= HUSTLE_ROOM_LIMITS.minMinutes
    && parsedMinutes <= HUSTLE_ROOM_LIMITS.maxMinutes
    && selected.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.replace('Hustlers');
          }}
          style={styles.iconButton}
          accessibilityLabel="Back"
        >
          <ArrowLeft color={palette.text} size={22} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: palette.text }]}>Create Hustle Room</Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.sectionLabel, { color: palette.muted }]}>ROOM</Text>
          <View style={[styles.inputShell, { borderColor: palette.border }]}>
            <TextInput
              value={name}
              onChangeText={(value) => setName(value.slice(0, HUSTLE_ROOM_LIMITS.maxName))}
              placeholder="e.g. Sunday deep work"
              placeholderTextColor={palette.muted}
              style={[styles.input, { color: palette.text }]}
              maxLength={HUSTLE_ROOM_LIMITS.maxName}
            />
            <Text style={[styles.counter, { color: palette.muted }]}>{name.length}/{HUSTLE_ROOM_LIMITS.maxName}</Text>
          </View>

          <Text style={[styles.sectionLabel, { color: palette.muted }]}>TARGET PER PERSON</Text>
          <View style={[styles.durationRow, { borderColor: palette.border }]}>
            <TextInput
              value={minutes}
              onChangeText={(value) => setMinutes(value.replace(/[^0-9]/g, '').slice(0, 3))}
              keyboardType="number-pad"
              placeholder="90"
              placeholderTextColor={palette.muted}
              style={[styles.durationInput, { color: palette.text }]}
            />
            <Text style={[styles.durationUnit, { color: palette.muted }]}>MINUTES · 1–240</Text>
          </View>

          <View style={[styles.optionRow, { borderColor: palette.border }]}>
            <MessageCircle color={palette.text} size={18} />
            <View style={styles.optionCopy}>
              <Text style={[styles.optionTitle, { color: palette.text }]}>Room chat</Text>
              <Text style={[styles.optionBody, { color: palette.muted }]}>Members can message while the room is active.</Text>
            </View>
            <Switch
              value={chatEnabled}
              onValueChange={setChatEnabled}
              trackColor={{ false: palette.border, true: palette.text }}
              thumbColor={chatEnabled ? palette.bg : palette.muted}
            />
          </View>

          <View style={styles.friendHeading}>
            <View>
              <Text style={[styles.sectionLabel, { color: palette.muted, marginTop: 0 }]}>INVITE FRIENDS</Text>
              <Text style={[styles.friendHint, { color: palette.muted }]}>They receive immediate access. Progress stays individual.</Text>
            </View>
            <Text style={[styles.selectedCount, { color: palette.text }]}>{selected.length} selected</Text>
          </View>


          {friends.length === 0 ? (
            <View style={styles.noFriends}>
              <Users color={palette.muted} size={25} />
              <Text style={[styles.noFriendsText, { color: palette.muted }]}>Add and accept at least one friend first.</Text>
            </View>
          ) : friends.map((friend) => {
            const checked = selected.includes(friend.userId);
            return (
              <TouchableOpacity
                key={friend.userId}
                onPress={() => toggleFriend(friend.userId)}
                style={[styles.friendRow, { borderBottomColor: palette.border }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
              >
                {friend.avatarUrl ? (
                  <Image source={{ uri: friend.avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback, { borderColor: palette.border }]}>
                    <Text style={[styles.avatarLetter, { color: palette.muted }]}>{friend.displayName.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.friendCopy}>
                  <Text style={[styles.friendName, { color: palette.text }]} numberOfLines={1}>{friend.displayName}</Text>
                  <Text style={[styles.friendUsername, { color: palette.muted }]} numberOfLines={1}>@{friend.username}</Text>
                </View>
                <View style={[styles.check, { borderColor: checked ? palette.text : palette.border, backgroundColor: checked ? palette.text : 'transparent' }]}>
                  {checked ? <Check color={palette.bg} size={14} strokeWidth={2.5} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: palette.border, backgroundColor: palette.bg }]}>
          <Text style={[styles.footerNote, { color: palette.muted }]}>Each member starts, pauses and finishes their own timer.</Text>
          <TouchableOpacity
            onPress={handleCreate}
            disabled={!valid || creating}
            style={[
              styles.submit,
              { backgroundColor: palette.accent },
              (!valid || creating) && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid || creating }}
          >
            <Text style={[styles.submitText, { color: palette.onAccent }]}>{creating ? 'CREATING…' : 'CREATE ROOM'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '400', letterSpacing: -0.4 },
  body: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 130 },
  sectionLabel: { marginTop: 19, marginBottom: 8, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.25 },
  inputShell: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13 },
  input: { flex: 1, fontSize: 15, paddingVertical: 11 },
  counter: { fontSize: 9 },
  durationRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13 },
  durationInput: { width: 74, fontSize: 20, fontWeight: '300', paddingVertical: 8 },
  durationUnit: { flex: 1, textAlign: 'right', fontSize: 9.5, letterSpacing: 0.8 },
  optionRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 16, paddingHorizontal: 13, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  optionCopy: { flex: 1 },
  optionTitle: { fontSize: 14, fontWeight: '400' },
  optionBody: { marginTop: 3, fontSize: 10.5, lineHeight: 14 },
  friendHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 23, marginBottom: 4 },
  friendHint: { maxWidth: 240, fontSize: 10.5, lineHeight: 14 },
  selectedCount: { fontSize: 10, marginBottom: 1 },
  noFriends: { alignItems: 'center', paddingVertical: 30, gap: 9 },
  noFriendsText: { fontSize: 11.5 },
  friendRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  avatarLetter: { fontSize: 14 },
  friendCopy: { flex: 1, minWidth: 0 },
  friendName: { fontSize: 14, fontWeight: '400' },
  friendUsername: { marginTop: 2, fontSize: 10.5 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth },
  footerNote: { marginBottom: 8, textAlign: 'center', fontSize: 9.5 },
  submit: { minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  disabled: { opacity: 0.35 },
});
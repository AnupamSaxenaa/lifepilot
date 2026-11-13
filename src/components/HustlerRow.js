// ─── Hustler Row ─────────────────────────────────────────
// One friend, at a glance: who they are, whether they're around right now, and
// what they've actually done today.
//
// Layout reasoning:
//  • Level sits INSIDE the avatar as a badge, so identity and rank read as one
//    object instead of competing for horizontal space.
//  • Presence is a coloured ring plus a dot — colour alone is not accessible,
//    so the state is also spelled out in the meta line and the a11y label.
//  • Stats are a fixed-width right rail, which keeps numbers aligned down the
//    list instead of ragged behind names of different lengths.
// ─────────────────────────────────────────────────────────
import { CheckCircle2, Clock3, Flame } from 'lucide-react-native';
import { memo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatHustle } from '../utils/focusSessions';
import { getPresence, getPresenceLabel } from '../utils/presence';

export const HustlerRow = memo(function HustlerRow({ hustler, palette, onPress, onLongPress }) {
  const presence = getPresence(hustler.lastSeenAt);
  const presenceLabel = getPresenceLabel(hustler.lastSeenAt);
  const isPresent = presence.id !== 'offline';

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: palette.border }]}
      activeOpacity={0.72}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      // One sentence covering everything the row shows visually, so the list is
      // usable without seeing the colours.
      accessibilityLabel={`${hustler.displayName}, level ${hustler.level}, ${presenceLabel}`
        + `${hustler.status ? `, ${hustler.status}` : ''}`
        + `, ${formatHustle(hustler.focusToday)} hustled today`
        + `, ${hustler.tasksToday} tasks done`
        + `${hustler.streak > 0 ? `, ${hustler.streak} day streak` : ''}`}
    >
      <View style={styles.avatarWrap}>
        <View
          style={[
            styles.avatarRing,
            { borderColor: isPresent ? presence.color : palette.border },
            !isPresent && styles.avatarRingOffline,
          ]}
        >
          {hustler.avatarUrl ? (
            <Image source={{ uri: hustler.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: `${palette.text}12` }]}>
              <Text style={[styles.avatarInitial, { color: palette.muted }]}>
                {(hustler.displayName || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        {/* Level badge, bottom-left, so it never covers the presence dot. */}
        <View style={[styles.levelBadge, { backgroundColor: palette.bg, borderColor: palette.border }]}>
          <Text style={[styles.levelText, { color: palette.text }]}>{hustler.level}</Text>
        </View>

        {/* Presence dot, bottom-right. */}
        <View
          style={[
            styles.presenceDot,
            { backgroundColor: presence.color, borderColor: palette.bg },
          ]}
        />
      </View>

      <View style={styles.copy}>
        <View style={styles.nameLine}>
          <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
            {hustler.displayName}
          </Text>
          {hustler.streak > 0 ? (
            <View style={styles.streakChip}>
              <Flame color={palette.muted} size={10} strokeWidth={2} />
              <Text style={[styles.streakText, { color: palette.muted }]}>{hustler.streak}</Text>
            </View>
          ) : null}
        </View>

        {/* Custom status wins the second line when set — it is the most human
            piece of information here. Presence is the fallback. */}
        <Text style={[styles.meta, { color: isPresent ? palette.text : palette.muted }]} numberOfLines={1}>
          {hustler.status
            ? hustler.status
            : presenceLabel}
        </Text>
        {hustler.status ? (
          <Text style={[styles.subMeta, { color: palette.muted }]} numberOfLines={1}>
            {presenceLabel} · @{hustler.username}
          </Text>
        ) : null}
      </View>

      <View style={styles.stats}>
        <View style={styles.statLine}>
          <Clock3 color={palette.muted} size={11} strokeWidth={2} />
          <Text style={[styles.statValue, { color: palette.text }]}>
            {formatHustle(hustler.focusToday)}
          </Text>
        </View>
        <View style={styles.statLine}>
          <CheckCircle2 color={palette.muted} size={11} strokeWidth={2} />
          <Text style={[styles.statSecondary, { color: palette.muted }]}>
            {hustler.tasksToday}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

const AVATAR = 44;
const RING = AVATAR + 6;

const styles = StyleSheet.create({
  row: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarWrap: { width: RING, height: RING },
  avatarRing: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Offline should recede, not shout: a hairline instead of a coloured ring.
  avatarRingOffline: { borderWidth: StyleSheet.hairlineWidth, opacity: 0.7 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatarFallback: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '500' },
  levelBadge: {
    position: 'absolute',
    left: -2,
    bottom: -2,
    minWidth: 20,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.2 },
  presenceDot: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  copy: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '400', letterSpacing: -0.25, flexShrink: 1 },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  streakText: { fontSize: 10, fontWeight: '600' },
  meta: { fontSize: 11.5, marginTop: 2 },
  subMeta: { fontSize: 10, marginTop: 1.5 },
  // Fixed width keeps the numbers in a clean column down the whole list.
  stats: { width: 74, alignItems: 'flex-end', gap: 4 },
  statLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 13, fontWeight: '500', letterSpacing: -0.2 },
  statSecondary: { fontSize: 11, fontWeight: '500' },
});

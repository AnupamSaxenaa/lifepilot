import { AlertTriangle, CheckCircle2, Clock3, WifiOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import {
    getCollaborationSyncState,
    subscribeCollaborationSyncState,
} from '../../lib/collaborationManager';

const belongsToSpace = (entry, spaceId) => {
  if (spaceId == null) return true;
  const entrySpaceId = entry?.spaceId
    ?? entry?.space_id
    ?? entry?.scope?.spaceId
    ?? entry?.collaborationMetadata?.spaceId;
  return entrySpaceId != null && String(entrySpaceId) === String(spaceId);
};

const countLabel = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`;

export const SyncStatusStrip = ({ spaceId, compact = false }) => {
  const { theme } = useTheme();
  const [online, setOnline] = useState(false);
  const [connectivityKnown, setConnectivityKnown] = useState(false);
  const [counts, setCounts] = useState({ pending: 0, conflicts: 0 });

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeCollaborationSyncState((snapshot) => {
      if (!active) return;
      setOnline(snapshot?.online === true);
      setConnectivityKnown(snapshot?.connectivityKnown === true);
      if (spaceId == null) {
        setCounts({
          pending: Number(snapshot?.pending) || 0,
          conflicts: Number(snapshot?.conflicts) || 0,
        });
        return;
      }
      // Scoped strips need entity arrays; the global/sidebar strip uses the
      // queue snapshot directly and performs no extra AsyncStorage reads.
      getCollaborationSyncState().then((state) => {
        if (!active) return;
        setCounts({
          pending: (state.pending || []).filter((entry) => belongsToSpace(entry, spaceId)).length,
          conflicts: (state.conflicts || []).filter((entry) => belongsToSpace(entry, spaceId)).length,
        });
      }).catch(() => {});
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [spaceId]);

  const healthy = connectivityKnown && online && counts.pending === 0 && counts.conflicts === 0;
  const pendingText = countLabel(counts.pending, 'pending change');
  const conflictText = countLabel(counts.conflicts, 'conflict');
  const visibleParts = healthy
    ? ['Synced']
    : [
      connectivityKnown ? (online ? null : 'Offline') : 'Checking sync',
      counts.pending > 0 ? pendingText : null,
      counts.conflicts > 0 ? conflictText : null,
    ].filter(Boolean);
  const accessibilityLabel = healthy
    ? 'Online. All collaboration changes are synced.'
    : [
      connectivityKnown ? (online ? 'Online.' : 'Offline.') : 'Checking connection.',
      counts.pending > 0 ? `${pendingText}.` : 'No pending changes.',
      counts.conflicts > 0 ? `${conflictText}.` : 'No conflicts.',
    ].join(' ');
  const StatusIcon = healthy
    ? CheckCircle2
    : counts.conflicts > 0
      ? AlertTriangle
      : connectivityKnown && !online
        ? WifiOff
        : Clock3;
  const muted = theme.muted || '#8E8E93';
  const statusColor = counts.conflicts > 0 ? (theme.danger || muted) : muted;

  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={accessibilityLabel}
      style={[styles.strip, compact && styles.compact]}
    >
      <StatusIcon size={compact ? 13 : 14} color={statusColor} />
      <Text
        maxFontSizeMultiplier={1.6}
        numberOfLines={1}
        style={[styles.text, compact && styles.compactText, { color: statusColor }]}
      >
        {visibleParts.join(' · ')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  strip: {
    minHeight: 36,
    alignSelf: 'flex-start',
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compact: { minHeight: 28, paddingHorizontal: 0 },
  text: { fontSize: 12, fontWeight: '400' },
  compactText: { fontSize: 11 },
});

export default SyncStatusStrip;
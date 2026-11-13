import { Activity, CalendarCheck2, Gem, Hexagon, Shield, X } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STONES_CATALOG } from '../config/stonesConfig';
import { useTheme } from '../context/ThemeContext';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';
import { StreakCalendar } from './StreakCalendar';
import { XPAvatarRing } from './XPAvatarRing';

const PREVIEW_STONE_COUNT = 6;

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const alpha = (color, opacity) => {
  if (!/^#[0-9A-F]{6}$/i.test(color || '')) return color;
  const suffix = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${color}${suffix}`;
};

export const GamificationStatsModal = ({ isVisible, onClose, gamestate, profile }) => {
  const [selectedStone, setSelectedStone] = React.useState(null);
  const [showAllStones, setShowAllStones] = React.useState(false);
  const [protectionPreference, setProtectionPreference] = React.useState({ userId: null, enabled: false });
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();


  const compact = windowWidth < 600;
  const sheetWidth = Math.min(windowWidth - (compact ? 0 : 32), 680);
  const sheetMaxHeight = Math.max(320, windowHeight - Math.max(insets.top, 12) - (compact ? 0 : 24));
  const detailImageSize = Math.max(76, Math.min(104, windowWidth * 0.24, windowHeight * 0.16));

  const palette = useMemo(() => ({
    bg: theme.bg || '#000000',
    text: theme.text || '#F5F5F5',
    muted: theme.muted || '#8E8E93',
    border: theme.hairline || alpha(theme.text || '#F5F5F5', 0.16),
    fill: alpha(theme.text || '#F5F5F5', 0.07),
    track: alpha(theme.text || '#F5F5F5', 0.12),
  }), [theme]);
  const styles = useMemo(() => makeStyles(palette, compact), [compact, palette]);

  React.useEffect(() => {
    let active = true;
    if (!isVisible || !profile?.id) return () => { active = false; };

    Storage.get(`streak_freeze_enabled_${profile.id}`).then((value) => {
      if (active) {
        setProtectionPreference({
          userId: profile.id,
          enabled: value === true || value === 'true',
        });
      }
    });
    return () => { active = false; };
  }, [isVisible, profile?.id]);

  // Cheap bail-out: this sheet builds a 42-cell calendar, an SVG ring and the
  // stones grid, and it was doing so on every render while invisible.
  if (!isVisible || !gamestate) return null;

  const currentLevel = Math.max(1, Math.floor(safeNumber(gamestate.level, 1)));
  const currentXP = Math.max(0, safeNumber(gamestate.xp));
  const streak = Math.max(0, Math.floor(safeNumber(gamestate.streak)));
  const tasksCompletedToday = Math.max(0, Math.floor(safeNumber(gamestate.tasksCompletedToday)));
  const protectionEnabled = protectionPreference.userId === profile?.id && protectionPreference.enabled;

  const levelFloor = Gamification.getRequiredXPForLevel(currentLevel);
  const nextLevelFloor = Gamification.getRequiredXPForLevel(currentLevel + 1);
  const levelSpan = Math.max(1, nextLevelFloor - levelFloor);
  const xpInCurrentLevel = Math.min(levelSpan, Math.max(0, currentXP - levelFloor));
  const progressPct = Math.min(100, Math.max(0, (xpInCurrentLevel / levelSpan) * 100));
  const xpRemaining = Math.max(0, levelSpan - xpInCurrentLevel);
  const safeProtectionXP = Math.max(0, currentXP - levelFloor);

  const collectedStones = STONES_CATALOG.filter((stone) => currentLevel >= stone.level);
  const stonesHighestFirst = [...collectedStones].sort((a, b) => b.level - a.level);
  const visibleStones = showAllStones
    ? stonesHighestFirst
    : stonesHighestFirst.slice(0, PREVIEW_STONE_COUNT);
  const totalShardsEarned = collectedStones.reduce((sum, stone) => sum + (stone.shards || 0), 0);
  const collectionPct = STONES_CATALOG.length > 0
    ? Math.round((collectedStones.length / STONES_CATALOG.length) * 100)
    : 0;

  const getAvatarSource = () => {
    if (profile?.avatar_url) return { uri: profile.avatar_url };
    const seed = profile?.avatar_seed || profile?.username || 'fallback';
    return { uri: `https://api.dicebear.com/7.x/adventurer/png?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9` };
  };

  const closeModal = () => {
    setSelectedStone(null);
    setShowAllStones(false);
    onClose?.();
  };

  const formatNumber = (value) => Math.round(value).toLocaleString();
  const progressText = t('gamificationStats.xpFraction', {
    current: formatNumber(xpInCurrentLevel),
    total: formatNumber(levelSpan),
    defaultValue: '{{current}} / {{total}} XP',
  });

  const metrics = [
    {
      icon: Activity,
      value: formatNumber(streak),
      label: t('gamificationStats.activeStreakLabel', { defaultValue: 'Streak' }),
    },
    {
      icon: CalendarCheck2,
      value: formatNumber(tasksCompletedToday),
      label: t('gamificationStats.tasksTodayLabel', { defaultValue: 'Tasks today' }),
    },
    {
      icon: Shield,
      value: formatNumber(safeProtectionXP),
      label: t('gamificationStats.protectedXpLabel', { defaultValue: 'Safe XP' }),
    },
    {
      icon: Gem,
      value: formatNumber(collectedStones.length),
      label: t('gamificationStats.stonesMetricLabel', { defaultValue: 'Stones' }),
    },
  ];

  return (
    <Modal
      visible={isVisible}
      animationType="fade"
      transparent
      onShow={() => setShowAllStones(false)}
      onRequestClose={closeModal}
      statusBarTranslucent
    >
      <View style={[styles.overlay, compact ? styles.overlayCompact : styles.overlayWide, { paddingTop: Math.max(insets.top, 12) }]}>
        <View
          style={[
            styles.sheet,
            {
              width: sheetWidth,
              maxHeight: sheetMaxHeight,
              paddingBottom: compact ? Math.max(insets.bottom, 8) : 8,
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {t('gamificationStats.progressTitle', { defaultValue: 'Progress' })}
            </Text>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={closeModal}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
              hitSlop={{ top: 4, right: 4, bottom: 4, left: 4 }}
            >
              <X color={palette.muted} size={19} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
          >
            <View style={styles.identity}>
              <View style={styles.avatarWrap}>
                <XPAvatarRing
                  avatarSource={getAvatarSource()}
                  xp={currentXP}
                  level={currentLevel}
                  size={64}
                  strokeWidth={2}
                />
              </View>
              <View style={styles.identityCopy}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {profile?.display_name || t('gamificationStats.profileFallbackName', { defaultValue: 'Your profile' })}
                </Text>
                {profile?.username ? (
                  <Text style={styles.username} numberOfLines={1}>@{profile.username}</Text>
                ) : null}
              </View>
              <View style={styles.levelBlock}>
                <Text style={styles.levelLabel}>{t('gamificationStats.levelLabel', { defaultValue: 'LEVEL' })}</Text>
                <Text style={styles.levelValue}>{currentLevel}</Text>
              </View>
            </View>

            <View style={styles.xpStrip}>
              <View style={styles.xpTopRow}>
                <View>
                  <Text style={styles.microLabel}>{t('gamificationStats.totalXpLabel', { defaultValue: 'TOTAL XP' })}</Text>
                  <Text style={styles.totalXp}>{formatNumber(currentXP)}</Text>
                </View>
                <View style={styles.xpMeta}>
                  <Text style={styles.progressPrimary}>{progressText}</Text>
                  <Text style={styles.progressSecondary}>
                    {t('gamificationStats.xpToNextLevel', {
                      remaining: formatNumber(xpRemaining),
                      nextLevel: currentLevel + 1,
                      defaultValue: '{{remaining}} remaining · Level {{nextLevel}}',
                    })}
                  </Text>
                </View>
              </View>
              <View
                style={styles.progressTrack}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={t('gamificationStats.levelProgressLabel', { defaultValue: 'Level progress' })}
                accessibilityValue={{ min: 0, max: 100, now: Math.round(progressPct), text: progressText }}
              >
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>
            </View>

            <View style={styles.statsRail}>
              {metrics.map(({ icon: Icon, value, label }, index) => (
                <View key={label} style={[styles.statCell, index > 0 && styles.statCellBorder]}>
                  <Icon color={palette.muted} size={14} strokeWidth={1.7} />
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                  <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
                </View>
              ))}
            </View>


            <View
              style={styles.protectionRow}
              accessible
              accessibilityLabel={t('gamificationStats.protectionAccessibilityLabel', {
                status: protectionEnabled ? 'on' : 'off',
                defaultValue: `Streak protection ${protectionEnabled ? 'on' : 'off'}`,
              })}
            >
              <Shield color={palette.muted} size={18} strokeWidth={1.6} />
              <View style={styles.protectionCopy}>
                <Text style={styles.rowTitle}>
                  {t('gamificationStats.streakProtectionTitle', { defaultValue: 'Streak protection' })}
                </Text>
                <Text style={styles.rowDescription} numberOfLines={2}>
                  {protectionEnabled
                    ? t('gamificationStats.streakProtectionSafeDesc', {
                      defaultValue: 'Each missed day costs exactly 500 safe XP. Protection applies only when every missed day can be covered; your level and stones never drop.',
                    })
                    : t('gamificationStats.streakProtectionOffDesc', {
                      defaultValue: 'Enable Auto Streak Freeze in Settings. No XP is spent while off.',
                    })}
                </Text>
              </View>
              <Text style={[styles.statusText, protectionEnabled && styles.statusTextActive]}>
                {protectionEnabled
                  ? t('gamificationStats.protectionOn', { defaultValue: 'On' })
                  : t('gamificationStats.protectionOff', { defaultValue: 'Off' })}
              </Text>
            </View>

            <StreakCalendar
              history={gamestate.streakHistory}
              today={Gamification.toLocalDayKey()}
              palette={palette}
            />

            <View style={styles.collection}>
              <View style={styles.collectionHeader}>
                <View style={styles.collectionTitleRow}>
                  <Gem color={palette.muted} size={17} strokeWidth={1.6} />
                  <Text style={styles.collectionTitle}>
                    {t('gamificationStats.stonesTitle', { count: collectedStones.length, defaultValue: 'Stone collection' })}
                  </Text>
                </View>
                <Text style={styles.collectionPercent}>{collectionPct}%</Text>
              </View>

              <View style={styles.collectionSummary}>
                <Text style={styles.summaryText}>
                  <Text style={styles.summaryStrong}>{collectedStones.length} / {STONES_CATALOG.length}</Text>
                  {'  '}{t('gamificationStats.discoveredLabel', { defaultValue: 'discovered' })}
                </Text>
                <Text style={styles.summaryDot}>·</Text>
                <Text style={styles.summaryText}>
                  <Text style={styles.summaryStrong}>{formatNumber(totalShardsEarned)}</Text>
                  {'  '}{t('gamificationStats.shardsLabel', { defaultValue: 'shards' })}
                </Text>
              </View>

              {collectedStones.length === 0 ? (
                <Text style={styles.emptyText}>
                  {t('gamificationStats.stonesEmptyText', { defaultValue: 'Level up to discover your first stone.' })}
                </Text>
              ) : (
                <View style={styles.stonesGrid}>
                  {visibleStones.map((stone) => (
                    <View key={stone.level} style={[styles.stoneSlot, !compact && styles.stoneSlotWide]}>
                      <TouchableOpacity
                        style={styles.stoneItem}
                        onPress={() => setSelectedStone(stone)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`${stone.name}, ${stone.rarity?.label || ''}`}
                        accessibilityHint={t('gamificationStats.stoneDetailHint', { defaultValue: 'Opens stone details' })}
                      >
                        <Image source={stone.image} style={styles.stoneImage} resizeMode="contain" />
                        <Text style={styles.stoneName} numberOfLines={1}>{stone.name}</Text>
                        <Text style={styles.stoneLevel}>
                          {t('gamificationStats.levelShort', { level: stone.level, defaultValue: 'LVL {{level}}' })}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {collectedStones.length > PREVIEW_STONE_COUNT ? (
                <TouchableOpacity
                  style={styles.expandButton}
                  onPress={() => setShowAllStones((current) => !current)}
                  activeOpacity={0.65}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showAllStones }}
                  accessibilityLabel={showAllStones
                    ? t('gamificationStats.showLess', { defaultValue: 'Show less' })
                    : t('gamificationStats.viewAll', { defaultValue: 'View all stones' })}
                >
                  <Text style={styles.expandButtonText}>
                    {showAllStones
                      ? t('gamificationStats.showLess', { defaultValue: 'Show less' })
                      : t('gamificationStats.viewAll', { defaultValue: `View all ${collectedStones.length}` })}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>

      {selectedStone ? (
        <Modal
          transparent
          animationType="fade"
          visible
          statusBarTranslucent
          onRequestClose={() => setSelectedStone(null)}
        >
          <View
            style={[
              styles.detailBackdrop,
              {
                paddingTop: Math.max(insets.top, 16),
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <View
              style={[styles.detailSheet, { maxHeight: windowHeight - insets.top - insets.bottom - 32 }]}
              accessibilityViewIsModal
            >
              <View style={styles.detailHeader}>
                <Text style={styles.detailHeaderTitle}>
                  {t('gamificationStats.stoneDetailTitle', { defaultValue: 'Stone detail' })}
                </Text>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => setSelectedStone(null)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
                >
                  <X color={palette.muted} size={19} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
                <View style={styles.detailContent}>
                  <Image
                    source={selectedStone.image}
                    style={{ width: detailImageSize, height: detailImageSize }}
                    resizeMode="contain"
                  />
                  <View style={styles.detailCopy}>
                    <Text style={styles.detailName}>{selectedStone.name}</Text>
                    <Text style={styles.detailRarity}>{selectedStone.rarity?.label || ''}</Text>
                    <Text style={styles.detailDesc}>
                      {t('gamificationStats.unearthedAtLevel', {
                        level: selectedStone.level,
                        defaultValue: 'Unearthed at Level {{level}}',
                      })}
                    </Text>
                  </View>
                </View>
                <View style={styles.detailFacts}>
                  <View style={styles.detailFact}>
                    <Text style={styles.detailFactLabel}>{t('gamificationStats.unlockedLabel', { defaultValue: 'Unlocked' })}</Text>
                    <Text style={styles.detailFactValue}>
                      {t('gamificationStats.levelValue', { level: selectedStone.level, defaultValue: 'Level {{level}}' })}
                    </Text>
                  </View>
                  <View style={[styles.detailFact, styles.detailFactBorder]}>
                    <Text style={styles.detailFactLabel}>{t('gamificationStats.rewardLabel', { defaultValue: 'Reward' })}</Text>
                    <View style={styles.detailShardRow}>
                      <Hexagon color={palette.muted} size={12} />
                      <Text style={styles.detailFactValue}>
                        {t('gamificationStats.detailShards', {
                          shards: formatNumber(selectedStone.shards || 0),
                          defaultValue: '+{{shards}} Shards',
                        })}
                      </Text>
                    </View>
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </Modal>
  );
};


const makeStyles = (palette, compact) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
  },
  overlayCompact: {
    justifyContent: 'flex-end',
  },
  overlayWide: {
    justifyContent: 'center',
    paddingBottom: 12,
  },
  sheet: {
    backgroundColor: palette.bg,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: compact ? 20 : 22,
    borderBottomLeftRadius: compact ? 0 : 22,
    borderBottomRightRadius: compact ? 0 : 22,
    overflow: 'hidden',
  },
  header: {
    height: 54,
    paddingLeft: 18,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: compact ? 16 : 22,
    paddingTop: 14,
    paddingBottom: 12,
  },
  identity: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    width: 64,
    height: 64,
    marginRight: 13,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  displayName: {
    color: palette.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  username: {
    color: palette.muted,
    fontSize: 12,
    marginTop: 2,
  },
  levelBlock: {
    minWidth: 48,
    alignItems: 'flex-end',
  },
  levelLabel: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  levelValue: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '500',
  },
  xpStrip: {
    marginTop: 13,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  xpTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
  },
  microLabel: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  totalXp: {
    color: palette.text,
    fontSize: 27,
    lineHeight: 31,
    fontWeight: '500',
    letterSpacing: -0.8,
    marginTop: 1,
  },
  xpMeta: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
    paddingBottom: 1,
  },
  progressPrimary: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '600',
  },
  progressSecondary: {
    color: palette.muted,
    fontSize: 10,
    marginTop: 3,
    textAlign: 'right',
  },
  progressTrack: {
    height: 4,
    marginTop: 10,
    overflow: 'hidden',
    backgroundColor: palette.track,
  },
  progressFill: {
    height: '100%',
    backgroundColor: palette.text,
  },
  statsRail: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  statCell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    paddingVertical: 10,
  },
  statCellBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: palette.border,
  },
  statValue: {
    color: palette.text,
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: 3,
    maxWidth: '100%',
  },
  statLabel: {
    color: palette.muted,
    fontSize: compact ? 8 : 9,
    lineHeight: 11,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  protectionRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    gap: 11,
    paddingVertical: 10,
  },
  protectionCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '600',
  },
  rowDescription: {
    color: palette.muted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  statusText: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingLeft: 6,
  },
  statusTextActive: {
    color: palette.text,
  },
  collection: {
    paddingTop: 15,
  },
  collectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collectionTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  collectionPercent: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  collectionSummary: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingVertical: 7,
  },
  summaryText: {
    color: palette.muted,
    fontSize: 10,
  },
  summaryStrong: {
    color: palette.text,
    fontWeight: '600',
  },
  summaryDot: {
    color: palette.muted,
    fontSize: 10,
    paddingHorizontal: 8,
  },
  emptyText: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  stonesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  stoneSlot: {
    width: '33.3333%',
    padding: 4,
  },
  stoneSlotWide: {
    width: '16.6667%',
  },
  stoneItem: {
    minHeight: compact ? 94 : 102,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.fill,
  },
  stoneImage: {
    width: compact ? 45 : 50,
    height: compact ? 45 : 50,
  },
  stoneName: {
    width: '100%',
    color: palette.text,
    fontSize: 9,
    fontWeight: '500',
    marginTop: 4,
    textAlign: 'center',
  },
  stoneLevel: {
    color: palette.muted,
    fontSize: 7,
    fontWeight: '600',
    letterSpacing: 0.7,
    marginTop: 2,
  },
  expandButton: {
    height: 44,
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  expandButtonText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '600',
  },

  detailBackdrop: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailSheet: {
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 20,
    backgroundColor: palette.bg,
    overflow: 'hidden',
  },
  detailHeader: {
    height: 52,
    paddingLeft: 17,
    paddingRight: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  detailHeaderTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '600',
  },
  detailContent: {
    minHeight: 142,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 16,
  },
  detailCopy: {
    flex: 1,
    minWidth: 0,
  },
  detailName: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  detailRarity: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  detailDesc: {
    color: palette.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 9,
  },
  detailFacts: {
    minHeight: 62,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  detailFact: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  detailFactBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: palette.border,
  },
  detailFactLabel: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  detailFactValue: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  detailShardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});

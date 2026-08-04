import { Flame, Gem, Hexagon, Shield, Snowflake, Sparkles, X } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { STONES_CATALOG } from '../config/stonesConfig';
import { useTheme } from '../context/ThemeContext';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';
import { XPAvatarRing } from './XPAvatarRing';

const { width } = Dimensions.get('window');

// ─── Unified Palette ───
const BG = '#000000';
const SURFACE = '#0A0A0A';
const SURFACE_2 = '#121214';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';

export const GamificationStatsModal = ({ isVisible, onClose, gamestate, profile }) => {
  const [selectedStone, setSelectedStone] = React.useState(null);
  const [protectionPreference, setProtectionPreference] = React.useState({ userId: null, enabled: false });
  const ACCENT = useTheme().theme.accent;
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);
  const { t } = useTranslation();

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

  const protectionEnabled = protectionPreference.userId === profile?.id && protectionPreference.enabled;

  if (!gamestate) return null;

  const currentLevel = gamestate.level || 1;
  const currentXP = gamestate.xp || 0;
  const streak = gamestate.streak || 0;

  const baseXPForCurrentLevel = Gamification.getRequiredXPForLevel(currentLevel);
  const baseXPForNextLevel = Gamification.getRequiredXPForLevel(currentLevel + 1);

  const totalXpNeededForNextLevel = baseXPForNextLevel - baseXPForCurrentLevel;
  const xpInCurrentLevel = currentXP - baseXPForCurrentLevel;
  const progressPct = Math.max(4, Math.min(100, (xpInCurrentLevel / totalXpNeededForNextLevel) * 100));
  const xpRemaining = Math.max(0, totalXpNeededForNextLevel - xpInCurrentLevel);

  const collectedStones = STONES_CATALOG.filter(s => currentLevel >= s.level);
  const totalShardsEarned = collectedStones.reduce((sum, s) => sum + (s.shards || 0), 0);
  // Only XP above the current level floor may fund streak protection.
  const safeProtectionXP = Math.max(0, currentXP - baseXPForCurrentLevel);

  const getAvatarSource = () => {
    if (profile?.avatar_url) return { uri: profile.avatar_url };
    const seed = profile?.avatar_seed || profile?.username || 'fallback';
    return { uri: `https://api.dicebear.com/7.x/adventurer/png?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9` };
  };

  return (
    <Modal visible={isVisible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          {/* Close */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <X color={MUTED} size={20} />
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
            {/* ── Hero: avatar + identity ── */}
            <View style={styles.hero}>
              <View style={styles.avatarWrap}>
                <XPAvatarRing
                  avatarSource={getAvatarSource()}
                  xp={currentXP}
                  level={currentLevel}
                  size={92}
                  strokeWidth={4}
                />
                <View style={styles.levelPill}>
                  <Text style={styles.levelPillText}>{currentLevel}</Text>
                </View>
              </View>

              <Text style={styles.displayName} numberOfLines={1}>
                {profile?.display_name || t('gamificationStats.headerTitle')}
              </Text>
              <Text style={styles.rankLabel}>
                {t('gamificationStats.levelValue', { level: currentLevel })} · {t('gamificationStats.currentRankLabel')}
              </Text>
            </View>

            {/* ── XP progress ── */}
            <View style={styles.xpBlock}>
              <View style={styles.xpTextRow}>
                <Text style={styles.xpText}>{t('gamificationStats.xpFraction', { current: xpInCurrentLevel, total: totalXpNeededForNextLevel })}</Text>
                <Text style={styles.xpTextMuted}>{t('gamificationStats.xpToNextLevel', { remaining: xpRemaining, nextLevel: currentLevel + 1 })}</Text>
              </View>
              <View style={styles.progressBarContainer}>
                <View style={styles.progressBarBg} />
                <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
              </View>
            </View>

            {/* ── Metrics row ── */}
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Flame color="#FB923C" size={22} fill="#FB923C33" />
                <Text style={styles.statValue}>{streak}</Text>
                <Text style={styles.statLabel}>{t('gamificationStats.activeStreakLabel')}</Text>
              </View>

              <View style={styles.statCard}>
                <Hexagon color={ACCENT} size={22} fill={ACCENT + '33'} />
                <Text style={styles.statValue}>{totalShardsEarned.toLocaleString()}</Text>
                <Text style={styles.statLabel}>{t('gamificationStats.shardsLabel', { defaultValue: 'Shards' })}</Text>
              </View>

              <View style={styles.statCard}>
                <Snowflake color="#60A5FA" size={22} />
                <Text style={styles.statValue}>{safeProtectionXP}</Text>
                <Text style={styles.statLabel}>
                  {t('gamificationStats.protectedXpLabel', { defaultValue: 'Safe XP' })}
                </Text>
              </View>
            </View>

            {/* ── Streak protection ── */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Shield color={ACCENT} size={15} />
                <Text style={styles.sectionTitle}>{t('gamificationStats.streakProtectionTitle')}</Text>
                <View style={[styles.protectionStatus, protectionEnabled && styles.protectionStatusOn]}>
                  <Text style={[styles.protectionStatusText, protectionEnabled && { color: ACCENT }]}>
                    {protectionEnabled
                      ? t('gamificationStats.protectionOn', { defaultValue: 'ON' })
                      : t('gamificationStats.protectionOff', { defaultValue: 'OFF' })}
                  </Text>
                </View>
              </View>
              <Text style={styles.bodyText}>
                {protectionEnabled
                  ? t('gamificationStats.streakProtectionSafeDesc', {
                    defaultValue: 'Uses up to 500 XP per missed day, only from XP earned in this level. Your level and stones stay safe.',
                  })
                  : t('gamificationStats.streakProtectionOffDesc', {
                    defaultValue: 'Enable Auto Streak Freeze in Settings to protect your streak. No XP is spent while it is off.',
                  })}
              </Text>
            </View>

            {/* ── Stones collected ── */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Gem color={ACCENT} size={15} />
                <Text style={styles.sectionTitle}>{t('gamificationStats.stonesTitle', { count: collectedStones.length })}</Text>
              </View>

              {collectedStones.length === 0 ? (
                <Text style={styles.emptyText}>{t('gamificationStats.stonesEmptyText')}</Text>
              ) : (
                <>
                  <Text style={styles.shardsEarnedNote}>
                    {t('gamificationStats.shardsEarnedNote', { shards: totalShardsEarned.toLocaleString() })}
                  </Text>
                  <View style={styles.stonesGrid}>
                    {collectedStones.map((stone) => {
                      const rColor = stone.rarity?.colors?.[1] || ACCENT;
                      return (
                        <TouchableOpacity
                          key={stone.level}
                          style={[styles.stoneItem, { borderColor: rColor + '55', shadowColor: rColor }]}
                          onPress={() => setSelectedStone(stone)}
                          activeOpacity={0.7}
                        >
                          <Image source={stone.image} style={styles.stoneImage} resizeMode="contain" />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </View>

      {/* ── Stone detail ── */}
      {selectedStone && (
        <Modal transparent animationType="fade" visible={!!selectedStone} onRequestClose={() => setSelectedStone(null)}>
          <View style={styles.detailBackdrop}>
            <View style={[styles.detailCard, { borderColor: (selectedStone.rarity?.colors?.[1] || ACCENT) + '66' }]}>
              <TouchableOpacity style={styles.detailClose} onPress={() => setSelectedStone(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X color={TEXT} size={22} />
              </TouchableOpacity>

              <View style={[styles.detailGlow, { backgroundColor: selectedStone.rarity?.glow || ACCENT + '40' }]} />
              <Image source={selectedStone.image} style={{ width: 150, height: 150 }} resizeMode="contain" />

              <Text style={styles.detailName}>{selectedStone.name}</Text>

              <View style={[styles.rarityBadge, { borderColor: selectedStone.rarity?.colors?.[1] || ACCENT, backgroundColor: (selectedStone.rarity?.colors?.[1] || ACCENT) + '1F' }]}>
                <Sparkles color={selectedStone.rarity?.colors?.[0] || ACCENT} size={11} />
                <Text style={[styles.rarityText, { color: selectedStone.rarity?.colors?.[0] || ACCENT }]}>{selectedStone.rarity.label}</Text>
              </View>

              {selectedStone.shards ? (
                <View style={styles.detailShardRow}>
                  <Hexagon color={ACCENT} size={14} fill={ACCENT} />
                  <Text style={styles.detailShardText}>{t('gamificationStats.detailShards', { shards: selectedStone.shards.toLocaleString() })}</Text>
                </View>
              ) : null}

              <Text style={styles.detailDesc}>{t('gamificationStats.unearthedAtLevel', { level: selectedStone.level })}</Text>
            </View>
          </View>
        </Modal>
      )}
    </Modal>
  );
};

const makeStyles = (ACCENT) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: width * 0.9,
    maxHeight: '86%',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
    padding: 2,
  },

  // Hero
  hero: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 22,
  },
  avatarWrap: {
    marginBottom: 14,
  },
  levelPill: {
    position: 'absolute',
    bottom: -4,
    left: '50%',
    marginLeft: -15,
    width: 30,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: BG,
  },
  levelPillText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '900',
  },
  displayName: {
    fontSize: 22,
    fontWeight: '800',
    color: TEXT,
    letterSpacing: 0.2,
  },
  rankLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // XP
  xpBlock: {
    marginBottom: 18,
  },
  xpTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  xpText: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT,
  },
  xpTextMuted: {
    fontSize: 11,
    fontWeight: '600',
    color: MUTED,
  },
  progressBarContainer: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    position: 'relative',
  },
  progressBarBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BORDER,
  },
  progressBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: ACCENT,
    borderRadius: 5,
  },

  // Metrics
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
  },
  statValue: {
    fontSize: 19,
    fontWeight: '800',
    color: TEXT,
  },
  statLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: MUTED,
    textAlign: 'center',
  },

  // Sections
  section: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    padding: 18,
    marginTop: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: TEXT,
  },
  protectionStatus: {
    marginLeft: 'auto',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE_2,
  },
  protectionStatusOn: {
    borderColor: ACCENT + '55',
    backgroundColor: ACCENT + '16',
  },
  protectionStatusText: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
  },
  accentInline: {
    color: ACCENT,
    fontWeight: '800',
  },
  emptyText: {
    color: MUTED,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  shardsEarnedNote: {
    color: ACCENT,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
  },
  stonesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-start',
  },
  stoneItem: {
    width: 58,
    height: 58,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: SURFACE_2,
    borderRadius: 14,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 2,
  },
  stoneImage: {
    width: 44,
    height: 44,
  },

  // Detail
  detailBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  detailCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 28,
    borderWidth: 1,
    backgroundColor: BG,
    padding: 32,
    alignItems: 'center',
    overflow: 'hidden',
  },
  detailGlow: {
    position: 'absolute',
    top: 20,
    width: 180,
    height: 180,
    borderRadius: 90,
    opacity: 0.35,
  },
  detailClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
    zIndex: 10,
  },
  detailName: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 20,
    marginBottom: 12,
    textAlign: 'center',
    color: TEXT,
  },
  rarityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 14,
    borderWidth: 1,
  },
  rarityText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  detailShardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ACCENT + '1A',
    borderWidth: 1,
    borderColor: ACCENT + '4D',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    marginBottom: 12,
  },
  detailShardText: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT,
  },
  detailDesc: {
    fontSize: 13,
    textAlign: 'center',
    color: MUTED,
  },
});

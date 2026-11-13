import { Award, CalendarDays, Gem, Hexagon, X, Zap } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { StoneCollectionModal } from './StoneCollectionModal';

// ─── Unified Palette ───
const BG = '#000000';
const SURFACE = '#0A0A0A';
const SURFACE_2 = '#121214';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';
const FAINT = '#3F3F46';

export const GamificationGuideModal = ({ isVisible, onClose, gamestate }) => {
  const insets = useSafeAreaInsets();
  const [isStoneModalOpen, setIsStoneModalOpen] = useState(false);
  const ACCENT = useTheme().theme.accent;
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);
  const { t } = useTranslation();

  return (
    <Modal visible={isVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('gamificationGuide.headerTitle')}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X color={MUTED} size={24} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.introText}>
            {t('gamificationGuide.introText')}
          </Text>

          {/* Stone Catalog Button */}
          <TouchableOpacity style={styles.stoneCatalogBtn} onPress={() => setIsStoneModalOpen(true)} activeOpacity={0.8}>
            <Gem color={ACCENT} size={26} />
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={styles.stoneBtnTitle}>{t('gamificationGuide.stoneCatalogTitle')}</Text>
              <Text style={styles.stoneBtnSub}>{t('gamificationGuide.stoneCatalogSubtitle', { level: gamestate?.level || 1 })}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* Earning XP */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Zap color={ACCENT} size={20} />
              <Text style={styles.cardTitle}>{t('gamificationGuide.earningXpTitle')}</Text>
            </View>
            <Text style={styles.cardDesc}>
              {t('gamificationGuide.earningXpDesc')}
            </Text>

            <View style={styles.xpRow}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: FAINT }]} /><Text style={styles.xpLabel}>{t('gamificationGuide.lowPriorityLabel')}</Text></View>
              <Text style={styles.xpAmount}>+5</Text>
            </View>
            <View style={styles.xpRow}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: MUTED }]} /><Text style={styles.xpLabel}>{t('gamificationGuide.basicTaskLabel')}</Text></View>
              <Text style={styles.xpAmount}>+10</Text>
            </View>
            <View style={styles.xpRow}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: '#FFFFFF' }]} /><Text style={styles.xpLabel}>{t('gamificationGuide.importantLabel')}</Text></View>
              <Text style={styles.xpAmount}>+40</Text>
            </View>
            <View style={[styles.xpRow, { borderBottomWidth: 0 }]}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: ACCENT }]} /><Text style={styles.xpLabel}>{t('gamificationGuide.urgentLabel')}</Text></View>
              <Text style={styles.xpAmount}>+50</Text>
            </View>
          </View>

          {/* Shards & Marketplace */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Hexagon color={ACCENT} size={20} fill={ACCENT} />
              <Text style={styles.cardTitle}>{t('gamificationGuide.shardsMarketplaceTitle')}</Text>
            </View>
            <Text style={styles.cardDesc}>
              {t('gamificationGuide.shardsMarketplaceDesc')}
            </Text>
            <View style={styles.xpRow}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: FAINT }]} /><Text style={styles.xpLabel}>{t('gamificationGuide.commonStoneLabel')}</Text></View>
              <Text style={styles.xpAmount}>10–35</Text>
            </View>
            <View style={styles.xpRow}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: '#FFFFFF' }]} /><Text style={styles.xpLabel}>{t('gamificationGuide.epicStoneLabel')}</Text></View>
              <Text style={styles.xpAmount}>400–850</Text>
            </View>
            <View style={[styles.xpRow, { borderBottomWidth: 0 }]}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: ACCENT }]} /><Text style={styles.xpLabel}>{t('gamificationGuide.mythicStoneLabel')}</Text></View>
              <Text style={styles.xpAmount}>2.8k–10k</Text>
            </View>
          </View>

          {/* Streaks & Freezes */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <CalendarDays color={ACCENT} size={20} />
              <Text style={styles.cardTitle}>{t('gamificationGuide.streaksFreezesTitle')}</Text>
            </View>
            <Text style={styles.cardDesc}>
              {t('gamificationGuide.streaksFreezesDesc')}
            </Text>
            <View style={styles.freezeBox}>
              <Text style={styles.freezeTitle}>
                {t('gamificationGuide.streakFreezeSafeTitle', { defaultValue: 'Streak Freeze · Up to 500 XP' })}
              </Text>
              <Text style={styles.freezeDesc}>
                {t('gamificationGuide.streakFreezeSafeDesc', {
                  defaultValue: 'When enabled, protection spends only XP earned in your current level. Your level and unlocked stones are never reduced.',
                })}
              </Text>
            </View>
          </View>

          {/* Level Progression */}
          <View style={[styles.card, { marginBottom: 40 }]}>
            <View style={styles.cardHeader}>
              <Award color={ACCENT} size={20} />
              <Text style={styles.cardTitle}>{t('gamificationGuide.levelProgressionTitle')}</Text>
            </View>
            <Text style={styles.cardDesc}>{t('gamificationGuide.levelProgressionDesc')}</Text>
            <View style={styles.levelTable}>
              {[
                [t('gamificationGuide.level1'), t('gamificationGuide.xp0')],
                [t('gamificationGuide.level2'), t('gamificationGuide.xp200')],
                [t('gamificationGuide.level3'), t('gamificationGuide.xp500')],
                [t('gamificationGuide.level4'), t('gamificationGuide.xp900')],
                [t('gamificationGuide.level5'), t('gamificationGuide.xp1400')],
                [t('gamificationGuide.level10'), t('gamificationGuide.xp5400')],
                [t('gamificationGuide.level20'), t('gamificationGuide.xp20900')],
              ].map(([lvl, xp]) => (
                <View style={styles.levelRow} key={lvl}>
                  <Text style={styles.levelCol}>{lvl}</Text>
                  <Text style={styles.xpCol}>{xp}</Text>
                </View>
              ))}
              <View style={[styles.levelRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.levelCol, { color: ACCENT, fontWeight: '800' }]}>{t('gamificationGuide.level30')}</Text>
                <Text style={[styles.xpCol, { color: ACCENT, fontWeight: '800' }]}>{t('gamificationGuide.xp46400')}</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>

      <StoneCollectionModal
        isVisible={isStoneModalOpen}
        onClose={() => setIsStoneModalOpen(false)}
        currentLevel={gamestate?.level || 1}
      />
    </Modal>
  );
};

const makeStyles = (ACCENT) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
    color: TEXT,
  },
  closeButton: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  introText: {
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 24,
    color: MUTED,
  },
  stoneCatalogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: ACCENT + '1A',
    padding: 18,
    marginBottom: 24,
  },
  stoneBtnTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '700',
  },
  stoneBtnSub: {
    color: ACCENT,
    fontSize: 13,
    marginTop: 3,
  },
  chevron: {
    color: ACCENT,
    fontSize: 26,
    fontWeight: '300',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: TEXT,
  },
  cardDesc: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
    color: MUTED,
  },
  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  xpBullet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  xpLabel: {
    color: TEXT,
    fontSize: 15,
  },
  xpAmount: {
    color: TEXT,
    fontWeight: '800',
    fontSize: 15,
  },
  freezeBox: {
    backgroundColor: SURFACE_2,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  freezeTitle: {
    color: ACCENT,
    fontWeight: '700',
    marginBottom: 6,
    fontSize: 15,
  },
  freezeDesc: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
  },
  levelTable: {
    backgroundColor: SURFACE_2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  levelCol: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '500',
  },
  xpCol: {
    color: MUTED,
    fontSize: 15,
  },
});

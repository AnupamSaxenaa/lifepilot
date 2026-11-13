import { Hexagon, Lock, Sparkles, X } from 'lucide-react-native';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STONES_CATALOG } from '../config/stonesConfig';
import { useTheme } from '../context/ThemeContext';
import { StoneIcon } from './StoneIcon';

const { width, height: WINDOW_H } = Dimensions.get('window');
const ITEM_SIZE = (width - 48 - 32) / 3;

/**
 * Wraps a section so it "unrolls" like a paper scroll as it enters the
 * viewport from the bottom: curled (rotateX) + faded + pushed down when far,
 * flattening out as it scrolls up into view.
 */
const PaperRollSection = ({ scrollY, viewportH, children, style }) => {
  const y = useSharedValue(0);
  const h = useSharedValue(0);

  const onLayout = (e) => {
    y.value = e.nativeEvent.layout.y;
    h.value = e.nativeEvent.layout.height;
  };

  const animatedStyle = useAnimatedStyle(() => {
    const vp = viewportH.value || WINDOW_H;
    // Animate from the leading edge. A tall section can extend far below the
    // viewport, so using its bottom edge would keep it curled until too late.
    const topOnScreen = y.value - scrollY.value;
    const flatAt = vp * 0.58;
    const rollAt = vp * 0.96;
    const rowHeight = Math.max(h.value, 1);

    // Two-sided tissue-roll motion: peel open from the bottom, remain flat in
    // the reading area, then curl away again at the top.
    const curl = interpolate(
      topOnScreen,
      [-rowHeight, 0, flatAt, rollAt],
      [-82, 0, 0, 82],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      topOnScreen,
      [-rowHeight, 0, flatAt, rollAt],
      [0.24, 1, 1, 0.28],
      Extrapolation.CLAMP,
    );
    const translateY = interpolate(
      topOnScreen,
      [-rowHeight, 0, flatAt, rollAt],
      [-30, 0, 0, 34],
      Extrapolation.CLAMP,
    );
    const scaleY = interpolate(
      topOnScreen,
      [-rowHeight, 0, flatAt, rollAt],
      [0.68, 1, 1, 0.66],
      Extrapolation.CLAMP,
    );
    const halfH = rowHeight / 2;

    return {
      opacity,
      backfaceVisibility: 'hidden',
      transform: [
        { perspective: 520 },
        { translateY: -halfH },
        { rotateX: `${curl}deg` },
        { translateY: halfH + translateY },
        { scaleY },
      ],
    };
  });

  return (
    <Animated.View onLayout={onLayout} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
};

// ─── Unified Palette ───
const BG = '#000000';
const SURFACE = '#0A0A0A';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';

export const StoneCollectionModal = ({ isVisible, onClose, currentLevel = 1 }) => {
  const insets = useSafeAreaInsets();
  const [selectedStone, setSelectedStone] = useState(null);
  const ACCENT = useTheme().theme.accent;
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);

  const scrollY = useSharedValue(0);
  const viewportH = useSharedValue(WINDOW_H);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const unlockedCount = STONES_CATALOG.filter(s => currentLevel >= s.level).length;

  // Group the catalog by rarity, preserving catalog order.
  const rarityGroups = useMemo(() => {
    const order = [];
    const map = {};
    STONES_CATALOG.forEach((stone) => {
      const label = stone.rarity?.label || 'Common';
      if (!map[label]) {
        map[label] = { label, rarity: stone.rarity, stones: [] };
        order.push(label);
      }
      map[label].stones.push(stone);
    });
    return order.map((label) => map[label]);
  }, []);

  const handleStoneTap = (stone) => {
    if (currentLevel >= stone.level) {
      setSelectedStone(stone);
    } else {
      Alert.alert(t('stoneCollection.lockedMineralTitle'), t('stoneCollection.lockedMineralMessage', { level: stone.level, name: stone.name }));
    }
  };

  const detailColor = selectedStone?.rarity?.colors?.[1] || ACCENT;
  const detailColorLight = selectedStone?.rarity?.colors?.[0] || ACCENT;

  return (
    <Modal visible={isVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('stoneCollection.headerTitle')}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X color={MUTED} size={24} />
          </TouchableOpacity>
        </View>

        <Animated.ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          onLayout={(e) => { viewportH.value = e.nativeEvent.layout.height; }}
        >
          {/* Progress */}
          <PaperRollSection scrollY={scrollY} viewportH={viewportH} style={styles.progressCard}>
            <View style={styles.progressRow}>
              <View>
                <Text style={styles.progressLabel}>{t('stoneCollection.yourLevelLabel')}</Text>
                <Text style={styles.progressValue}>{currentLevel}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.progressLabel}>{t('stoneCollection.collectionLabel')}</Text>
                <Text style={[styles.progressValue, { color: ACCENT }]}>
                  {unlockedCount} <Text style={{ fontSize: 15, color: MUTED }}>/ {STONES_CATALOG.length}</Text>
                </Text>
              </View>
            </View>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarFill, { width: `${(unlockedCount / STONES_CATALOG.length) * 100}%` }]} />
            </View>
          </PaperRollSection>

          <Text style={styles.subtitle}>{t('stoneCollection.subtitle')}</Text>

          {/* Rarity groups — each row peels independently from the roll. */}
          {rarityGroups.map((group) => {
            const gColor = group.rarity?.colors?.[1] || ACCENT;
            const gColorLight = group.rarity?.colors?.[0] || ACCENT;
            const groupUnlocked = group.stones.filter(s => currentLevel >= s.level).length;
            const rows = [];
            for (let i = 0; i < group.stones.length; i += 3) rows.push(group.stones.slice(i, i + 3));

            return (
              <Fragment key={group.label}>
                <PaperRollSection scrollY={scrollY} viewportH={viewportH} style={styles.rarityHeaderSection}>
                  <View style={styles.rarityHeader}>
                    <View style={[styles.rarityDot, { backgroundColor: gColor, shadowColor: gColor }]} />
                    <Text style={[styles.rarityHeaderText, { color: gColorLight }]}>{group.label}</Text>
                    <View style={styles.rarityHeaderLine} />
                    <Text style={styles.rarityCount}>{groupUnlocked}/{group.stones.length}</Text>
                  </View>
                </PaperRollSection>

                {rows.map((row, rowIndex) => (
                  <PaperRollSection
                    key={`${group.label}-${rowIndex}`}
                    scrollY={scrollY}
                    viewportH={viewportH}
                    style={[styles.grid, rowIndex === rows.length - 1 && styles.rarityLastRow]}
                  >
                    {row.map((stone) => {
                      const isUnlocked = currentLevel >= stone.level;
                      return (
                        <TouchableOpacity
                          key={stone.level}
                          style={[
                            styles.stoneBox,
                            isUnlocked
                              ? { borderColor: gColor + '66', shadowColor: gColor, shadowOpacity: 0.45 }
                              : { borderColor: BORDER },
                          ]}
                          onPress={() => handleStoneTap(stone)}
                          activeOpacity={0.7}
                        >
                          <StoneIcon imageSource={stone.image} size={ITEM_SIZE - 30} isLocked={!isUnlocked} />

                          {!isUnlocked ? (
                            <>
                              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
                              <View style={styles.labelContainer}>
                                <Lock color={MUTED} size={15} />
                                <Text style={styles.lockedLevel}>{t('stoneCollection.lvlLabel', { level: stone.level })}</Text>
                                <View style={styles.shardChip}>
                                  <Hexagon color={ACCENT} size={10} fill={ACCENT} />
                                  <Text style={styles.shardChipText}>{stone.shards?.toLocaleString()}</Text>
                                </View>
                              </View>
                            </>
                          ) : (
                            <View style={styles.labelContainer}>
                              <Text style={styles.stoneLabel} numberOfLines={2}>{stone.name}</Text>
                              <View style={styles.shardChip}>
                                <Hexagon color={ACCENT} size={10} fill={ACCENT} />
                                <Text style={styles.shardChipText}>{stone.shards?.toLocaleString()}</Text>
                              </View>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </PaperRollSection>
                ))}
              </Fragment>
            );
          })}
          <View style={{ height: 40 }} />
        </Animated.ScrollView>
      </View>

      {/* Stone Detail */}
      {selectedStone && (
        <Modal transparent animationType="fade" visible={!!selectedStone} onRequestClose={() => setSelectedStone(null)}>
          <View style={styles.detailBackdrop}>
            <View style={[styles.detailCard, { borderColor: detailColor + '66' }]}>
              <TouchableOpacity style={styles.detailClose} onPress={() => setSelectedStone(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X color={TEXT} size={22} />
              </TouchableOpacity>

              <View style={[styles.detailGlow, { backgroundColor: selectedStone.rarity?.glow || ACCENT + '40' }]} />
              <StoneIcon imageSource={selectedStone.image} size={150} isLocked={false} />

              <Text style={styles.detailName}>{selectedStone.name}</Text>

              <View style={[styles.rarityBadge, { borderColor: detailColor, backgroundColor: detailColor + '1F' }]}>
                <Sparkles color={detailColorLight} size={11} />
                <Text style={[styles.rarityText, { color: detailColorLight }]}>{selectedStone.rarity.label}</Text>
              </View>

              <View style={styles.detailShardRow}>
                <Hexagon color={ACCENT} size={15} fill={ACCENT} />
                <Text style={styles.detailShardText}>{t('stoneCollection.shardsEarned', { shards: selectedStone.shards?.toLocaleString() })}</Text>
              </View>

              <Text style={styles.detailDesc}>{t('stoneCollection.unearthedAtLevel', { level: selectedStone.level })}</Text>
            </View>
          </View>
        </Modal>
      )}
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
  scrollContent: {
    padding: 24,
  },
  progressCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ACCENT + '4D',
    backgroundColor: ACCENT + '14',
    padding: 20,
    marginBottom: 20,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressValue: {
    color: TEXT,
    fontSize: 24,
    fontWeight: '900',
    marginTop: 2,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
    color: MUTED,
  },
  rarityHeaderSection: {
    marginTop: 8,
    marginBottom: 14,
  },
  rarityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rarityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 3,
  },
  rarityHeaderText: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  rarityHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: BORDER,
  },
  rarityCount: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
  },
  rarityLastRow: {
    marginBottom: 24,
  },
  stoneBox: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.25,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 12,
    overflow: 'hidden',
    position: 'relative',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    elevation: 2,
  },
  labelContainer: {
    position: 'absolute',
    bottom: 8,
    left: 4,
    right: 4,
    alignItems: 'center',
  },
  stoneLabel: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    color: TEXT,
    opacity: 0.9,
  },
  lockedLevel: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
    color: MUTED,
  },
  shardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  shardChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: ACCENT,
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
    marginBottom: 14,
  },
  detailShardText: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT,
  },
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
  detailDesc: {
    fontSize: 13,
    textAlign: 'center',
    color: MUTED,
  },
});

import { ArrowRight, Hexagon, Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import { STONES_CATALOG } from '../config/stonesConfig';
import { useTheme } from '../context/ThemeContext';
import { StoneIcon } from './StoneIcon';

const { width, height } = Dimensions.get('window');

export const LevelUpModal = ({ isVisible, oldLevel, newLevel, onClose }) => {
  const ACCENT = useTheme().theme.accent;
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);
  const { t } = useTranslation();
  const [showConfetti, setShowConfetti] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isVisible) {
      scaleAnim.setValue(0.8);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 60,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        })
      ]).start();
      
      const timer = setTimeout(() => setShowConfetti(true), 350);
      return () => clearTimeout(timer);
    } else {
      setShowConfetti(false);
    }
  }, [isVisible]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      })
    ]).start(() => {
      onClose();
    });
  };

  if (!isVisible || !newLevel) return null;

  // Find the stone for the new level
  const stone = STONES_CATALOG.find(s => s.level === newLevel) || STONES_CATALOG[STONES_CATALOG.length - 1];

  return (
    <Modal transparent animationType="none" visible={isVisible} onRequestClose={handleClose}>
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        
        {/* Confetti Explosion (Elegant Silver/White/Grey) */}
        {showConfetti && (
          <ConfettiCannon 
            count={100} 
            origin={{ x: width / 2, y: -20 }} 
            autoStart={true} 
            fadeOut={true}
            colors={['#ffffff', '#e4e4e7', '#a1a1aa', '#71717a']}
            fallSpeed={2500}
          />
        )}

        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
            <X color="#71717a" size={24} />
          </TouchableOpacity>

          <View style={styles.header}>
            <Sparkles color="#a1a1aa" size={20} />
            <Text style={styles.title}>{t('levelUp.title')}</Text>
            <Sparkles color="#a1a1aa" size={20} />
          </View>

          <View style={styles.levelTransition}>
            <Text style={styles.oldLevelText}>{t('levelUp.levelLabel', { level: oldLevel })}</Text>
            <View style={styles.arrowContainer}>
              <ArrowRight color="#71717a" size={18} />
            </View>
            <Text style={styles.newLevelText}>{t('levelUp.levelLabel', { level: newLevel })}</Text>
          </View>

          <View style={styles.stoneContainer}>
            <View style={[styles.glow, { backgroundColor: stone.rarity.colors[0] }]} />
            <StoneIcon imageSource={stone.image} size={140} isLocked={false} />
          </View>

          <Text style={styles.unlockedText}>{t('levelUp.newStoneUnlocked')}</Text>
          <Text style={[styles.stoneName, { color: stone.rarity.colors[0] }]}>{stone.name}</Text>
          
          <View style={[styles.rarityBadge, { backgroundColor: '#18181b', borderColor: stone.rarity.colors[2] }]}>
            <Text style={[styles.rarityText, { color: stone.rarity.colors[0] }]}>
              {stone.rarity.label}
            </Text>
          </View>

          {/* Shard reward for unlocking this stone */}
          {stone.shards ? (
            <View style={styles.shardReward}>
              <Hexagon color={ACCENT} size={16} fill={ACCENT} />
              <Text style={styles.shardRewardText}>{t('levelUp.shardReward', { shards: stone.shards.toLocaleString() })}</Text>
            </View>
          ) : null}
          <Text style={styles.shardHint}>{t('levelUp.shardHint')}</Text>

          <TouchableOpacity onPress={handleClose} activeOpacity={0.8} style={{ width: '100%' }}>
            <View style={styles.continueBtn}>
              <Text style={styles.continueText}>{t('levelUp.continueButton')}</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const makeStyles = (ACCENT) => StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  card: {
    width: width * 0.85,
    backgroundColor: '#09090b',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 15,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  title: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 4,
    marginHorizontal: 12,
  },
  levelTransition: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 16,
    marginBottom: 35,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  arrowContainer: {
    marginHorizontal: 16,
  },
  oldLevelText: {
    color: '#71717a',
    fontSize: 18,
    fontWeight: '600',
  },
  newLevelText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  stoneContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  glow: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    opacity: 0.15,
    filter: 'blur(35px)',
  },
  unlockedText: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
  },
  stoneName: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  rarityBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 18,
    borderWidth: 1,
  },
  shardReward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: ACCENT + '1F',
    borderWidth: 1,
    borderColor: ACCENT + '59',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 10,
  },
  shardRewardText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  shardHint: {
    color: '#52525b',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 20,
    lineHeight: 16,
  },
  rarityText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  continueBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
  }
});

import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, ScrollView, Dimensions, Alert } from 'react-native';
import { X, Lock, Gem } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/theme';
import { STONES_CATALOG } from '../config/stonesConfig';
import { StoneIcon } from './StoneIcon';
import { BlurView } from 'expo-blur';

const { width } = Dimensions.get('window');
// 3 columns
const ITEM_SIZE = (width - 48 - 32) / 3; 

export const StoneCollectionModal = ({ isVisible, onClose, currentLevel = 1 }) => {
  const theme = COLORS.dark;
  const insets = useSafeAreaInsets();
  const [selectedStone, setSelectedStone] = useState(null);

  const unlockedCount = STONES_CATALOG.filter(s => currentLevel >= s.level).length;

  const handleStoneTap = (stone) => {
    const isUnlocked = currentLevel >= stone.level;
    if (isUnlocked) {
      setSelectedStone(stone);
    } else {
      Alert.alert('Locked Mineral', `Reach Level ${stone.level} to unearth the ${stone.name}.`);
    }
  };

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: '#000000', paddingTop: Math.max(insets.top, 16) }]}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Stone Catalog</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <X color={theme.textMuted} size={28} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          
          {/* Progress Header */}
          <View style={[styles.progressCard, { backgroundColor: 'rgba(168, 85, 247, 0.1)', borderColor: 'rgba(168, 85, 247, 0.3)' }]}>
            <View style={styles.progressRow}>
              <View>
                <Text style={{ color: theme.textMuted, fontSize: 14 }}>Your Level</Text>
                <Text style={{ color: theme.text, fontSize: 24, fontWeight: '900' }}>{currentLevel}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: theme.textMuted, fontSize: 14 }}>Collection</Text>
                <Text style={{ color: '#A855F7', fontSize: 24, fontWeight: '900' }}>{unlockedCount} <Text style={{ fontSize: 16 }}>/ 30</Text></Text>
              </View>
            </View>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarFill, { width: `${(unlockedCount / 30) * 100}%` }]} />
            </View>
          </View>

          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            Level up to unearth rare minerals and mythical gems.
          </Text>

          <View style={styles.grid}>
            {STONES_CATALOG.map((stone, index) => {
              const isUnlocked = currentLevel >= stone.level;
              return (
                <TouchableOpacity 
                  key={stone.level} 
                  style={[styles.stoneBox, { backgroundColor: '#000000', borderColor: isUnlocked ? stone.rarity.colors[0] : theme.border }]} 
                  onPress={() => handleStoneTap(stone)}
                  activeOpacity={0.7}
                >
                  <StoneIcon 
                    imageSource={stone.image} 
                    size={ITEM_SIZE - 30} 
                    isLocked={!isUnlocked}
                  />
                  
                  {!isUnlocked ? (
                    <>
                      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
                      <View style={styles.unlockedLabelContainer}>
                        <Lock color={theme.textMuted} size={16} />
                        <Text style={[styles.lockedLevel, { color: theme.textMuted }]}>Lvl {stone.level}</Text>
                      </View>
                    </>
                  ) : (
                    <View style={styles.unlockedLabelContainer}>
                      <Text style={[styles.stoneLabel, { color: theme.text }]} numberOfLines={2}>
                        {stone.name}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      {/* Selected Stone Detail Popup */}
      {selectedStone && (
        <Modal transparent animationType="fade" visible={!!selectedStone} onRequestClose={() => setSelectedStone(null)}>
          <View style={styles.detailBackdrop}>
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={[styles.detailCard, { backgroundColor: '#000000', borderColor: selectedStone.rarity.colors[1] }]}>
              <TouchableOpacity style={styles.detailClose} onPress={() => setSelectedStone(null)}>
                <X color={theme.text} size={24} />
              </TouchableOpacity>
              
              <StoneIcon 
                imageSource={selectedStone.image} 
                size={160} 
                isLocked={false}
              />
              
              <Text style={[styles.detailName, { color: theme.text }]}>{selectedStone.name}</Text>
              
              <View style={[styles.rarityBadge, { backgroundColor: selectedStone.rarity.colors[2] }]}>
                <Text style={[styles.rarityText, { color: selectedStone.rarity.colors[0] }]}>
                  {selectedStone.rarity.label}
                </Text>
              </View>
              
              <Text style={[styles.detailDesc, { color: theme.textMuted }]}>
                Unearthed at Level {selectedStone.level}.
              </Text>
            </View>
          </View>
        </Modal>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
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
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#A855F7',
    borderRadius: 4,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  stoneBox: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.25,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  unlockedLabelContainer: {
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
    opacity: 0.9,
  },
  lockedLevel: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
  },
  detailBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  detailCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 2,
    padding: 32,
    alignItems: 'center',
    position: 'relative',
  },
  detailClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
    zIndex: 10,
  },
  detailName: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 20,
    marginBottom: 12,
    textAlign: 'center',
  },
  rarityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 16,
  },
  rarityText: {
    fontSize: 14,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  detailDesc: {
    fontSize: 15,
    textAlign: 'center',
  }
});

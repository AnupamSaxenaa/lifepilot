import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, Dimensions, useColorScheme, ScrollView, Image, Alert } from 'react-native';
import { Award, Flame, Star, X, Gem } from 'lucide-react-native';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';
import { BlurView } from 'expo-blur';
import { STONES_CATALOG } from '../config/stonesConfig';

const { width } = Dimensions.get('window');

export const GamificationStatsModal = ({ isVisible, onClose, gamestate, profile }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  
  const [selectedStone, setSelectedStone] = React.useState(null);

  if (!gamestate) return null;

  const currentLevel = gamestate.level || 1;
  const currentXP = gamestate.xp || 0;
  
  const baseXPForCurrentLevel = Gamification.getRequiredXPForLevel(currentLevel);
  const baseXPForNextLevel = Gamification.getRequiredXPForLevel(currentLevel + 1);
  
  const totalXpNeededForNextLevel = baseXPForNextLevel - baseXPForCurrentLevel;
  const xpInCurrentLevel = currentXP - baseXPForCurrentLevel;

  const collectedStones = STONES_CATALOG.filter(s => currentLevel >= s.level);

  return (
    <Modal
      visible={isVisible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <BlurView intensity={colorScheme === 'dark' ? 60 : 80} tint={colorScheme} style={StyleSheet.absoluteFill} />
        
        <View style={[styles.modalContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <X color={theme.textMuted} size={24} />
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
            <Text style={[styles.title, { color: theme.text }]}>Your Journey</Text>

          <View style={styles.statsGrid}>
            
            {/* Level Card */}
            <View style={[styles.statCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Award color="#A855F7" size={32} style={styles.icon} />
              <Text style={[styles.statValue, { color: theme.text }]}>Level {currentLevel}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>Current Rank</Text>
            </View>

            {/* Streak Card */}
            <View style={[styles.statCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Flame color="#EF4444" size={32} style={styles.icon} />
              <Text style={[styles.statValue, { color: theme.text }]}>{gamestate.streak} Days</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>Active Streak</Text>
            </View>

          </View>

          {/* XP Progress Section */}
          <View style={[styles.progressSection, { backgroundColor: theme.background, borderColor: theme.border, marginBottom: 20 }]}>
            <View style={styles.progressHeader}>
              <Star color="#F59E0B" size={20} />
              <Text style={[styles.progressTitle, { color: theme.text }]}>XP Progress</Text>
            </View>
            
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarBg, { backgroundColor: theme.border }]} />
              <View style={[styles.progressBarFill, { width: `${Math.max(5, (xpInCurrentLevel / totalXpNeededForNextLevel) * 100)}%` }]} />
            </View>

            <View style={styles.xpTextRow}>
              <Text style={[styles.xpText, { color: theme.text }]}>{xpInCurrentLevel} / {totalXpNeededForNextLevel} XP</Text>
              <Text style={[styles.xpTextMuted, { color: theme.textMuted }]}>{totalXpNeededForNextLevel - xpInCurrentLevel} XP to Level {currentLevel + 1}</Text>
            </View>
          </View>

            {/* Special Items / Freezes */}
            <View style={[styles.progressSection, { backgroundColor: theme.background, borderColor: theme.border, marginBottom: 20 }]}>
               <View style={styles.progressHeader}>
                  <Flame color="#0EA5E9" size={20} />
                  <Text style={[styles.progressTitle, { color: theme.text }]}>Streak Protection</Text>
               </View>
               <Text style={[styles.xpTextMuted, { color: theme.text, marginTop: -4, lineHeight: 20 }]}>
                 If you miss a day, the system will automatically consume <Text style={{fontWeight:'700', color: '#F59E0B'}}>500 XP</Text> per missed day to save your streak.
               </Text>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <Text style={{ fontSize: 13, color: theme.textMuted, fontWeight: '600' }}>Available Freezes:</Text>
                  <Text style={{ fontSize: 14, color: theme.text, fontWeight: '800' }}>{Math.floor(currentXP / 500)} Days</Text>
               </View>
            </View>

            {/* Stones Collected */}
            <View style={[styles.progressSection, { backgroundColor: theme.background, borderColor: theme.border }]}>
               <View style={styles.progressHeader}>
                  <Gem color="#A855F7" size={20} />
                  <Text style={[styles.progressTitle, { color: theme.text }]}>Stones Collected ({collectedStones.length})</Text>
               </View>
               
               {collectedStones.length === 0 ? (
                 <Text style={{ color: theme.textMuted, fontSize: 13, textAlign: 'center', marginTop: 10 }}>
                   Level up to start collecting rare stones!
                 </Text>
               ) : (
                 <View style={styles.stonesGrid}>
                   {collectedStones.map((stone) => (
                     <TouchableOpacity 
                       key={stone.level} 
                       style={styles.stoneItem}
                       onPress={() => setSelectedStone(stone)}
                       activeOpacity={0.7}
                     >
                       <Image 
                         source={stone.image} 
                         style={styles.stoneImage} 
                         resizeMode="contain" 
                       />
                     </TouchableOpacity>
                   ))}
                 </View>
               )}
            </View>

            {/* Reset Stats */}
            <TouchableOpacity 
              style={{ marginTop: 24, marginHorizontal: 20, padding: 14, borderRadius: 12, backgroundColor: '#EF444420', alignItems: 'center' }}
              onPress={() => {
                Alert.alert('Reset Progress', 'Are you sure you want to reset your Level, XP, and Streak to zero? This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Reset', style: 'destructive', onPress: async () => {
                     if (profile?.id) {
                       await Gamification.saveState(profile.id, { xp: 0, level: 1, streak: 0, last_active_date: null });
                       onClose(); 
                     }
                  }}
                ]);
              }}
            >
              <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14 }}>Reset Progress Data</Text>
            </TouchableOpacity>
          </ScrollView>

        </View>
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
              
              <Image 
                source={selectedStone.image} 
                style={{ width: 160, height: 160 }} 
                resizeMode="contain" 
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: width * 0.85,
    maxHeight: '80%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    padding: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressSection: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressBarContainer: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 12,
  },
  progressBarBg: {
    ...StyleSheet.absoluteFillObject,
  },
  progressBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#F59E0B', // Gold
    borderRadius: 6,
  },
  xpTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  xpText: {
    fontSize: 14,
    fontWeight: '700',
  },
  xpTextMuted: {
    fontSize: 12,
    fontWeight: '500',
  },
  stonesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
    justifyContent: 'center',
  },
  stoneItem: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#09090b', // Deep dark for contrast
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  stoneImage: {
    width: 48,
    height: 48,
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

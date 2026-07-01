import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import { X, Award, Flame, Zap, Target, Gem } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/theme';
import { StoneCollectionModal } from './StoneCollectionModal';

export const GamificationGuideModal = ({ isVisible, onClose, gamestate }) => {
  const theme = COLORS.dark; // Force dark mode for sleek look
  const insets = useSafeAreaInsets();
  const [isStoneModalOpen, setIsStoneModalOpen] = useState(false);

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.background, paddingTop: Math.max(insets.top, 16) }]}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>XP & Rewards Guide</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <X color={theme.textMuted} size={28} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          
          <Text style={[styles.introText, { color: theme.textMuted }]}>
            Welcome to LifePilot's Gamification Engine. Completing tasks earns you Experience Points (XP). Level up to unlock higher ranks and build an unbreakable streak!
          </Text>

          {/* Stone Catalog Button */}
          <TouchableOpacity 
            style={[styles.stoneCatalogBtn, { backgroundColor: 'rgba(168, 85, 247, 0.15)', borderColor: '#A855F7' }]}
            onPress={() => setIsStoneModalOpen(true)}
            activeOpacity={0.8}
          >
            <View style={styles.stoneBtnContent}>
              <Gem color="#A855F7" size={28} />
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>Stone Catalog</Text>
                <Text style={{ color: '#A855F7', fontSize: 14, marginTop: 4 }}>View your collection (Level {gamestate?.level || 1})</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Section: Task XP */}
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <Zap color="#F59E0B" size={24} />
              <Text style={[styles.cardTitle, { color: theme.text }]}>Earning XP</Text>
            </View>
            <Text style={[styles.cardDesc, { color: theme.textMuted }]}>
              XP scales based on how critical your task is. Focus on high priority items to level up faster!
            </Text>
            <View style={styles.xpRow}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: '#10B981' }]} /><Text style={{ color: theme.text, fontSize: 16 }}>Low Priority</Text></View>
              <Text style={styles.xpAmount}>+5 XP</Text>
            </View>
            <View style={styles.xpRow}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: '#6B7280' }]} /><Text style={{ color: theme.text, fontSize: 16 }}>Basic Task</Text></View>
              <Text style={styles.xpAmount}>+10 XP</Text>
            </View>
            <View style={styles.xpRow}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: '#F59E0B' }]} /><Text style={{ color: theme.text, fontSize: 16 }}>Important (High)</Text></View>
              <Text style={styles.xpAmount}>+40 XP</Text>
            </View>
            <View style={[styles.xpRow, { borderBottomWidth: 0 }]}>
              <View style={styles.xpBullet}><View style={[styles.dot, { backgroundColor: '#EF4444' }]} /><Text style={{ color: theme.text, fontSize: 16 }}>Urgent Task</Text></View>
              <Text style={styles.xpAmount}>+50 XP</Text>
            </View>
          </View>

          {/* Section: Streaks & Freezes */}
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <Flame color="#EF4444" size={24} />
              <Text style={[styles.cardTitle, { color: theme.text }]}>Streaks & Freezes</Text>
            </View>
            <Text style={[styles.cardDesc, { color: theme.textMuted }]}>
              Complete at least one task every day to keep your streak alive. The fire icon on your dashboard will evolve as your streak grows!
            </Text>
            <View style={styles.freezeBox}>
               <Text style={{ color: '#0EA5E9', fontWeight: 'bold', marginBottom: 4, fontSize: 16 }}>❄️ Streak Freeze (500 XP)</Text>
               <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 20 }}>
                 If you miss a day, the system will automatically consume 500 XP per missed day to save your streak from resetting.
               </Text>
            </View>
          </View>

          {/* Section: Leveling Curve */}
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: 40 }]}>
            <View style={styles.cardHeader}>
              <Award color="#A855F7" size={24} />
              <Text style={[styles.cardTitle, { color: theme.text }]}>Level Progression</Text>
            </View>
            <Text style={[styles.cardDesc, { color: theme.textMuted }]}>
              Leveling up gets progressively harder. Can you reach the legendary Level 30?
            </Text>
            <View style={styles.levelTable}>
              <View style={styles.levelRow}><Text style={styles.levelCol}>Level 1</Text><Text style={styles.xpCol}>0 XP</Text></View>
              <View style={styles.levelRow}><Text style={styles.levelCol}>Level 2</Text><Text style={styles.xpCol}>200 XP</Text></View>
              <View style={styles.levelRow}><Text style={styles.levelCol}>Level 3</Text><Text style={styles.xpCol}>500 XP</Text></View>
              <View style={styles.levelRow}><Text style={styles.levelCol}>Level 4</Text><Text style={styles.xpCol}>900 XP</Text></View>
              <View style={styles.levelRow}><Text style={styles.levelCol}>Level 5</Text><Text style={styles.xpCol}>1,400 XP</Text></View>
              <View style={styles.levelRow}><Text style={styles.levelCol}>Level 10</Text><Text style={styles.xpCol}>5,400 XP</Text></View>
              <View style={styles.levelRow}><Text style={styles.levelCol}>Level 20</Text><Text style={styles.xpCol}>20,900 XP</Text></View>
              <View style={[styles.levelRow, { borderBottomWidth: 0 }]}><Text style={[styles.levelCol, { color: '#A855F7', fontWeight: 'bold' }]}>Level 30</Text><Text style={[styles.xpCol, { color: '#A855F7', fontWeight: 'bold' }]}>46,400 XP</Text></View>
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
    padding: 24,
  },
  introText: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  xpBullet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  xpAmount: {
    color: '#10B981',
    fontWeight: 'bold',
    fontSize: 16,
  },
  freezeBox: {
    backgroundColor: 'rgba(14, 165, 233, 0.1)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(14, 165, 233, 0.3)',
  },
  levelTable: {
    backgroundColor: '#111',
    borderRadius: 12,
    overflow: 'hidden',
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  levelCol: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  xpCol: {
    color: '#aaa',
    fontSize: 16,
  },
  stoneCatalogBtn: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 24,
  },
  stoneBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
  }
});

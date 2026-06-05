import React from 'react';
import { StyleSheet, Text, View, SafeAreaView, ScrollView } from 'react-native';
import { CheckCircle, Clock, Zap } from 'lucide-react-native';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';

export const DashboardScreen = () => {
  return (
    <BackgroundWrapper>
      <SafeAreaView style={styles.container}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Text style={styles.title}>LifePilot</Text>
            <Text style={styles.subtitle}>Your AI Productivity Hub</Text>
          </View>
          
          <GlassCard style={styles.card}>
            <View style={styles.cardHeader}>
              <Zap color={COLORS.secondary} size={24} />
              <Text style={styles.cardTitle}>AI Assistant</Text>
            </View>
            <Text style={styles.cardText}>
              I've prepared your daily roadmap. You have 3 high-priority tasks in the Eisenhower Matrix.
            </Text>
            <GlassButton 
              title="Start Focus Session" 
              icon={Clock} 
              style={styles.button}
              onPress={() => {}}
            />
          </GlassCard>

          <View style={styles.row}>
            <GlassCard style={styles.halfCard}>
              <CheckCircle color={COLORS.primary} size={28} />
              <Text style={styles.metricTitle}>12</Text>
              <Text style={styles.metricSubtitle}>Tasks Done</Text>
            </GlassCard>
            
            <GlassCard style={styles.halfCard}>
              <Clock color={COLORS.secondary} size={28} />
              <Text style={styles.metricTitle}>2.5h</Text>
              <Text style={styles.metricSubtitle}>Deep Work</Text>
            </GlassCard>
          </View>
        </ScrollView>
      </SafeAreaView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: COLORS.text,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  card: {
    marginHorizontal: 24,
    marginTop: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginLeft: 8,
  },
  cardText: {
    fontSize: 15,
    color: COLORS.textMuted,
    lineHeight: 22,
    marginBottom: 20,
  },
  button: {
    marginTop: 'auto',
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    marginTop: 20,
  },
  halfCard: {
    flex: 1,
    marginHorizontal: 4,
    marginTop: 0,
  },
  metricTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 12,
  },
  metricSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 4,
  },
});

import React from 'react';
import { StyleSheet, Text, View, SafeAreaView, ScrollView, useColorScheme } from 'react-native';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';
import { CheckCircle, Clock, Zap } from 'lucide-react-native';

export const DashboardScreen = ({ navigation }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  return (
    <BackgroundWrapper>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text style={[styles.greeting, { color: theme.textMuted }]}>Good Morning,</Text>
            <Text style={[styles.name, { color: theme.text }]}>Anupam</Text>
          </View>

          <View style={styles.statsRow}>
            <GlassCard style={styles.statCard}>
              <CheckCircle color={theme.text} size={24} style={styles.icon} />
              <Text style={[styles.statValue, { color: theme.text }]}>12</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>Tasks</Text>
            </GlassCard>
            <GlassCard style={styles.statCard}>
              <Zap color={theme.text} size={24} style={styles.icon} />
              <Text style={[styles.statValue, { color: theme.text }]}>4</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>Focus Hours</Text>
            </GlassCard>
          </View>

          <View style={styles.actions}>
            <GlassButton 
              title="Start Focus Session" 
              icon={Clock} 
              style={styles.button}
              onPress={() => {}}
            />
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
    padding: 24,
  },
  header: {
    marginTop: 20,
    marginBottom: 32,
  },
  greeting: {
    fontSize: 16,
    marginBottom: 4,
  },
  name: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  statCard: {
    flex: 0.48,
    alignItems: 'center',
    paddingVertical: 24,
  },
  icon: {
    marginBottom: 12,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
  },
  actions: {
    gap: 16,
  },
  button: {
    width: '100%',
  },
});

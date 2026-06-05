import React from 'react';
import { StyleSheet, Text, View, SafeAreaView, useColorScheme, TouchableOpacity } from 'react-native';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';
import { LogIn } from 'lucide-react-native';

export const LoginScreen = ({ navigation }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  return (
    <BackgroundWrapper>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>LifePilot</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>Master your productivity</Text>
        </View>

        <View style={styles.formContainer}>
          <GlassCard>
            <GlassInput 
              placeholder="Email" 
              keyboardType="email-address"
            />
            <GlassInput 
              placeholder="Password" 
              secureTextEntry 
            />
            
            <GlassButton 
              title="Sign In" 
              icon={LogIn} 
              onPress={() => navigation.replace('Dashboard')} 
              style={{ marginTop: 12 }}
            />

            <View style={styles.divider}>
              <View style={[styles.line, { backgroundColor: theme.border }]} />
              <Text style={[styles.orText, { color: theme.textMuted }]}>OR</Text>
              <View style={[styles.line, { backgroundColor: theme.border }]} />
            </View>

            <GlassButton 
              title="Continue with Google" 
              onPress={() => {}} 
              style={{ marginTop: 4, backgroundColor: theme.background }}
            />

            <View style={styles.footer}>
              <Text style={{ color: theme.textMuted }}>Don't have an account? </Text>
              <TouchableOpacity>
                <Text style={{ color: theme.text, fontWeight: 'bold' }}>Register</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      </SafeAreaView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: -40,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    letterSpacing: 0.5,
  },
  formContainer: {
    paddingHorizontal: 24,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  line: {
    flex: 1,
    height: 1,
  },
  orText: {
    marginHorizontal: 16,
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
});

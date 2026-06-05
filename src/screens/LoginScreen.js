import React, { useState } from 'react';
import { StyleSheet, Text, View, KeyboardAvoidingView, Platform } from 'react-native';
import { Mail, Lock, ArrowRight } from 'lucide-react-native';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';

export const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = () => {
    // Later we will link this to Supabase! For now, navigate.
    navigation.replace('Dashboard');
  };

  return (
    <BackgroundWrapper>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>LifePilot</Text>
            <Text style={styles.subtitle}>Unlock your potential</Text>
          </View>

          <GlassCard style={styles.card}>
            <Text style={styles.cardTitle}>Welcome Back</Text>
            
            <GlassInput 
              icon={Mail}
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            
            <GlassInput 
              icon={Lock}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <View style={styles.forgotPasswordContainer}>
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </View>

            <GlassButton 
              title="Sign In" 
              icon={ArrowRight}
              onPress={handleLogin}
              style={styles.loginButton}
            />
          </GlassCard>
        </View>
      </KeyboardAvoidingView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: COLORS.text,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.textMuted,
    marginTop: 8,
  },
  card: {
    padding: 8,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 24,
    textAlign: 'center',
  },
  forgotPasswordContainer: {
    alignItems: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: COLORS.secondary,
    fontSize: 14,
    fontWeight: '500',
  },
  loginButton: {
    marginTop: 8,
  },
});

import React, { useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView, useColorScheme, TouchableOpacity, Alert } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';
import { Mail, ArrowLeft } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const ForgotPasswordScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  const handleRequestOTP = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    try {
      setLoading(true);
      
      const { error } = await supabase.auth.resetPasswordForEmail(email);

      if (error) throw error;

      Alert.alert(
        'Email Sent!', 
        'If an account exists, an 8-digit recovery code has been sent to your email.',
        [
          { text: 'Enter Code', onPress: () => navigation.navigate('ResetPassword', { email }) }
        ]
      );
      
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <BackgroundWrapper>
      <KeyboardAwareScrollView 
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        enableOnAndroid={true}
        enableAutomaticScroll={true}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={20}
      >
        <SafeAreaView style={styles.safeArea}>
          <TouchableOpacity 
            style={[styles.backButton, { top: Math.max(insets.top, 20) }]} 
            onPress={() => navigation.goBack()}
          >
            <ArrowLeft color={theme.text} size={28} />
          </TouchableOpacity>

          <View style={styles.headerContainer}>
            <Text style={[styles.title, { color: theme.text }]}>Reset Password</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              {"Enter your email address and we'll send you an 8-digit code to reset your password."}
            </Text>
          </View>

          <View style={styles.formContainer}>
            <GlassCard>
              <GlassInput
                placeholder="Email address"
                value={email}
                onChangeText={setEmail}
                icon={Mail}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <GlassButton 
                title={loading ? "Sending..." : "Send Recovery Code"} 
                onPress={handleRequestOTP} 
                style={{ marginTop: 24 }}
                disabled={loading}
              />
            </GlassCard>
          </View>
        </SafeAreaView>
      </KeyboardAwareScrollView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  safeArea: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    left: 24,
    zIndex: 10,
    padding: 8,
  },
  headerContainer: {
    alignItems: 'center',
    marginTop: 100,
    marginBottom: 40,
    paddingHorizontal: 24,
  },
  title: {
    fontFamily: 'PlaywriteGBJ_400Regular',
    fontSize: 32,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  formContainer: {
    paddingHorizontal: 24,
    width: '100%',
    paddingBottom: 40,
  },
});

import React, { useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView, useColorScheme, TouchableOpacity, Alert } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';
import { Lock, ArrowLeft, KeyRound } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';

export const ResetPasswordScreen = ({ route, navigation }) => {
  const email = route.params?.email || '';
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  const handleResetPassword = async () => {
    if (!token || !newPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      
      // Step 1: Verify the 8-digit OTP
      const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'recovery',
      });

      if (verifyError) throw verifyError;

      // Step 2: Now that they are securely authenticated, update the password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) throw updateError;

      Alert.alert(
        'Success!', 
        'Your password has been securely reset.',
        [
          { 
            text: 'Go to Dashboard', 
            onPress: () => navigation.reset({
              index: 0,
              routes: [{ name: 'Dashboard' }],
            }) 
          }
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
            <Text style={[styles.title, { color: theme.text }]}>New Password</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              Enter the 8-digit code sent to {email} and pick a secure new password.
            </Text>
          </View>

          <View style={styles.formContainer}>
            <GlassCard>
              <GlassInput
                placeholder="8-Digit Code"
                value={token}
                onChangeText={setToken}
                icon={KeyRound}
                keyboardType="number-pad"
              />

              <GlassInput
                placeholder="New Password"
                value={newPassword}
                onChangeText={setNewPassword}
                icon={Lock}
                secureTextEntry
              />

              <PasswordStrengthIndicator password={newPassword} />

              <GlassButton 
                title={loading ? "Updating..." : "Reset Password"} 
                onPress={handleResetPassword} 
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

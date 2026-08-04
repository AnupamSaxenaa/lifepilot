import { KeyRound, LockKeyhole } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import {
    AuthBackButton,
    AuthButton,
    AuthCard,
    AuthField,
    AuthHero,
    AuthScreen,
} from '../components/auth/AuthKit';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';
import { supabase } from '../lib/supabase';

export const ResetPasswordScreen = ({ route, navigation }) => {
  const { t } = useTranslation();
  const email = route.params?.email || '';
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async () => {
    if (!token || !newPassword) {
      Alert.alert(t('common.error'), t('resetPassword.errorMissingFields'));
      return;
    }

    try {
      setLoading(true);
      
      // Step 1: Verify the 8-digit OTP
      const { error: verifyError } = await supabase.auth.verifyOtp({
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
        t('resetPassword.successTitle'), 
        t('resetPassword.successMessage'),
        [
          { 
            text: t('resetPassword.goToDashboard'), 
            onPress: () => navigation.reset({
              index: 0,
              routes: [{ name: 'Dashboard' }],
            }) 
          }
        ]
      );
      
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen centered contentStyle={styles.screenContent}>
      <AuthBackButton onPress={() => navigation.goBack()} />
      <View style={styles.shell}>
        <AuthHero
          icon={KeyRound}
          title={t('resetPassword.title')}
          subtitle={t('resetPassword.subtitle', { email })}
        />
        <AuthCard>
          <AuthField
            index={0}
            icon={KeyRound}
            label={t('resetPassword.codePlaceholder')}
            placeholder={t('resetPassword.codePlaceholder')}
            value={token}
            onChangeText={setToken}
            keyboardType="number-pad"
            maxLength={8}
          />
          <AuthField
            index={1}
            icon={LockKeyhole}
            label={t('resetPassword.newPasswordPlaceholder')}
            placeholder={t('resetPassword.newPasswordPlaceholder')}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
          />
          <PasswordStrengthIndicator password={newPassword} />
          <AuthButton
            title={loading ? t('resetPassword.updating') : t('resetPassword.resetButton')}
            onPress={handleResetPassword}
            loading={loading}
            disabled={loading}
            style={styles.submitButton}
          />
        </AuthCard>
      </View>
    </AuthScreen>
  );
};

const styles = StyleSheet.create({
  screenContent: { paddingTop: 0 },
  shell: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  submitButton: { marginTop: 8 },
});

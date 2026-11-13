import { Mail } from 'lucide-react-native';
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
import { supabase } from '../lib/supabase';

export const ForgotPasswordScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequestOTP = async () => {
    if (!email) {
      Alert.alert(t('common.error'), t('forgotPassword.errorMissingEmail'));
      return;
    }

    try {
      setLoading(true);
      
      const { error } = await supabase.auth.resetPasswordForEmail(email);

      if (error) throw error;

      Alert.alert(
        t('forgotPassword.emailSentTitle'), 
        t('forgotPassword.emailSentMessage'),
        [
          { text: t('forgotPassword.enterCode'), onPress: () => navigation.navigate('ResetPassword', { email }) }
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
          icon={Mail}
          title={t('forgotPassword.title')}
          subtitle={t('forgotPassword.subtitle')}
        />
        <AuthCard>
          <AuthField
            index={0}
            icon={Mail}
            label={t('forgotPassword.emailPlaceholder')}
            placeholder={t('forgotPassword.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <AuthButton
            title={loading ? t('forgotPassword.sending') : t('forgotPassword.sendButton')}
            onPress={handleRequestOTP}
            loading={loading}
            disabled={loading}
          />
        </AuthCard>
      </View>
    </AuthScreen>
  );
};

const styles = StyleSheet.create({
  screenContent: { paddingTop: 0 },
  shell: { width: '100%', maxWidth: 520, alignSelf: 'center' },
});

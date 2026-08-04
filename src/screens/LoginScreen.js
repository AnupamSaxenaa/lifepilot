import * as WebBrowser from 'expo-web-browser';
import { LockKeyhole, LogIn, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import {
    AuthBackButton,
    AuthButton,
    AuthCard,
    AuthDivider,
    AuthField,
    AuthFooter,
    AuthHero,
    AuthScreen,
    AuthStatus,
    useAuthPalette
} from '../components/auth/AuthKit';
import { supabase } from '../lib/supabase';
import { Storage } from '../utils/storage';

WebBrowser.maybeCompleteAuthSession();

export const LoginScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const palette = useAuthPalette();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async () => {
    if (!email || !password) {
      setError(t('login.errorMissingFields'));
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });
      
      if (error) {
        setError(error.message);
      } else {
        // 📱 Save user ID for Android Widgets
        if (data?.session?.user?.id) {
          await Storage.set('current_user_id', data.session.user.id);
        }
        
        navigation.reset({
          index: 0,
          routes: [{ name: 'Dashboard' }],
        });
      }
    } catch (e) {
      setError(e.message || t('common.networkError'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      // Check if running in dev mode
      const isDev = __DEV__;
      
      if (isDev) {
        Alert.alert(
          t('login.devModeTitle'),
          t('login.devModeMessage'),
          [
            { text: t('login.useEmailInstead'), style: 'cancel' },
            { 
              text: t('login.tryAnyway'), 
              onPress: () => proceedWithGoogleAuth()
            }
          ]
        );
        return;
      }
      
      proceedWithGoogleAuth();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const proceedWithGoogleAuth = async () => {
    try {
      setLoading(true);
      setError(null);

      // Lazy require so the import sorter can't strip it (recurring issue).
      const { signInWithGoogle } = require('../lib/googleAuth');
      const session = await signInWithGoogle();

      if (!session) {
        setError(t('login.errorSignInCancelled'));
        return;
      }

      // Save user ID for Android widgets.
      if (session.user?.id) {
        await Storage.set('current_user_id', session.user.id);
      }

      navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
    } catch (err) {
      console.error('[Google Auth] Error:', err);
      setError(err.message || t('login.errorGoogleFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen centered contentStyle={styles.screenContent}>
      <AuthBackButton onPress={() => navigation.goBack()} />
      <View style={styles.shell}>
        <AuthHero title={t('login.title')} subtitle={t('login.subtitle')} />
        <AuthCard>
          <AuthField
            index={0}
            icon={Mail}
            label={t('login.emailPlaceholder')}
            placeholder={t('login.emailPlaceholder')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
          <AuthField
            index={1}
            icon={LockKeyhole}
            label={t('login.passwordPlaceholder')}
            placeholder={t('login.passwordPlaceholder')}
            secureTextEntry
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
          />

          <Animated.View entering={FadeIn.duration(300).delay(300)}>
            <TouchableOpacity
              style={styles.forgotPassword}
              onPress={() => navigation.navigate('ForgotPassword')}
              hitSlop={6}
            >
              <Text style={[styles.forgotPasswordText, { color: palette.accent }]}>{t('login.forgotPassword')}</Text>
            </TouchableOpacity>
          </Animated.View>

          <AuthStatus>{error}</AuthStatus>
          <AuthButton
            title={loading ? t('login.loggingIn') : t('login.loginButton')}
            icon={LogIn}
            onPress={handleLogin}
            loading={loading}
            disabled={loading}
          />
          <AuthDivider label={t('common.or')} />
          <AuthButton
            title={t('login.continueWithGoogle')}
            imageSource={require('../../assets/images/google-logo.png')}
            onPress={handleGoogleAuth}
            disabled={loading}
            variant="secondary"
          />
          <AuthFooter
            prompt={t('login.noAccount')}
            action={t('login.register')}
            onPress={() => navigation.navigate('Register')}
          />
        </AuthCard>
      </View>
    </AuthScreen>
  );
};

const styles = StyleSheet.create({
  screenContent: { paddingTop: 28 },
  shell: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    marginTop: -2,
    marginBottom: 14,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '800',
  },
});

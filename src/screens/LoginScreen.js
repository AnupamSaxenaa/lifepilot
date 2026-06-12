import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { ArrowLeft, Lock, LogIn } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassButton } from '../components/GlassButton';
import { GlassCard } from '../components/GlassCard';
import { GlassInput } from '../components/GlassInput';
import { supabase } from '../lib/supabase';
import { COLORS } from '../theme/theme';
import { Storage } from '../utils/storage';

WebBrowser.maybeCompleteAuthSession();

export const LoginScreen = ({ navigation }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter both email and password.');
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
      setError(e.message || 'A network error occurred.');
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
          'Google Sign In - Dev Mode',
          'Google OAuth works best in production APK builds.\n\nFor development testing, please use:\n• Email: saxenaanupam2004@gmail.com\n• Or create a new account\n\nWant to try Google Sign In anyway?',
          [
            { text: 'Use Email Instead', style: 'cancel' },
            { 
              text: 'Try Anyway', 
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
      
      const redirectUrl = makeRedirectUri({
        scheme: 'com.anupam.lp', // Use package name for better compatibility
      });
      
      console.log('[Google Auth] Redirect URL:', redirectUrl);
      
      console.log('[Google Auth] Redirect URL:', redirectUrl);
      
      // Use Supabase OAuth with the correct redirect
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: false, // Let Supabase handle the redirect
        },
      });
      if (error) {
        console.error('[Google Auth] OAuth error:', error);
        throw error;
      }

      if (data?.url) {
        console.log('[Google Auth] Opening auth session...');
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        console.log('[Google Auth] WebBrowser result:', result);
        
        if (result.type === 'success' && result.url) {
          // Parse the redirect URL to extract tokens
          const url = new URL(result.url);
          const params = new URLSearchParams(url.hash.substring(1)); // Remove # and parse
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          
          console.log('[Google Auth] Tokens received:', { accessToken: !!accessToken, refreshToken: !!refreshToken });
          
          if (accessToken) {
            // Set the session with the tokens
            const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            
            if (sessionError) {
              console.error('[Google Auth] Session error:', sessionError);
              throw sessionError;
            }
            
            console.log('[Google Auth] Session set successfully:', !!sessionData.session);
            
            // 📱 Save user ID for Android Widgets
            if (sessionData?.session?.user?.id) {
              await Storage.set('current_user_id', sessionData.session.user.id);
              console.log('[Google Auth] User ID saved for widgets');
            }
            
            // Navigate to Dashboard
            navigation.reset({
              index: 0,
              routes: [{ name: 'Dashboard' }],
            });
          } else {
            throw new Error('No access token received from Google');
          }
        } else if (result.type === 'cancel') {
          console.log('[Google Auth] User cancelled');
          setError('Sign in cancelled');
        } else {
          console.log('[Google Auth] Unexpected result:', result);
          setError('Sign in failed. Please try again.');
        }
      }
    } catch (err) {
      console.error('[Google Auth] Error:', err);
      setError(err.message || 'Failed to sign in with Google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BackgroundWrapper>
      <KeyboardAwareScrollView 
        style={{ flex: 1 }} 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid={true}
        extraScrollHeight={20}
      >
          <SafeAreaView style={styles.innerContainer}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, { top: Math.max(insets.top, 24) }]}>
              <ArrowLeft color={theme.text} size={24} />
            </TouchableOpacity>

            <View style={styles.header}>
              <Image 
                source={require('../../assets/images/logo-bw.png')} 
                style={[styles.logo, { borderColor: theme.border }]} 
              />
              <Text style={[styles.title, { color: theme.text }]}>LifePilot</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>Master your productivity</Text>
            </View>

            <View style={styles.formContainer}>
              <GlassCard>
                <GlassInput 
                  placeholder="Email" 
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
                <GlassInput 
                  placeholder="Password" 
                  secureTextEntry 
                  value={password}
                  onChangeText={setPassword}
                  icon={Lock}
                />

                <TouchableOpacity 
                  style={styles.forgotPasswordContainer}
                  onPress={() => navigation.navigate('ForgotPassword')}
                >
                  <Text style={[styles.forgotPasswordText, { color: theme.textMuted }]}>Forgot Password?</Text>
                </TouchableOpacity>
                
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
                
                <GlassButton 
                  title={loading ? "Logging in..." : "Login"} 
                  icon={LogIn} 
                  onPress={handleLogin} 
                  style={{ marginTop: 24 }}
                />

                <View style={styles.divider}>
                  <View style={[styles.line, { backgroundColor: theme.border }]} />
                  <Text style={[styles.orText, { color: theme.textMuted }]}>OR</Text>
                  <View style={[styles.line, { backgroundColor: theme.border }]} />
                </View>

                <GlassButton 
                  title="Continue with Google" 
                  imageSource={require('../../assets/images/google-logo.png')}
                  onPress={handleGoogleAuth} 
                  style={{ marginTop: 4, backgroundColor: theme.background }}
                />

                <View style={styles.footer}>
                  <Text style={{ color: theme.textMuted }}>{"Don't have an account? "}</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Register')}>
                    <Text style={{ color: theme.text, fontWeight: 'bold' }}>Register</Text>
                  </TouchableOpacity>
                </View>
              </GlassCard>
            </View>
          </SafeAreaView>
      </KeyboardAwareScrollView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  innerContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    left: 24,
    zIndex: 10,
    padding: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: -40,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16,
  },
  title: {
    fontFamily: 'PlaywriteGBJ_400Regular',
    fontSize: 48,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 16,
    letterSpacing: 0.5,
  },
  formContainer: {
    paddingHorizontal: 24,
  },
  forgotPasswordContainer: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontWeight: '500',
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
  errorText: {
    color: '#ff4b4b',
    fontSize: 12,
    marginTop: -8,
    marginBottom: 8,
    marginLeft: 16,
  },
});

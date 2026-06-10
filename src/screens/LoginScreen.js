import React, { useState } from 'react';
import { StyleSheet, Text, View, useColorScheme, TouchableOpacity, Image, Platform, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';
import { LogIn, ArrowLeft, Lock } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';

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
    
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });
    
    setLoading(false);
    
    if (error) {
      setError(error.message);
      return;
    }
    
    navigation.reset({
      index: 0,
      routes: [{ name: 'Dashboard' }],
    });
  };

  const handleGoogleAuth = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const redirectUrl = makeRedirectUri({
        scheme: 'lifepilot',
        path: 'auth/callback',
      });
      
      // Temporary debug alert
      Alert.alert(
        "Redirect URL Generated!", 
        `Please add exactly this URL to your Supabase Redirect URLs list:\n\n${redirectUrl}\n\nMake sure to add a '/**' at the end of it just in case!`,
        [
          { 
            text: "I've added it", 
            onPress: async () => {
              try {
                const { data, error } = await supabase.auth.signInWithOAuth({
                  provider: 'google',
                  options: {
                    redirectTo: redirectUrl,
                    skipBrowserRedirect: true,
                  },
                });

                if (error) throw error;

                if (data?.url) {
                  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
                  if (result.type === 'success' && result.url) {
                    navigation.reset({
                      index: 0,
                      routes: [{ name: 'Dashboard' }],
                    });
                  }
                }
              } catch (err) {
                setError(err.message);
              } finally {
                setLoading(false);
              }
            } 
          }
        ]
      );
    } catch (err) {
      setError(err.message);
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

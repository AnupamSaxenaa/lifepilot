import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, useColorScheme, TouchableOpacity, Alert, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { GlassCheckbox } from '../components/GlassCheckbox';
import { COLORS } from '../theme/theme';
import { ArrowLeft, Mail, User } from 'lucide-react-native';
import { validateConfirmPassword, validateEmail, validatePassword } from '../utils/validation';
import { supabase } from '../lib/supabase';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';

WebBrowser.maybeCompleteAuthSession();

export const RegisterScreen = ({ navigation }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState(null); // 'checking' | 'available' | 'taken'
  const [suggestedUsername, setSuggestedUsername] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null); // 'checking' | 'available' | 'taken'
  const [emailTimeout, setEmailTimeout] = useState(null);
  
  const [errors, setErrors] = useState({});

  const checkUsernameAvailability = async (text) => {
    if (!text || text.trim().length < 3) {
      setUsernameStatus(null);
      return;
    }

    setUsernameStatus('checking');
    
    const cleanUsername = text.trim().toLowerCase();
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('username', cleanUsername)
      .maybeSingle();

    if (data) {
      setUsernameStatus('taken');
      const randomNum = Math.floor(Math.random() * 1000);
      setSuggestedUsername(`${cleanUsername}${randomNum}`);
    } else {
      setUsernameStatus('available');
    }
  };

  const handleUsernameChange = (text) => {
    setUsername(text);
    if (typingTimeout) clearTimeout(typingTimeout);
    
    if (text.trim().length >= 3) {
      const timeout = setTimeout(() => {
        checkUsernameAvailability(text);
      }, 600);
      setTypingTimeout(timeout);
    } else {
      setUsernameStatus(null);
    }
  };

  const applySuggestion = () => {
    setUsername(suggestedUsername);
    setUsernameStatus('available');
  };

  const checkEmailAvailability = async (text) => {
    if (!text || text.trim().length === 0 || !text.includes('@')) {
      setEmailStatus(null);
      return;
    }

    setEmailStatus('checking');

    try {
      const { data, error } = await supabase.rpc('check_email_exists', {
        email_to_check: text.trim().toLowerCase()
      });

      if (!error && data === true) {
        setEmailStatus('taken');
        setErrors(prev => ({ ...prev, email: 'This email is already registered' }));
      } else {
        setEmailStatus('available');
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors.email;
          return newErrors;
        });
      }
    } catch (err) {
      setEmailStatus(null);
    }
  };

  const handleEmailChange = (text) => {
    setEmail(text);
    
    // Clear email errors as user types
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors.email;
      return newErrors;
    });

    if (emailTimeout) clearTimeout(emailTimeout);

    // Debounce checking after checking standard regex to save database resources
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(text.trim())) {
      const timeout = setTimeout(() => {
        checkEmailAvailability(text);
      }, 600);
      setEmailTimeout(timeout);
    } else {
      setEmailStatus(null);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeout) clearTimeout(typingTimeout);
      if (emailTimeout) clearTimeout(emailTimeout);
    };
  }, [typingTimeout, emailTimeout]);

  const handleRegister = async () => {
    const emailErr = validateEmail(email);
    const passErr = validatePassword(password);
    const confirmErr = validateConfirmPassword(password, confirmPassword);

    let localErrors = {};
    if (username.trim().length < 3) localErrors.username = 'Username must be at least 3 characters';
    if (!agreeTerms) localErrors.terms = 'You must agree to the Terms of Service';
    if (emailErr) localErrors.email = emailErr;
    if (passErr) localErrors.password = passErr;
    if (confirmErr) localErrors.confirmPassword = confirmErr;

    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    setErrors({});
    setLoading(true);

    try {
      // Check if username is taken
      const cleanUsername = username.trim().toLowerCase();
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', cleanUsername)
        .maybeSingle();

      if (existingUser) {
        setErrors({ username: 'This username is already taken' });
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            username: cleanUsername,
            display_name: username.trim(),
          }
        }
      });

      if (error) throw error;

      // Detect already registered email in Supabase (which doesn't throw on duplicate signups to prevent email enumeration)
      if (data?.user?.identities && data.user.identities.length === 0) {
        setErrors({ email: 'This email is already registered' });
        setLoading(false);
        return;
      }

      // Navigate to OTP verification screen with user's email
      navigation.navigate('OTP', { email: email });
    } catch (err) {
      setErrors({ email: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      setLoading(true);
      setErrors({});
      
      const redirectUrl = makeRedirectUri({
        scheme: 'lifepilot',
        path: 'auth/callback',
      });
      
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
            routes: [{ name: 'Login' }],
          });
        }
      }
    } catch (err) {
      setErrors({ email: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <BackgroundWrapper>
      <SafeAreaView style={styles.container}>
        <KeyboardAwareScrollView 
          style={{ flex: 1 }} 
          contentContainerStyle={styles.scrollContent} 
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          enableOnAndroid={true}
          extraScrollHeight={20}
        >
            
            <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, { top: Math.max(insets.top, 24) }]}>
              <ArrowLeft color={theme.text} size={24} />
            </TouchableOpacity>

          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Create Account</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>Join LifePilot today</Text>
          </View>

          <View style={styles.formContainer}>
            <GlassCard>
              <GlassButton 
                title="Register with Google" 
                imageSource={require('../../assets/images/google-logo.png')}
                onPress={handleGoogleAuth} 
                style={{ marginBottom: 24, backgroundColor: theme.surface, borderColor: theme.border }}
              />

              <View style={styles.divider}>
                <View style={[styles.line, { backgroundColor: theme.border }]} />
                <Text style={[styles.orText, { color: theme.textMuted }]}>OR EMAIL</Text>
                <View style={[styles.line, { backgroundColor: theme.border }]} />
              </View>

              <GlassInput 
                placeholder="Username" 
                autoCapitalize="none"
                value={username}
                onChangeText={handleUsernameChange}
                icon={User}
              />
              {usernameStatus === 'checking' && (
                <Text style={[styles.errorText, { color: theme.textMuted }]}>Checking availability...</Text>
              )}
              {usernameStatus === 'available' && (
                <Text style={[styles.errorText, { color: '#10B981' }]}>✓ Username is available</Text>
              )}
              {usernameStatus === 'taken' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: -12, marginBottom: 12, marginLeft: 16 }}>
                  <Text style={{ color: '#ff4b4b', fontSize: 12, marginRight: 8 }}>Taken.</Text>
                  <TouchableOpacity onPress={applySuggestion} activeOpacity={0.7}>
                    <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' }}>
                      Try: {suggestedUsername}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {errors.username && usernameStatus !== 'taken' ? <Text style={styles.errorText}>{errors.username}</Text> : null}

              <GlassInput 
                placeholder="Email Address" 
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={handleEmailChange}
              />
              {emailStatus === 'checking' && (
                <Text style={[styles.errorText, { color: theme.textMuted }]}>Checking email...</Text>
              )}
              {emailStatus === 'available' && (
                <Text style={[styles.errorText, { color: '#10B981' }]}>✓ Email is available</Text>
              )}
              {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

              <GlassInput 
                placeholder="Password" 
                secureTextEntry 
                value={password}
                onChangeText={setPassword}
              />
              <PasswordStrengthIndicator password={password} />
              {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

              <GlassInput 
                placeholder="Confirm Password" 
                secureTextEntry 
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}

              <GlassCheckbox
                label="I agree to the Terms of Service & Privacy Policy"
                isChecked={agreeTerms}
                onToggle={() => setAgreeTerms(!agreeTerms)}
                style={{ marginTop: 8, marginBottom: 8 }}
              />
              {errors.terms ? <Text style={styles.errorText}>{errors.terms}</Text> : null}

              <GlassButton 
                title="Register Account" 
                icon={Mail} 
                onPress={handleRegister} 
                style={{ marginTop: 12 }}
              />
            </GlassCard>

            <View style={styles.footer}>
              <Text style={{ color: theme.textMuted }}>Already have an account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text style={[styles.link, { color: theme.primary }]}>Login</Text>
              </TouchableOpacity>
            </View>
          </View>

        </KeyboardAwareScrollView>
      </SafeAreaView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  backButton: {
    position: 'absolute',
    top: 24,
    left: 0,
    zIndex: 10,
    padding: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 40,
  },
  title: {
    fontFamily: 'PlaywriteGBJ_400Regular',
    fontSize: 48,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 16,
  },
  formContainer: {
    width: '100%',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  line: {
    flex: 1,
    height: 1,
  },
  orText: {
    marginHorizontal: 16,
    fontSize: 12,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#ff4b4b',
    fontSize: 12,
    marginTop: -12,
    marginBottom: 12,
    marginLeft: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  link: {
    fontWeight: 'bold',
  },
});

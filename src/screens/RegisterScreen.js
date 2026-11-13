import DateTimePicker from '@react-native-community/datetimepicker';
import * as WebBrowser from 'expo-web-browser';
import { CalendarDays, Globe, LockKeyhole, Mail, User } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
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
    useAuthPalette,
} from '../components/auth/AuthKit';
import { GlassCheckbox } from '../components/GlassCheckbox';
import { LanguagePickerModal } from '../components/LanguagePickerModal';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';
import { TermsModal } from '../components/TermsModal';
import { getCurrentLanguage, setAppLanguage } from '../i18n';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import { setAuthenticatedUser } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { validateConfirmPassword, validateEmail, validatePassword } from '../utils/validation';

WebBrowser.maybeCompleteAuthSession();

export const RegisterScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const palette = useAuthPalette();
  const returnTo = route?.params?.returnTo;
  const inviteToken = route?.params?.inviteToken;
  const authRouteParams = {
    ...(returnTo ? { returnTo } : {}),
    ...(inviteToken ? { inviteToken } : {}),
  };
  const postAuthRoute = inviteToken
    ? {
        name: 'InviteAcceptance',
        params: {
          ...(returnTo ? { returnTo } : {}),
          token: inviteToken,
        },
      }
    : { name: 'Dashboard' };

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
  
  const [dob, setDob] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  
  const [errors, setErrors] = useState({});

  // ─── Language (auto-detected, user-overridable) ──────
  // App language is auto-detected from the device locale on first launch
  // (see src/i18n/index.js). Here we just surface what was detected and let
  // the user correct it before/while registering — the choice is applied
  // immediately (so the rest of this form re-renders in it) and saved to
  // their profile on signup so it follows them across devices.
  const [selectedLanguage, setSelectedLanguage] = useState(getCurrentLanguage());
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const selectedLanguageInfo = SUPPORTED_LANGUAGES.find((l) => l.code === selectedLanguage) || SUPPORTED_LANGUAGES[0];

  const handleSelectLanguage = async (code) => {
    setShowLanguageModal(false);
    if (code === selectedLanguage) return;
    setSelectedLanguage(code);
    await setAppLanguage(code);
    // Note: unlike Settings, we don't force a reload here even for RTL
    // languages — the user hasn't committed to an account yet, and RN's
    // layout direction will correctly apply on the very next app launch
    // (post-signup) since it's now persisted. Forcing a reload mid-registration
    // would lose their in-progress form input.
  };

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
        setErrors(prev => ({ ...prev, email: t('register.errorEmailTaken') }));
      } else {
        setEmailStatus('available');
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors.email;
          return newErrors;
        });
      }
    } catch (_err) {
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
    if (username.trim().length < 3) localErrors.username = t('register.errorUsernameLength');
    if (!agreeTerms) localErrors.terms = t('register.errorTermsRequired');
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
        setErrors({ username: t('register.errorUsernameTaken') });
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
            dob: dob ? dob.toISOString().split('T')[0] : null,
            preferred_language: selectedLanguage
          }
        }
      });

      if (error) throw error;

      // Detect already registered email in Supabase (which doesn't throw on duplicate signups to prevent email enumeration)
      if (data?.user?.identities && data.user.identities.length === 0) {
        setErrors({ email: t('register.errorEmailTaken') });
        setLoading(false);
        return;
      }

      // Navigate to OTP verification without persisting invitation context.
      navigation.navigate('OTP', { email, ...authRouteParams });
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

      // Lazy require so the import sorter can't strip it (recurring issue).
      const { signInWithGoogle } = require('../lib/googleAuth');
      const session = await signInWithGoogle();

      if (!session) {
        setLoading(false);
        return; // user cancelled
      }

      await setAuthenticatedUser(session.user);

      // Persist the selected app language onto their new profile (fire and
      // forget — non-critical, shouldn't block navigation if it fails).
      if (session.user?.id) {
        supabase.from('profiles').update({ preferred_language: selectedLanguage }).eq('id', session.user.id).then(() => {}, () => {});
      }

      // Google sign-in signs the user straight in — continue an in-memory
      // invitation when present, otherwise retain the existing dashboard flow.
      navigation.reset({ index: 0, routes: [postAuthRoute] });
    } catch (err) {
      setErrors({ email: err.message || t('register.errorGoogleFailed') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AuthScreen contentStyle={styles.screenContent}>
        <AuthBackButton onPress={() => navigation.goBack()} />
        <View style={styles.shell}>
          <AuthHero
            title={t('register.title')}
            subtitle={t('register.subtitle')}
          />

          <Animated.View entering={FadeInDown.duration(360).delay(110)}>
            <TouchableOpacity
              style={[styles.languageRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
              onPress={() => setShowLanguageModal(true)}
              activeOpacity={0.72}
            >
              <View style={[styles.languageIcon, { backgroundColor: `${palette.accent}1A` }]}>
                <Globe color={palette.accent} size={18} />
              </View>
              <Text style={[styles.languageRowText, { color: palette.text }]}>{selectedLanguageInfo.nativeLabel}</Text>
              <Text style={[styles.languageRowChange, { color: palette.accent }]}>{t('settings.selectLanguage')}</Text>
            </TouchableOpacity>
          </Animated.View>

          <AuthCard>
            <AuthButton
              title={t('register.registerWithGoogle')}
              imageSource={require('../../assets/images/google-logo.png')}
              onPress={handleGoogleAuth}
              disabled={loading}
              variant="secondary"
            />
            <AuthDivider label={t('register.orEmail')} />

            <AuthField
              index={0}
              icon={User}
              label={t('register.usernamePlaceholder')}
              placeholder={t('register.usernamePlaceholder')}
              autoCapitalize="none"
              autoComplete="username"
              value={username}
              onChangeText={handleUsernameChange}
              error={errors.username && usernameStatus !== 'taken' ? errors.username : null}
            />
            {usernameStatus === 'checking' ? <AuthStatus tone="muted">{t('register.checkingUsername')}</AuthStatus> : null}
            {usernameStatus === 'available' ? <AuthStatus tone="success">{t('register.usernameAvailable')}</AuthStatus> : null}
            {usernameStatus === 'taken' ? (
              <View style={styles.suggestionRow}>
                <AuthStatus style={styles.suggestionStatus}>{t('register.usernameTaken')}</AuthStatus>
                <TouchableOpacity onPress={applySuggestion} activeOpacity={0.7}>
                  <Text style={[styles.suggestionLink, { color: palette.accent }]}>
                    {t('register.tryUsername', { suggestion: suggestedUsername })}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <AuthField
              index={1}
              icon={Mail}
              label={t('register.emailPlaceholder')}
              placeholder={t('register.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={email}
              onChangeText={handleEmailChange}
              error={errors.email}
            />
            {emailStatus === 'checking' ? <AuthStatus tone="muted">{t('register.checkingEmail')}</AuthStatus> : null}
            {emailStatus === 'available' ? <AuthStatus tone="success">{t('register.emailAvailable')}</AuthStatus> : null}

            <TouchableOpacity onPress={() => setShowDatePicker(true)} activeOpacity={0.8}>
              <View pointerEvents="none">
                <AuthField
                  index={2}
                  icon={CalendarDays}
                  label={t('register.dobPlaceholder')}
                  placeholder={t('register.dobPlaceholder')}
                  value={dob ? dob.toLocaleDateString() : ''}
                  editable={false}
                />
              </View>
            </TouchableOpacity>
            {showDatePicker ? (
              <DateTimePicker
                value={dob || new Date()}
                mode="date"
                display="default"
                maximumDate={new Date()}
                onChange={(event, selectedDate) => {
                  setShowDatePicker(false);
                  if (selectedDate) setDob(selectedDate);
                }}
              />
            ) : null}

            <AuthField
              index={3}
              icon={LockKeyhole}
              label={t('register.passwordPlaceholder')}
              placeholder={t('register.passwordPlaceholder')}
              secureTextEntry
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
              error={errors.password}
            />
            <View style={styles.strengthWrap}>
              <PasswordStrengthIndicator password={password} />
            </View>
            <AuthField
              index={4}
              icon={LockKeyhole}
              label={t('register.confirmPasswordPlaceholder')}
              placeholder={t('register.confirmPasswordPlaceholder')}
              secureTextEntry
              autoComplete="new-password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={errors.confirmPassword}
            />

            <TouchableOpacity onPress={() => !agreeTerms && setIsTermsModalOpen(true)} activeOpacity={0.78}>
              <View pointerEvents="none">
                <GlassCheckbox
                  label={t('register.agreeTerms')}
                  isChecked={agreeTerms}
                  onToggle={() => {}}
                  style={styles.termsCheckbox}
                />
              </View>
            </TouchableOpacity>
            <AuthStatus>{errors.terms}</AuthStatus>

            <AuthButton
              title={t('register.registerButton')}
              icon={Mail}
              onPress={handleRegister}
              loading={loading}
              disabled={loading}
              style={styles.submitButton}
            />
          </AuthCard>
          <AuthFooter
            prompt={t('register.alreadyHaveAccount')}
            action={t('register.login')}
            onPress={() => navigation.navigate('Login', authRouteParams)}
          />
        </View>
      </AuthScreen>

      <TermsModal
        isVisible={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
        onAccept={() => {
          setAgreeTerms(true);
          setIsTermsModalOpen(false);
          setErrors((previous) => {
            const next = { ...previous };
            delete next.terms;
            return next;
          });
        }}
      />
      <LanguagePickerModal
        isVisible={showLanguageModal}
        onClose={() => setShowLanguageModal(false)}
        currentCode={selectedLanguage}
        onSelect={handleSelectLanguage}
        forceDark
      />
    </>
  );
};

const styles = StyleSheet.create({
  screenContent: { paddingTop: 28 },
  shell: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  languageRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 13,
    borderWidth: 1,
    marginBottom: 18,
  },
  languageIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageRowText: { flex: 1, fontSize: 14, fontWeight: '700' },
  languageRowChange: { fontSize: 12, fontWeight: '800' },
  suggestionRow: {
    marginTop: -4,
    marginBottom: 14,
  },
  suggestionStatus: { marginBottom: 7 },
  suggestionLink: { fontSize: 12, lineHeight: 17, fontWeight: '800', marginLeft: 3 },
  strengthWrap: { marginTop: -8, marginBottom: 14 },
  termsCheckbox: { marginTop: 3, marginBottom: 10 },
  submitButton: { marginTop: 6 },
});

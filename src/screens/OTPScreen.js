import { CheckCircle2, MailCheck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
    AuthBackButton,
    AuthButton,
    AuthCard,
    AuthHero,
    AuthScreen,
    AuthStatus,
    useAuthPalette,
} from '../components/auth/AuthKit';
import { supabase } from '../lib/supabase';

export const OTPScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const palette = useAuthPalette();
  
  const email = route?.params?.email || 'your email';

  const [code, setCode] = useState(['', '', '', '', '', '', '', '']);
  const [timer, setTimer] = useState(30);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const inputs = useRef([]);

  useEffect(() => {
    let interval = setInterval(() => {
      setTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleChange = (text, index) => {
    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);

    if (text && index < 7) {
      inputs.current[index + 1].focus();
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputs.current[index - 1].focus();
    }
  };

  const handleVerify = async () => {
    const fullCode = code.join('');
    if (fullCode.length !== 8) {
      setErrorText(t('otp.errorIncompleteCode'));
      return;
    }

    setLoading(true);
    setErrorText('');

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: fullCode,
      type: 'signup',
    });

    setLoading(false);

    if (error) {
      setErrorText(error.message);
      return;
    }

    // Navigate to Dashboard upon success
    navigation.reset({
      index: 0,
      routes: [{ name: 'Dashboard' }],
    });
  };

  return (
    <AuthScreen centered contentStyle={styles.screenContent}>
      <AuthBackButton onPress={() => navigation.goBack()} />
      <View style={styles.shell}>
        <AuthHero
          icon={MailCheck}
          title={t('otp.title')}
          subtitle={t('otp.subtitle')}
          align="center"
        />
        <Animated.Text
          entering={FadeIn.duration(280).delay(90)}
          style={[styles.email, { color: palette.text, backgroundColor: `${palette.accent}16`, borderColor: `${palette.accent}38` }]}
        >
          {email}
        </Animated.Text>
        <AuthCard>
          <View style={styles.codeContainer}>
            {code.map((digit, index) => (
              <Animated.View key={index} entering={FadeInDown.duration(320).delay(160 + index * 45)} style={styles.codeInputWrap}>
                <TextInput
                  ref={(ref) => { inputs.current[index] = ref; }}
                  style={[
                    styles.codeInput,
                    {
                      backgroundColor: palette.surface,
                      borderColor: digit ? palette.accent : palette.border,
                      color: palette.text,
                    },
                  ]}
                  selectionColor={palette.accent}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={1}
                  value={digit}
                  onChangeText={(text) => handleChange(text.replace(/\D/g, ''), index)}
                  onKeyPress={(event) => handleKeyPress(event, index)}
                />
              </Animated.View>
            ))}
          </View>
          <AuthStatus>{errorText}</AuthStatus>
          <AuthButton
            title={t('otp.verifyButton')}
            icon={CheckCircle2}
            onPress={handleVerify}
            loading={loading}
            disabled={loading}
          />
        </AuthCard>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: palette.muted }]}>{t('otp.noCode')}</Text>
          {timer > 0 ? (
            <Text style={[styles.resendText, { color: palette.muted }]}>{t('otp.resendIn', { seconds: timer })}</Text>
          ) : (
            <TouchableOpacity
              onPress={async () => {
                setTimer(30);
                setErrorText('');
                const { error } = await supabase.auth.resend({ type: 'signup', email });
                if (error) setErrorText(error.message);
              }}
            >
              <Text style={[styles.resendText, { color: palette.accent }]}>{t('otp.resendNow')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </AuthScreen>
  );
};

const styles = StyleSheet.create({
  screenContent: { paddingTop: 0 },
  shell: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  email: {
    alignSelf: 'center',
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: -10,
    marginBottom: 18,
  },
  codeContainer: {
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  codeInputWrap: {
    flex: 1,
    minWidth: 28,
    maxWidth: 42,
  },
  codeInput: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 20,
  },
  footerText: { fontSize: 13 },
  resendText: { fontSize: 13, fontWeight: '800' },
});

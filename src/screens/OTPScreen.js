import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, SafeAreaView, useColorScheme, TouchableOpacity, TextInput, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassCard } from '../components/GlassCard';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';
import { CheckCircle2, ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';

export const OTPScreen = ({ navigation, route }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  
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
      setErrorText('Please enter the full 8-digit code');
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
              <Text style={[styles.title, { color: theme.text }]}>Verification</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                Enter the 8-digit code sent to
              </Text>
              <Text style={[styles.emailText, { color: theme.text }]}>{email}</Text>
            </View>

            <View style={styles.formContainer}>
              <GlassCard>
                <View style={styles.codeContainer}>
                  {code.map((digit, index) => (
                    <TextInput
                      key={index}
                      ref={(ref) => inputs.current[index] = ref}
                      style={[
                        styles.codeInput, 
                        { 
                          backgroundColor: theme.surface, 
                          borderColor: theme.border,
                          color: theme.text 
                        }
                      ]}
                      keyboardType="number-pad"
                      maxLength={1}
                      value={digit}
                      onChangeText={(text) => handleChange(text, index)}
                      onKeyPress={(e) => handleKeyPress(e, index)}
                    />
                  ))}
                </View>

                <GlassButton 
                  title="Verify Code" 
                  icon={CheckCircle2} 
                  onPress={handleVerify} 
                  style={{ marginTop: 24 }}
                />
              </GlassCard>

              <View style={styles.footer}>
                <Text style={{ color: theme.textMuted }}>{"Didn't receive code? "}</Text>
                {timer > 0 ? (
                  <Text style={[styles.link, { color: theme.textMuted }]}>Resend in {timer}s</Text>
                ) : (
                  <TouchableOpacity onPress={async () => {
                    setTimer(30);
                    const { error } = await supabase.auth.resend({ type: 'signup', email });
                    if (error) setErrorText(error.message);
                  }}>
                    <Text style={[styles.link, { color: theme.primary }]}>Resend Now</Text>
                  </TouchableOpacity>
                )}
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
    left: 24,
    zIndex: 10,
    padding: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontFamily: 'PlaywriteGBJ_400Regular',
    fontSize: 42,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 16,
  },
  emailText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 4,
  },
  formContainer: {
    width: '100%',
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  codeInput: {
    width: 35,
    height: 50,
    borderRadius: 8,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'bold',
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

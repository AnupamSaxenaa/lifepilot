/**
 * LifePilot — Voice Challenge
 * ------------------------------------------------------------------
 * User must speak a target phrase aloud; on-device speech recognition
 * (`expo-speech-recognition`, already installed for the AI voice chat)
 * transcribes it and checks for a match. Capability-gated: if the module
 * fails to load or the mic permission is denied, this challenge reports
 * itself unavailable so `getAvailable()` never offers it (Property 10).
 */
import { Mic } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

let SpeechModule = null;
// Fallback no-op so we can call this hook unconditionally (Rules of Hooks)
// even when the native module failed to load.
let useSpeechRecognitionEvent = () => {};
try {
  const mod = require('expo-speech-recognition');
  SpeechModule = mod.ExpoSpeechRecognitionModule;
  if (mod.useSpeechRecognitionEvent) useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
} catch (_e) {
  SpeechModule = null;
}

const normalize = (value) => (value || '')
  .normalize('NFKD')
  .toLocaleLowerCase()
  .replace(/\p{M}/gu, '')
  .replace(/[^\p{L}\p{N}\s]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

export const VoiceChallenge = ({ config = {}, onComplete, onUnavailable }) => {
  const { t, i18n } = useTranslation();
  const defaultPhrases = [
    t('alarmChallengeUi.voicePhrase1'),
    t('alarmChallengeUi.typingPhrase2'),
    t('alarmChallengeUi.voicePhrase2'),
  ];
  const phrases = Array.isArray(config.phrases) && config.phrases.length ? config.phrases : defaultPhrases;
  const target = config.target || phrases[0];
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Hooks are always called (Rules of Hooks) — they're no-ops if the native
  // module failed to load, via the fallback assigned above.
  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript || '';
    const normalizedTarget = normalize(target);
    setHeard(transcript);
    if (normalizedTarget && normalize(transcript).includes(normalizedTarget)) {
      SpeechModule?.stop?.();
      onComplete && onComplete();
    }
  });

  useEffect(() => () => { try { SpeechModule?.stop?.(); } catch (_e) {} }, []);

  const startListening = async () => {
    if (!SpeechModule) {
      onUnavailable?.();
      return;
    }
    try {
      const perm = await SpeechModule.requestPermissionsAsync();
      if (!perm.granted) {
        setPermissionDenied(true);
        onUnavailable?.();
        return;
      }
      SpeechModule.start({ lang: i18n.resolvedLanguage || 'en-US', interimResults: true, continuous: false });
    } catch (_e) {
      setPermissionDenied(true);
      onUnavailable?.();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.sayPhrase')}</Text>
      <Text style={styles.target}>“{target}”</Text>
      <TouchableOpacity
        style={[styles.micBtn, listening && styles.micBtnActive]}
        onPress={startListening}
        activeOpacity={0.85}
      >
        <Mic color={listening ? '#000' : '#FFF'} size={26} />
      </TouchableOpacity>
      {heard ? <Text style={styles.heardText}>{t('alarmChallengeUi.heard', { transcript: heard })}</Text> : null}
      {permissionDenied && <Text style={styles.errorText}>{t('alarmChallengeUi.microphonePermissionRequired')}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  target: { color: '#FFF', fontSize: 17, fontStyle: 'italic', textAlign: 'center', marginBottom: 20 },
  micBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#27272A', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  micBtnActive: { backgroundColor: '#FFFFFF' },
  heardText: { color: '#71717A', fontSize: 12, marginTop: 14, fontStyle: 'italic' },
  errorText: { color: '#A1A1AA', fontSize: 12, marginTop: 10, fontWeight: '600' },
});

register('voice', {
  component: VoiceChallenge,
  isAvailable: () => !!SpeechModule,
  isAvailableAsync: async () => {
    if (!SpeechModule?.getPermissionsAsync) return false;
    const permission = await SpeechModule.getPermissionsAsync();
    return permission.granted || permission.canAskAgain !== false;
  },
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.voice',
});

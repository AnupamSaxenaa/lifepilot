/**
 * LifePilot — Typing Challenge
 * ------------------------------------------------------------------
 * User must type a target phrase exactly (case-insensitive, trimmed) to
 * dismiss. `config.phrases` overrides the built-in set; a random one is
 * picked per firing.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

export const TypingChallenge = ({ config = {}, onComplete }) => {
  const { t } = useTranslation();
  const defaultPhrases = [
    t('alarmChallengeUi.typingPhrase1'),
    t('alarmChallengeUi.typingPhrase2'),
    t('alarmChallengeUi.typingPhrase3'),
    t('alarmChallengeUi.typingPhrase4'),
    t('alarmChallengeUi.typingPhrase5'),
  ];
  const phrases = Array.isArray(config.phrases) && config.phrases.length ? config.phrases : defaultPhrases;
  const target = config.target || phrases[0];
  const [input, setInput] = useState('');

  const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const matches = normalize(input) === normalize(target);

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.typePhrase')}</Text>
      <Text style={styles.target}>“{target}”</Text>
      <TextInput
        style={[styles.input, matches && styles.inputMatch]}
        value={input}
        onChangeText={setInput}
        autoFocus
        placeholder={t('alarmChallengeUi.typeHere')}
        placeholderTextColor="#666"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        style={[styles.submitBtn, !matches && styles.submitBtnDisabled]}
        onPress={() => matches && onComplete && onComplete()}
        disabled={!matches}
        activeOpacity={0.85}
      >
        <Text style={styles.submitText}>{t('alarmChallengeUi.confirm')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  target: { color: '#FFF', fontSize: 16, fontStyle: 'italic', textAlign: 'center', marginBottom: 18, paddingHorizontal: 10 },
  input: { width: '100%', color: '#FFF', fontSize: 16, borderWidth: 1, borderColor: '#3F3F46', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 18 },
  inputMatch: { borderColor: '#34D399' },
  submitBtn: { backgroundColor: '#FFFFFF', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 20 },
  submitBtnDisabled: { backgroundColor: '#3F3F46' },
  submitText: { color: '#000', fontWeight: '800', fontSize: 15 },
});

register('typing', {
  component: TypingChallenge,
  isAvailable: () => true,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.typing',
});

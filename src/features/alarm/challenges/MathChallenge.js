/**
 * LifePilot — Math Challenge
 * ------------------------------------------------------------------
 * Mental-arithmetic dismiss challenge. Difficulty controls operand size and
 * operator set; `config.questionCount` controls how many must be solved.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

const DIFFICULTY_RANGES = {
  simple: { max: 10, ops: ['+', '-'] },
  medium: { max: 25, ops: ['+', '-', '*'] },
  hard: { max: 60, ops: ['+', '-', '*'] },
  expert: { max: 100, ops: ['+', '-', '*', '/'] },
};

const randInt = (max) => Math.floor(Math.random() * max) + 1;

const genQuestion = (difficulty, round = 0) => {
  const cfg = DIFFICULTY_RANGES[difficulty] || DIFFICULTY_RANGES.medium;
  const opIndex = (Math.floor(Math.random() * cfg.ops.length) + round) % cfg.ops.length;
  const op = cfg.ops[opIndex];
  let a = randInt(cfg.max);
  let b = randInt(cfg.max);
  let answer;
  if (op === '/') {
    // Ensure integer division.
    b = randInt(10) || 1;
    a = b * randInt(10);
    answer = a / b;
  } else if (op === '+') answer = a + b;
  else if (op === '-') { if (b > a) [a, b] = [b, a]; answer = a - b; }
  else answer = a * b;
  return { text: `${a} ${op} ${b}`, answer };
};

export const MathChallenge = ({ difficulty = 'medium', config = {}, onComplete, onAbandon }) => {
  const { t } = useTranslation();
  const questionCount = config.questionCount || 3;
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const question = useMemo(() => genQuestion(difficulty, index), [index, difficulty]);

  const submit = () => {
    const val = parseFloat(input);
    if (val === question.answer) {
      setInput('');
      setError(false);
      if (index + 1 >= questionCount) {
        onComplete && onComplete();
      } else {
        setIndex((i) => i + 1);
      }
    } else {
      setError(true);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>{index + 1} / {questionCount}</Text>
      <Text style={styles.question}>{question.text} = ?</Text>
      <TextInput
        style={[styles.input, error && styles.inputError]}
        value={input}
        onChangeText={(t) => { setInput(t); setError(false); }}
        keyboardType="numeric"
        autoFocus
        placeholder="?"
        placeholderTextColor="#666"
      />
      <TouchableOpacity style={styles.submitBtn} onPress={submit} activeOpacity={0.85}>
        <Text style={styles.submitText}>{t('alarmChallengeUi.check')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  progress: { color: '#A1A1AA', fontSize: 12, fontWeight: '700', marginBottom: 10 },
  question: { color: '#FFF', fontSize: 28, fontWeight: '700', marginBottom: 20 },
  input: { width: 140, textAlign: 'center', color: '#FFF', fontSize: 22, borderBottomWidth: 2, borderBottomColor: '#FFFFFF', paddingVertical: 6, marginBottom: 20 },
  inputError: { borderBottomColor: '#A1A1AA' },
  submitBtn: { backgroundColor: '#FFFFFF', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 20 },
  submitText: { color: '#000', fontWeight: '800', fontSize: 15 },
});

register('math', {
  component: MathChallenge,
  isAvailable: () => true,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.math',
});

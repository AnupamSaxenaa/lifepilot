/**
 * LifePilot — Sequence Challenge
 * ------------------------------------------------------------------
 * Classic "Simon Says": 4 pads light up in a growing sequence each round;
 * repeat it back. Growing (rather than fixed-length like MemoryChallenge)
 * makes this progressively harder within a single challenge.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

const PAD_COLORS = ['#A1A1AA', '#34D399', '#9CA3AF', '#C7C7C7'];
const ROUNDS_BY_DIFFICULTY = { easy: 3, medium: 4, hard: 5, expert: 6 };

export const SequenceChallenge = ({ difficulty = 'medium', onComplete }) => {
  const { t } = useTranslation();
  const totalRounds = ROUNDS_BY_DIFFICULTY[difficulty] || 4;
  const [sequence, setSequence] = useState(() => [Math.floor(Math.random() * 4)]);
  const [phase, setPhase] = useState('show');
  const [showIdx, setShowIdx] = useState(-1);
  const [inputIdx, setInputIdx] = useState(0);
  const [wrongPad, setWrongPad] = useState(null);

  useEffect(() => {
    let i = -1;
    const interval = setInterval(() => {
      i += 1;
      if (i >= sequence.length) {
        clearInterval(interval);
        setShowIdx(-1);
        setPhase('input');
        return;
      }
      setShowIdx(sequence[i]);
    }, 550);
    return () => clearInterval(interval);
  }, [sequence]);

  const handleTap = (pad) => {
    if (phase !== 'input') return;
    if (sequence[inputIdx] === pad) {
      const nextInput = inputIdx + 1;
      if (nextInput === sequence.length) {
        if (sequence.length >= totalRounds) {
          onComplete && onComplete();
          return;
        }
        setPhase('show');
        setInputIdx(0);
        setSequence((prev) => [...prev, Math.floor(Math.random() * 4)]);
        return;
      }
      setInputIdx(nextInput);
    } else {
      setWrongPad(pad);
      setTimeout(() => { setWrongPad(null); setInputIdx(0); setPhase('show'); setSequence((s) => [...s]); }, 500);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>{t('alarmChallengeUi.round', { current: sequence.length, total: totalRounds })}</Text>
      <View style={styles.grid}>
        {PAD_COLORS.map((color, i) => (
          <TouchableOpacity
            key={i}
            style={[
              styles.pad,
              { backgroundColor: color },
              showIdx === i && styles.padActive,
              wrongPad === i && styles.padWrong,
            ]}
            onPress={() => handleTap(i)}
            disabled={phase !== 'input'}
            activeOpacity={0.8}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  progress: { color: '#A1A1AA', fontSize: 13, fontWeight: '700', marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 140, justifyContent: 'center', gap: 10 },
  pad: { width: 60, height: 60, borderRadius: 14, opacity: 0.55 },
  padActive: { opacity: 1, transform: [{ scale: 1.1 }] },
  padWrong: { backgroundColor: '#A1A1AA', opacity: 1 },
});

register('sequence', {
  component: SequenceChallenge,
  isAvailable: () => true,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.sequence',
});

/**
 * LifePilot — Memory Challenge
 * ------------------------------------------------------------------
 * Shows a sequence of colored tiles (or numbers) briefly, then the user must
 * tap them back in the same order. `config.variant`: 'colors'|'numbers'
 * (default 'colors'). Difficulty controls sequence length.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

const LENGTH_BY_DIFFICULTY = { simple: 3, medium: 4, hard: 5, expert: 6 };
const COLORS = ['#A1A1AA', '#34D399', '#9CA3AF', '#C7C7C7', '#FFFFFF', '#F472B6'];

export const MemoryChallenge = ({ difficulty = 'medium', config = {}, onComplete }) => {
  const { t } = useTranslation();
  const variant = config.variant || 'colors';
  const length = LENGTH_BY_DIFFICULTY[difficulty] || 4;
  const tileOrder = useMemo(() => [0, 1, 2, 3, 4, 5], []);
  const sequence = useMemo(
    () => Array.from({ length }, (_, index) => tileOrder[(index * 3 + length) % tileOrder.length]),
    [length, tileOrder],
  );

  const [phase, setPhase] = useState('show'); // 'show' | 'input'
  const [showIndex, setShowIndex] = useState(-1);
  const [userInput, setUserInput] = useState([]);
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    let i = -1;
    const interval = setInterval(() => {
      i += 1;
      if (i >= sequence.length) {
        clearInterval(interval);
        setShowIndex(-1);
        setPhase('input');
        return;
      }
      setShowIndex(i);
    }, 650);
    return () => clearInterval(interval);
  }, [sequence]);

  const handleTap = (tileIdx) => {
    if (phase !== 'input') return;
    const next = [...userInput, tileIdx];
    const pos = next.length - 1;
    if (sequence[pos] !== tileIdx) {
      setWrong(true);
      setTimeout(() => { setUserInput([]); setWrong(false); }, 500);
      return;
    }
    setUserInput(next);
    if (next.length === sequence.length) {
      onComplete && onComplete();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        {phase === 'show' ? t('alarmChallengeUi.watchSequence') : t('alarmChallengeUi.repeatSequence')}
      </Text>
      <View style={styles.grid}>
        {tileOrder.map((tileIdx, i) => {
          const highlighted = phase === 'show' && sequence[showIndex] === tileIdx;
          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.tile,
                { backgroundColor: variant === 'colors' ? COLORS[tileIdx % COLORS.length] : '#27272A' },
                highlighted && styles.tileHighlighted,
                wrong && userInput.length > 0 && styles.tileWrong,
              ]}
              onPress={() => handleTap(tileIdx)}
              disabled={phase !== 'input'}
              activeOpacity={0.8}
            >
              {variant === 'numbers' && <Text style={styles.tileNumber}>{tileIdx + 1}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.progress}>{userInput.length} / {sequence.length}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 220, justifyContent: 'center', gap: 10 },
  tile: { width: 60, height: 60, borderRadius: 14, justifyContent: 'center', alignItems: 'center', opacity: 0.85 },
  tileHighlighted: { opacity: 1, transform: [{ scale: 1.08 }] },
  tileWrong: { backgroundColor: '#A1A1AA' },
  tileNumber: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  progress: { color: '#71717A', fontSize: 12, marginTop: 14, fontWeight: '600' },
});

register('memory', {
  component: MemoryChallenge,
  isAvailable: () => true,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.memory',
});

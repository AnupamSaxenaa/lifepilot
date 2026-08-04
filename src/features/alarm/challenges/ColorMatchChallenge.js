/**
 * LifePilot — Color Matching Challenge
 * ------------------------------------------------------------------
 * Shows a target color swatch and a grid of similar swatches; the user must
 * tap the ONE that exactly matches. Difficulty controls how close the
 * decoys are (harder = closer hues) and grid size.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

const GRID_BY_DIFFICULTY = { easy: 4, medium: 6, hard: 9, expert: 12 };
const HUE_GAP_BY_DIFFICULTY = { easy: 60, medium: 35, hard: 18, expert: 8 };

const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360}, ${s}%, ${l}%)`;

const buildSwatches = (difficulty) => {
  const count = GRID_BY_DIFFICULTY[difficulty] || 6;
  const gap = HUE_GAP_BY_DIFFICULTY[difficulty] || 35;
  const baseHue = Math.floor(Math.random() * 360);
  const targetColor = hsl(baseHue, 70, 55);
  const swatches = [{ color: targetColor, isTarget: true }];
  for (let i = 1; i < count; i++) {
    const offset = gap * (Math.ceil(i / 2)) * (i % 2 === 0 ? 1 : -1);
    swatches.push({ color: hsl(baseHue + offset, 70, 55), isTarget: false });
  }
  // Shuffle.
  for (let i = swatches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [swatches[i], swatches[j]] = [swatches[j], swatches[i]];
  }
  return { targetColor, swatches };
};

export const ColorMatchChallenge = ({ difficulty = 'medium', onComplete }) => {
  const { t } = useTranslation();
  const { targetColor, swatches } = useMemo(() => buildSwatches(difficulty), [difficulty]);
  const [wrongIdx, setWrongIdx] = useState(null);

  const handleTap = (swatch, idx) => {
    if (swatch.isTarget) {
      onComplete && onComplete();
    } else {
      setWrongIdx(idx);
      setTimeout(() => setWrongIdx(null), 350);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.tapMatchingColor')}</Text>
      <View style={[styles.targetSwatch, { backgroundColor: targetColor }]} />
      <View style={styles.grid}>
        {swatches.map((s, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.swatch, { backgroundColor: s.color }, wrongIdx === i && styles.swatchWrong]}
            onPress={() => handleTap(s, i)}
            activeOpacity={0.8}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', marginBottom: 12 },
  targetSwatch: { width: 64, height: 64, borderRadius: 14, marginBottom: 16, borderWidth: 2, borderColor: '#FFF' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 240, justifyContent: 'center', gap: 10 },
  swatch: { width: 60, height: 60, borderRadius: 12 },
  swatchWrong: { borderWidth: 3, borderColor: '#A1A1AA' },
});

register('colorMatch', {
  component: ColorMatchChallenge,
  isAvailable: () => true,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.colorMatch',
});

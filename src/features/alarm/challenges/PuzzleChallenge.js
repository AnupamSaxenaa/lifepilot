/**
 * LifePilot — Puzzle Challenge (sliding tile puzzle)
 * ------------------------------------------------------------------
 * Classic 3x3 (or 4x4 on hard/expert) sliding number puzzle. Tap a tile
 * adjacent to the blank to slide it. Solved when tiles read 1..N-1 in order
 * with the blank last.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

const SIZE_BY_DIFFICULTY = { easy: 3, medium: 3, hard: 4, expert: 4 };
const SHUFFLE_MOVES_BY_DIFFICULTY = { easy: 20, medium: 40, hard: 60, expert: 90 };

const isSolved = (tiles) => tiles.every((v, i) => v === (i === tiles.length - 1 ? 0 : i + 1));

const neighbors = (idx, size) => {
  const row = Math.floor(idx / size);
  const col = idx % size;
  const out = [];
  if (row > 0) out.push(idx - size);
  if (row < size - 1) out.push(idx + size);
  if (col > 0) out.push(idx - 1);
  if (col < size - 1) out.push(idx + 1);
  return out;
};

const buildShuffled = (size, moves) => {
  const total = size * size;
  const tiles = Array.from({ length: total }, (_, i) => (i === total - 1 ? 0 : i + 1)); // 0 = blank
  let blank = total - 1;
  for (let m = 0; m < moves; m++) {
    const opts = neighbors(blank, size);
    const pick = opts[Math.floor(Math.random() * opts.length)];
    [tiles[blank], tiles[pick]] = [tiles[pick], tiles[blank]];
    blank = pick;
  }
  return tiles;
};

export const PuzzleChallenge = ({ difficulty = 'medium', onComplete }) => {
  const { t } = useTranslation();
  const size = SIZE_BY_DIFFICULTY[difficulty] || 3;
  const moves = SHUFFLE_MOVES_BY_DIFFICULTY[difficulty] || 40;
  const [tiles, setTiles] = useState(() => buildShuffled(size, moves));

  const blankIdx = tiles.indexOf(0);

  const handleTap = (idx) => {
    if (!neighbors(blankIdx, size).includes(idx)) return;
    const next = [...tiles];
    [next[blankIdx], next[idx]] = [next[idx], next[blankIdx]];
    setTiles(next);
    if (isSolved(next)) {
      onComplete && onComplete();
    }
  };

  const tileSize = 240 / size - 8;

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.slideTiles')}</Text>
      <View style={[styles.grid, { width: size * (tileSize + 8) }]}>
        {tiles.map((val, i) => (
          <TouchableOpacity
            key={i}
            style={[
              styles.tile,
              { width: tileSize, height: tileSize },
              val === 0 && styles.tileBlank,
            ]}
            onPress={() => handleTap(i)}
            disabled={val === 0}
            activeOpacity={0.8}
          >
            {val !== 0 && <Text style={styles.tileText}>{val}</Text>}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  tile: { backgroundColor: '#FFFFFF', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  tileBlank: { backgroundColor: 'transparent' },
  tileText: { color: '#000', fontSize: 18, fontWeight: '800' },
});

register('puzzle', {
  component: PuzzleChallenge,
  isAvailable: () => true,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.puzzle',
});

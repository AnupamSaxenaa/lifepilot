/**
 * LifePilot — Reaction Challenge
 * ------------------------------------------------------------------
 * A target appears at a random position; the user must tap it before it
 * disappears, N times in a row. Difficulty shortens the appear window.
 */
import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

const { width } = Dimensions.get('window');
const AREA_W = Math.min(width - 48, 300);
const AREA_H = 220;
const TARGET_SIZE = 52;

const WINDOW_MS_BY_DIFFICULTY = { easy: 1400, medium: 1000, hard: 700, expert: 500 };
const ROUNDS_BY_DIFFICULTY = { easy: 4, medium: 6, hard: 8, expert: 10 };

const randomPos = () => ({
  x: Math.random() * (AREA_W - TARGET_SIZE),
  y: Math.random() * (AREA_H - TARGET_SIZE),
});

export const ReactionChallenge = ({ difficulty = 'medium', onComplete }) => {
  const windowMs = WINDOW_MS_BY_DIFFICULTY[difficulty] || WINDOW_MS_BY_DIFFICULTY.medium;
  const rounds = ROUNDS_BY_DIFFICULTY[difficulty] || ROUNDS_BY_DIFFICULTY.medium;

  const [hits, setHits] = useState(0);
  const [pos, setPos] = useState(randomPos());
  const [visible, setVisible] = useState(true);
  const timeoutRef = useRef(null);

  const nextRound = (missed) => {
    if (missed) {
      // A miss doesn't fail the whole mission — just re-spawn the target so
      // the alarm stays fair for sleepy fingers, but doesn't count progress.
    }
    setPos(randomPos());
    setVisible(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(() => nextRound(true), 250);
    }, windowMs);
  };

  useEffect(() => {
    nextRound(false);
    return () => clearTimeout(timeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTap = () => {
    clearTimeout(timeoutRef.current);
    setHits((h) => {
      const next = h + 1;
      if (next >= rounds) {
        onComplete && onComplete();
      } else {
        nextRound(false);
      }
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>{hits} / {rounds}</Text>
      <View style={[styles.area, { width: AREA_W, height: AREA_H }]}>
        {visible && (
          <TouchableOpacity
            style={[styles.target, { left: pos.x, top: pos.y }]}
            onPress={handleTap}
            activeOpacity={0.7}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  progress: { color: '#A1A1AA', fontSize: 13, fontWeight: '700', marginBottom: 10 },
  area: { backgroundColor: '#18181B', borderRadius: 16, overflow: 'hidden' },
  target: { position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF' },
});

register('reaction', {
  component: ReactionChallenge,
  isAvailable: () => true,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.reaction',
});

/**
 * LifePilot — Squat Challenge
 * ------------------------------------------------------------------
 * User must perform N squats (phone in pocket/hand) to dismiss. Detects
 * squat reps via the accelerometer's vertical (Y) axis: a squat produces a
 * characteristic dip-then-rise in acceleration, counted as one rep per full
 * cycle through a low threshold then back through a high threshold.
 * Capability-gated exactly like ShakeChallenge (same underlying sensor).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { register } from './registry';

let Accelerometer = null;
try {
  Accelerometer = require('expo-sensors').Accelerometer;
} catch (_e) {
  Accelerometer = null;
}

const REPS_BY_DIFFICULTY = { easy: 5, medium: 10, hard: 15 };
const LOW_THRESHOLD = 0.6;  // "down" phase magnitude drop
const HIGH_THRESHOLD = 1.3; // "up" phase magnitude rise

export const SquatChallenge = ({ difficulty = 'medium', onComplete }) => {
  const { t } = useTranslation();
  const target = REPS_BY_DIFFICULTY[difficulty] || REPS_BY_DIFFICULTY.medium;
  const [reps, setReps] = useState(0);
  const phaseRef = useRef('up'); // 'up' | 'down' — tracks where in the cycle we are

  useEffect(() => {
    if (!Accelerometer) return;
    Accelerometer.setUpdateInterval(150);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (phaseRef.current === 'up' && magnitude < LOW_THRESHOLD) {
        phaseRef.current = 'down';
      } else if (phaseRef.current === 'down' && magnitude > HIGH_THRESHOLD) {
        phaseRef.current = 'up';
        setReps((r) => {
          const next = r + 1;
          if (next >= target) {
            sub.remove();
            onComplete && onComplete();
          }
          return next;
        });
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = Math.min(1, reps / target);

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.doSquats', { count: target })}</Text>
      <View style={styles.trackWrap}>
        <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.progress}>{reps} / {target}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#FFF', fontSize: 17, fontWeight: '700', marginBottom: 18 },
  trackWrap: { width: '100%', height: 14, borderRadius: 8, backgroundColor: '#27272A', overflow: 'hidden', marginBottom: 10 },
  trackFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 8 },
  progress: { color: '#A1A1AA', fontSize: 13, fontWeight: '700' },
});

register('squat', {
  component: SquatChallenge,
  isAvailable: () => !!Accelerometer,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.squat',
});

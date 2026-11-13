/**
 * LifePilot — Shake Challenge
 * ------------------------------------------------------------------
 * User must physically shake the device N times to dismiss. Uses
 * `expo-sensors` Accelerometer; gracefully unavailable if the sensor module
 * fails to load (falls out of `getAvailable()`).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { register } from './registry';

let Accelerometer = null;
try {
  // Lazy require so a missing/broken native module doesn't crash import.
  Accelerometer = require('expo-sensors').Accelerometer;
} catch (_e) {
  Accelerometer = null;
}

const SHAKES_BY_DIFFICULTY = { easy: 5, medium: 10, hard: 18 };
const SHAKE_THRESHOLD = 1.8; // combined-axis delta considered a "shake"

export const ShakeChallenge = ({ difficulty = 'medium', onComplete }) => {
  const { t } = useTranslation();
  const target = SHAKES_BY_DIFFICULTY[difficulty] || SHAKES_BY_DIFFICULTY.medium;
  const [count, setCount] = useState(0);
  const lastRef = useRef({ x: 0, y: 0, z: 0, t: 0 });

  useEffect(() => {
    if (!Accelerometer) return;
    Accelerometer.setUpdateInterval(120);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const now = Date.now();
      const last = lastRef.current;
      if (now - last.t < 100) return; // debounce
      const delta = Math.abs(x - last.x) + Math.abs(y - last.y) + Math.abs(z - last.z);
      lastRef.current = { x, y, z, t: now };
      if (delta > SHAKE_THRESHOLD) {
        setCount((c) => {
          const next = c + 1;
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

  const progress = Math.min(1, count / target);

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.shakePhone')}</Text>
      <View style={styles.trackWrap}>
        <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.progress}>{count} / {target}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#FFF', fontSize: 18, fontWeight: '700', marginBottom: 18 },
  trackWrap: { width: '100%', height: 14, borderRadius: 8, backgroundColor: '#27272A', overflow: 'hidden', marginBottom: 10 },
  trackFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 8 },
  progress: { color: '#A1A1AA', fontSize: 13, fontWeight: '700' },
});

register('shake', {
  component: ShakeChallenge,
  isAvailable: () => !!Accelerometer,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.shake',
});

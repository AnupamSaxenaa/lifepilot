/**
 * LifePilot — Walking (Steps) Challenge
 * ------------------------------------------------------------------
 * User must walk N steps (20–1000, per config.steps) to dismiss. Uses
 * `expo-sensors`'s Pedometer.watchStepCount. Capability-gated on
 * `isAvailableAsync()` (many Android devices lack a step-counter sensor).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { register } from './registry';

let Pedometer = null;
try {
  Pedometer = require('expo-sensors').Pedometer;
} catch (_e) {
  Pedometer = null;
}

// Cached across the session so the sync isAvailable() check has a value.
let _cachedAvailable = null;
const checkAvailable = async () => {
  if (_cachedAvailable != null) return _cachedAvailable;
  if (!Pedometer) return (_cachedAvailable = false);
  try {
    _cachedAvailable = await Pedometer.isAvailableAsync();
  } catch (_e) {
    _cachedAvailable = false;
  }
  return _cachedAvailable;
};
checkAvailable();

const STEPS_BY_DIFFICULTY = { simple: 20, easy: 50, medium: 100, hard: 250, expert: 500 };

export const WalkingChallenge = ({ difficulty = 'medium', config = {}, onComplete }) => {
  const { t } = useTranslation();
  const target = config.steps || STEPS_BY_DIFFICULTY[difficulty] || 100;
  const [steps, setSteps] = useState(0);
  const [error, setError] = useState(Pedometer ? null : t('alarmChallengeUi.stepCountingUnavailable'));
  const completedRef = useRef(false);

  useEffect(() => {
    if (!Pedometer) return;
    let sub = null;
    (async () => {
      try {
        const perm = await Pedometer.requestPermissionsAsync();
        if (!perm.granted) { setError(t('alarmChallengeUi.motionPermissionRequired')); return; }
        sub = Pedometer.watchStepCount(({ steps: cumulativeSteps }) => {
          const next = Math.max(0, cumulativeSteps || 0);
          setSteps(next);
          if (next >= target && !completedRef.current) {
            completedRef.current = true;
            onComplete && onComplete();
          }
        });
      } catch (e) {
        setError(e?.message || t('alarmChallengeUi.stepCountingStartError'));
      }
    })();
    return () => { if (sub) sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = Math.min(1, steps / target);

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.walkSteps', { count: target })}</Text>
      <View style={styles.trackWrap}>
        <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.progress}>{steps} / {target}</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#FFF', fontSize: 17, fontWeight: '700', marginBottom: 18 },
  trackWrap: { width: '100%', height: 14, borderRadius: 8, backgroundColor: '#27272A', overflow: 'hidden', marginBottom: 10 },
  trackFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 8 },
  progress: { color: '#A1A1AA', fontSize: 13, fontWeight: '700' },
  errorText: { color: '#A1A1AA', fontSize: 12, marginTop: 10, fontWeight: '600' },
});

register('walking', {
  component: WalkingChallenge,
  isAvailable: () => !!_cachedAvailable,
  isAvailableAsync: checkAvailable,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.walking',
});

/**
 * LifePilot — Ambient Pre-Wake Experience
 * ------------------------------------------------------------------
 * The gentle screen shown during the configured lead time before an alarm's
 * real ring time. Shows a slowly-brightening sunrise gradient, a countdown to
 * the alarm, and a motivational line — then calls `onTransition()` once the
 * lead time elapses so the caller (AlarmScreen) can swap to the full ring.
 *
 * Brightness ramping is handled by `ambientController`; this component is
 * purely the visual/timer layer.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { getDailyMotivation } from '../motivation';
import { startAmbientBrightnessRamp, stopAmbientBrightnessRamp } from './ambientController';

// Sunrise palette progression: deep night -> dawn -> warm sunrise.
const GRADIENT_STOPS = [
  ['#050510', '#0B0B1A'],
  ['#1A1030', '#2D1B4E'],
  ['#4A2545', '#7A3B4E'],
  ['#B8563F', '#D98A3D'],
  ['#F2A65A', '#FDE68A'],
];

export const AmbientPreWake = ({ leadMinutes, targetEpoch, awaitingPrimary = false, onTransition }) => {
  const { t } = useTranslation();
  const configuredMs = Math.max(1, leadMinutes) * 60 * 1000;
  const totalMs = configuredMs;
  const [remainingMs, setRemainingMs] = useState(configuredMs);
  const { affirmation } = getDailyMotivation(t);

  useEffect(() => {
    const actualRemaining = targetEpoch
      ? Math.max(0, Number(targetEpoch) - Date.now())
      : configuredMs;
    if (actualRemaining <= 0) {
      onTransition && onTransition();
      return undefined;
    }
    startAmbientBrightnessRamp(actualRemaining);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const left = targetEpoch
        ? Number(targetEpoch) - Date.now()
        : actualRemaining - (Date.now() - startedAt);
      if (left <= 0) {
        clearInterval(interval);
        stopAmbientBrightnessRamp();
        onTransition && onTransition();
      } else {
        setRemainingMs(left);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      stopAmbientBrightnessRamp();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = 1 - remainingMs / totalMs; // 0 -> 1 as we approach wake time
  const stopIndex = Math.min(GRADIENT_STOPS.length - 1, Math.floor(progress * GRADIENT_STOPS.length));
  const [colorTop, colorBottom] = GRADIENT_STOPS[stopIndex];

  const minutesLeft = Math.ceil(remainingMs / 60000);
  const secondsLeft = Math.ceil((remainingMs % 60000) / 1000);

  return (
    <LinearGradient colors={[colorTop, colorBottom]} style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.countdownLabel}>
          {awaitingPrimary ? t('alarmAmbient.starting') : t('alarmAmbient.gentleCountdown')}
        </Text>
        <Text style={styles.countdown}>
          {awaitingPrimary
            ? t('alarmAmbient.now')
            : (minutesLeft > 1 ? t('alarmAmbient.minutes', { count: minutesLeft }) : t('alarmAmbient.seconds', { count: secondsLeft }))}
        </Text>
        <Text style={styles.affirmation}>{affirmation}</Text>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { alignItems: 'center', paddingHorizontal: 30 },
  countdownLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  countdown: { color: '#FFF', fontSize: 40, fontWeight: '300', marginBottom: 24 },
  affirmation: { color: 'rgba(255,255,255,0.9)', fontSize: 17, fontStyle: 'italic', textAlign: 'center', lineHeight: 26 },
});

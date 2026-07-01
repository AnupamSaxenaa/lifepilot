// ─── Breathing Exercise Component ────────────────────────
// A calming animated breathing circle for the Mindful Lock
// intervention flow. Guides the user through one full
// breathing cycle before allowing an override.
// ─────────────────────────────────────────────────────────

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const { width } = Dimensions.get('window');
const CIRCLE_SIZE = width * 0.5;

const PHASES = [
  { label: 'Breathe in...', duration: 4000, scale: 1.0 },
  { label: 'Hold...', duration: 4000, scale: 1.0 },
  { label: 'Breathe out...', duration: 4000, scale: 0.5 },
  { label: 'Rest...', duration: 4000, scale: 0.5 },
];

export const BreathingExercise = ({ onComplete, duration = 20, visible = true }) => {
  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0.6);
  const [phaseLabel, setPhaseLabel] = useState('Get ready...');
  const [secondsLeft, setSecondsLeft] = useState(duration);
  const timerRef = useRef(null);
  const phaseTimerRef = useRef(null);

  useEffect(() => {
    if (!visible) return;

    // Countdown timer
    setSecondsLeft(duration);
    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          if (onComplete) onComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Breathing phases
    let elapsed = 0;
    const runPhase = (index) => {
      if (elapsed >= duration * 1000 || !visible) return;

      const phase = PHASES[index % PHASES.length];
      setPhaseLabel(phase.label);

      scale.value = withTiming(phase.scale, {
        duration: phase.duration,
        easing: Easing.inOut(Easing.ease),
      });

      opacity.value = withTiming(phase.scale > 0.7 ? 1.0 : 0.6, {
        duration: phase.duration,
        easing: Easing.inOut(Easing.ease),
      });

      elapsed += phase.duration;
      phaseTimerRef.current = setTimeout(() => runPhase(index + 1), phase.duration);
    };

    phaseTimerRef.current = setTimeout(() => runPhase(0), 500);

    return () => {
      clearInterval(timerRef.current);
      clearTimeout(phaseTimerRef.current);
    };
  }, [visible]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <View style={styles.circleContainer}>
        <Animated.View style={[styles.outerGlow, circleStyle]} />
        <Animated.View style={[styles.circle, circleStyle]}>
          <Text style={styles.phaseText}>{phaseLabel}</Text>
        </Animated.View>
      </View>

      <Text style={styles.timerText}>{secondsLeft}s</Text>
      <Text style={styles.subtitleText}>
        Just breathe. If you still want to after this, go ahead.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  circleContainer: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  outerGlow: {
    position: 'absolute',
    width: CIRCLE_SIZE + 20,
    height: CIRCLE_SIZE + 20,
    borderRadius: (CIRCLE_SIZE + 20) / 2,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(124, 58, 237, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  timerText: {
    color: '#a1a1aa',
    fontSize: 28,
    fontWeight: '300',
    marginBottom: 8,
  },
  subtitleText: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 20,
  },
});

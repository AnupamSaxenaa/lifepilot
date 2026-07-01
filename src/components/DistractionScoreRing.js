// ─── Distraction Score Ring ──────────────────────────────
// A circular progress ring that visualizes the user's
// Distraction Score (0-100) with color-coded fill.
// ─────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const getScoreColor = (score) => {
  if (score <= 40) return '#EF4444';   // Red
  if (score <= 70) return '#F59E0B';   // Amber
  return '#22C55E';                     // Green
};

export const DistractionScoreRing = ({ score = 0, size = 180, strokeWidth = 10, label = 'Distraction Score' }) => {
  const animatedScore = useSharedValue(0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  useEffect(() => {
    animatedScore.value = withTiming(score, {
      duration: 1200,
      easing: Easing.out(Easing.cubic),
    });
  }, [score]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animatedScore.value / 100),
  }));

  const color = getScoreColor(score);

  return (
    <View style={[styles.container, { 
      width: size, 
      height: size,
      shadowColor: color,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.6,
      shadowRadius: 20,
      elevation: 10,
    }]}>
      <Svg width={size} height={size}>
        {/* Background track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#27272A"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Animated fill */}
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
          transform={`rotate(-90, ${center}, ${center})`}
        />
      </Svg>

      {/* Center text */}
      <View style={styles.centerContent}>
        <Text style={[styles.scoreText, { color }]}>{score}</Text>
        <Text style={styles.labelText}>{label}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContent: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  labelText: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 2,
  },
});

// ─── Distraction Score Ring ──────────────────────────────
// A circular progress ring that visualizes the user's
// Distraction Score (0-100) with color-coded fill.
// ─────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedProps,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const getScoreColor = (score) => {
  if (score <= 40) return '#FB7185';   // danger
  if (score <= 70) return '#FBBF24';   // warning
  return '#34D399';                    // healthy
};

export const DistractionScoreRing = ({ score = 0, size = 180, strokeWidth = 10, label }) => {
  const { t } = useTranslation();
  const displayLabel = label ?? t('distractionScore.defaultLabel');
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
        <Text style={styles.labelText}>{displayLabel}</Text>
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

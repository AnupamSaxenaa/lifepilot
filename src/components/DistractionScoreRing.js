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
  if (score <= 40) return '#C47D84';
  if (score <= 70) return '#C4A261';
  return '#6FAD8E';
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
  }, [animatedScore, score]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animatedScore.value / 100),
  }));

  const color = getScoreColor(score);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Background track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#202024"
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
    fontSize: 40,
    fontWeight: '300',
    letterSpacing: -1.5,
  },
  labelText: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginTop: 3,
  },
});

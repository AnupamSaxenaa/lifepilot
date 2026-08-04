import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useAuthPalette } from './auth/AuthKit';

const STRENGTH_COLORS = ['#FB7185', '#FB7185', '#FBBF24', '#34D399'];

const Bar = ({ active, color, trackColor, delay }) => {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(active ? 100 : 0, { duration: 260 });
  }, [active, width]);

  const style = useAnimatedStyle(() => ({ width: `${width.value}%` }));

  return (
    <View style={[styles.barTrack, { backgroundColor: trackColor }]}>
      <Animated.View style={[styles.barFill, { backgroundColor: color }, style]} />
    </View>
  );
};

export const PasswordStrengthIndicator = ({ password }) => {
  const { t } = useTranslation();
  const palette = useAuthPalette();
  let score = 0;

  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;

  const activeColor = score === 0 ? palette.border : STRENGTH_COLORS[Math.min(score, 3)];

  const getLabel = () => {
    if (score === 0) return '';
    if (score < 3) return t('passwordStrength.weak');
    if (score === 3) return t('passwordStrength.fair');
    return t('passwordStrength.strong');
  };

  return (
    <View style={styles.container}>
      <View style={styles.barsContainer}>
        {[0, 1, 2, 3].map((index) => (
          <Bar
            key={index}
            active={index < score}
            color={activeColor}
            trackColor={palette.border}
            delay={index * 40}
          />
        ))}
      </View>
      <View style={styles.labelContainer}>
        <Text style={[styles.label, { color: activeColor }]}>{getLabel()}</Text>
        <Text style={[styles.hint, { color: palette.muted }]}>{t('passwordStrength.hint')}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  barsContainer: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 8,
  },
  barTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
  },
  labelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
  },
  hint: {
    fontSize: 10,
  },
});

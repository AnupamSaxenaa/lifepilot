import { CalendarCheck2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const ACTIVE_COLOR = '#F5F5F5';
const INACTIVE_COLOR = '#73757A';
const ACTIVE_BORDER_COLOR = '#9CA3AF';
const INACTIVE_BORDER_COLOR = '#5F6368';

export const AnimatedFlame = ({ streak = 0, size = 26 }) => {
  const isActive = streak > 0;
  const [progress] = useState(() => new Animated.Value(0));
  const frameSize = Math.min(34, Math.max(32, size + 6));
  const iconSize = Math.min(20, Math.max(14, size - 6));

  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);

    if (!isActive) return undefined;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      { resetBeforeIteration: false }
    );

    loop.start();

    return () => {
      loop.stop();
      progress.stopAnimation();
      progress.setValue(0);
    };
  }, [isActive, progress]);

  const animatedStyle = isActive
    ? {
        opacity: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.92, 1],
        }),
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -0.75],
            }),
          },
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.015],
            }),
          },
        ],
      }
    : null;

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.container,
        {
          width: frameSize,
          height: frameSize,
          borderRadius: frameSize / 2,
          borderColor: isActive ? ACTIVE_BORDER_COLOR : INACTIVE_BORDER_COLOR,
        },
      ]}
    >
      <Animated.View style={animatedStyle}>
        <CalendarCheck2
          color={isActive ? ACTIVE_COLOR : INACTIVE_COLOR}
          size={iconSize}
          strokeWidth={1.7}
        />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});

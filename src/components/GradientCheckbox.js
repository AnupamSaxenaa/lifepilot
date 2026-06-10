import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { CheckCircle2 } from 'lucide-react-native';

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

export const GradientCheckbox = ({ isCompleted, onPress, style }) => {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (!isCompleted) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 2500, easing: Easing.linear }),
        -1 // infinite
      );
    } else {
      rotation.value = 0;
    }
  }, [isCompleted]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotateZ: `${rotation.value}deg` }],
    };
  });

  return (
    <TouchableOpacity onPress={onPress} style={[styles.container, style]}>
      {isCompleted ? (
        <CheckCircle2 color="#888" size={24} />
      ) : (
        <View style={styles.circleWrapper}>
          <AnimatedSvg width={24} height={24} viewBox="0 0 24 24" style={animatedStyle}>
            <Defs>
              <LinearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#ff007f" />
                <Stop offset="50%" stopColor="#7f00ff" />
                <Stop offset="100%" stopColor="#00d2ff" />
              </LinearGradient>
            </Defs>
            <Circle
              cx="12"
              cy="12"
              r="10"
              stroke="url(#grad)"
              strokeWidth="2.5"
              fill="none"
            />
          </AnimatedSvg>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  circleWrapper: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  }
});

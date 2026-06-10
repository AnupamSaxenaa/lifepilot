import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedProps, withTiming, Easing } from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const LifetimeProgressRing = ({ completed = 0, total = 0, size = 40, strokeWidth = 4 }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  
  const percentage = total > 0 ? completed / total : 0;
  const targetOffset = circumference - (percentage * circumference);

  const strokeDashoffset = useSharedValue(circumference);

  useEffect(() => {
    strokeDashoffset.value = withTiming(targetOffset, {
      duration: 1200,
      easing: Easing.out(Easing.cubic)
    });
  }, [percentage]);

  const animatedProps = useAnimatedProps(() => {
    return {
      strokeDashoffset: strokeDashoffset.value,
    };
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background Red Circle (Not Completed) */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#ef4444" // Red
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        
        {/* Foreground Green Circle (Completed) */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#22c55e" // Green
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
          // Hide completely when 0% to avoid the round linecap dot
          opacity={percentage === 0 ? 0 : 1}
          // Rotate -90deg so it starts from the top
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  );
};

import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { Gamification } from '../utils/gamification';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const XPAvatarRing = ({ xp = 0, level = 1, avatarSource, size = 64, strokeWidth = 3 }) => {
  const accent = useTheme().theme.accent;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;

  // Progress within the current level (0 to 100)
  const xpInCurrentLevel = xp % 100;
  const progress = useSharedValue(0);

  useEffect(() => {
    // Dynamic Leveling Math
    const currentLevel = level || 1;
    const baseXPForCurrentLevel = Gamification.getRequiredXPForLevel(currentLevel);
    const baseXPForNextLevel = Gamification.getRequiredXPForLevel(currentLevel + 1);
    
    const totalXpNeededForNextLevel = baseXPForNextLevel - baseXPForCurrentLevel;
    const xpInCurrentLevel = xp - baseXPForCurrentLevel;
    
    const targetProgress = xpInCurrentLevel / totalXpNeededForNextLevel;

    progress.value = withTiming(Math.max(0, Math.min(1, targetProgress)), {
      duration: 1000,
      easing: Easing.out(Easing.cubic),
    });
  }, [xp, level]);

  const animatedProps = useAnimatedProps(() => {
    return {
      strokeDashoffset: circumference - (progress.value * circumference),
      opacity: progress.value === 0 ? 0 : 1,
    };
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Avatar Image in the Center */}
      <Image 
        source={avatarSource} 
        style={[
          StyleSheet.absoluteFill, 
          { 
            width: size - strokeWidth * 2, 
            height: size - strokeWidth * 2, 
            borderRadius: (size - strokeWidth * 2) / 2,
            top: strokeWidth,
            left: strokeWidth
          }
        ]} 
      />
      
      {/* SVG Ring Overlaid */}
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        {/* Background Track Circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        
        {/* Foreground XP Progress Circle */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={accent}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
          // Hide dot when 0 (handled in animatedProps)
          // Rotate -90deg so it starts from the top
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  );
};

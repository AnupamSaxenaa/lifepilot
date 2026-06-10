import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  Easing,
  withSpring
} from 'react-native-reanimated';

// Optimized Dense Grid for Retro Look without Lag
const GRID_SIZE = 14;
const DOT_SIZE = 5;
const SPACING = 10;
const MATRIX_SIZE = GRID_SIZE * SPACING;

const Dot = ({ x, y, progress, isProcessingAnim, randomTension }) => {
  const animatedStyle = useAnimatedStyle(() => {
    const cx = x - Math.floor(GRID_SIZE / 2);
    const cy = y - Math.floor(GRID_SIZE / 2);
    const dist = Math.sqrt(cx * cx + cy * cy);
    
    const time = progress.value;
    const tension = Math.max(isProcessingAnim.value * 2.5, randomTension.value);
    
    // Organic Interference Math
    const wave1 = Math.sin(time * (1 + tension) + x * 0.4 + Math.sin(y * 0.5 + time));
    const wave2 = Math.cos(time * (1.2 + tension * 1.5) + y * 0.4 + Math.sin(x * 0.5));
    const circularWave = Math.sin((time * 2) - dist * (0.3 + tension * 0.2));
    
    const noise = (wave1 * wave2 + circularWave) / 2;
    const baseOpacity = 0.1 + ((noise + 1) / 2) * 0.9;
    const scale = 0.4 + ((noise + 1) / 2) * (0.6 + tension * 0.8);

    return {
      opacity: baseOpacity,
      transform: [{ scale }]
    };
  });

  return (
    <Animated.View style={[
      styles.dot, 
      { left: x * SPACING, top: y * SPACING },
      animatedStyle
    ]} />
  );
};

export const DotMatrixAura = ({ isProcessing }) => {
  const progress = useSharedValue(0);
  const isProcessingAnim = useSharedValue(0);
  const randomTension = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(Math.PI * 10, { duration: 15000, easing: Easing.linear }),
      -1,
      false
    );

    const glitchInterval = setInterval(() => {
      if (!isProcessing) {
        const spike = Math.random() > 0.6 ? Math.random() * 0.8 : 0.1;
        randomTension.value = withSpring(spike, { damping: 12, stiffness: 90 });
      }
    }, 2000);

    return () => clearInterval(glitchInterval);
  }, [isProcessing, progress, randomTension]);

  useEffect(() => {
    isProcessingAnim.value = withSpring(isProcessing ? 1 : 0, { damping: 14 });
  }, [isProcessing, isProcessingAnim]);

  const dots = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      dots.push(<Dot key={`${x}-${y}`} x={x} y={y} progress={progress} isProcessingAnim={isProcessingAnim} randomTension={randomTension} />);
    }
  }

  return (
    <View style={styles.container}>
      {/* Circle Mask Container */}
      <View style={styles.circularMask}>
        <View style={styles.grid}>
          {dots}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: MATRIX_SIZE,
    height: MATRIX_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#A78BFA',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  circularMask: {
    width: MATRIX_SIZE,
    height: MATRIX_SIZE,
    borderRadius: MATRIX_SIZE / 2, // Perfect circle crop
    overflow: 'hidden', // Masks the square grid into a circle!
    backgroundColor: 'rgba(167, 139, 250, 0.05)', // Slight background tint for depth
  },
  grid: {
    width: MATRIX_SIZE,
    height: MATRIX_SIZE,
    position: 'relative'
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: 1, 
    backgroundColor: '#A78BFA',
  }
});

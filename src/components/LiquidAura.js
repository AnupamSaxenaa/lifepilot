import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Ellipse } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const SIZE = 260; // Increased size for a more expansive aura
const CENTER = SIZE / 2;

const AuraLobe = ({
  angle,
  color,
  duration,
  size,
  isProcessing,
  opacity,
  radiusX,
  radiusY,
}) => {
  const phase = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(Math.PI * 2, {
        duration: isProcessing ? Math.max(duration * 0.4, 1800) : duration,
        easing: Easing.linear,
      }),
      -1,
      false
    );

    pulse.value = withRepeat(
      withSequence(
        withTiming(isProcessing ? 1.25 : 1.1, {
          duration: isProcessing ? 650 : 2600,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(isProcessing ? 0.9 : 0.95, {
          duration: isProcessing ? 760 : 3100,
          easing: Easing.inOut(Easing.sin),
        })
      ),
      -1,
      true
    );
  }, [duration, isProcessing, phase, pulse]);

  const style = useAnimatedStyle(() => {
    const current = phase.value + angle;
    // Circular orbital motion
    const x = Math.cos(current) * radiusX;
    const y = Math.sin(current * 1.1) * radiusY;
    
    // Slight breathing opacity
    const livingOpacity = opacity + Math.sin(current * 2) * 0.15;

    return {
      opacity: Math.max(0.1, Math.min(1, livingOpacity)),
      transform: [
        { translateX: x },
        { translateY: y },
        { scale: pulse.value },
      ],
    };
  });

  // The id must be unique per color so the gradients don't clash
  const gradId = `grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.lobe,
        {
          left: CENTER - size / 2,
          top: CENTER - size / 2,
          width: size,
          height: size,
        },
        style,
      ]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={gradId} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor={color} stopOpacity="1" />
            <Stop offset="40%" stopColor={color} stopOpacity="0.7" />
            <Stop offset="70%" stopColor={color} stopOpacity="0.2" />
            <Stop offset="100%" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill={`url(#${gradId})`} />
      </Svg>
    </Animated.View>
  );
};

export const LiquidAura = ({ isProcessing }) => {
  const breath = useSharedValue(1);
  const coreOpacity = useSharedValue(0.68);
  const ringOpacity = useSharedValue(0.35);

  useEffect(() => {
    breath.value = withRepeat(
      withSequence(
        withTiming(isProcessing ? 1.07 : 1.025, {
          duration: isProcessing ? 620 : 3200,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(isProcessing ? 0.94 : 0.985, {
          duration: isProcessing ? 760 : 3600,
          easing: Easing.inOut(Easing.sin),
        })
      ),
      -1,
      true
    );

    coreOpacity.value = withRepeat(
      withSequence(
        withTiming(isProcessing ? 0.82 : 0.72, {
          duration: isProcessing ? 520 : 2800,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(isProcessing ? 0.48 : 0.58, {
          duration: isProcessing ? 660 : 3400,
          easing: Easing.inOut(Easing.sin),
        })
      ),
      -1,
      true
    );

    ringOpacity.value = withRepeat(
      withSequence(
        withTiming(isProcessing ? 0.72 : 0.42, {
          duration: isProcessing ? 450 : 2400,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(isProcessing ? 0.26 : 0.24, {
          duration: isProcessing ? 690 : 3000,
          easing: Easing.inOut(Easing.sin),
        })
      ),
      -1,
      true
    );
  }, [breath, coreOpacity, isProcessing, ringOpacity]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breath.value }],
  }));

  const coreStyle = useAnimatedStyle(() => ({
    opacity: coreOpacity.value,
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: 0.98 + ringOpacity.value * 0.1 }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.body, bodyStyle]}>
        
        {/* Deep background glow to tie it all together */}
        <AuraLobe
          angle={0}
          color="#38BDF8"
          duration={18000}
          size={240}
          isProcessing={isProcessing}
          opacity={0.3}
          radiusX={10}
          radiusY={10}
        />

        {/* The 4 main flowing orbs */}
        <AuraLobe
          angle={0}
          color="#38BDF8" // Sky Blue
          duration={9000}
          size={180}
          isProcessing={isProcessing}
          opacity={0.8}
          radiusX={35}
          radiusY={20}
        />
        <AuraLobe
          angle={Math.PI * 0.5}
          color="#C084FC" // Purple
          duration={11200}
          size={190}
          isProcessing={isProcessing}
          opacity={0.85}
          radiusX={40}
          radiusY={25}
        />
        <AuraLobe
          angle={Math.PI * 1.2}
          color="#2DD4BF" // Teal
          duration={12800}
          size={160}
          isProcessing={isProcessing}
          opacity={0.7}
          radiusX={25}
          radiusY={35}
        />
        <AuraLobe
          angle={Math.PI * 1.6}
          color="#60A5FA" // Blue
          duration={14600}
          size={170}
          isProcessing={isProcessing}
          opacity={0.75}
          radiusX={30}
          radiusY={20}
        />

        {/* The sharp core elements */}
        <Animated.View style={[styles.outerRing, ringStyle]} />
        <Animated.View style={[styles.coreGlow, coreStyle]} />
        <View style={styles.darkCore}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#050505' }]} />
        </View>
      </Animated.View>
    </View>
  );
};

const CORE_SIZE = 110;

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lobe: {
    position: 'absolute',
  },
  outerRing: {
    position: 'absolute',
    width: CORE_SIZE + 40,
    height: CORE_SIZE + 40,
    borderRadius: (CORE_SIZE + 40) / 2,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.4)',
    shadowColor: '#A78BFA',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
  },
  coreGlow: {
    position: 'absolute',
    width: CORE_SIZE + 16,
    height: CORE_SIZE + 16,
    borderRadius: (CORE_SIZE + 16) / 2,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 15,
  },
  darkCore: {
    position: 'absolute',
    width: CORE_SIZE,
    height: CORE_SIZE,
    borderRadius: CORE_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.03)',
  },
});

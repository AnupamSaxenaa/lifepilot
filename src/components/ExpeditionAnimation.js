import React, { useEffect } from 'react';
import { StyleSheet, View, Text, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
  withTiming,
  Easing
} from 'react-native-reanimated';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Polygon } from 'react-native-svg';
import { Flag, Mountain, TrendingDown } from 'lucide-react-native';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedView = Animated.createAnimatedComponent(View);

// Define our exact path points for the mountain
const POINTS = [
  { x: 20, y: 140 }, // Base Camp
  { x: 80, y: 110 }, // Camp 1
  { x: 140, y: 125 }, // Valley / Dip
  { x: 200, y: 70 }, // Camp 2
  { x: 240, y: 85 }, // Death Zone start
  { x: 280, y: 20 }, // Summit
];

// Calculated cumulative distance percentages for accurate linear interpolation
const PROGRESS_INPUTS = [0, 20.3, 39.1, 63.8, 76.8, 100];
const X_OUTPUTS = POINTS.map(p => p.x);
const Y_OUTPUTS = POINTS.map(p => p.y);

// Build the SVG path string for the solid mountain line
const MOUNTAIN_PATH = POINTS.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

// Build a polygon for the mountain fill that drops down to the bottom
const MOUNTAIN_FILL = `${MOUNTAIN_PATH} L280,180 L20,180 Z`;

export const ExpeditionAnimation = ({ progress = 0, onSimulateMiss }) => {
  // Reanimated shared value
  const animatedProgress = useSharedValue(0);

  // When progress prop changes, animate to new value
  useEffect(() => {
    animatedProgress.value = withSpring(progress, {
      damping: 14,
      stiffness: 90,
      mass: 1,
    });
  }, [progress]);

  // Interpolate X and Y positions strictly along the mountain path
  const handleStyle = useAnimatedStyle(() => {
    const cx = interpolate(animatedProgress.value, PROGRESS_INPUTS, X_OUTPUTS, Extrapolation.CLAMP);
    const cy = interpolate(animatedProgress.value, PROGRESS_INPUTS, Y_OUTPUTS, Extrapolation.CLAMP);

    return {
      transform: [
        { translateX: cx - 12 }, // Offset by half width/height so it's centered
        { translateY: cy - 12 }
      ]
    };
  });

  const getLabel = () => {
    if (progress >= 100) return 'The Summit';
    if (progress >= 76.8) return 'Death Zone';
    if (progress >= 63.8) return 'Camp 3';
    if (progress >= 39.1) return 'Camp 2';
    if (progress >= 20.3) return 'Camp 1';
    return 'Base Camp';
  };

  const getElevation = () => {
    // Arbitrary scale: 0 to 8848m (Everest)
    return Math.floor((progress / 100) * 8848);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Mountain color="#fff" size={20} />
          <Text style={styles.title}>EXPEDITION PROGRESS</Text>
        </View>
        <Text style={styles.elevation}>{getElevation().toLocaleString()}m</Text>
      </View>

      <Text style={styles.subtitle}>Current Stage: <Text style={{ color: '#F59E0B' }}>{getLabel()}</Text></Text>

      {/* SVG Mountain Range */}
      <View style={styles.mountainWrapper}>
        <Svg height="160" width="300" viewBox="0 0 300 160">
          <Defs>
            <LinearGradient id="mountainGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#333333" stopOpacity={0.6} />
              <Stop offset="1" stopColor="#1A1A1A" stopOpacity={0.0} />
            </LinearGradient>
            <LinearGradient id="pathGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#444444" stopOpacity={1} />
              <Stop offset="1" stopColor="#888888" stopOpacity={1} />
            </LinearGradient>
          </Defs>

          {/* Mountain Fill */}
          <Path d={MOUNTAIN_FILL} fill="url(#mountainGrad)" />

          {/* Background Path (Dashed/Subtle) */}
          <Path
            d={MOUNTAIN_PATH}
            fill="none"
            stroke="url(#pathGrad)"
            strokeWidth="3"
            strokeDasharray="6, 6"
          />

          {/* Render Camp Nodes */}
          {POINTS.map((p, index) => (
            <Circle
              key={index}
              cx={p.x}
              cy={p.y}
              r={index === POINTS.length - 1 ? 6 : 4}
              fill={index === POINTS.length - 1 ? "#F59E0B" : "#1A1A1A"}
              stroke={index === POINTS.length - 1 ? "#F59E0B" : "#666"}
              strokeWidth="2"
            />
          ))}
          {/* Summit Flag indicator */}
          <Circle cx={280} cy={20} r={2} fill="#000" />
        </Svg>

        {/* The Animated Climber */}
        <AnimatedView style={[styles.climberMarker, handleStyle]}>
          <View style={styles.climberCore} />
          <View style={styles.climberPulse} />
        </AnimatedView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E1E1E',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333333',
    padding: 20,
    marginBottom: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#CCCCCC',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  elevation: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  subtitle: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 16,
  },
  mountainWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    position: 'relative',
    marginTop: 10,
  },
  climberMarker: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  climberCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 5,
  },
  climberPulse: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
});

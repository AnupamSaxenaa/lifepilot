import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Generate a random scribble path across a given width and height
const generateScribblePath = (w, h) => {
  if (w <= 0 || h <= 0) return '';
  
  // Start slightly outside the left bound, vertically centered with some jitter
  let path = `M -5,${h / 2 + (Math.random() * 4 - 2)}`;
  
  const numLoops = 3 + Math.floor(Math.random() * 3); // 3 to 5 loops
  const stepX = (w + 10) / numLoops; // Overlap on the right edge slightly
  
  let currentX = 0;
  for (let i = 0; i <= numLoops; i++) {
    const cp1x = currentX + stepX * 0.3;
    const cp1y = h / 2 - (h * 0.8 + Math.random() * h * 0.5); // Go high
    
    const cp2x = currentX + stepX * 0.7;
    const cp2y = h / 2 + (h * 0.8 + Math.random() * h * 0.5); // Go low
    
    currentX += stepX;
    const endY = h / 2 + (Math.random() * 4 - 2);
    
    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${currentX},${endY}`;
  }
  return path;
};

export const ScribbleStrike = ({ isCompleted, children, color = '#666', strokeWidth = 2, shouldAnimate = true }) => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [pathData, setPathData] = useState('');
  const [pathLength, setPathLength] = useState(0);
  const pathRef = useRef(null);

  const progress = useSharedValue(isCompleted ? 1 : 0);
  const isFirstRender = useRef(true);

  // Measure the text container
  const onLayout = (event) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && width !== dimensions.width) {
      setDimensions({ width, height });
      setPathData(generateScribblePath(width, height));
    }
  };

  // When path data changes or isCompleted changes, trigger animation
  useEffect(() => {
    if (isCompleted) {
      if (shouldAnimate && !isFirstRender.current) {
        // Small delay looks nice
        progress.value = withTiming(1, {
          duration: 400,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        });
      } else {
        progress.value = 1; // instantly show completed without animation
      }
    } else {
      progress.value = 0; // instantly reset when unchecked
      // generate a new path for next time
      if (dimensions.width > 0) {
        requestAnimationFrame(() => {
          setPathData(generateScribblePath(dimensions.width, dimensions.height));
        });
      }
    }
    isFirstRender.current = false;
  }, [isCompleted, shouldAnimate, dimensions.width]);

  const animatedProps = useAnimatedProps(() => {
    const len = pathLength || 1000;
    return {
      strokeDashoffset: len * (1 - progress.value),
      strokeOpacity: progress.value > 0 ? 1 : 0,
    };
  }, [pathLength]);

  return (
    <View style={styles.container}>
      {/* The actual text */}
      <View onLayout={onLayout} style={[styles.content, { opacity: (isCompleted && dimensions.width === 0) ? 0 : 1 }]}>
        {children}
      </View>

      {/* The SVG Overlay */}
      {dimensions.width > 0 && pathData ? (
        <View style={[StyleSheet.absoluteFill, styles.svgContainer]} pointerEvents="none">
          <Svg width={dimensions.width} height={dimensions.height}>
            <Defs>
              <LinearGradient id="scribbleGrad" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#ff007f" />
                <Stop offset="0.5" stopColor="#7f00ff" />
                <Stop offset="1" stopColor="#00d2ff" />
              </LinearGradient>
            </Defs>
            <AnimatedPath
              ref={pathRef}
              d={pathData}
              stroke="url(#scribbleGrad)"
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={pathLength || 1000} // Fallback until length is known
              animatedProps={animatedProps}
              onLayout={() => {
                // To get the exact length of the SVG path, we could use a trick, 
                // but since RN SVG doesn't perfectly expose getTotalLength synchronously in all versions,
                // we can approximate the length of the scribble to be roughly 3-4x the width.
                // A better fallback is to just use a very large dash array or estimate it based on loops.
                setPathLength(dimensions.width * 3); 
              }}
            />
          </Svg>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignSelf: 'flex-start', // wrap content tightly
  },
  content: {
    // padding shouldn't be added here, it wraps children directly
  },
  svgContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    // offset slightly to sit directly over text
    marginTop: 2, 
  },
});

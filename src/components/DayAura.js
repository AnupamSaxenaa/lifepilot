// ─── Day Aura ────────────────────────────────────────────
// A glow that rises from the bottom of the Dashboard as today's tasks are
// completed, with drifting embers and falling ash.
//
// Implementation notes (learned the hard way):
//  • The fill is a full-height gradient SLID up from below via translateY,
//    not a `scaleY` + `transformOrigin` trick. Scaling an absolutely filled
//    view depended on transform-origin support and produced an invisible or
//    mid-screen result; a translate is unambiguous and stays on the native
//    driver.
//  • No hard edge anywhere. The top of the gradient is fully transparent, so
//    there is never a visible boundary line across the screen.
//  • It sits behind content and never intercepts touches.
// ─────────────────────────────────────────────────────────
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { contrastRatio, withAlpha } from '../theme/contrast';

const SPARK_COUNT = 16;

const Spark = ({ index, travel, heat, isAsh, emberColor, ashColor }) => {
  const [progress] = useState(() => new Animated.Value(0));

  // Deterministic scatter: Math.random() during render would re-roll the
  // layout on every state change and make the field twitch.
  const { seed, seed2 } = useMemo(() => {
    const a = Math.sin((index + 1) * 12.9898) * 43758.5453;
    const b = Math.sin((index + 1) * 78.233) * 12345.6789;
    return { seed: a - Math.floor(a), seed2: b - Math.floor(b) };
  }, [index]);

  const duration = 3000 + seed * 3000;
  const delay = seed2 * 3000;
  const size = isAsh ? 2 + seed * 1.5 : 2.4 + seed2 * 2.6;

  useEffect(() => {
    progress.setValue(0);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
      progress.stopAnimation();
    };
  }, [delay, duration, progress]);

  return (
    <Animated.View
      style={[
        styles.spark,
        {
          left: `${5 + seed * 90}%`,
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: isAsh ? ashColor : emberColor,
          opacity: Animated.multiply(
            heat,
            progress.interpolate({
              inputRange: [0, 0.1, 0.65, 1],
              outputRange: [0, isAsh ? 0.4 : 0.85, isAsh ? 0.2 : 0.4, 0],
            }),
          ),
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                // Ash drifts down, embers climb.
                outputRange: isAsh ? [-travel * 0.3, travel * 0.45] : [0, -travel],
              }),
            },
            {
              translateX: progress.interpolate({
                inputRange: [0, 0.4, 0.75, 1],
                outputRange: [0, (seed - 0.5) * 22, (seed2 - 0.5) * 34, (seed - 0.5) * 44],
              }),
            },
          ],
        },
      ]}
    />
  );
};

export const DayAura = ({ ratio = 0, isComplete = false, hasWork = false, height = 320 }) => {
  const { theme } = useAppTheme();
  // COLORS/theme objects are mutated in place when the equipped theme changes,
  // so subscribing to the version is what forces a recolour.
  useAppTheme().themeVersion;
  const [level] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const target = hasWork ? Math.max(0, Math.min(1, ratio)) : 0;

  // Match the equipped theme. The accent leads, but if the accent is too close
  // to the background to be seen (a white accent on a paper-white theme) the
  // readable foreground takes over, so the aura is visible on every theme in
  // the store — light, dark, and mid-tone alike.
  const palette = useMemo(() => {
    const bg = theme?.bg || '#000000';
    const accent = theme?.accent || '#FFFFFF';
    const text = theme?.text || '#F5F5F7';
    const base = contrastRatio(accent, bg) >= 1.7 ? accent : text;
    return {
      glow: base,
      ember: base,
      ash: theme?.muted || withAlpha(base, 0.55),
    };
  }, [theme]);

  useEffect(() => {
    // Spring so it gathers as it rises, and settles rather than snapping when
    // newly added tasks push the ratio back down.
    const anim = Animated.spring(level, {
      toValue: target,
      damping: 20,
      stiffness: 60,
      mass: 1,
      overshootClamping: true,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [level, target]);

  useEffect(() => {
    pulse.stopAnimation();
    pulse.setValue(0);
    if (!isComplete) return undefined;

    // The cleared-day loop: a slow swell, only once the day is actually done so
    // it stays a reward instead of ambience.
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
      pulse.stopAnimation();
    };
  }, [isComplete, pulse]);

  // Constant, derived only from height. It previously scaled with `target`,
  // which meant every completed task produced a NEW interpolation outputRange;
  // rebuilding a native animated node mid-flight detaches the running loop, so
  // the embers played once and then froze. Keeping this stable lets the loops
  // run uninterrupted for the whole day while `heat` alone controls intensity.
  const emberTravel = height * 0.85;

  // No tasks at all → render nothing, so an empty day stays pure black.
  // A day with work but nothing done yet DOES stay mounted at level 0 (fully
  // translated off-screen), so the first completion animates up smoothly
  // instead of popping into existence.
  if (!hasWork) {
    return null;
  }

  const fillOpacity = Animated.add(
    level.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0.35, 0.6, 1] }),
    isComplete ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.25] }) : 0,
  );

  return (
    <View style={[styles.container, { height }]} pointerEvents="none" accessible={false}>
      <Animated.View
        style={[
          styles.fill,
          {
            height,
            opacity: fillOpacity,
            transform: [
              {
                // level 0 → pushed entirely below the screen; level 1 → fully up.
                translateY: level.interpolate({
                  inputRange: [0, 1],
                  outputRange: [height, 0],
                }),
              },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={[
            withAlpha(palette.glow, 0),
            withAlpha(palette.glow, 0.05),
            withAlpha(palette.glow, 0.14),
            withAlpha(palette.glow, 0.32),
          ]}
          locations={[0, 0.4, 0.72, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {Array.from({ length: SPARK_COUNT }, (_, index) => (
          <Spark
            key={index}
            index={index}
            travel={emberTravel}
            heat={level}
            isAsh={index % 4 === 3}
            emberColor={palette.ember}
            ashColor={palette.ash}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  spark: {
    position: 'absolute',
    bottom: 0,
  },
});

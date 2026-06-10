import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate } from 'react-native-reanimated';

export const ShimmerQuote = ({ text, style }) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.linear }),
      -1, // infinite
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      // Moves the gradient from far left to far right
      transform: [{ translateX: interpolate(progress.value, [0, 1], [-200, 400]) }],
    };
  });

  return (
    <View style={styles.container}>
      <MaskedView
        style={{ flex: 1 }}
        maskElement={
          <Text style={[style, styles.maskText]} numberOfLines={3}>
            {text}
          </Text>
        }
      >
        {/* The solid dark grey background text */}
        <View style={StyleSheet.absoluteFill}>
          <Text style={[style, styles.baseText]} numberOfLines={3}>
            {text}
          </Text>
        </View>

        {/* The shining white gradient sliding across */}
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle, { flexDirection: 'row' }]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', '#ffffff', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ width: 100, height: '100%' }}
          />
        </Animated.View>
      </MaskedView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
    minHeight: 60,
  },
  maskText: {
    backgroundColor: 'transparent',
  },
  baseText: {
    color: '#444444', // Dark grey base color
  }
});

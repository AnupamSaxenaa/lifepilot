import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withDelay, 
  withTiming, 
  Easing,
  runOnJS
} from 'react-native-reanimated';

const AnimatedWord = ({ word, index, delayPerWord = 100, onComplete, isLast }) => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withDelay(
      index * delayPerWord,
      withTiming(1, { duration: 600, easing: Easing.out(Easing.ease) })
    );
    translateY.value = withDelay(
      index * delayPerWord,
      withTiming(0, { duration: 600, easing: Easing.out(Easing.ease) }, (finished) => {
        if (finished && isLast && onComplete) {
          // Trigger the completion callback when the very last word finishes animating
          runOnJS(onComplete)();
        }
      })
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }]
  }));

  return (
    <Animated.Text style={[styles.word, animatedStyle]}>
      {word}{' '}
    </Animated.Text>
  );
};

export const FadeText = ({ text, style, delayPerWord = 150, onAnimationComplete }) => {
  if (!text) return null;
  const words = text.split(' ');

  return (
    <View style={styles.container}>
      {words.map((word, i) => (
        <AnimatedWord 
          key={i} 
          word={word} 
          index={i} 
          delayPerWord={delayPerWord}
          onComplete={onAnimationComplete}
          isLast={i === words.length - 1}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  word: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 38,
  }
});

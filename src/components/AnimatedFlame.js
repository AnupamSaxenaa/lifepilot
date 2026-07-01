import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Flame } from 'lucide-react-native';
import { Image } from 'expo-image';

export const AnimatedFlame = ({ streak = 0, size = 26 }) => {
  const isBurning = streak > 0;
  
  // Animation values
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isBurning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          })
        ])
      ).start();
    } else {
      pulseAnim.setValue(0);
    }
  }, [isBurning, pulseAnim]);

  // Interpolations for a beautiful premium glow
  const scaleOuter = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.05]
  });
  
  const opacityOuter = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1]
  });

  if (!isBurning) {
    return (
      <View style={styles.container}>
        <Flame color="#555" size={size} fill="transparent" />
      </View>
    );
  }

  const gifSize = size + 6;

  // Array of GIF URIs for the fire icon
  const FIRE_GIFS = [
    'https://media.tenor.com/x4UA1SGzabwAAAAj/catjam-fire-catjam.gif', // Catjam
    'https://media.tenor.com/pmiCBCGZiekAAAAM/fire-elmo-whahahah.gif', // Elmo Fire
  ];

  // Pick one based on the current day of the year so it changes exactly once a day
  const getDayOfYear = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = (now - start) + ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000);
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  };
  
  const selectedGifIndex = getDayOfYear() % FIRE_GIFS.length;
  const currentGifUri = FIRE_GIFS[selectedGifIndex];

  return (
    <View style={styles.container}>
      <Animated.View style={{ 
        transform: [{ scale: scaleOuter }], 
        opacity: opacityOuter,
        shadowColor: '#EF4444',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 10,
        borderRadius: gifSize / 2,
      }}>
        <Image 
          source={{ uri: currentGifUri }}
          style={{
            width: gifSize,
            height: gifSize,
            borderRadius: gifSize / 2, // Circular crop
          }}
          contentFit="cover"
        />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
    height: 40,
  },
});

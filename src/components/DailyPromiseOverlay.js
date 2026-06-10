import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS } from 'react-native-reanimated';
import { Storage } from '../utils/storage';
import { FadeText } from './FadeText';

const { width, height } = Dimensions.get('window');

export const DailyPromiseOverlay = ({ userId }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [promiseText, setPromiseText] = useState('');
  const [countdown, setCountdown] = useState(5);
  const [showCountdown, setShowCountdown] = useState(false);
  const [showButton, setShowButton] = useState(false);

  // Animations
  const containerOpacity = useSharedValue(0);
  const buttonOpacity = useSharedValue(0);

  const handleDismiss = async () => {
    // Save that we've shown it today
    const today = new Date().toDateString();
    await Storage.set(`lastPromiseShownDate_${userId}`, today);

    // Fade out
    containerOpacity.value = withTiming(0, { duration: 600 }, (finished) => {
      if (finished) {
        runOnJS(setIsVisible)(false);
      }
    });
  };

  useEffect(() => {
    const checkPromise = async () => {
      if (!userId) return;

      const today = new Date().toDateString();
      const lastShown = await Storage.get(`lastPromiseShownDate_${userId}`);
      
      const config = await Storage.get(`promisesConfig_${userId}`);
      const isEnabled = config?.enabled !== false; // Default true
      const promisesList = config?.promises || [];

      // Only show if enabled, we have promises, and haven't shown today
      if (isEnabled && promisesList.length > 0 && lastShown !== today) {
        // Pick random promise
        const randomPromise = promisesList[Math.floor(Math.random() * promisesList.length)];
        setPromiseText(randomPromise);
        setIsVisible(true);
        
        // Fade in container
        containerOpacity.value = withTiming(1, { duration: 800 });
      }
    };
    checkPromise();
  }, [userId]);

  // Handle countdown logic
  useEffect(() => {
    if (showCountdown && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (showCountdown && countdown === 0) {
      requestAnimationFrame(() => {
        setShowButton(true);
      });
      buttonOpacity.value = withTiming(1, { duration: 600 });
    }
  }, [showCountdown, countdown]);

  const handleAnimationComplete = () => {
    // Wait a brief moment after text finishes, then start countdown
    setTimeout(() => {
      setShowCountdown(true);
    }, 500);
  };


  const animatedContainerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  const animatedButtonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
  }));

  if (!isVisible) return null;

  return (
    <Animated.View style={[styles.overlay, animatedContainerStyle]}>
      <View style={styles.content}>
        <Text style={styles.title}>YOUR DAILY PROMISE</Text>
        
        <View style={styles.promiseWrapper}>
          <FadeText 
            text={promiseText} 
            onAnimationComplete={handleAnimationComplete} 
          />
        </View>

        <View style={styles.bottomSection}>
          {showCountdown && countdown > 0 && (
            <Text style={styles.countdown}>Locking in for {countdown}s...</Text>
          )}

          {showButton && (
            <Animated.View style={[animatedButtonStyle, { width: '100%' }]}>
              <TouchableOpacity style={styles.button} onPress={handleDismiss}>
                <Text style={styles.buttonText}>I Respect Myself & My Promise</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#050505', // Solid ultra-dark color so it doesn't show dashboard underneath
    zIndex: 99999,
    elevation: 99999, // For Android
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    color: '#666',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    position: 'absolute',
    top: 100,
  },
  promiseWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 80,
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 32,
  },
  countdown: {
    color: '#888',
    fontSize: 16,
    fontStyle: 'italic',
  },
  button: {
    backgroundColor: '#ffffff',
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  }
});

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Storage } from '../utils/storage';
import { FadeText } from './FadeText';

const { width, height } = Dimensions.get('window');

export const DailyPromiseOverlay = ({ userId }) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [promiseText, setPromiseText] = useState('');
  const [countdown, setCountdown] = useState(5);
  const [showCountdown, setShowCountdown] = useState(false);
  // Derived, not stored: the button is visible exactly when the countdown has
  // run out. Holding this in state meant setting it from inside an effect, which
  // added a render pass and an ordering hazard between the mount and the fade-in
  // for no benefit.
  const showButton = showCountdown && countdown === 0;

  // Latched once the user accepts, so neither a second tap nor an AppState
  // 'active' event can restart the fade-in and strand a half-dismissed overlay.
  const dismissingRef = useRef(false);

  // Animations
  const containerOpacity = useSharedValue(0);
  const buttonOpacity = useSharedValue(0);

  /**
   * Dismiss the overlay.
   *
   * This used to need two taps, for two independent reasons:
   *
   * 1. It awaited `Storage.set` BEFORE starting the fade, so the first tap
   *    produced no visible response at all until AsyncStorage came back. On a
   *    device that has just resumed, that is easily long enough to read as "the
   *    button didn't work", so the natural reaction is to tap again. Writing the
   *    date is bookkeeping — it must not gate the user's feedback.
   *
   * 2. The completion callback only hid the overlay `if (finished)`. Reanimated
   *    reports finished=false whenever an animation is interrupted, and
   *    `checkPromise` re-assigns `containerOpacity` on every AppState 'active'
   *    event and on every re-run of the mount effect. If either landed while the
   *    fade-out was in flight, the callback was dropped and `isVisible` stayed
   *    true — the overlay simply sat there, fully dismissed in intent but still
   *    on screen, until the next tap started a fade that nothing interrupted.
   *
   * Now: the fade starts synchronously on press, the overlay is hidden whether or
   * not the animation completed cleanly, and a re-entry guard makes any extra
   * taps harmless.
   */
  const handleDismiss = () => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;

    // Persist in the background. A failed write only means the promise may show
    // again later, which is far better than delaying the dismissal.
    const today = new Date().toDateString();
    Storage.set(`lastPromiseShownDate_${userId}`, today).catch(() => {});

    containerOpacity.value = withTiming(0, { duration: 600 }, () => {
      // Unconditional: an interrupted fade must still dismiss.
      runOnJS(setIsVisible)(false);
    });
  };

  useEffect(() => {
    const checkPromise = async () => {
      if (!userId) return;
      // Once accepted, never re-show in this session. Without this, the
      // AppState listener could fire mid-fade-out and animate the overlay back
      // in, because the "shown today" write may not have landed yet.
      if (dismissingRef.current) return;

      const today = new Date().toDateString();
      const lastShown = await Storage.get(`lastPromiseShownDate_${userId}`);
      
      const config = await Storage.get(`promisesConfig_${userId}`);
      const isEnabled = config?.enabled !== false; // Default true

      // Fall back to a default promise if the user hasn't opened the Promises
      // screen yet (config not seeded). This is why the popup previously only
      // worked after visiting the Promises section first.
      const DEFAULT_PROMISE = t('dailyPromise.defaultPromise');
      let promisesList = config?.promises || [];
      if (promisesList.length === 0) {
        promisesList = [DEFAULT_PROMISE];
        // Seed config so the Promises screen stays consistent
        if (!config) {
          await Storage.set(`promisesConfig_${userId}`, { enabled: true, promises: [DEFAULT_PROMISE] });
        }
      }

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

    // Check immediately on mount
    checkPromise();

    // Check when app comes to foreground
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkPromise();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [userId]);

  // Handle countdown logic
  useEffect(() => {
    if (showCountdown && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (showCountdown && countdown === 0) {
      // The button is already mounted by this point (showButton is derived from
      // the same condition), so this only has to fade it in.
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
        <Text style={styles.title}>{t('dailyPromise.title')}</Text>
        
        <View style={styles.promiseWrapper}>
          <FadeText 
            text={promiseText} 
            onAnimationComplete={handleAnimationComplete} 
          />
        </View>

        <View style={styles.bottomSection}>
          {showCountdown && countdown > 0 && (
            <Text style={styles.countdown}>{t('dailyPromise.lockingInFor', { count: countdown })}</Text>
          )}

          {showButton && (
            <Animated.View style={[animatedButtonStyle, { width: '100%' }]}>
              <TouchableOpacity
                style={styles.button}
                onPress={handleDismiss}
                activeOpacity={0.85}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('dailyPromise.respectButton')}
              >
                <Text style={styles.buttonText}>{t('dailyPromise.respectButton')}</Text>
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

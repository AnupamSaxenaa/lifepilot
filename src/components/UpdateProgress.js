import { CheckCircle, Download, RefreshCw } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native';

const { width } = Dimensions.get('window');

/**
 * Beautiful OTA Update Progress UI
 * Shows at bottom of screen during update download
 */
export const UpdateProgress = ({ status, progress = 0 }) => {
  const [slideAnim] = useState(new Animated.Value(100)); // Start off-screen
  const [spinAnim] = useState(new Animated.Value(0));
  const [progressWidth] = useState(new Animated.Value(0));

  // Slide in/out animation
  useEffect(() => {
    if (status === 'checking' || status === 'downloading' || status === 'reloading') {
      // Slide in
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }).start();
    } else {
      // Slide out
      Animated.timing(slideAnim, {
        toValue: 100,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [status]);

  // Spin animation for checking/downloading
  useEffect(() => {
    if (status === 'checking' || status === 'downloading') {
      const animation = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      );
      animation.start();
      return () => animation.stop();
    }
  }, [status]);

  // Progress bar animation
  useEffect(() => {
    Animated.timing(progressWidth, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const progressBarWidth = progressWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const getStatusText = () => {
    switch (status) {
      case 'checking':
        return 'Checking for updates...';
      case 'downloading':
        return `Downloading update... ${Math.round(progress * 100)}%`;
      case 'reloading':
        return 'Update complete! Reloading...';
      case 'complete':
        return 'Up to date';
      default:
        return '';
    }
  };

  const getIcon = () => {
    switch (status) {
      case 'checking':
        return (
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <RefreshCw color="#A78BFA" size={20} />
          </Animated.View>
        );
      case 'downloading':
        return (
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Download color="#A78BFA" size={20} />
          </Animated.View>
        );
      case 'reloading':
      case 'complete':
        return <CheckCircle color="#10B981" size={20} />;
      default:
        return null;
    }
  };

  if (!status || status === 'no_update' || status === 'error') {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>{getIcon()}</View>
        <View style={styles.textContainer}>
          <Text style={styles.statusText}>{getStatusText()}</Text>
          {status === 'downloading' && (
            <View style={styles.progressBar}>
              <Animated.View
                style={[
                  styles.progressFill,
                  { width: progressBarWidth },
                ]}
              />
            </View>
          )}
        </View>
      </View>

      {/* Glow effect */}
      <View style={styles.glowTop} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#18181B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 20,
    paddingBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(167, 139, 250, 0.2)',
  },
  glowTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#A78BFA',
    shadowColor: '#A78BFA',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    marginRight: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
  },
  statusText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#27272A',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#A78BFA',
    borderRadius: 2,
  },
});

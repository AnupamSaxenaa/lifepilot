import { CheckCircle, Download, RefreshCw, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const { width } = Dimensions.get('window');

/**
 * Beautiful OTA Update Progress UI
 * Shows at bottom of screen during update download
 */
export const UpdateProgress = ({ status, progress = 0, updateReady = false, applying = false, onApply, onDismiss }) => {
  const { t } = useTranslation();
  const [slideAnim] = useState(new Animated.Value(100)); // Start off-screen
  const [spinAnim] = useState(new Animated.Value(0));
  const [progressWidth] = useState(new Animated.Value(0));
  const [indeterminateAnim] = useState(new Animated.Value(0));
  // Status belongs to the parent. Mirroring it into local state caused every
  // transition to render once stale and then again from an effect.
  const localStatus = status;

  // Slide in/out animation
  useEffect(() => {
    const shouldShow =
      localStatus === 'checking' ||
      localStatus === 'downloading' ||
      localStatus === 'reloading' ||
      localStatus === 'ready' ||
      localStatus === 'success_toast';
    if (shouldShow) {
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
  }, [localStatus]);

  // Spin animation for checking/downloading
  useEffect(() => {
    if (localStatus === 'checking' || localStatus === 'downloading') {
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
  }, [localStatus]);

  // Progress bar animation
  useEffect(() => {
    Animated.timing(progressWidth, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  // Indeterminate sliding animation (used while downloading when the server
  // doesn't report byte progress).
  useEffect(() => {
    if (localStatus === 'downloading' && progress <= 0) {
      const animation = Animated.loop(
        Animated.timing(indeterminateAnim, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        })
      );
      animation.start();
      return () => animation.stop();
    }
  }, [localStatus, progress]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const progressBarWidth = progressWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const indeterminateX = indeterminateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, width],
  });

  const getStatusText = () => {
    switch (localStatus) {
      case 'checking':
        return t('updateProgress.checkingForUpdates');
      case 'downloading':
        // Real byte-progress isn't exposed by fetchUpdateAsync, so we show an
        // honest indeterminate state rather than a fake/stuck percentage.
        return progress > 0
          ? t('updateProgress.downloadingUpdate', { percent: Math.round(progress * 100) })
          : t('updateProgress.downloadingUpdateIndeterminate');
      case 'ready':
        return t('updateProgress.updateReady');
      case 'reloading':
        return t('updateProgress.updateCompleteReloading');
      case 'success_toast':
        return t('updateProgress.newPatchesDownloaded');
      case 'complete':
        return t('updateProgress.upToDate');
      default:
        return '';
    }
  };

  const getIcon = () => {
    switch (localStatus) {
      case 'checking':
        return (
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <RefreshCw color="#FFFFFF" size={20} />
          </Animated.View>
        );
      case 'downloading':
        return (
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Download color="#FFFFFF" size={20} />
          </Animated.View>
        );
      case 'ready':
        return <Download color="#FFFFFF" size={20} />;
      case 'reloading':
      case 'success_toast':
      case 'complete':
        return <CheckCircle color="#34D399" size={20} />;
      default:
        return null;
    }
  };

  if (!localStatus || localStatus === 'no_update' || localStatus === 'error') {
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
          {localStatus === 'ready' && (
            <Text style={styles.subText}>{t('updateProgress.updateReadySub')}</Text>
          )}
          {localStatus === 'downloading' && (
            <View style={styles.progressBar}>
              {progress > 0 ? (
                <Animated.View style={[styles.progressFill, { width: progressBarWidth }]} />
              ) : (
                <Animated.View
                  style={[
                    styles.progressIndeterminate,
                    { transform: [{ translateX: indeterminateX }] },
                  ]}
                />
              )}
            </View>
          )}
        </View>

        {/* Apply / Dismiss actions for the "update ready" banner */}
        {localStatus === 'ready' && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.applyButton}
              onPress={onApply}
              disabled={applying}
              activeOpacity={0.8}
            >
              <Text style={styles.applyButtonText}>
                {applying ? t('updateProgress.applying') : t('updateProgress.applyButton')}
              </Text>
            </TouchableOpacity>
            {!applying && (
              <TouchableOpacity style={styles.closeButton} onPress={onDismiss}>
                <X color="#999" size={20} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Dismiss Button for Success Toast */}
        {localStatus === 'success_toast' && (
          <TouchableOpacity 
            style={styles.closeButton} 
            onPress={() => onDismiss?.()}
          >
            <X color="#999" size={20} />
          </TouchableOpacity>
        )}
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
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  closeButton: {
    padding: 8,
    marginLeft: 8,
  },
  glowTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
  subText: {
    color: '#A1A1AA',
    fontSize: 13,
    marginBottom: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  applyButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  applyButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '800',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#27272A',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  progressIndeterminate: {
    height: '100%',
    width: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
});

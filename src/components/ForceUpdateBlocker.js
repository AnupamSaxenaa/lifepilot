import { AlertCircle, Download } from 'lucide-react-native';
import React, { useState } from 'react';
import { Alert, Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { downloadAndInstallAPK } from '../utils/apkDownloader';

const { width, height } = Dimensions.get('window');

/**
 * Force Update Blocker
 * Full-screen overlay that blocks app usage when APK update is required
 * Shows version info, download button with progress, and auto-triggers install
 */
export const ForceUpdateBlocker = ({ updateInfo, visible }) => {
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [pulseAnim] = useState(new Animated.Value(1));

  React.useEffect(() => {
    if (visible) {
      // Fade in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Pulse animation for alert icon
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [visible]);

  const handleDownload = async () => {
    if (!updateInfo?.downloadUrl) {
      Alert.alert('Error', 'Download URL not available. Please contact support.');
      return;
    }

    try {
      setDownloading(true);
      setDownloadProgress(0);

      await downloadAndInstallAPK(
        updateInfo.downloadUrl,
        (progress) => {
          setDownloadProgress(progress);
        }
      );

      // Install prompt opened - user will install manually
      // After install, app will restart with new version
    } catch (error) {
      setDownloading(false);
      Alert.alert(
        'Download Failed',
        error.message || 'Failed to download update. Please check your internet connection and try again.',
        [{ text: 'Retry', onPress: handleDownload }]
      );
    }
  };

  if (!visible || !updateInfo) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Background blur overlay */}
      <BlurView intensity={100} style={styles.backdrop} tint="dark">
        <View style={styles.darkOverlay} />
      </BlurView>

      {/* Content */}
      <View style={styles.content}>
        {/* Alert Icon */}
        <Animated.View style={[styles.iconContainer, { transform: [{ scale: pulseAnim }] }]}>
          <AlertCircle color="#EF4444" size={64} strokeWidth={2} />
        </Animated.View>

        {/* Title */}
        <Text style={styles.title}>Update Required</Text>
        
        {/* Description */}
        <Text style={styles.description}>
          A new version of LifePilot is available. Please update to continue using the app.
        </Text>

        {/* Version Info */}
        <View style={styles.versionBox}>
          <Text style={styles.versionLabel}>Version Information</Text>
          <Text style={styles.versionText}>
            Current: v{updateInfo.currentVersion}
          </Text>
          <Text style={styles.versionText}>
            Latest: v{updateInfo.latestVersion}
          </Text>
        </View>

        {/* Release Notes (if available) */}
        {updateInfo.releaseNotes && (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>What's New</Text>
            <Text style={styles.notesText}>{updateInfo.releaseNotes}</Text>
          </View>
        )}

        {/* Download Button / Progress */}
        {!downloading ? (
          <TouchableOpacity
            style={styles.downloadButton}
            onPress={handleDownload}
            activeOpacity={0.8}
          >
            <Download color="#FFF" size={24} />
            <Text style={styles.downloadButtonText}>Download Update</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Downloading...</Text>
              <Text style={styles.progressPercent}>{Math.round(downloadProgress * 100)}%</Text>
            </View>
            
            {/* Progress Bar */}
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBackground}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${downloadProgress * 100}%`,
                    },
                  ]}
                />
              </View>
            </View>

            {downloadProgress === 1 && (
              <Text style={styles.installHint}>
                Opening installer... Please allow installation from unknown sources if prompted.
              </Text>
            )}
          </View>
        )}

        {/* Help Text */}
        <Text style={styles.helpText}>
          This update contains critical improvements and is required to continue.
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: '#A1A1AA',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  versionBox: {
    backgroundColor: '#18181B',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  versionLabel: {
    fontSize: 12,
    color: '#71717A',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  versionText: {
    fontSize: 16,
    color: '#FFF',
    marginBottom: 6,
    fontFamily: 'monospace',
  },
  notesBox: {
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
  },
  notesLabel: {
    fontSize: 12,
    color: '#A78BFA',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  notesText: {
    fontSize: 14,
    color: '#E4E4E7',
    lineHeight: 20,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A78BFA',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    marginTop: 16,
    shadowColor: '#A78BFA',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
    gap: 12,
  },
  downloadButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  progressContainer: {
    width: '100%',
    marginTop: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressLabel: {
    fontSize: 16,
    color: '#FFF',
    fontWeight: '600',
  },
  progressPercent: {
    fontSize: 16,
    color: '#A78BFA',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  progressBarContainer: {
    marginBottom: 12,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#27272A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#A78BFA',
    borderRadius: 4,
  },
  installHint: {
    fontSize: 13,
    color: '#71717A',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
  },
  helpText: {
    fontSize: 12,
    color: '#52525B',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});

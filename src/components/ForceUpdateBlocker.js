import { Download } from 'lucide-react-native';
import React, { useState } from 'react';
import { Alert, Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { downloadAndInstallAPK } from '../utils/apkDownloader';

export const ForceUpdateBlocker = ({ updateInfo, visible }) => {
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [fadeAnim] = useState(new Animated.Value(0));

  React.useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleDownload = async () => {
    // The database column is download_url, but sometimes it's mapped to downloadUrl
    const url = updateInfo?.downloadUrl || updateInfo?.download_url;
    
    console.log('[ForceUpdate] Download button clicked');
    console.log('[ForceUpdate] Update info:', JSON.stringify(updateInfo, null, 2));
    console.log('[ForceUpdate] Download URL:', url);
    
    if (!url) {
      console.error('[ForceUpdate] No download URL available!');
      Alert.alert('Error', 'Download URL not available. Please contact support.');
      return;
    }

    try {
      console.log('[ForceUpdate] Starting download...');
      setDownloading(true);
      setDownloadProgress(0);

      await downloadAndInstallAPK(url, (progress) => {
        console.log('[ForceUpdate] Progress:', Math.round(progress * 100) + '%');
        setDownloadProgress(progress);
      });
      
      console.log('[ForceUpdate] Download completed, installer should open');
    } catch (error) {
      console.error('[ForceUpdate] Download failed:', error);
      setDownloading(false);
      Alert.alert(
        'Download Failed', 
        error.message || 'Failed to download update. Please check your internet connection and try again.'
      );
    }
  };

  if (!visible || !updateInfo) return null;

  const currentVer = updateInfo.currentVersion || updateInfo.current_version;
  const latestVer = updateInfo.latestVersion || updateInfo.latest_version;

  return (
    <Modal 
      visible={visible} 
      animationType="none" 
      transparent={false}
      statusBarTranslucent
      hardwareAccelerated
    >
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <View style={styles.content}>
          {/* Minimal Header */}
          <View style={styles.header}>
            <Text style={styles.updateLabel}>UPDATE REQUIRED</Text>
            <View style={styles.versionRow}>
              <Text style={styles.versionSmall}>{currentVer}</Text>
              <Text style={styles.arrow}>→</Text>
              <Text style={styles.versionHighlight}>{latestVer}</Text>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Message */}
          <Text style={styles.message}>
            A new version is required to continue.{'\n'}
            Please update now.
          </Text>

          {/* Download Button or Progress */}
          {!downloading ? (
            <TouchableOpacity style={styles.downloadButton} onPress={handleDownload} activeOpacity={0.7}>
              <Download color="#000" size={20} strokeWidth={2.5} />
              <Text style={styles.downloadButtonText}>Download Update</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.progressContainer}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>Downloading</Text>
                <Text style={styles.progressPercent}>{Math.round(downloadProgress * 100)}%</Text>
              </View>
              <View style={styles.progressBarBackground}>
                <Animated.View 
                  style={[
                    styles.progressBarFill, 
                    { width: `${downloadProgress * 100}%` }
                  ]} 
                />
              </View>
              {downloadProgress === 1 && (
                <Text style={styles.installHint}>Opening installer...</Text>
              )}
            </View>
          )}

          {/* Footer Note */}
          <Text style={styles.footerNote}>
            This update contains critical improvements
          </Text>
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  
  // Header Section
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  updateLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#555',
    letterSpacing: 2,
    marginBottom: 24,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  versionSmall: {
    fontSize: 16,
    color: '#555',
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  arrow: {
    fontSize: 20,
    color: '#FFF',
    fontWeight: '300',
  },
  versionHighlight: {
    fontSize: 24,
    color: '#FFF',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  
  // Divider
  divider: {
    width: 60,
    height: 1,
    backgroundColor: '#222',
    marginBottom: 40,
  },
  
  // Message
  message: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 48,
    maxWidth: 280,
  },
  
  // Download Button
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    maxWidth: 320,
    gap: 10,
  },
  downloadButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 0.5,
  },
  
  // Progress
  progressContainer: {
    width: '100%',
    maxWidth: 320,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressLabel: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '600',
  },
  progressPercent: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: '#222',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFF',
    borderRadius: 2,
  },
  installHint: {
    fontSize: 12,
    color: '#555',
    textAlign: 'center',
    marginTop: 12,
  },
  
  // Footer
  footerNote: {
    fontSize: 12,
    color: '#444',
    textAlign: 'center',
    marginTop: 32,
  },
});

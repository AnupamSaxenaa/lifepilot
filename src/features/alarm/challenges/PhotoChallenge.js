/**
 * LifePilot — Photo Challenge
 * ------------------------------------------------------------------
 * User must take a photo (of anything — e.g. the sink, mirror, coffee
 * machine per config.target — verification is presence-of-photo only, no
 * image classification) to dismiss. Uses `expo-image-picker`'s camera launch,
 * already installed. Capability-gated on camera permission availability.
 */
import { Camera } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { register } from './registry';

let ImagePicker = null;
try {
  ImagePicker = require('expo-image-picker');
} catch (_e) {
  ImagePicker = null;
}

export const PhotoChallenge = ({ config = {}, onComplete, onUnavailable }) => {
  const { t } = useTranslation();
  const target = config.target || t('alarmChallengeUi.photoTargetDefault');
  const [photoUri, setPhotoUri] = useState(null);
  const [error, setError] = useState(null);

  const takePhoto = async () => {
    if (!ImagePicker) {
      onUnavailable?.();
      return;
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError(t('alarmChallengeUi.cameraPermissionRequired'));
        onUnavailable?.();
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      if (!result.canceled && result.assets && result.assets.length) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (_e) {
      setError(t('alarmChallengeUi.cameraOpenError'));
      onUnavailable?.();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.takePhotoOf', { target })}</Text>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.preview} />
      ) : (
        <View style={styles.placeholder}>
          <Camera color="#71717A" size={32} />
        </View>
      )}
      <TouchableOpacity style={styles.cameraBtn} onPress={takePhoto} activeOpacity={0.85}>
        <Text style={styles.cameraBtnText}>{photoUri ? t('alarmChallengeUi.retake') : t('alarmChallengeUi.openCamera')}</Text>
      </TouchableOpacity>
      {photoUri && (
        <TouchableOpacity style={styles.confirmBtn} onPress={() => onComplete && onComplete()} activeOpacity={0.85}>
          <Text style={styles.confirmBtnText}>{t('alarmChallengeUi.confirm')}</Text>
        </TouchableOpacity>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', marginBottom: 14, textAlign: 'center' },
  preview: { width: 140, height: 140, borderRadius: 16, marginBottom: 16 },
  placeholder: { width: 140, height: 140, borderRadius: 16, backgroundColor: '#18181B', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  cameraBtn: { backgroundColor: '#27272A', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 20, marginBottom: 10 },
  cameraBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  confirmBtn: { backgroundColor: '#FFFFFF', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 20 },
  confirmBtnText: { color: '#000', fontWeight: '800', fontSize: 15 },
  errorText: { color: '#A1A1AA', fontSize: 12, marginTop: 10, fontWeight: '600' },
});

register('photo', {
  component: PhotoChallenge,
  isAvailable: () => !!ImagePicker,
  isAvailableAsync: async () => {
    if (!ImagePicker?.getCameraPermissionsAsync) return false;
    const permission = await ImagePicker.getCameraPermissionsAsync();
    return permission.granted || permission.canAskAgain !== false;
  },
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.photo',
});

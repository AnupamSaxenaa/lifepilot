/**
 * LifePilot — QR Code / Barcode Challenge
 * ------------------------------------------------------------------
 * User must scan a registered QR code (or any barcode, depending on
 * `config.mode`) to dismiss. QR mode checks the scanned value against the
 * user's registered codes (see qrCodes.js); barcode mode accepts any valid
 * barcode scan (no registration needed — the point is "walk to the kitchen
 * and scan a product").
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Storage } from '../../../utils/storage';
import { isRegisteredCode, loadRegisteredCodes } from './qrCodes';
import { register } from './registry';

let CameraView = null;
let useCameraPermissions = () => [null, async () => {}];
try {
  const mod = require('expo-camera');
  CameraView = mod.CameraView;
  useCameraPermissions = mod.useCameraPermissions;
} catch (_e) {
  CameraView = null;
}

const QR_TYPES = ['qr'];
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code39', 'code128', 'qr'];

export const QrCodeChallenge = ({ config = {}, onComplete }) => {
  const { t } = useTranslation();
  const mode = config.mode === 'barcode' ? 'barcode' : 'qr';
  const [status, setStatus] = useState('scanning'); // scanning | wrong | granted
  const [permission, requestPermission] = useCameraPermissions();
  const [registeredCodes, setRegisteredCodes] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const uid = await Storage.get('current_user_id');
      if (mode === 'qr' && uid) {
        const codes = await loadRegisteredCodes(uid);
        if (mounted) setRegisteredCodes(codes);
      }
    })();
    return () => { mounted = false; };
  }, [mode]);

  if (!CameraView) return null; // isAvailable() already excludes this, but stay defensive

  if (!permission) {
    return <View style={styles.container}><Text style={styles.hint}>{t('alarmChallengeUi.cameraLoading')}</Text></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.hint}>{t('alarmChallengeUi.cameraPermissionScan')}</Text>
        <Text style={styles.link} onPress={requestPermission}>{t('alarmChallengeUi.grantPermission')}</Text>
      </View>
    );
  }

  const handleScanned = ({ data }) => {
    if (status !== 'scanning') return;
    if (mode === 'barcode') {
      setStatus('granted');
      onComplete && onComplete();
      return;
    }
    // QR mode: must match a registered code (if any are registered at all —
    // if the user never registered one, accept any QR scan so the challenge
    // still works rather than being permanently unsolvable).
    if (registeredCodes.length === 0 || isRegisteredCode(registeredCodes, data)) {
      setStatus('granted');
      onComplete && onComplete();
    } else {
      setStatus('wrong');
      setTimeout(() => setStatus('scanning'), 800);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{mode === 'qr' ? t('alarmChallengeUi.scanRegisteredQr') : t('alarmChallengeUi.scanAnyBarcode')}</Text>
      <View style={styles.cameraWrap}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: mode === 'qr' ? QR_TYPES : BARCODE_TYPES }}
          onBarcodeScanned={handleScanned}
        />
      </View>
      {status === 'wrong' && <Text style={styles.errorText}>{t('alarmChallengeUi.wrongQr')}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  cameraWrap: { width: 220, height: 220, borderRadius: 16, overflow: 'hidden' },
  camera: { flex: 1 },
  link: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', marginTop: 10 },
  errorText: { color: '#A1A1AA', fontSize: 12, marginTop: 10, fontWeight: '600' },
});

register('qrCode', {
  component: QrCodeChallenge,
  isAvailable: () => !!CameraView,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.qrCode',
});

register('barcode', {
  component: (props) => <QrCodeChallenge {...props} config={{ ...props.config, mode: 'barcode' }} />,
  isAvailable: () => !!CameraView,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.barcode',
});

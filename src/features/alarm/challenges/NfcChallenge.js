/**
 * LifePilot — NFC Tap Challenge
 * ------------------------------------------------------------------
 * User must tap a registered NFC tag to dismiss. Uses `react-native-nfc-
 * manager`. Capability-gated on `isSupported()` (many devices/iOS lack
 * writable NFC read support in this flow, or the module fails to load) so it
 * never appears in `getAvailable()` where unsupported (Property 10).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Storage } from '../../../utils/storage';
import { isRegisteredTag, loadRegisteredTags } from './nfcTags';
import { register } from './registry';

let NfcManager = null;
let NfcEvents = null;
try {
  const mod = require('react-native-nfc-manager');
  NfcManager = mod.default;
  NfcEvents = mod.NfcEvents;
} catch (_e) {
  NfcManager = null;
}

// Cached across the app session — checked once, used by isAvailable().
let _cachedSupported = null;
export const refreshNfcSupport = async () => {
  if (!NfcManager) return (_cachedSupported = false);
  try {
    const supported = await NfcManager.isSupported();
    _cachedSupported = supported && (typeof NfcManager.isEnabled !== 'function' || await NfcManager.isEnabled());
  } catch (_e) {
    _cachedSupported = false;
  }
  return _cachedSupported;
};
refreshNfcSupport();

export const NfcChallenge = ({ onComplete }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState('waiting'); // waiting | wrong | granted
  const [error, setError] = useState(null);
  const registeredRef = useRef([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const uid = await Storage.get('current_user_id');
      if (uid) registeredRef.current = await loadRegisteredTags(uid);

      if (!NfcManager) return;
      try {
        await NfcManager.start();
        NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag) => {
          if (!mounted) return;
          const tagId = tag?.id || '';
          if (registeredRef.current.length === 0) {
            setError(t('alarmChallengeUi.registerNfcFirst'));
            return;
          }
          if (isRegisteredTag(registeredRef.current, tagId)) {
            setStatus('granted');
            onComplete && onComplete();
          } else {
            setStatus('wrong');
            setTimeout(() => mounted && setStatus('waiting'), 800);
          }
        });
        await NfcManager.registerTagEvent();
      } catch (e) {
        setError(e?.message || t('alarmChallengeUi.nfcUnavailable'));
      }
    })();

    return () => {
      mounted = false;
      if (NfcManager) {
        try {
          NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
          NfcManager.unregisterTagEvent().catch(() => {});
        } catch (_e) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('alarmChallengeUi.tapRegisteredNfc')}</Text>
      <View style={[styles.ring, status === 'granted' && styles.ringGranted, status === 'wrong' && styles.ringWrong]} />
      {status === 'wrong' && <Text style={styles.errorText}>{t('alarmChallengeUi.wrongNfc')}</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  hint: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', marginBottom: 20 },
  ring: { width: 100, height: 100, borderRadius: 50, borderWidth: 4, borderColor: '#FFFFFF' },
  ringGranted: { borderColor: '#34D399' },
  ringWrong: { borderColor: '#A1A1AA' },
  errorText: { color: '#A1A1AA', fontSize: 12, marginTop: 14, fontWeight: '600' },
});

register('nfc', {
  component: NfcChallenge,
  isAvailable: () => !!_cachedSupported,
  isAvailableAsync: refreshNfcSupport,
  defaultDifficulty: 'medium',
  i18nKey: 'alarmChallenges.nfc',
});

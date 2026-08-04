/**
 * LifePilot — Registered QR Codes
 * ------------------------------------------------------------------
 * Lets the user scan and register QR codes they've placed around their home
 * (kitchen, bathroom, front door, etc.) for use with the QR dismiss
 * challenge. Fully offline/local (see qrCodes.js) — no server round-trip.
 */
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, QrCode, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadRegisteredCodes, registerCode, removeCode } from '../features/alarm/challenges/qrCodes';
import { getCurrentUserId } from '../lib/dataManager';

let CameraView = null;
let useCameraPermissions = () => [null, async () => {}];
try {
  const mod = require('expo-camera');
  CameraView = mod.CameraView;
  useCameraPermissions = mod.useCameraPermissions;
} catch (_e) {
  CameraView = null;
}

export const AlarmQrCodesScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [userId, setUserId] = useState(null);
  const [codes, setCodes] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [pendingValue, setPendingValue] = useState(null);
  const [label, setLabel] = useState('');
  const [permission, requestPermission] = useCameraPermissions();

  const load = useCallback(async () => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    setUserId(uid);
    setCodes(await loadRegisteredCodes(uid));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleScanned = ({ data }) => {
    setScanning(false);
    setPendingValue(data);
    setLabel('');
  };

  const confirmSave = async () => {
    if (!userId || !pendingValue) return;
    const updated = await registerCode(userId, pendingValue, label.trim() || t('alarmChallenges.qrCode'));
    setCodes(updated);
    setPendingValue(null);
  };

  const handleRemove = async (value) => {
    const updated = await removeCode(userId, value);
    setCodes(updated);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('alarmQrCodes.title')}</Text>
      </View>

      {codes.length === 0 ? (
        <View style={styles.emptyWrap}>
          <QrCode color="#71717A" size={40} />
          <Text style={styles.emptyText}>{t('alarmQrCodes.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={codes}
          keyExtractor={(item) => item.value}
          contentContainerStyle={{ padding: 20 }}
          renderItem={({ item }) => (
            <View style={styles.codeRow}>
              <Text style={styles.codeLabel}>{item.label}</Text>
              <TouchableOpacity onPress={() => handleRemove(item.value)}>
                <Trash2 color="#FB7185" size={18} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.scanBtn} onPress={() => setScanning(true)} activeOpacity={0.85}>
        <QrCode color="#000" size={20} />
        <Text style={styles.scanBtnText}>{t('alarmQrCodes.scanNew')}</Text>
      </TouchableOpacity>

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <SafeAreaView style={styles.container}>
          {CameraView && permission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleScanned}
            />
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>{t('alarmChallengeUi.cameraPermissionRequired')}</Text>
              <TouchableOpacity onPress={requestPermission}><Text style={styles.scanBtnText}>{t('alarmChallengeUi.grantPermission')}</Text></TouchableOpacity>
            </View>
          )}
          <TouchableOpacity style={styles.cancelScanBtn} onPress={() => setScanning(false)}>
            <Text style={styles.duplicateText}>{t('alarmQrCodes.cancel')}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      <Modal visible={!!pendingValue} transparent animationType="fade" onRequestClose={() => setPendingValue(null)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <TextInput
              style={styles.labelInput}
              value={label}
              onChangeText={setLabel}
              placeholder={t('alarmQrCodes.labelPlaceholder')}
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setPendingValue(null)}>
                <Text style={styles.duplicateText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmSaveBtn} onPress={confirmSave}>
                <Text style={styles.confirmSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', flex: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 30 },
  emptyText: { color: '#A1A1AA', fontSize: 14, textAlign: 'center' },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#18181B', borderRadius: 14, padding: 14, marginBottom: 10 },
  codeLabel: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFFFFF', margin: 20, paddingVertical: 14, borderRadius: 20 },
  scanBtnText: { color: '#000', fontWeight: '800', fontSize: 15 },
  cancelScanBtn: { padding: 20, alignItems: 'center' },
  duplicateText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 30 },
  confirmCard: { backgroundColor: '#18181B', borderRadius: 20, padding: 20 },
  labelInput: { backgroundColor: '#27272A', borderRadius: 12, padding: 12, color: '#FFF', fontSize: 15 },
  confirmCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: '#27272A', borderRadius: 14 },
  confirmSaveBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: '#FFFFFF', borderRadius: 14 },
  confirmSaveText: { color: '#000', fontWeight: '800' },
});

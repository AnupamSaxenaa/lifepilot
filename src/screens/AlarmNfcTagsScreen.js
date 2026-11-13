/**
 * LifePilot — Registered NFC Tags
 * ------------------------------------------------------------------
 * Lets the user tap and register NFC tags for use with the NFC dismiss
 * challenge. Mirrors AlarmQrCodesScreen. Fully offline/local (nfcTags.js).
 */
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Nfc, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadRegisteredTags, registerTag, removeTag } from '../features/alarm/challenges/nfcTags';
import { getCurrentUserId } from '../lib/dataManager';

let NfcManager = null;
let NfcEvents = null;
try {
  const mod = require('react-native-nfc-manager');
  NfcManager = mod.default;
  NfcEvents = mod.NfcEvents;
} catch (_e) {
  NfcManager = null;
}

export const AlarmNfcTagsScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [userId, setUserId] = useState(null);
  const [tags, setTags] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    setUserId(uid);
    setTags(await loadRegisteredTags(uid));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!scanning || !NfcManager) return;
    let active = true;
    (async () => {
      try {
        await NfcManager.start();
        NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag) => {
          if (!active) return;
          setPendingId(tag?.id || '');
          setLabel('');
          setScanning(false);
        });
        await NfcManager.registerTagEvent();
      } catch (_e) {}
    })();
    return () => {
      active = false;
      try {
        NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
        NfcManager.unregisterTagEvent().catch(() => {});
      } catch (_e) {}
    };
  }, [scanning]);

  const confirmSave = async () => {
    if (!userId || !pendingId) return;
    const updated = await registerTag(userId, pendingId, label.trim() || t('alarmRegistrationUi.defaultNfcLabel'));
    setTags(updated);
    setPendingId(null);
  };

  const handleRemove = async (id) => {
    const updated = await removeTag(userId, id);
    setTags(updated);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('alarmNfcTags.title')}</Text>
      </View>

      {tags.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Nfc color="#71717A" size={40} />
          <Text style={styles.emptyText}>{t('alarmNfcTags.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={tags}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 20 }}
          renderItem={({ item }) => (
            <View style={styles.tagRow}>
              <Text style={styles.tagLabel}>{item.label}</Text>
              <TouchableOpacity onPress={() => handleRemove(item.id)}>
                <Trash2 color="#FB7185" size={18} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.scanBtn} onPress={() => setScanning(true)} activeOpacity={0.85}>
        <Nfc color="#000" size={20} />
        <Text style={styles.scanBtnText}>{t('alarmNfcTags.scanNew')}</Text>
      </TouchableOpacity>

      <Modal visible={scanning} transparent animationType="fade" onRequestClose={() => setScanning(false)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Nfc color="#FFFFFF" size={40} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.waitingText}>{t('alarmNfcTags.waiting')}</Text>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setScanning(false)}>
              <Text style={styles.duplicateText}>{t('alarmNfcTags.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!pendingId} transparent animationType="fade" onRequestClose={() => setPendingId(null)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <TextInput
              style={styles.labelInput}
              value={label}
              onChangeText={setLabel}
              placeholder={t('alarmNfcTags.labelPlaceholder')}
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setPendingId(null)}>
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
  tagRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#18181B', borderRadius: 14, padding: 14, marginBottom: 10 },
  tagLabel: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFFFFF', margin: 20, paddingVertical: 14, borderRadius: 20 },
  scanBtnText: { color: '#000', fontWeight: '800', fontSize: 15 },
  duplicateText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  waitingText: { color: '#D4D4D8', fontSize: 15, textAlign: 'center', marginBottom: 16 },
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 30 },
  confirmCard: { backgroundColor: '#18181B', borderRadius: 20, padding: 20 },
  labelInput: { backgroundColor: '#27272A', borderRadius: 12, padding: 12, color: '#FFF', fontSize: 15 },
  confirmCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: '#27272A', borderRadius: 14 },
  confirmSaveBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: '#FFFFFF', borderRadius: 14 },
  confirmSaveText: { color: '#000', fontWeight: '800' },
});

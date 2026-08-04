// ─── Mindful Reflection Modal ────────────────────────────
// End-of-day journal for the Mindful Lock feature.
// Records mood, optional note, and awards XP.
// ─────────────────────────────────────────────────────────

import { X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { syncToSupabase } from '../lib/syncQueue';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';

const { width } = Dimensions.get('window');

const generateUUID = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// Canonical English mood labels stored in the database — kept stable
// regardless of the active display language.
const MOOD_DB_LABELS = ['Rough', 'Meh', 'Okay', 'Good', 'Great'];

export const MindfulReflectionModal = ({ isVisible, onClose, userId, todayStats = {}, onSuccess }) => {
  const ACCENT = useTheme().theme.accent;
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);

  const MOODS = [
    { emoji: '😫', label: t('mindfulReflection.moodRough') },
    { emoji: '😕', label: t('mindfulReflection.moodMeh') },
    { emoji: '😐', label: t('mindfulReflection.moodOkay') },
    { emoji: '🙂', label: t('mindfulReflection.moodGood') },
    { emoji: '😊', label: t('mindfulReflection.moodGreat') },
  ];
  const [selectedMood, setSelectedMood] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (selectedMood === null) return;
    setSaving(true);

    try {
      const existing = (await Storage.get(`mindful_reflections_${userId}`)) || [];
      const newId = generateUUID();
      const newEntry = {
        id: newId,
        mood: selectedMood,
        note: note.trim(),
        stats: todayStats,
        createdAt: new Date().toISOString(),
      };
      
      existing.unshift(newEntry);
      // Keep last 90 days
      if (existing.length > 90) existing.length = 90;
      await Storage.set(`mindful_reflections_${userId}`, existing);

      // Award XP
      await Gamification.addXP(userId, 10);

      // Sync to database
      syncToSupabase('mindful_reflections', 'insert', {
        id: newId,
        user_id: userId,
        mood: MOOD_DB_LABELS[selectedMood],
        note: note.trim(),
        stats: todayStats,
        created_at: newEntry.createdAt
      });

      if (onSuccess) onSuccess();

      setSelectedMood(null);
      setNote('');
      onClose();
    } catch (err) {
      console.log('Reflection save error:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!isVisible) return null;

  return (
    <Modal visible={isVisible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('mindfulReflection.modalTitle')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X color="#a1a1aa" size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Today's Summary */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statEmoji}>🛡️</Text>
                <Text style={styles.statValue}>{todayStats.resisted || 0}</Text>
                <Text style={styles.statLabel}>{t('mindfulReflection.statResisted')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statEmoji}>📱</Text>
                <Text style={styles.statValue}>{todayStats.used || 0}</Text>
                <Text style={styles.statLabel}>{t('mindfulReflection.statUsed')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statEmoji}>⏱️</Text>
                <Text style={styles.statValue}>{todayStats.timeSaved || 0}</Text>
                <Text style={styles.statLabel}>{t('mindfulReflection.statMinSaved')}</Text>
              </View>
            </View>

            {/* Mood Selector */}
            <Text style={styles.sectionTitle}>{t('mindfulReflection.moodQuestion')}</Text>
            <View style={styles.moodRow}>
              {MOODS.map((mood, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.moodBtn,
                    selectedMood === index && styles.moodBtnSelected,
                  ]}
                  onPress={() => setSelectedMood(index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.moodEmoji}>{mood.emoji}</Text>
                  <Text style={[
                    styles.moodLabel,
                    selectedMood === index && { color: ACCENT },
                  ]}>{mood.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Note */}
            <Text style={styles.sectionTitle}>{t('mindfulReflection.noteQuestion')}</Text>
            <TextInput
              style={styles.noteInput}
              placeholder={t('mindfulReflection.notePlaceholder')}
              placeholderTextColor="#52525b"
              multiline
              maxLength={500}
              value={note}
              onChangeText={setNote}
            />

            {/* Submit */}
            <TouchableOpacity
              style={[
                styles.submitBtn,
                selectedMood === null && { opacity: 0.4 },
              ]}
              onPress={handleSubmit}
              disabled={selectedMood === null || saving}
              activeOpacity={0.8}
            >
              <Text style={styles.submitText}>
                {saving ? t('mindfulReflection.savingButton') : t('mindfulReflection.saveReflectionButton', { xp: 10 })}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const makeStyles = (ACCENT) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    width: width * 0.9,
    maxHeight: '80%',
    backgroundColor: '#0a0a0a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 14,
    alignItems: 'center',
  },
  statEmoji: {
    fontSize: 20,
    marginBottom: 6,
  },
  statValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  statLabel: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  sectionTitle: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  moodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  moodBtn: {
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 56,
  },
  moodBtnSelected: {
    borderColor: ACCENT,
    backgroundColor: ACCENT + '1A',
  },
  moodEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  moodLabel: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '600',
  },
  noteInput: {
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#ffffff',
    fontSize: 14,
    padding: 14,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  submitBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  submitText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});

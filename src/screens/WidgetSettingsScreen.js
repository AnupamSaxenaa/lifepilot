import Slider from '@react-native-community/slider';
import { ArrowLeft, Check, Palette } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { loadLists } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { Storage } from '../utils/storage';
import { updateAllWidgets } from '../utils/widgetUpdater';

export const WidgetSettingsScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const ACCENT = useTheme().theme.accent;

  const [opacity, setOpacity] = useState(90);
  const [listId, setListId] = useState('today');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [bgStyle, setBgStyle] = useState('solid');
  const [customLists, setCustomLists] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [savedOpacity, savedList, savedHide, savedStyle] = await Promise.all([
        Storage.get('widget_bg_opacity'),
        Storage.get('widget_list_id'),
        Storage.get('widget_hide_completed'),
        Storage.get('widget_bg_style'),
      ]);
      if (savedOpacity != null) setOpacity(parseInt(savedOpacity, 10));
      if (savedList) setListId(savedList);
      setHideCompleted(savedHide === 'true');
      if (savedStyle) setBgStyle(savedStyle);

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const cached = await loadLists(session.user.id, (fresh) => setCustomLists(fresh || []));
        if (cached) setCustomLists(cached);
      }
    };
    load();
  }, []);

  const builtInLists = [
    { id: 'today', label: t('widgetSettings.listToday') },
    { id: 'inbox', label: t('widgetSettings.listInbox') },
    { id: 'starred', label: t('widgetSettings.listStarred') },
    { id: 'planned', label: t('widgetSettings.listPlanned') },
  ];

  const handleSave = async () => {
    setIsSaving(true);
    await Storage.set('widget_bg_opacity', opacity.toString());
    await Storage.set('widget_list_id', listId);
    await Storage.set('widget_hide_completed', hideCompleted ? 'true' : 'false');
    await Storage.set('widget_bg_style', bgStyle);
    await updateAllWidgets();
    setIsSaving(false);
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace('Settings');
  };

  const ListChip = ({ id, label }) => {
    const selected = listId === id;
    return (
      <TouchableOpacity
        style={[
          styles.chip,
          selected && { backgroundColor: ACCENT + '20', borderColor: ACCENT },
        ]}
        onPress={() => setListId(id)}
        activeOpacity={0.8}
      >
        <Text style={[styles.chipText, selected && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
        {selected && <Check color={ACCENT} size={15} />}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ArrowLeft color="#FAFAFA" size={22} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('widgetSettings.headerTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Live preview */}
        <View style={styles.previewWrap}>
          <View style={[
            styles.preview,
            {
              backgroundColor: `rgba(10,10,12,${(bgStyle === 'translucent' ? Math.min(opacity, 45) : bgStyle === 'frost' ? Math.min(opacity, 65) : bgStyle === 'grain' ? Math.min(opacity, 70) : opacity) / 100})`,
            },
            bgStyle === 'frost' && { borderColor: 'rgba(255,255,255,0.12)' },
          ]}>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewLabel}>
                {(builtInLists.find((l) => l.id === listId)?.label
                  || customLists.find((l) => l.id === listId)?.name
                  || 'List').toUpperCase()}
                <Text style={styles.previewFraction}>   1/3</Text>
              </Text>
              <View style={[styles.previewPlus, { backgroundColor: ACCENT + '24' }]}>
                <Text style={[styles.previewPlusText, { color: ACCENT }]}>+</Text>
              </View>
            </View>
            <View style={styles.previewTrack}>
              <View style={{ flex: 1, height: 3, backgroundColor: ACCENT, borderRadius: 2 }} />
              <View style={{ flex: 2, height: 3 }} />
            </View>
            {[0, 1].map((i) => (
              <View key={i} style={styles.previewRow}>
                <View style={[styles.previewNode, { borderColor: ACCENT + '8C' }]} />
                <Text style={styles.previewTask}>{t(i === 0 ? 'widgetSettings.previewTask1' : 'widgetSettings.previewTask2')}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* What to show */}
        <Text style={styles.sectionTitle}>{t('widgetSettings.listSection')}</Text>
        <Text style={styles.sectionDesc}>{t('widgetSettings.listDescription')}</Text>
        <View style={styles.chipWrap}>
          {builtInLists.map((l) => <ListChip key={l.id} id={l.id} label={l.label} />)}
          {customLists.map((l) => <ListChip key={l.id} id={l.id} label={l.name} />)}
        </View>

        {/* Opacity */}
        <Text style={styles.sectionTitle}>{t('widgetSettings.opacityLabel')}</Text>
        <Text style={styles.sectionDesc}>{t('widgetSettings.opacityDescription')}</Text>
        <View style={styles.card}>
          <Text style={[styles.valueText, { color: ACCENT }]}>{t('widgetSettings.valueText', { opacity })}</Text>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={opacity}
            onValueChange={setOpacity}
            minimumTrackTintColor={ACCENT}
            maximumTrackTintColor="#27272A"
            thumbTintColor="#FAFAFA"
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabelText}>{t('widgetSettings.transparentLabel')}</Text>
            <Text style={styles.sliderLabelText}>{t('widgetSettings.opaqueLabel')}</Text>
          </View>
        </View>

        {/* Background style */}
        <Text style={styles.sectionTitle}>{t('widgetSettings.bgStyleSection')}</Text>
        <Text style={styles.sectionDesc}>{t('widgetSettings.bgStyleDescription')}</Text>
        <View style={styles.chipWrap}>
          {[
            { id: 'solid', label: t('widgetSettings.styleSolid') },
            { id: 'translucent', label: t('widgetSettings.styleTranslucent') },
            { id: 'frost', label: t('widgetSettings.styleFrost') },
            { id: 'grain', label: t('widgetSettings.styleGrain') },
          ].map((s) => {
            const selected = bgStyle === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.chip, selected && { backgroundColor: ACCENT + '20', borderColor: ACCENT }]}
                onPress={() => setBgStyle(s.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, selected && { color: '#fff', fontWeight: '700' }]}>{s.label}</Text>
                {selected && <Check color={ACCENT} size={15} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Hide completed */}
        <View style={styles.rowCard}>
          <Text style={styles.rowLabel}>{t('widgetSettings.hideCompletedLabel')}</Text>
          <Switch
            value={hideCompleted}
            onValueChange={setHideCompleted}
            trackColor={{ false: '#27272a', true: ACCENT + '55' }}
            thumbColor={hideCompleted ? ACCENT : '#52525b'}
          />
        </View>

        {/* Theme follows app */}
        <Text style={styles.sectionTitle}>{t('widgetSettings.themeSection')}</Text>
        <View style={styles.themeNote}>
          <Palette color={ACCENT} size={18} />
          <Text style={styles.themeNoteText}>{t('widgetSettings.themeFollowsApp')}</Text>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: ACCENT }]}
          onPress={handleSave}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          <Text style={styles.saveButtonText}>
            {isSaving ? t('widgetSettings.applying') : t('widgetSettings.applyButton')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: '#FAFAFA', fontSize: 18, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingBottom: 20 },

  previewWrap: { alignItems: 'center', marginTop: 4, marginBottom: 28 },
  preview: {
    width: '82%',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1C1C1E',
  },
  previewHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewLabel: { color: '#FAFAFA', fontSize: 12, fontWeight: '700', letterSpacing: 3 },
  previewFraction: { color: '#71717A', fontSize: 12, fontWeight: '600', letterSpacing: 1 },
  previewPlus: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  previewPlusText: { fontSize: 18, marginTop: -2 },
  previewTrack: { flexDirection: 'row', height: 3, borderRadius: 2, backgroundColor: 'rgba(250,250,250,0.08)', marginTop: 14, marginBottom: 16 },
  previewRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  previewNode: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, marginRight: 13 },
  previewTask: { color: '#FAFAFA', fontSize: 14, fontWeight: '500' },

  sectionTitle: { color: '#FAFAFA', fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 4 },
  sectionDesc: { color: '#71717A', fontSize: 13, marginBottom: 14, lineHeight: 18 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: '#1A1A1A',
    backgroundColor: '#0A0A0A',
  },
  chipText: { color: '#A1A1AA', fontSize: 14, fontWeight: '600' },

  card: { backgroundColor: '#0A0A0A', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#1A1A1A' },
  valueText: { fontSize: 22, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 2 },
  sliderLabelText: { color: '#52525B', fontSize: 12 },

  rowCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0A0A0A', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: '#1A1A1A', marginTop: 14,
  },
  rowLabel: { color: '#FAFAFA', fontSize: 15, fontWeight: '600' },

  themeNote: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0A0A0A', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#1A1A1A',
  },
  themeNoteText: { color: '#A1A1AA', fontSize: 13, flex: 1, lineHeight: 19 },

  footer: { padding: 20, paddingBottom: 32 },
  saveButton: { paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
  saveButtonText: { color: '#000', fontSize: 15, fontWeight: '800' },
});

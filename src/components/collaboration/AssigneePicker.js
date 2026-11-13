import { Check, Search, UserRoundX, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { getMemberHandle, getMemberName } from './MemberRow';

export const AssigneePicker = ({ visible, onClose, members = [], value, onSelect, disabled = false }) => {
  const [query, setQuery] = useState('');
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const filtered = useMemo(() => { const needle = query.trim().toLowerCase(); return needle ? members.filter((member) => `${getMemberName(member)} ${getMemberHandle(member)}`.toLowerCase().includes(needle)) : members; }, [members, query]);
  const narrowAndroid = Platform.OS === 'android' && width < 420;
  const sheetHeight = Math.min(height - Math.max(insets.top, 8), narrowAndroid ? height * 0.94 : height * 0.82, 720);
  const pick = (next) => { if (!disabled) { onSelect?.(next); setQuery(''); onClose?.(); } };
  const close = () => { setQuery(''); onClose?.(); };
  return (
    <Modal visible={Boolean(visible)} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <View style={styles.overlay}><Pressable accessibilityLabel="Close assignee picker" style={StyleSheet.absoluteFill} onPress={close} /><View style={[styles.sheet, { width: Math.min(width, 640), height: sheetHeight, backgroundColor: theme.bg, borderColor: theme.hairline || '#2A2A2E' }]}>
        <View style={[styles.header, { borderBottomColor: theme.hairline || '#2A2A2E' }]}><View><Text maxFontSizeMultiplier={1.6} style={[styles.title, { color: theme.text }]}>Assign task</Text><Text maxFontSizeMultiplier={1.6} style={[styles.subtitle, { color: theme.muted }]}>Choose one collaborator.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close assignee picker" onPress={close} style={styles.iconButton}><X size={21} color={theme.muted} /></Pressable></View>
        <View style={[styles.search, { borderColor: theme.hairline || '#2A2A2E', backgroundColor: theme.surface }]}><Search size={18} color={theme.muted} /><TextInput value={query} onChangeText={setQuery} editable={!disabled} placeholder="Search members" placeholderTextColor={theme.muted} accessibilityLabel="Search members" style={[styles.input, { color: theme.text }]} /></View>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">{filtered.map((member) => { const id = member.user_id || member.id; const selected = id != null && String(id) === String(value); return <Pressable key={String(id)} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={`Assign to ${getMemberName(member)}`} disabled={disabled} onPress={() => pick(id)} style={({ pressed }) => [styles.row, { borderBottomColor: theme.hairline || '#2A2A2E', opacity: pressed || disabled ? 0.55 : 1 }]}><View style={styles.copy}><Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[styles.name, { color: theme.text }]}>{getMemberName(member)}</Text><Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[styles.handle, { color: theme.muted }]}>{getMemberHandle(member) || member.role || 'Member'}</Text></View>{selected ? <Check size={20} color={theme.text} /> : null}</Pressable>; })}{filtered.length === 0 ? <Text maxFontSizeMultiplier={1.6} style={[styles.empty, { color: theme.muted }]}>No matching members.</Text> : null}</ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12), borderTopColor: theme.hairline || '#2A2A2E', backgroundColor: theme.bg }]}><Pressable accessibilityRole="button" accessibilityLabel="Clear task assignee" disabled={disabled || value == null} onPress={() => pick(null)} style={({ pressed }) => [styles.clear, { borderColor: theme.hairline || '#2A2A2E', opacity: pressed || disabled || value == null ? 0.45 : 1 }]}><UserRoundX size={18} color={theme.text} /><Text maxFontSizeMultiplier={1.5} style={[styles.clearText, { color: theme.text }]}>Leave unassigned</Text></Pressable></View>
      </View></View>
    </Modal>
  );
};

const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.58)' }, sheet: { maxWidth: 640, borderWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }, header: { minHeight: 76, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontSize: 18, fontWeight: '400' }, subtitle: { marginTop: 3, fontSize: 12, fontWeight: '300' }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, search: { minHeight: 48, margin: 16, paddingHorizontal: 14, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, minHeight: 44, fontSize: 15, fontWeight: '300' }, list: { flex: 1 }, listContent: { paddingHorizontal: 20 }, row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, copy: { flex: 1, minWidth: 0 }, name: { fontSize: 15, fontWeight: '400' }, handle: { marginTop: 3, fontSize: 12, textTransform: 'capitalize', fontWeight: '300' }, empty: { paddingVertical: 36, textAlign: 'center', fontSize: 14 }, footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth }, clear: { minHeight: 48, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, clearText: { fontSize: 14, fontWeight: '400' } });

export default AssigneePicker;

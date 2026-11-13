import { Check, X } from 'lucide-react-native';
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';

const ROLES = [{ value: 'editor', title: 'Editor', detail: 'Can add and update shared work.' }, { value: 'viewer', title: 'Viewer', detail: 'Can view shared work without changing it.' }];

export const RolePicker = ({ visible, onClose, value = 'viewer', onSelect, disabled = false, title = 'Choose a role' }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const narrowAndroid = Platform.OS === 'android' && width < 420;
  const sheetHeight = Math.min(height - Math.max(insets.top, 8), narrowAndroid ? height * 0.94 : 420);
  const choose = (role) => { if (!disabled) { onSelect?.(role); onClose?.(); } };
  return (
    <Modal visible={Boolean(visible)} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close role picker" onPress={onClose} />
        <View style={[styles.sheet, { width: Math.min(width, 640), height: sheetHeight, paddingBottom: Math.max(insets.bottom, 12), backgroundColor: theme.bg, borderColor: theme.hairline || '#2A2A2E' }]}>
          <View style={[styles.header, { borderBottomColor: theme.hairline || '#2A2A2E' }]}><View><Text maxFontSizeMultiplier={1.6} style={[styles.title, { color: theme.text }]}>{title}</Text><Text maxFontSizeMultiplier={1.6} style={[styles.subtitle, { color: theme.muted }]}>Permissions can be changed later.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close role picker" onPress={onClose} style={styles.close}><X size={21} color={theme.muted} /></Pressable></View>
          <View style={styles.options}>{ROLES.map((role) => { const selected = role.value === value; return <Pressable key={role.value} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={`${role.title}. ${role.detail}`} disabled={disabled} onPress={() => choose(role.value)} style={({ pressed }) => [styles.option, { borderBottomColor: theme.hairline || '#2A2A2E', opacity: pressed || disabled ? 0.55 : 1 }]}><View style={styles.optionCopy}><Text maxFontSizeMultiplier={1.6} style={[styles.optionTitle, { color: theme.text }]}>{role.title}</Text><Text maxFontSizeMultiplier={1.6} style={[styles.detail, { color: theme.muted }]}>{role.detail}</Text></View>{selected ? <Check size={20} color={theme.text} /> : null}</Pressable>; })}</View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.58)' }, sheet: { maxWidth: 640, borderWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }, header: { minHeight: 76, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontSize: 18, fontWeight: '400' }, subtitle: { marginTop: 3, fontSize: 12, fontWeight: '300' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, options: { paddingHorizontal: 20 }, option: { minHeight: 76, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, optionCopy: { flex: 1, paddingRight: 12 }, optionTitle: { fontSize: 15, fontWeight: '400' }, detail: { marginTop: 4, fontSize: 12, lineHeight: 17, fontWeight: '300' } });

export default RolePicker;

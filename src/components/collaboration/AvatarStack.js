import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

const identity = (member = {}) => member.profile || member.profiles || member;
const labelFor = (member) => {
  const value = identity(member);
  return value.display_name || value.displayName || value.username || value.email || 'Member';
};
const initialsFor = (member) => labelFor(member).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';

export const AvatarStack = ({ members = [], size = 26, max = 3 }) => {
  const { theme } = useTheme();
  const visible = members.slice(0, Math.max(0, max));
  const overflow = Math.max(0, members.length - visible.length);
  const overlap = Math.max(6, Math.round(size * 0.28));
  return (
    <View style={styles.row} accessibilityLabel={`${members.length} collaborator${members.length === 1 ? '' : 's'}`}>
      {visible.map((member, index) => {
        const person = identity(member);
        const uri = person.avatar_url || person.avatarUrl;
        return (
          <View key={String(member.user_id || member.id || index)} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, marginLeft: index ? -overlap : 0, borderColor: theme.bg, backgroundColor: theme.surface }]} accessibilityLabel={labelFor(member)}>
            {uri ? <Image source={{ uri }} style={styles.image} accessibilityIgnoresInvertColors /> : <Text maxFontSizeMultiplier={1.4} style={[styles.initials, { color: theme.text, fontSize: Math.max(10, size * 0.34) }]}>{initialsFor(member)}</Text>}
          </View>
        );
      })}
      {overflow > 0 ? <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, marginLeft: -overlap, borderColor: theme.bg, backgroundColor: theme.surface }]}><Text maxFontSizeMultiplier={1.4} style={[styles.initials, { color: theme.muted, fontSize: Math.max(10, size * 0.31) }]}>+{overflow}</Text></View> : null}
    </View>
  );
};

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' }, avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' }, image: { width: '100%', height: '100%' }, initials: { fontWeight: '400' } });

export default AvatarStack;

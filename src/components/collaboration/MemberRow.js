import { ChevronDown, Crown, MoreHorizontal } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

const personFor = (member = {}) => member.profile || member.profiles || member;
export const getMemberName = (member = {}) => { const person = personFor(member); return person.display_name || person.displayName || person.username || person.email || 'Member'; };
export const getMemberHandle = (member = {}) => { const person = personFor(member); return person.username ? `@${person.username}` : person.email || ''; };
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';

const ROLE_DETAILS = {
  owner: 'Manages people, invitations, roles, ownership, and space settings.',
  editor: 'Can add and update shared lists, tasks, and comments.',
  viewer: 'Can view shared work without changing it.',
};

export const MemberRow = ({ member, isCurrentUser = false, canManage = false, disabled = false, onRolePress, onActionsPress }) => {
  const { theme } = useTheme();
  const person = personFor(member);
  const name = getMemberName(member);
  const handle = getMemberHandle(member);
  const role = String(member?.role || 'viewer').toLowerCase();
  const roleDetail = ROLE_DETAILS[role] || ROLE_DETAILS.viewer;
  const avatar = person.avatar_url || person.avatarUrl;
  return (
    <View style={[styles.row, { borderBottomColor: theme.hairline || '#2A2A2E' }]} accessibilityLabel={`${name}, ${role}${isCurrentUser ? ', you' : ''}. ${roleDetail}`}>
      <View style={[styles.avatar, { backgroundColor: theme.surface, borderColor: theme.hairline || '#2A2A2E' }]}>{avatar ? <Image source={{ uri: avatar }} style={styles.image} /> : <Text maxFontSizeMultiplier={1.4} style={[styles.initials, { color: theme.text }]}>{initials(name)}</Text>}</View>
      <View style={styles.copy}><Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[styles.name, { color: theme.text }]}>{name}{isCurrentUser ? ' (you)' : ''}</Text>{handle ? <Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[styles.handle, { color: theme.muted }]}>{handle}</Text> : null}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Role: ${role}. ${roleDetail}`} disabled={!canManage || disabled || role === 'owner'} onPress={() => onRolePress?.(member)} style={({ pressed }) => [styles.role, { borderColor: theme.hairline || '#2A2A2E', opacity: pressed || disabled ? 0.55 : 1 }]}>
        {role === 'owner' ? <Crown size={14} color={theme.muted} /> : null}<Text maxFontSizeMultiplier={1.4} style={[styles.roleText, { color: theme.muted }]}>{role}</Text>{canManage && role !== 'owner' ? <ChevronDown size={14} color={theme.muted} /> : null}
      </Pressable>
      {canManage && role !== 'owner' ? <Pressable accessibilityRole="button" accessibilityLabel={`More actions for ${name}`} disabled={disabled} onPress={() => onActionsPress?.(member)} style={({ pressed }) => [styles.action, { opacity: pressed || disabled ? 0.5 : 1 }]}><MoreHorizontal size={20} color={theme.muted} /></Pressable> : null}
    </View>
  );
};

const styles = StyleSheet.create({ row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, avatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, image: { width: '100%', height: '100%' }, initials: { fontSize: 12, fontWeight: '400' }, copy: { flex: 1, minWidth: 0 }, name: { fontSize: 15, fontWeight: '400' }, handle: { marginTop: 2, fontSize: 12, fontWeight: '300' }, role: { minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderRadius: 12, flexDirection: 'row', gap: 5, alignItems: 'center' }, roleText: { fontSize: 12, fontWeight: '400', textTransform: 'capitalize' }, action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' } });

export default MemberRow;

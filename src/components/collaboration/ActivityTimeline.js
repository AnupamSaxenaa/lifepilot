import { CheckCircle2, Circle, MessageSquare, RefreshCw, UserPlus, Users } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { getMemberName } from './MemberRow';

const memberId = (member) => member?.user_id || member?.id;
const actorFor = (item, members) => members.find((member) => String(memberId(member)) === String(item.actor_id || item.user_id || item.created_by));
const iconFor = (type, color) => { const props = { size: 16, color }; if (/comment/i.test(type)) return <MessageSquare {...props} />; if (/member|invite|join/i.test(type)) return <UserPlus {...props} />; if (/complete/i.test(type)) return <CheckCircle2 {...props} />; if (/sync|update|change/i.test(type)) return <RefreshCw {...props} />; if (/space|share/i.test(type)) return <Users {...props} />; return <Circle {...props} />; };
const titleFor = (item) => {
  if (item.title || item.message) return item.title || item.message;
  const type = String(item.event_type || item.type || 'activity');
  const labels = { 'space.created': 'created the space', 'member.joined': 'joined the space', 'member.role_changed': 'changed a member role', 'comment.added': 'added a comment', 'task.completed': 'completed a task', 'task.updated': 'updated a task', 'list.updated': 'updated a list' };
  return labels[type] || type.replace(/[._-]+/g, ' ');
};
const timeFor = (value) => { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const seconds = Math.floor((Date.now() - date.getTime()) / 1000); if (seconds < 60) return 'Just now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`; return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

export const ActivityTimeline = ({ items = [], members = [] }) => {
  const { theme } = useTheme();
  if (!items.length) return <View style={styles.empty}><Text maxFontSizeMultiplier={1.6} style={[styles.emptyText, { color: theme.muted }]}>No activity yet.</Text></View>;
  return <View accessibilityRole="list">{items.map((item, index) => { const actor = actorFor(item, members); const actorName = actor ? getMemberName(actor) : item.actor_name || 'A collaborator'; const type = String(item.event_type || item.type || 'activity'); const detail = item.detail || item.payload?.title || item.payload?.name || ''; return <View key={String(item.id || `${type}-${index}`)} accessibilityRole="text" style={styles.item}><View style={styles.rail}><View style={[styles.icon, { borderColor: theme.hairline || '#2A2A2E', backgroundColor: theme.surface }]}>{iconFor(type, theme.muted)}</View>{index < items.length - 1 ? <View style={[styles.line, { backgroundColor: theme.hairline || '#2A2A2E' }]} /> : null}</View><View style={styles.copy}><Text maxFontSizeMultiplier={1.6} style={[styles.text, { color: theme.text }]}><Text style={styles.actor}>{actorName}</Text> {titleFor(item)}</Text>{detail ? <Text numberOfLines={2} maxFontSizeMultiplier={1.6} style={[styles.detail, { color: theme.muted }]}>{detail}</Text> : null}<Text maxFontSizeMultiplier={1.5} style={[styles.time, { color: theme.muted }]}>{timeFor(item.created_at || item.occurred_at || item.updated_at)}</Text></View></View>; })}</View>;
};

const styles = StyleSheet.create({ empty: { minHeight: 88, alignItems: 'center', justifyContent: 'center' }, emptyText: { fontSize: 14, fontWeight: '300' }, item: { minHeight: 72, flexDirection: 'row' }, rail: { width: 38, alignItems: 'center' }, icon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, line: { width: StyleSheet.hairlineWidth, flex: 1 }, copy: { flex: 1, paddingLeft: 9, paddingBottom: 18 }, text: { fontSize: 14, lineHeight: 20, fontWeight: '300' }, actor: { fontWeight: '500' }, detail: { marginTop: 3, fontSize: 12, lineHeight: 17, fontWeight: '300' }, time: { marginTop: 5, fontSize: 11, fontWeight: '300' } });

export default ActivityTimeline;

import * as ScreenOrientation from 'expo-screen-orientation';
import {
    Check,
    CheckCircle2,
    Coffee,
    Eye,
    EyeOff,
    ListPlus,
    Pause,
    PhoneCall,
    Play,
    Plus,
    SkipForward,
    StickyNote,
    X
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
    Image,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View
} from 'react-native';
import { formatRoomClock } from '../lib/dataManager';

const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const dayKey = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
const todayKey = () => dayKey(new Date());

export const FocusRoomTaskPicker = ({
  visible,
  tasks,
  lists,
  palette,
  onClose,
  onAdd,
  onQuickAdd,
}) => {
  const [tab, setTab] = useState('today');
  const [selected, setSelected] = useState([]);
  const [quickTitle, setQuickTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const resetPicker = () => {
    setTab('today');
    setSelected([]);
    setQuickTitle('');
    setBusy(false);
  };

  const tabs = useMemo(() => [
    { id: 'today', label: 'TODAY' },
    { id: 'starred', label: 'STARRED' },
    ...lists.map((list) => ({ id: `list:${list.id}`, label: String(list.name || 'LIST').toUpperCase() })),
    { id: 'all', label: 'ALL' },
  ], [lists]);
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (task.is_completed) return false;
    if (tab === 'today') return Boolean(task.added_to_today) || dayKey(task.due_date) === todayKey();
    if (tab === 'starred') return Boolean(task.is_important);
    if (tab === 'all') return true;
    if (tab.startsWith('list:')) return sameId(task.list_id, tab.slice(5));
    return false;
  }), [tab, tasks]);

  const toggle = (id) => setSelected((current) => (
    current.some((value) => sameId(value, id))
      ? current.filter((value) => !sameId(value, id))
      : [...current, id]
  ));
  const addSelected = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      await onAdd(tasks.filter((task) => selected.some((id) => sameId(id, task.id))));
      setSelected([]);
    } finally {
      setBusy(false);
    }
  };
  const quickAdd = async () => {
    const title = quickTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onQuickAdd(title);
      setQuickTitle('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onShow={resetPicker} onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.bg }]}>
        <View style={styles.sheetHeader}>
          <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>My Lists</Text>
            <Text style={[styles.sheetSubtitle, { color: palette.muted }]}>Choose private tasks for this room.</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.iconButton} accessibilityLabel="Close task picker">
            <X color={palette.text} size={20} />
          </TouchableOpacity>
        </View>
        <View style={[styles.quickRow, { borderColor: palette.border }]}>
          <TextInput
            value={quickTitle}
            onChangeText={setQuickTitle}
            onSubmitEditing={quickAdd}
            editable={!busy}
            placeholder="Quick-add a task"
            placeholderTextColor={palette.muted}
            style={[styles.quickInput, { color: palette.text }]}
          />
          <TouchableOpacity onPress={quickAdd} disabled={!quickTitle.trim() || busy} style={styles.iconButton} accessibilityLabel="Quick add task">
            <Plus color={quickTitle.trim() && !busy ? palette.text : palette.muted} size={19} />
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          style={styles.tabsViewport}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {tabs.map((item) => (
            <TouchableOpacity key={item.id} onPress={() => setTab(item.id)} style={[styles.tab, { borderColor: tab === item.id ? palette.text : palette.border }]}>
              <Text style={[styles.tabText, { color: tab === item.id ? palette.text : palette.muted }]} numberOfLines={1}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView style={styles.taskViewport} contentContainerStyle={styles.taskList}>
          {visibleTasks.length === 0 ? (
            <View style={styles.empty}>
              <ListPlus color={palette.muted} size={26} />
              <Text style={[styles.emptyText, { color: palette.muted }]}>No open tasks in this list.</Text>
            </View>
          ) : visibleTasks.map((task) => {
            const checked = selected.some((id) => sameId(id, task.id));
            return (
              <TouchableOpacity key={String(task.id)} onPress={() => toggle(task.id)} style={[styles.taskRow, { borderBottomColor: palette.border }]} accessibilityRole="checkbox" accessibilityState={{ checked }}>
                <View style={[styles.checkbox, { borderColor: checked ? palette.text : palette.border, backgroundColor: checked ? palette.text : 'transparent' }]}>
                  {checked ? <Check color={palette.bg} size={13} /> : null}
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.taskTitle, { color: palette.text }]} numberOfLines={2}>{task.title}</Text>
                  {task.note || task.notes ? <Text style={[styles.taskNote, { color: palette.muted }]} numberOfLines={1}>{task.note || task.notes}</Text> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity onPress={addSelected} disabled={!selected.length || busy} style={[styles.primary, { backgroundColor: palette.text, opacity: selected.length && !busy ? 1 : 0.32 }]}>
          <Text style={[styles.primaryText, { color: palette.bg }]}>ADD {selected.length || ''} TO UP NEXT</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

export const FocusRoomFocusView = ({
  visible,
  item,
  elapsed,
  isPaused,
  isOnBreak,
  palette,
  onClose,
  onPause,
  onResume,
  onComplete,
  onSkip,
  onBreak,
  onToggleShare,
  onSaveNote,
}) => {
  const { width, height } = useWindowDimensions();
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item?.note || '');
  const landscape = width > height;

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return undefined;
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT).catch(() => {});
    };
  }, [visible]);

  if (!item) return null;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.focusRoot, landscape && styles.focusLandscape, { backgroundColor: palette.bg }]}>
        <TouchableOpacity onPress={onClose} style={styles.focusClose} accessibilityLabel="Close focus view">
          <X color={palette.muted} size={21} />
        </TouchableOpacity>
        <View style={[styles.focusCore, landscape && styles.focusCoreLandscape]}>
          <Text style={[styles.focusEyebrow, { color: palette.muted }]}>{isOnBreak ? 'ON BREAK' : isPaused ? 'PAUSED' : 'FOCUSING'}</Text>
          <Text style={[styles.focusTask, { color: palette.text }]} numberOfLines={3}>{item.title}</Text>
          <Text style={[styles.focusTimer, { color: palette.text }]}>{formatRoomClock(elapsed)}</Text>
          {item.note ? <Text style={[styles.focusNote, { color: palette.muted }]} numberOfLines={3}>{item.note}</Text> : null}
        </View>
        <View style={[styles.focusControls, landscape && styles.focusControlsLandscape]}>
          <TouchableOpacity onPress={isPaused ? onResume : onPause} disabled={isOnBreak} style={[styles.focusControl, { borderColor: palette.border, opacity: isOnBreak ? 0.4 : 1 }]}>
            {isPaused ? <Play color={palette.text} size={19} /> : <Pause color={palette.text} size={19} />}
            <Text style={[styles.focusControlText, { color: palette.text }]}>{isPaused ? 'RESUME' : 'PAUSE'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onComplete} style={[styles.focusControl, styles.focusPrimary, { backgroundColor: palette.text }]}>
            <CheckCircle2 color={palette.bg} size={19} />
            <Text style={[styles.focusControlText, { color: palette.bg }]}>COMPLETE</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSkip} style={[styles.focusControl, { borderColor: palette.border }]}>
            <SkipForward color={palette.text} size={19} />
            <Text style={[styles.focusControlText, { color: palette.text }]}>SKIP</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onBreak} style={[styles.focusControl, { borderColor: palette.border }]}>
            <Coffee color={palette.text} size={19} />
            <Text style={[styles.focusControlText, { color: palette.text }]}>{isOnBreak ? 'END BREAK' : 'BREAK'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setEditingNote((current) => !current)} style={[styles.focusControl, { borderColor: palette.border }]}>
            <StickyNote color={palette.text} size={19} />
            <Text style={[styles.focusControlText, { color: palette.text }]}>NOTE</Text>
          </TouchableOpacity>
        </View>
        {editingNote ? (
          <View style={[styles.noteEditor, { borderColor: palette.border }]}>
            <TextInput
              value={noteDraft}
              onChangeText={(value) => setNoteDraft(value.slice(0, 4000))}
              placeholder="Add a private task note"
              placeholderTextColor={palette.muted}
              multiline
              autoFocus
              style={[styles.noteInput, { color: palette.text }]}
            />
            <TouchableOpacity onPress={() => { onSaveNote(noteDraft); setEditingNote(false); }} style={[styles.noteSave, { backgroundColor: palette.text }]}>
              <Text style={[styles.noteSaveText, { color: palette.bg }]}>SAVE NOTE</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <TouchableOpacity onPress={onToggleShare} style={styles.shareToggle}>
          {item.shareTitle ? <Eye color={palette.muted} size={15} /> : <EyeOff color={palette.muted} size={15} />}
          <Text style={[styles.shareText, { color: palette.muted }]}>{item.shareTitle ? 'TITLE VISIBLE TO ROOM' : 'TITLE PRIVATE'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

export const FocusRoomMemberPanel = ({ visible, member, isSelf, palette, onClose, onCallback, onPrivacy }) => {
  const [showTitles, setShowTitles] = useState(Boolean(member?.showTaskTitles));
  const [callbackPolicy, setCallbackPolicy] = useState(member?.callbackPolicy || 'room');

  if (!member) return null;
  const offline = member.presenceStatus === 'away' || member.presenceStatus === 'offline';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.profileCard, { backgroundColor: palette.bg, borderColor: palette.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.profileClose} accessibilityLabel="Close member details"><X color={palette.muted} size={19} /></TouchableOpacity>
          {member.avatarUrl ? <Image source={{ uri: member.avatarUrl }} style={styles.profileAvatar} /> : <View style={[styles.profileAvatar, styles.avatarFallback, { borderColor: palette.border }]}><Text style={[styles.avatarLetter, { color: palette.text }]}>{member.displayName?.charAt(0)?.toUpperCase() || '?'}</Text></View>}
          <Text style={[styles.profileName, { color: palette.text }]}>{member.displayName}</Text>
          <Text style={[styles.profileStatus, { color: palette.muted }]}>{String(member.presenceStatus || 'online').replace('_', ' ').toUpperCase()}</Text>
          {offline ? (
            <Text style={[styles.profileLastSeen, { color: palette.muted }]}>
              {member.lastSeenAt ? `Last active ${new Date(member.lastSeenAt).toLocaleString()}` : 'Last active unavailable'}
            </Text>
          ) : null}
          {member.currentTaskTitle ? <Text style={[styles.profileTask, { color: palette.text }]}>{member.currentTaskTitle}</Text> : <Text style={[styles.profileTask, { color: palette.muted }]}>Task titles are private</Text>}
          <View style={styles.statGrid}>
            <Stat label="TASKS" value={member.tasksCompletedSession || 0} palette={palette} />
            <Stat label="FOCUS" value={formatRoomClock(member.focusSecondsTotal || 0)} palette={palette} />
            <Stat label="BREAK" value={formatRoomClock(member.breakSecondsTotal || 0)} palette={palette} />
          </View>
          {isSelf ? (
            <View style={[styles.privacy, { borderTopColor: palette.border }]}>
              <View style={styles.privacyRow}>
                <Text style={[styles.privacyLabel, { color: palette.text }]}>Show active task title</Text>
                <Switch value={showTitles} onValueChange={(value) => { setShowTitles(value); onPrivacy(value, callbackPolicy); }} />
              </View>
              <Text style={[styles.privacyCaption, { color: palette.muted }]}>CALL-BACK PERMISSION</Text>
              <View style={styles.policyRow}>{['everyone', 'room', 'nobody'].map((policy) => (
                <TouchableOpacity key={policy} onPress={() => { setCallbackPolicy(policy); onPrivacy(showTitles, policy); }} style={[styles.policy, { borderColor: callbackPolicy === policy ? palette.text : palette.border }]}>
                  <Text style={[styles.policyText, { color: callbackPolicy === policy ? palette.text : palette.muted }]}>{policy.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}</View>
            </View>
          ) : offline && member.callbackPolicy !== 'nobody' ? (
            <TouchableOpacity onPress={onCallback} style={[styles.primary, styles.callbackButton, { backgroundColor: palette.text }]}><PhoneCall color={palette.bg} size={16} /><Text style={[styles.primaryText, { color: palette.bg }]}>CALL THEM BACK</Text></TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

const Stat = ({ label, value, palette }) => <View style={styles.stat}><Text style={[styles.statValue, { color: palette.text }]}>{value}</Text><Text style={[styles.statLabel, { color: palette.muted }]}>{label}</Text></View>;

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 22, fontWeight: '400', letterSpacing: -0.4 },
  sheetSubtitle: { marginTop: 3, fontSize: 11 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  quickRow: { minHeight: 48, marginTop: 18, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingLeft: 13, flexDirection: 'row', alignItems: 'center' },
  quickInput: { flex: 1, fontSize: 14 },
  tabsViewport: { flexGrow: 0, flexShrink: 0, height: 60 },
  tabs: { alignItems: 'center', gap: 7, paddingVertical: 12 },
  tab: { height: 34, maxWidth: 132, borderWidth: StyleSheet.hairlineWidth, borderRadius: 17, justifyContent: 'center', paddingHorizontal: 12 },
  tabText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8 },
  taskViewport: { flex: 1 },
  taskList: { flexGrow: 1, paddingBottom: 20 },
  taskRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  checkbox: { width: 21, height: 21, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  taskTitle: { fontSize: 13.5 },
  taskNote: { marginTop: 3, fontSize: 10.5 },
  empty: { paddingVertical: 60, alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 11.5 },
  primary: { minHeight: 46, borderRadius: 23, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },
  focusRoot: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  focusLandscape: { flexDirection: 'row', paddingHorizontal: 54 },
  focusClose: { position: 'absolute', top: 18, right: 18, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  focusCore: { width: '100%', maxWidth: 660, alignItems: 'center' },
  focusCoreLandscape: { flex: 1, paddingRight: 30 },
  focusEyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
  focusTask: { marginTop: 18, maxWidth: 650, textAlign: 'center', fontSize: 30, lineHeight: 38, fontWeight: '300' },
  focusTimer: { marginTop: 24, fontSize: 62, fontWeight: '200', fontVariant: ['tabular-nums'], letterSpacing: -2 },
  focusNote: { marginTop: 15, maxWidth: 520, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  focusControls: { marginTop: 42, width: '100%', maxWidth: 620, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 9 },
  focusControlsLandscape: { width: 230, flexDirection: 'column', marginTop: 0 },
  focusControl: { minWidth: 132, minHeight: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  focusPrimary: { borderWidth: 0 },
  focusControlText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8 },
  noteEditor: { width: '100%', maxWidth: 520, marginTop: 18, padding: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  noteInput: { flex: 1, minHeight: 42, maxHeight: 110, fontSize: 12, lineHeight: 17, padding: 4 },
  noteSave: { minHeight: 34, paddingHorizontal: 12, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  noteSaveText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.7 },
  shareToggle: { marginTop: 25, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12 },
  shareText: { fontSize: 8.5, fontWeight: '600', letterSpacing: 0.7 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  profileCard: { width: '100%', maxWidth: 390, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 24, alignItems: 'center' },
  profileClose: { position: 'absolute', top: 9, right: 9, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  profileAvatar: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: { borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 22, fontWeight: '300' },
  profileName: { marginTop: 12, fontSize: 20, fontWeight: '400' },
  profileStatus: { marginTop: 4, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.1 },
  profileLastSeen: { marginTop: 5, fontSize: 9.5 },
  profileTask: { marginTop: 14, fontSize: 12, textAlign: 'center' },
  statGrid: { width: '100%', flexDirection: 'row', marginTop: 22 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '300' },
  statLabel: { marginTop: 4, fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  privacy: { width: '100%', marginTop: 22, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  privacyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  privacyLabel: { fontSize: 12 },
  privacyCaption: { marginTop: 18, fontSize: 8, fontWeight: '700', letterSpacing: 0.9 },
  policyRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  policy: { flex: 1, minHeight: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  policyText: { fontSize: 7.5, fontWeight: '700', letterSpacing: 0.6 },
  callbackButton: { width: '100%', marginTop: 22 },
});
import { useFocusEffect } from '@react-navigation/native';
import {
    ArrowLeft,
    CheckCircle2,
    Coffee,
    GripVertical,
    ListPlus,
    LogOut,
    MessageCircle,
    PhoneCall,
    Send,
    Square,
    Users,
    X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    NestableDraggableFlatList,
    NestableScrollContainer,
    ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    FocusRoomFocusView,
    FocusRoomMemberPanel,
    FocusRoomTaskPicker,
} from '../components/FocusRoomOverlays';
import { useTheme } from '../context/ThemeContext';
import {
    addTask,
    addTasksToHustleRoomQueue,
    completeFocusRoomTask,
    endHustleRoom,
    formatRoomClock,
    getCurrentUserId,
    getFocusRoomTaskElapsed,
    getHustleRoomElapsed,
    isHustleRoomsOnline,
    leaveHustleRoom,
    loadHustleRoom,
    loadLists,
    loadTasks,
    markHustleRoomCallbacksRead,
    refreshHustleRoom,
    reorderHustleRoomQueue,
    sendHustleRoomCallback,
    sendHustleRoomMessage,
    setHustleRoomBreak,
    subscribeToHustleRoomChanges,
    updateHustleRoomPrivacy,
    updateHustleRoomQueueItem,
    updateHustleRoomQueueItemDetails,
    updateMyHustleRoomProgress,
} from '../lib/dataManager';
import {
    cancelHustleRoomNotification,
    showHustleRoomNotification,
} from '../utils/hustleRoomNotifications';
import { getPresence, PRESENCE } from '../utils/presence';

const statusText = (status, elapsed, duration) => {
  if (status === 'done' || elapsed >= duration) return 'DONE';
  if (status === 'running') return 'FOCUSING';
  if (status === 'paused') return 'PAUSED';
  return 'NOT STARTED';
};

const deriveRoomPresence = (member, currentUserId, now) => {
  const timestampPresence = getPresence(member?.lastSeenAt, now || Date.now()).id;
  // The signed-in user is visibly foregrounded on this screen; everyone else
  // must prove availability with a non-stale presence-session timestamp.
  const availability = member?.userId === String(currentUserId) ? 'online' : timestampPresence;

  if (availability === 'online' && ['focusing', 'on_break'].includes(member?.presenceStatus)) {
    return member.presenceStatus;
  }
  // Focus Rooms intentionally collapse the global idle state into away.
  return availability === 'idle' ? 'away' : availability;
};

const MemberRow = ({ member, duration, palette, now, onPress }) => {
  const elapsed = getHustleRoomElapsed(member, duration, now);
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const state = member.presenceStatus
    ? String(member.presenceStatus).replace('_', ' ').toUpperCase()
    : statusText(member.timerStatus, elapsed, duration);
  const statusColor = member.presenceStatus === 'focusing'
    ? '#60A5FA'
    : member.presenceStatus === 'on_break'
      ? '#FBBF24'
      : (PRESENCE[member.presenceStatus]?.color || PRESENCE.offline.color);
  return (
    <TouchableOpacity onPress={onPress} style={[styles.memberRow, { borderBottomColor: palette.border }]} accessibilityRole="button" accessibilityLabel={`Open ${member.displayName} profile`}>
      <View>
        {member.avatarUrl ? (
          <Image source={{ uri: member.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { borderColor: palette.border }]}>
            <Text style={[styles.avatarLetter, { color: palette.muted }]}>{member.displayName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.memberStatusDot, { backgroundColor: statusColor, borderColor: palette.bg }]} />
      </View>
      <View style={styles.memberCopy}>
        <View style={styles.memberNameLine}>
          <Text style={[styles.memberName, { color: palette.text }]} numberOfLines={1}>{member.displayName}</Text>
          {member.role === 'owner' ? <Text style={[styles.ownerTag, { color: palette.muted }]}>OWNER</Text> : null}
        </View>
        <Text style={[styles.memberTask, { color: palette.muted }]} numberOfLines={1}>
          {member.currentTaskTitle || (member.showTaskTitles ? member.taskLabel : null) || 'Task title private'}
        </Text>
        <View style={styles.memberMetaLine}>
          <Text style={[styles.memberCount, { color: palette.muted }]}>{member.tasksCompletedSession || 0} DONE</Text>
          <View style={[styles.memberTrack, { backgroundColor: palette.border }]}>
            <View style={[styles.memberFill, { width: `${progress * 100}%`, backgroundColor: palette.text }]} />
          </View>
        </View>
      </View>
      <View style={styles.memberStats}>
        <Text style={[styles.memberTime, { color: palette.text }]}>{formatRoomClock(elapsed)}</Text>
        <Text style={[styles.memberState, { color: palette.muted }]}>{state}</Text>
      </View>
    </TouchableOpacity>
  );
};


export const HustleRoomScreen = ({ route, navigation }) => {
  const roomId = route.params?.roomId;
  const { theme } = useTheme();
  const [userId, setUserId] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [resolved, setResolved] = useState(false);
  const [taskLabel, setTaskLabel] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showCompletion, setShowCompletion] = useState(false);
  const [notificationAvailable, setNotificationAvailable] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [lists, setLists] = useState([]);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [showFocusView, setShowFocusView] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [focusedItemId, setFocusedItemId] = useState(null);
  const [chatReadCount, setChatReadCount] = useState(0);
  const completionHandledRef = useRef(false);
  const palette = useMemo(() => ({
    bg: theme?.bg || '#000000',
    text: theme?.text || '#F5F5F7',
    muted: theme?.muted || '#8E8E93',
    border: theme?.hairline || 'rgba(244,244,245,0.16)',
    accent: theme?.accent || '#FFFFFF',
    onAccent: theme?.onAccent || theme?.bg || '#000000',
  }), [theme]);

  useEffect(() => {
    let active = true;
    getCurrentUserId().then(async (uid) => {
      if (!active || !uid || !roomId) { if (active) setResolved(true); return; }
      setUserId(uid);
      Promise.all([
        loadTasks(uid, (fresh) => active && setTasks(fresh)),
        loadLists(uid, (fresh) => active && setLists(fresh)),
      ]).then(([cachedTasks, cachedLists]) => {
        if (!active) return;
        setTasks(Array.isArray(cachedTasks) ? cachedTasks : []);
        setLists(Array.isArray(cachedLists) ? cachedLists : []);
      }).catch(() => {});
      const cached = await loadHustleRoom(uid, roomId, (fresh) => {
        if (!active) return;
        setSnapshot(fresh);
        const own = fresh?.members?.find((member) => member.userId === String(uid));
        if (own?.taskLabel && own.timerStatus !== 'not_started') setTaskLabel(own.taskLabel);
      });
      if (!active) return;
      setSnapshot(cached);
      setChatReadCount(cached?.messages?.length || 0);
      const own = cached?.members?.find((member) => member.userId === String(uid));
      if (own?.taskLabel) setTaskLabel(own.taskLabel);
      setResolved(true);
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); };
  }, [roomId]);

  const refresh = useCallback(() => {
    if (!userId || !roomId) return;
    refreshHustleRoom(userId, roomId).then((result) => {
      if (result.ok) {
        setSnapshot(result.data);
        const own = result.data?.members?.find((member) => member.userId === String(userId));
        if (own?.taskLabel && own.timerStatus !== 'not_started') setTaskLabel(own.taskLabel);
      } else if (result.error?.code === '42501' || result.error?.code === 'P0002') {
        Alert.alert('Room unavailable', 'This room ended or your access was removed.', [
          { text: 'OK', onPress: () => navigation.replace('HustleRooms') },
        ]);
      }
    }).catch(() => {});
  }, [navigation, roomId, userId]);

  const handleRoomChange = useCallback((localSnapshot, snapshotUserId) => {
    if (
      localSnapshot?.room?.id === String(roomId)
      && String(snapshotUserId) === String(userId)
    ) {
      setSnapshot(localSnapshot);
      const own = localSnapshot.members?.find((member) => member.userId === String(userId));
      if (own?.taskLabel && own.timerStatus !== 'not_started') setTaskLabel(own.taskLabel);
      return;
    }
    refresh();
  }, [refresh, roomId, userId]);

  useFocusEffect(useCallback(() => {
    if (!userId || !roomId) return undefined;
    refresh();
    const unsubscribe = subscribeToHustleRoomChanges(roomId, handleRoomChange);
    const poll = setInterval(refresh, 10000);
    return () => { clearInterval(poll); unsubscribe(); };
  }, [handleRoomChange, refresh, roomId, userId]));

  const room = snapshot?.room;
  const members = snapshot?.members || [];
  const focusState = snapshot?.focus || { queue: [], members: [], aggregate: {}, unreadCallbackCount: 0 };
  const queue = focusState.queue || [];
  const upNext = queue.filter((item) => item.status !== 'completed');
  const focusMembers = focusState.members || [];
  const localCompletedCount = queue.reduce(
    (total, item) => total + (item.status === 'completed' ? 1 : 0),
    0,
  );
  const displayMembers = members.map((member) => {
    const focusMember = focusMembers.find((item) => item.userId === member.userId);
    const merged = { ...member, ...(focusMember || {}) };
    return {
      ...merged,
      tasksCompletedSession: member.userId === String(userId)
        ? Math.max(Number(merged.tasksCompletedSession) || 0, localCompletedCount)
        : Number(merged.tasksCompletedSession) || 0,
      presenceStatus: deriveRoomPresence(merged, userId, now),
    };
  });
  const displayedCompletedCount = Math.max(
    Number(focusState.aggregate?.tasksCompletedSession) || 0,
    displayMembers.reduce((total, member) => total + member.tasksCompletedSession, 0),
  );
  const self = displayMembers.find((member) => member.userId === String(userId));
  const activeItem = queue.find((item) => item.id === focusedItemId)
    || queue.find((item) => item.status === 'focusing')
    || null;
  const isOnBreak = self?.presenceStatus === 'on_break';
  const focusElapsed = isOnBreak
    ? Math.max(0, Number(activeItem?.focusSeconds) || 0)
    : getFocusRoomTaskElapsed(activeItem, now);
  const unreadMessages = Math.max(0, (snapshot?.messages?.length || 0) - chatReadCount);
  const elapsed = getHustleRoomElapsed(self, room?.durationSeconds || 0, now);
  const remaining = Math.max(0, (room?.durationSeconds || 0) - elapsed);
  const progress = room?.durationSeconds ? Math.min(1, elapsed / room.durationSeconds) : 0;
  const isOwner = self?.role === 'owner' || room?.ownerId === String(userId);
  const online = isHustleRoomsOnline();


  useEffect(() => {
    if (!roomId || !room || !self) return;
    if (self.timerStatus === 'running' && elapsed < room.durationSeconds) {
      showHustleRoomNotification({
        roomId,
        roomName: room.name,
        taskLabel: activeItem?.title || self.taskLabel,
        taskId: activeItem?.taskId || null,
        queueItemId: activeItem?.id || null,
        userId,
        elapsedSeconds: elapsed,
        durationSeconds: room.durationSeconds,
      }).then(setNotificationAvailable).catch(() => setNotificationAvailable(false));
    } else {
      cancelHustleRoomNotification(roomId);
    }
  // Re-display only when the timer anchor/state changes; Android's chronometer
  // advances without waking JavaScript every second.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.id, activeItem?.title, roomId, room?.name, self?.timerStatus, self?.anchorStartedAt, userId]);

  const runProgress = useCallback(async (timerStatus) => {
    if (!userId || !roomId || busy) return;
    if (timerStatus === 'running' && !taskLabel.trim()) {
      Alert.alert('Name your focus', 'Add what you are working on before starting.');
      return;
    }
    setBusy(true);
    try {
      const updated = await updateMyHustleRoomProgress(userId, roomId, {
        timerStatus,
        taskLabel,
      });
      setSnapshot(updated);
    } catch (error) {
      Alert.alert('Could not update timer', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, roomId, taskLabel, userId]);

  const handleAddTasks = async (selectedTasks) => {
    if (!selectedTasks.length) return;
    const updated = await addTasksToHustleRoomQueue(userId, roomId, selectedTasks);
    setSnapshot(updated);
    setShowTaskPicker(false);
  };

  const handleQuickAdd = async (title) => {
    const updatedTasks = await addTask(userId, tasks, { title, added_to_today: true });
    setTasks(updatedTasks);
    const created = updatedTasks.find((task) => task.title === title && !tasks.some((old) => old.id === task.id));
    if (created) {
      const updatedRoom = await addTasksToHustleRoomQueue(userId, roomId, [created]);
      setSnapshot(updatedRoom);
      setShowTaskPicker(false);
    }
  };

  const startFocusItem = async (item) => {
    if (!item || busy) return;
    setBusy(true);
    try {
      const currentlyFocusing = queue.find((candidate) => candidate.status === 'focusing' && candidate.id !== item.id);
      if (currentlyFocusing) {
        await updateHustleRoomQueueItem(userId, roomId, currentlyFocusing.id, {
          status: 'queued',
          shareTitle: currentlyFocusing.shareTitle,
        });
      }
      await updateHustleRoomQueueItem(userId, roomId, item.id, {
        status: 'focusing',
        shareTitle: item.shareTitle,
      });
      setTaskLabel(item.title);
      const updated = await updateMyHustleRoomProgress(userId, roomId, {
        timerStatus: 'running',
        taskLabel: item.title,
      });
      setFocusedItemId(item.id);
      setSnapshot(updated);
      setShowFocusView(true);
    } catch (error) {
      Alert.alert('Could not start focus', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const pauseFocusItem = async () => {
    if (!activeItem || busy) return;
    setBusy(true);
    try {
      await updateHustleRoomQueueItem(userId, roomId, activeItem.id, {
        status: 'queued',
        shareTitle: activeItem.shareTitle,
      });
      const updated = await updateMyHustleRoomProgress(userId, roomId, {
        timerStatus: 'paused',
        taskLabel: activeItem.title,
      });
      setSnapshot(updated);
    } finally {
      setBusy(false);
    }
  };

  const completeActiveItem = async () => {
    if (!activeItem || busy) return;
    setBusy(true);
    try {
      await completeFocusRoomTask(userId, roomId, activeItem);
      const updated = await updateMyHustleRoomProgress(userId, roomId, {
        timerStatus: 'paused',
        taskLabel: activeItem.title,
      });
      setSnapshot(updated);
      setShowFocusView(false);
      setFocusedItemId(null);
    } catch (error) {
      Alert.alert('Could not complete task', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const skipActiveItem = async () => {
    if (!activeItem || busy) return;
    setBusy(true);
    try {
      await updateHustleRoomQueueItem(userId, roomId, activeItem.id, {
        status: 'skipped',
        shareTitle: activeItem.shareTitle,
      });
      const updated = await updateMyHustleRoomProgress(userId, roomId, {
        timerStatus: 'paused',
        taskLabel: activeItem.title,
      });
      setSnapshot(updated);
      setShowFocusView(false);
      setFocusedItemId(null);
    } finally {
      setBusy(false);
    }
  };

  const toggleBreak = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!isOnBreak && self?.timerStatus === 'running') {
        await updateMyHustleRoomProgress(userId, roomId, { timerStatus: 'paused', taskLabel: activeItem?.title || taskLabel });
      }
      let updated = await setHustleRoomBreak(userId, roomId, !isOnBreak);
      if (isOnBreak && activeItem) {
        updated = await updateHustleRoomQueueItem(userId, roomId, activeItem.id, { status: 'focusing', shareTitle: activeItem.shareTitle });
        updated = await updateMyHustleRoomProgress(userId, roomId, { timerStatus: 'running', taskLabel: activeItem.title });
      }
      setSnapshot(updated);
    } finally {
      setBusy(false);
    }
  };

  const updatePrivacy = async (showTaskTitles, callbackPolicy) => {
    const updated = await updateHustleRoomPrivacy(userId, roomId, { showTaskTitles, callbackPolicy });
    setSnapshot(updated);
  };

  const callMemberBack = async () => {
    if (!selectedMember) return;
    try {
      await sendHustleRoomCallback(userId, roomId, selectedMember.userId);
      Alert.alert('Call-back sent', `${selectedMember.displayName} will see your request.`);
      setSelectedMember(null);
    } catch (error) {
      Alert.alert('Could not send call-back', error?.message || 'Please try later.');
    }
  };

  const handleQueueReorder = async ({ data }) => {
    try {
      const updated = await reorderHustleRoomQueue(userId, roomId, data);
      setSnapshot(updated);
    } catch (error) {
      Alert.alert('Could not reorder tasks', error?.message || 'Please try again.');
    }
  };

  const toggleActiveItemSharing = async () => {
    if (!activeItem || busy) return;
    try {
      const updated = await updateHustleRoomQueueItem(userId, roomId, activeItem.id, {
        status: activeItem.status,
        shareTitle: !activeItem.shareTitle,
      });
      setSnapshot(updated);
    } catch (error) {
      Alert.alert('Could not update privacy', error?.message || 'Please try again.');
    }
  };

  const saveActiveItemNote = async (note) => {
    if (!activeItem || busy) return;
    try {
      const updated = await updateHustleRoomQueueItemDetails(userId, roomId, activeItem.id, { note });
      setSnapshot(updated);
    } catch (error) {
      Alert.alert('Could not save note', error?.message || 'Please try again.');
    }
  };

  const openMember = (member) => {
    setSelectedMember(member);
    if (member.userId === String(userId) && focusState.unreadCallbackCount > 0 && online) {
      markHustleRoomCallbacksRead(roomId)
        .then(() => setSnapshot((current) => current ? {
          ...current,
          focus: { ...current.focus, unreadCallbackCount: 0 },
        } : current))
        .catch(() => {});
    }
  };

  const openChat = () => {
    setChatReadCount(snapshot?.messages?.length || 0);
    setShowChat(true);
  };

  const renderQueueItem = ({ item, drag, isActive }) => {
    const itemElapsed = getFocusRoomTaskElapsed(item, now);
    return (
      <ScaleDecorator>
        <TouchableOpacity
          onPress={() => startFocusItem(item)}
          disabled={busy || isActive}
          style={[styles.queueRow, { borderBottomColor: palette.border, opacity: isActive ? 0.72 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={`Focus ${item.title}`}
        >
          <TouchableOpacity onLongPress={drag} delayLongPress={180} disabled={busy} style={styles.dragHandle} accessibilityLabel={`Reorder ${item.title}`}>
            <GripVertical color={palette.muted} size={17} />
          </TouchableOpacity>
          <View style={styles.queueCopy}>
            <Text style={[styles.queueTitle, { color: palette.text }]} numberOfLines={2}>{item.title}</Text>
            <Text style={[styles.queueMeta, { color: palette.muted }]}>
              {item.status === 'focusing' ? 'FOCUSING' : item.status === 'skipped' ? 'SKIPPED · TAP TO RETRY' : 'READY'}
              {itemElapsed > 0 ? ` · ${formatRoomClock(itemElapsed)}` : ''}
            </Text>
          </View>
          <Text style={[styles.queuePosition, { color: palette.muted }]}>{item.orderIndex + 1}</Text>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  useEffect(() => {
    completionHandledRef.current = false;
  }, [roomId]);

  useEffect(() => {
    if (!self || !room || busy || completionHandledRef.current) return;
    const reachedTarget = self.timerStatus === 'done'
      || (self.timerStatus === 'running' && elapsed >= room.durationSeconds);
    if (!reachedTarget) return;

    // A server snapshot can project a suspended running timer as done without
    // persisting the transition. Re-submit the deterministic completion so the
    // member row, focus rollup, and recovery path all converge exactly once.
    completionHandledRef.current = true;
    const completionTimer = setTimeout(() => {
      runProgress('done').finally(() => setShowCompletion(true));
    }, 0);
    return () => clearTimeout(completionTimer);
  }, [busy, elapsed, room, runProgress, self]);

  const handleLeave = async () => {
    if (!online) {
      Alert.alert('Internet required', 'Leaving changes room access and must be confirmed online.');
      return;
    }
    if (isOwner) {
      setShowCompletion(false);
      Alert.alert('Owner controls the room', 'End the room for everyone, or stay here.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'End room', style: 'destructive', onPress: () => handleEndRoom() },
      ]);
      return;
    }
    setBusy(true);
    try {
      await leaveHustleRoom(userId, roomId);
      await cancelHustleRoomNotification(roomId);
      navigation.replace('HustleRooms');
    } catch (error) {
      Alert.alert('Could not leave', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleEndRoom = async () => {
    if (!online) {
      Alert.alert('Internet required', 'Ending a shared room must be confirmed online.');
      return;
    }
    setBusy(true);
    try {
      await endHustleRoom(userId, roomId);
      await cancelHustleRoomNotification(roomId);
      setShowCompletion(false);
      navigation.replace('HustleRooms');
    } catch (error) {
      Alert.alert('Could not end room', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEndRoom = () => Alert.alert(
    'End this room?',
    'Every running timer will stop. This cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End room', style: 'destructive', onPress: handleEndRoom },
    ],
  );

  const handleSend = async () => {
    if (!message.trim() || busy) return;
    if (!online) {
      Alert.alert('Chat is offline', 'Reconnect before sending a room message.');
      return;
    }
    const body = message;
    setMessage('');
    setBusy(true);
    try {
      const updated = await sendHustleRoomMessage(userId, roomId, body);
      setSnapshot(updated);
    } catch (error) {
      setMessage(body);
      Alert.alert('Message not sent', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };


  if (!snapshot && resolved) {
    return (
      <SafeAreaView style={[styles.container, styles.center, { backgroundColor: palette.bg }]}>
        <Users color={palette.muted} size={28} />
        <Text style={[styles.unavailableTitle, { color: palette.text }]}>Room unavailable</Text>
        <Text style={[styles.unavailableBody, { color: palette.muted }]}>It may have ended, or you may be offline before this room was cached.</Text>
        <TouchableOpacity onPress={() => navigation.replace('HustleRooms')} style={[styles.outlineButton, { borderColor: palette.border }]}>
          <Text style={[styles.outlineText, { color: palette.text }]}>BACK TO ROOMS</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.replace('HustleRooms');
            }}
            style={styles.iconButton}
            accessibilityLabel="Back"
          >
            <ArrowLeft color={palette.text} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>{room?.name || 'Hustle Room'}</Text>
            <Text style={[styles.headerMeta, { color: palette.muted }]}>
              {members.length} MEMBERS · {room?.durationSeconds ? Math.round(room.durationSeconds / 60) : 0} MIN EACH
            </Text>
          </View>
          {isOwner ? (
            <TouchableOpacity onPress={confirmEndRoom} style={styles.iconButton} accessibilityLabel="End room">
              <Square color={palette.muted} size={18} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleLeave} style={styles.iconButton} accessibilityLabel="Leave room">
              <LogOut color={palette.muted} size={18} />
            </TouchableOpacity>
          )}
        </View>

        <NestableScrollContainer contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!online ? (
            <View style={[styles.offlineStrip, { borderColor: palette.border }]}>
              <Text style={[styles.offlineText, { color: palette.muted }]}>OFFLINE · CACHED TASKS AND TIMER REMAIN AVAILABLE</Text>
            </View>
          ) : null}

          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeadingCompact}>
              <ListPlus color={palette.muted} size={15} />
              <Text style={[styles.sectionTitle, { color: palette.text }]}>UP NEXT</Text>
            </View>
            <Text style={[styles.sectionCount, { color: palette.muted }]}>{upNext.length} TASK{upNext.length === 1 ? '' : 'S'}</Text>
          </View>
          <View style={[styles.queuePanel, { borderColor: palette.border }]}>
            {upNext.length ? (
              <NestableDraggableFlatList
                data={upNext}
                keyExtractor={(item) => item.id}
                renderItem={renderQueueItem}
                onDragEnd={handleQueueReorder}
                scrollEnabled={false}
                activationDistance={8}
              />
            ) : (
              <View style={styles.queueEmpty}>
                <Text style={[styles.queueEmptyTitle, { color: palette.text }]}>Bring a task into the room</Text>
                <Text style={[styles.queueEmptyBody, { color: palette.muted }]}>Choose from Today, Starred, a custom list, or all open tasks.</Text>
              </View>
            )}
          </View>
          <View style={styles.roomActions}>
            <TouchableOpacity onPress={() => setShowTaskPicker(true)} disabled={busy} style={[styles.outlineAction, { borderColor: palette.border }]}>
              <ListPlus color={palette.text} size={16} />
              <Text style={[styles.outlineActionText, { color: palette.text }]}>MY LISTS</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleBreak} disabled={busy} style={[styles.outlineAction, { borderColor: palette.border }]}>
              <Coffee color={isOnBreak ? '#FBBF24' : palette.text} size={16} />
              <Text style={[styles.outlineActionText, { color: palette.text }]}>{isOnBreak ? 'END BREAK' : 'TAKE A BREAK'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.timerSection}>
            <Text style={[styles.timerLabel, { color: palette.muted }]}>ROOM SESSION</Text>
            <Text style={[styles.timer, { color: palette.text }]}>{formatRoomClock(elapsed)}</Text>
            <Text style={[styles.remaining, { color: palette.muted }]}>{formatRoomClock(remaining)} remaining</Text>
            <View style={[styles.mainTrack, { backgroundColor: palette.border }]}>
              <View style={[styles.mainFill, { width: `${progress * 100}%`, backgroundColor: palette.text }]} />
            </View>
          </View>

          {Platform.OS === 'android' && !notificationAvailable && self?.timerStatus === 'running' ? (
            <Text style={[styles.notificationNote, { color: palette.muted }]}>Notification permission is off. Wall-clock timing still continues in the background.</Text>
          ) : null}

          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeadingCompact}>
              <Users color={palette.muted} size={15} />
              <Text style={[styles.sectionTitle, { color: palette.text }]}>MEMBER PROGRESS</Text>
            </View>
            {focusState.unreadCallbackCount > 0 ? (
              <TouchableOpacity onPress={() => openMember(self)} style={styles.callbackBadge} accessibilityLabel={`${focusState.unreadCallbackCount} unread call-back requests`}>
                <PhoneCall color="#F472B6" size={12} />
                <Text style={styles.callbackBadgeText}>{focusState.unreadCallbackCount}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={[styles.aggregateText, { color: palette.muted }]}>
            {displayedCompletedCount} tasks · {formatRoomClock(focusState.aggregate?.focusSecondsTotal || 0)} focus · {formatRoomClock(focusState.aggregate?.breakSecondsTotal || 0)} break
          </Text>
          <View style={[styles.memberPanel, { borderColor: palette.border }]}>
            {displayMembers.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                duration={room?.durationSeconds || 0}
                palette={palette}
                now={now}
                onPress={() => openMember(member)}
              />
            ))}
          </View>

          {!room?.chatEnabled ? (
            <View style={[styles.chatDisabled, { borderColor: palette.border }]}>
              <MessageCircle color={palette.muted} size={15} />
              <Text style={[styles.chatDisabledText, { color: palette.muted }]}>Chat was disabled by the room owner.</Text>
            </View>
          ) : null}
        </NestableScrollContainer>

        {room?.chatEnabled ? (
          <TouchableOpacity onPress={openChat} style={[styles.floatingChat, { backgroundColor: palette.text }]} accessibilityLabel={`Open room chat${unreadMessages ? `, ${unreadMessages} unread` : ''}`}>
            <MessageCircle color={palette.bg} size={21} />
            {unreadMessages > 0 ? (
              <View style={styles.chatBadge}><Text style={styles.chatBadgeText}>{Math.min(99, unreadMessages)}</Text></View>
            ) : null}
          </TouchableOpacity>
        ) : null}
      </KeyboardAvoidingView>

      <FocusRoomTaskPicker
        visible={showTaskPicker}
        tasks={tasks}
        lists={lists}
        palette={palette}
        onClose={() => setShowTaskPicker(false)}
        onAdd={handleAddTasks}
        onQuickAdd={handleQuickAdd}
      />
      <FocusRoomFocusView
        key={`focus-${activeItem?.id || 'closed'}`}
        visible={showFocusView}
        item={activeItem}
        elapsed={focusElapsed}
        isPaused={activeItem?.status !== 'focusing' || self?.timerStatus === 'paused'}
        isOnBreak={isOnBreak}
        palette={palette}
        onClose={() => setShowFocusView(false)}
        onPause={pauseFocusItem}
        onResume={() => startFocusItem(activeItem)}
        onComplete={completeActiveItem}
        onSkip={skipActiveItem}
        onBreak={toggleBreak}
        onToggleShare={toggleActiveItemSharing}
        onSaveNote={saveActiveItemNote}
      />
      <FocusRoomMemberPanel
        key={`member-${selectedMember?.userId || 'closed'}`}
        visible={Boolean(selectedMember)}
        member={displayMembers.find((member) => member.userId === selectedMember?.userId) || selectedMember}
        isSelf={selectedMember?.userId === String(userId)}
        palette={palette}
        onClose={() => setSelectedMember(null)}
        onCallback={callMemberBack}
        onPrivacy={updatePrivacy}
      />

      <Modal transparent visible={showChat} animationType="fade" onRequestClose={() => setShowChat(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.chatModal, { backgroundColor: palette.bg, borderColor: palette.border }]}>
            <View style={styles.chatModalHeader}>
              <View>
                <Text style={[styles.chatModalTitle, { color: palette.text }]}>Room chat</Text>
                <Text style={[styles.chatModalSubtitle, { color: palette.muted }]}>Light connection, without the feed.</Text>
              </View>
              <TouchableOpacity onPress={() => setShowChat(false)} style={styles.iconButton} accessibilityLabel="Close room chat">
                <X color={palette.muted} size={19} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.chatScroll} contentContainerStyle={styles.chatPanel} keyboardShouldPersistTaps="handled">
              {snapshot?.messages?.length ? snapshot.messages.map((item) => {
                const mine = item.authorId === String(userId);
                return (
                  <View key={item.id} style={[styles.messageRow, mine && styles.myMessageRow]}>
                    <Text style={[styles.messageAuthor, { color: palette.muted }]}>{mine ? 'YOU' : item.displayName.toUpperCase()}</Text>
                    <View style={[styles.messageBubble, { borderColor: palette.border }, mine && { backgroundColor: `${palette.text}0D` }]}>
                      <Text style={[styles.messageBody, { color: palette.text }]}>{item.body}</Text>
                    </View>
                  </View>
                );
              }) : <Text style={[styles.noMessages, { color: palette.muted }]}>No messages yet. Keep it focused.</Text>}
            </ScrollView>
            <View style={[styles.composer, { borderColor: palette.border }]}>
              <TextInput
                value={message}
                onChangeText={(value) => setMessage(value.slice(0, 2000))}
                placeholder={online ? 'Message the room' : 'Chat unavailable offline'}
                placeholderTextColor={palette.muted}
                editable={online && !busy}
                multiline
                style={[styles.messageInput, { color: palette.text }]}
              />
              <TouchableOpacity onPress={handleSend} disabled={!online || !message.trim() || busy} style={styles.sendButton} accessibilityLabel="Send message">
                <Send color={!online || !message.trim() ? palette.muted : palette.text} size={18} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal transparent visible={showCompletion} animationType="fade" onRequestClose={() => setShowCompletion(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.completionCard, { backgroundColor: palette.bg, borderColor: palette.border }]}>
            <TouchableOpacity onPress={() => setShowCompletion(false)} style={styles.modalClose} accessibilityLabel="Dismiss">
              <X color={palette.muted} size={18} />
            </TouchableOpacity>
            <CheckCircle2 color={palette.text} size={34} strokeWidth={1.5} />
            <Text style={[styles.completionTitle, { color: palette.text }]}>Your hustle is complete</Text>
            <Text style={[styles.completionBody, { color: palette.muted }]}>You are marked done. Stay to watch everyone finish, or {isOwner ? 'end the room' : 'leave now'}.</Text>
            <TouchableOpacity onPress={handleLeave} disabled={busy} style={[styles.completionAction, { backgroundColor: palette.accent }]}>
              <Text style={[styles.completionActionText, { color: palette.onAccent }]}>{isOwner ? 'END ROOM' : 'LEAVE ROOM'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCompletion(false)} style={styles.stayAction}>
              <Text style={[styles.stayText, { color: palette.text }]}>STAY IN ROOM</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '400', letterSpacing: -0.35 },
  headerMeta: { marginTop: 2, fontSize: 8.5, fontWeight: '600', letterSpacing: 0.9 },
  body: { paddingHorizontal: 16, paddingBottom: 92 },
  offlineStrip: { marginTop: 4, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  offlineText: { textAlign: 'center', fontSize: 8.5, fontWeight: '600', letterSpacing: 0.65 },
  timerSection: { alignItems: 'center', paddingTop: 28 },
  timerLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  timer: { marginTop: 10, fontSize: 48, fontWeight: '200', fontVariant: ['tabular-nums'], letterSpacing: -1.5 },
  remaining: { marginTop: 3, fontSize: 11, fontVariant: ['tabular-nums'] },
  mainTrack: { width: '100%', height: 4, marginTop: 20, borderRadius: 2, overflow: 'hidden' },
  mainFill: { height: '100%', borderRadius: 2 },
  taskShell: { minHeight: 48, marginTop: 20, paddingHorizontal: 13, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  taskInput: { fontSize: 14, paddingVertical: 10 },
  controls: { alignItems: 'center', marginTop: 13 },
  primaryControl: { minWidth: 166, minHeight: 46, paddingHorizontal: 22, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryControlText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1 },
  doneControl: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  doneText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },
  notificationNote: { marginTop: 9, textAlign: 'center', fontSize: 9.5, lineHeight: 14 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 30, marginBottom: 9 },
  sectionTitle: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.1 },
  memberPanel: { borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  memberRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  avatarLetter: { fontSize: 13 },
  memberCopy: { flex: 1, minWidth: 0 },
  memberNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { flexShrink: 1, fontSize: 13.5, fontWeight: '400' },
  ownerTag: { fontSize: 7.5, fontWeight: '700', letterSpacing: 0.8 },
  memberTask: { marginTop: 3, fontSize: 10.5 },
  memberTrack: { flex: 1, height: 2, borderRadius: 1, overflow: 'hidden' },
  memberFill: { height: '100%' },
  memberStats: { minWidth: 76, alignItems: 'flex-end' },
  memberTime: { fontSize: 11, fontVariant: ['tabular-nums'] },
  memberState: { marginTop: 4, fontSize: 7.5, fontWeight: '700', letterSpacing: 0.65 },
  chatSection: { marginTop: 2 },
  chatPanel: { padding: 2, gap: 10 },
  noMessages: { paddingVertical: 16, textAlign: 'center', fontSize: 10.5 },
  messageRow: { alignItems: 'flex-start' },
  myMessageRow: { alignItems: 'flex-end' },
  messageAuthor: { marginBottom: 3, fontSize: 7.5, fontWeight: '700', letterSpacing: 0.7 },
  messageBubble: { maxWidth: '86%', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  messageBody: { fontSize: 12, lineHeight: 17 },
  composer: { minHeight: 46, marginTop: 9, paddingLeft: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center' },
  messageInput: { flex: 1, maxHeight: 90, fontSize: 12.5, paddingVertical: 9 },
  sendButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chatDisabled: { minHeight: 48, marginTop: 26, paddingHorizontal: 13, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 9 },
  chatDisabledText: { flex: 1, fontSize: 10.5 },
  unavailableTitle: { marginTop: 12, fontSize: 17 },
  unavailableBody: { marginTop: 7, textAlign: 'center', fontSize: 11.5, lineHeight: 17 },
  outlineButton: { minHeight: 40, marginTop: 18, paddingHorizontal: 17, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  outlineText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.9 },
  modalBackdrop: { flex: 1, padding: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)' },
  completionCard: { width: '100%', maxWidth: 360, padding: 24, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  modalClose: { position: 'absolute', top: 10, right: 10, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  completionTitle: { marginTop: 15, fontSize: 19, fontWeight: '400', letterSpacing: -0.35 },
  completionBody: { marginTop: 8, maxWidth: 280, textAlign: 'center', fontSize: 11.5, lineHeight: 17 },
  completionAction: { width: '100%', minHeight: 46, marginTop: 22, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  completionActionText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1 },
  stayAction: { minHeight: 40, marginTop: 5, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  stayText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.9 },
  memberStatusDot: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  memberMetaLine: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberCount: { fontSize: 7, fontWeight: '700', letterSpacing: 0.65 },
  sectionHeaderRow: { marginTop: 28, marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeadingCompact: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionCount: { fontSize: 8, fontWeight: '700', letterSpacing: 0.7 },
  queuePanel: { borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  queueRow: { minHeight: 64, paddingRight: 13, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  dragHandle: { width: 42, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  queueCopy: { flex: 1, minWidth: 0, paddingVertical: 10 },
  queueTitle: { fontSize: 13.5, fontWeight: '400' },
  queueMeta: { marginTop: 4, fontSize: 7.5, fontWeight: '700', letterSpacing: 0.55 },
  queuePosition: { marginLeft: 10, fontSize: 10, fontVariant: ['tabular-nums'] },
  queueEmpty: { paddingHorizontal: 20, paddingVertical: 26, alignItems: 'center' },
  queueEmptyTitle: { fontSize: 14, fontWeight: '400' },
  queueEmptyBody: { maxWidth: 260, marginTop: 6, textAlign: 'center', fontSize: 10.5, lineHeight: 16 },
  roomActions: { marginTop: 10, flexDirection: 'row', gap: 8 },
  outlineAction: { flex: 1, minHeight: 42, paddingHorizontal: 10, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  outlineActionText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.75 },
  aggregateText: { marginTop: -4, marginBottom: 10, fontSize: 9.5, fontVariant: ['tabular-nums'] },
  callbackBadge: { minHeight: 28, paddingHorizontal: 9, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(244,114,182,0.12)' },
  callbackBadgeText: { color: '#F472B6', fontSize: 9, fontWeight: '700' },
  floatingChat: { position: 'absolute', right: 18, bottom: 18, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', elevation: 7, shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  chatBadge: { position: 'absolute', right: -2, top: -2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F472B6' },
  chatBadgeText: { color: '#000000', fontSize: 8, fontWeight: '800' },
  chatModal: { width: '100%', maxWidth: 460, height: '72%', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  chatModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chatModalTitle: { fontSize: 18, fontWeight: '400' },
  chatModalSubtitle: { marginTop: 2, fontSize: 9.5 },
  chatScroll: { flex: 1, marginTop: 12 },
});
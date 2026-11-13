// Cache-first data layer for private, timed Hustle Rooms.
// Screens use the re-exports from dataManager and never touch Supabase directly.
import { recordFocusSession } from '../utils/focusSessions';
import { Storage } from '../utils/storage';
import { supabase } from './supabase';
import { drainSyncQueue, getSyncState, syncRpc } from './syncQueue';

const roomsKey = (userId) => `hustle_rooms_${userId}`;
const roomKey = (userId, roomId) => `hustle_room_${userId}_${roomId}`;
const ROOM_TABLES = [
  'hustle_rooms',
  'hustle_room_members',
  'hustle_room_messages',
  'hustle_room_queue_items',
  'hustle_room_callbacks',
];

const uuid = () => {
  let timestamp = Date.now();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = (timestamp + Math.random() * 16) % 16 | 0;
    timestamp = Math.floor(timestamp / 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
};

const asArray = (value) => (Array.isArray(value) ? value : []);
const asDateMs = (value, fallback = Date.now()) => {
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
};
const validUser = (userId) => typeof userId === 'string' && userId.length > 0;
const requireOnline = () => {
  if (getSyncState().online) return;
  const error = new Error('Connect to the internet to manage room access.');
  error.code = 'OFFLINE';
  throw error;
};

export const HUSTLE_ROOM_LIMITS = Object.freeze({
  minMinutes: 1,
  maxMinutes: 240,
  maxFriends: 19,
  maxName: 60,
  maxTask: 120,
  maxMessage: 2000,
});


export const normalizeHustleRoomMember = (row, snapshotAt = new Date().toISOString()) => {
  if (!row || !(row.user_id ?? row.userId)) return null;
  const timerStatus = row.timer_status ?? row.timerStatus ?? 'not_started';
  const elapsedSeconds = Math.max(0, Math.floor(Number(row.elapsed_seconds ?? row.elapsedSeconds) || 0));
  return {
    roomId: String(row.room_id ?? row.roomId ?? ''),
    userId: String(row.user_id ?? row.userId),
    role: row.role === 'owner' ? 'owner' : 'member',
    timerStatus,
    taskLabel: row.task_label ?? row.taskLabel ?? '',
    elapsedSeconds,
    // RPC snapshots return elapsed measured at server_now. Anchor locally from
    // that moment so the server's original anchor is never counted twice.
    anchorStartedAt: timerStatus === 'running'
      ? (row.snapshot_at ?? row.snapshotAt ?? row.anchorStartedAt ?? snapshotAt)
      : null,
    joinedAt: row.joined_at ?? row.joinedAt ?? null,
    leftAt: row.left_at ?? row.leftAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    username: row.username || '',
    displayName: row.display_name ?? row.displayName ?? row.username ?? 'Hustler',
    avatarUrl: row.avatar_url ?? row.avatarUrl ?? null,
    avatarSeed: row.avatar_seed ?? row.avatarSeed ?? null,
    lastSeenAt: row.last_seen_at ?? row.lastSeenAt ?? null,
    // Availability is timestamp-derived. Missing/legacy presence must fail
    // closed; defaulting it to online makes stale cached users live forever.
    presenceStatus: row.presence_status ?? row.presenceStatus ?? 'offline',
    tasksCompletedSession: Math.max(0, Number(row.tasks_completed_session ?? row.tasksCompletedSession) || 0),
    focusSecondsTotal: Math.max(0, Number(row.focus_seconds_total ?? row.focusSecondsTotal) || 0),
    breakSecondsTotal: Math.max(0, Number(row.break_seconds_total ?? row.breakSecondsTotal) || 0),
    showTaskTitles: Boolean(row.show_task_titles ?? row.showTaskTitles),
    callbackPolicy: row.callback_policy ?? row.callbackPolicy ?? null,
    currentQueueItemId: row.current_queue_item_id ?? row.currentQueueItemId ?? null,
    currentTaskTitle: row.current_task_title ?? row.currentTaskTitle ?? null,
  };
};

export const normalizeHustleRoom = (row, snapshotAt = new Date().toISOString()) => {
  if (!row || !(row.id ?? row.room_id ?? row.roomId)) return null;
  const rawMember = row.my_member ?? row.myMember;
  return {
    id: String(row.id ?? row.room_id ?? row.roomId),
    ownerId: String(row.owner_id ?? row.ownerId ?? ''),
    name: String(row.name || 'Hustle Room'),
    durationSeconds: Math.max(60, Math.floor(Number(row.duration_seconds ?? row.durationSeconds) || 60)),
    chatEnabled: Boolean(row.chat_enabled ?? row.chatEnabled),
    status: row.status || 'active',
    memberCount: Math.max(0, Number(row.member_count ?? row.memberCount) || 0),
    myMember: rawMember ? normalizeHustleRoomMember(rawMember, snapshotAt) : null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    endedAt: row.ended_at ?? row.endedAt ?? null,
    endedBy: row.ended_by ?? row.endedBy ?? null,
  };
};

export const normalizeHustleRoomMessage = (row) => {
  if (!row || !(row.id ?? row.client_mutation_id ?? row.clientMutationId)) return null;
  return {
    id: String(row.id ?? row.client_mutation_id ?? row.clientMutationId),
    roomId: String(row.room_id ?? row.roomId ?? ''),
    authorId: String(row.author_id ?? row.authorId ?? ''),
    body: String(row.body || ''),
    clientMutationId: String(row.client_mutation_id ?? row.clientMutationId ?? ''),
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    username: row.username || '',
    displayName: row.display_name ?? row.displayName ?? row.username ?? 'Hustler',
    avatarUrl: row.avatar_url ?? row.avatarUrl ?? null,
    pending: Boolean(row.pending),
  };
};

export const normalizeFocusRoomQueueItem = (row) => {
  if (!row || !(row.id ?? row.task_id ?? row.taskId)) return null;
  const status = ['queued', 'focusing', 'completed', 'skipped'].includes(row.status)
    ? row.status
    : 'queued';
  return {
    id: String(row.id ?? uuid()),
    roomId: String(row.room_id ?? row.roomId ?? ''),
    userId: String(row.user_id ?? row.userId ?? ''),
    taskId: row.task_id ?? row.taskId ?? null,
    title: String(row.title || 'Untitled task'),
    note: row.note ?? null,
    listId: row.list_id ?? row.listId ?? null,
    isStarred: Boolean(row.is_starred ?? row.isStarred),
    estimatedMinutes: row.estimated_minutes ?? row.estimatedMinutes ?? null,
    orderIndex: Math.max(0, Number(row.order_index ?? row.orderIndex) || 0),
    status,
    focusSeconds: Math.max(0, Number(row.focus_seconds ?? row.focusSeconds) || 0),
    focusAnchorAt: status === 'focusing'
      ? (row.focus_anchor_at ?? row.focusAnchorAt ?? null)
      : null,
    completedAt: row.completed_at ?? row.completedAt ?? null,
    xpEarned: Math.max(0, Number(row.xp_earned ?? row.xpEarned) || 0),
    shareTitle: Boolean(row.share_title ?? row.shareTitle),
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString(),
  };
};

export const normalizeFocusRoomState = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return { queue: [], members: [], aggregate: {}, unreadCallbackCount: 0, serverNow: null };
  }
  return {
    queue: asArray(payload.queue).map(normalizeFocusRoomQueueItem).filter(Boolean),
    members: asArray(payload.members).map((row) => normalizeHustleRoomMember(row, payload.server_now ?? payload.serverNow)).filter(Boolean),
    aggregate: payload.aggregate && typeof payload.aggregate === 'object' ? {
      activeMembers: Number(payload.aggregate.active_members ?? payload.aggregate.activeMembers) || 0,
      tasksCompletedSession: Number(payload.aggregate.tasks_completed_session ?? payload.aggregate.tasksCompletedSession) || 0,
      focusSecondsTotal: Number(payload.aggregate.focus_seconds_total ?? payload.aggregate.focusSecondsTotal) || 0,
      breakSecondsTotal: Number(payload.aggregate.break_seconds_total ?? payload.aggregate.breakSecondsTotal) || 0,
      membersFocusing: Number(payload.aggregate.members_focusing ?? payload.aggregate.membersFocusing) || 0,
      membersOnBreak: Number(payload.aggregate.members_on_break ?? payload.aggregate.membersOnBreak) || 0,
    } : {},
    unreadCallbackCount: Number(payload.unread_callback_count ?? payload.unreadCallbackCount) || 0,
    serverNow: payload.server_now ?? payload.serverNow ?? null,
  };
};

export const getFocusRoomTaskElapsed = (item, now = Date.now()) => {
  if (!item) return 0;
  const base = Math.max(0, Math.floor(Number(item.focusSeconds) || 0));
  if (item.status !== 'focusing' || !item.focusAnchorAt) return base;
  return Math.min(57600, base + Math.max(0, Math.floor((now - asDateMs(item.focusAnchorAt, now)) / 1000)));
};

export const normalizeHustleRoomSnapshot = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const serverNow = payload.server_now ?? payload.serverNow ?? new Date().toISOString();
  const room = normalizeHustleRoom(payload.room, serverNow);
  if (!room) return null;
  return {
    room,
    members: asArray(payload.members).map((row) => normalizeHustleRoomMember(row, serverNow)).filter(Boolean),
    messages: asArray(payload.messages).map(normalizeHustleRoomMessage).filter(Boolean),
    focus: normalizeFocusRoomState(payload.focus ?? payload.focusState),
    serverNow,
    cachedAt: new Date().toISOString(),
  };
};

export const getHustleRoomElapsed = (member, durationSeconds, now = Date.now()) => {
  if (!member) return 0;
  const base = Math.max(0, Math.floor(Number(member.elapsedSeconds) || 0));
  const running = member.timerStatus === 'running' && member.anchorStartedAt;
  const extra = running ? Math.max(0, Math.floor((now - asDateMs(member.anchorStartedAt, now)) / 1000)) : 0;
  return Math.min(Math.max(0, Number(durationSeconds) || 0), base + extra);
};

export const formatRoomClock = (seconds) => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const localRoomSubscribers = new Map();
const emitLocalRoomSnapshot = (userId, snapshot) => {
  const roomId = snapshot?.room?.id;
  if (!roomId) return;
  localRoomSubscribers.get(String(roomId))?.forEach((subscriber) => {
    try { subscriber(snapshot, String(userId)); } catch (_error) {}
  });
};
const subscribeToLocalRoomSnapshot = (roomId, subscriber) => {
  const key = String(roomId);
  const subscribers = localRoomSubscribers.get(key) || new Set();
  subscribers.add(subscriber);
  localRoomSubscribers.set(key, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) localRoomSubscribers.delete(key);
  };
};

const saveSnapshot = async (userId, snapshot) => {
  if (!snapshot?.room?.id) return;
  await Storage.set(roomKey(userId, snapshot.room.id), snapshot);
  emitLocalRoomSnapshot(userId, snapshot);
};

const mergeRoomIntoList = async (userId, room) => {
  const cached = asArray(await Storage.get(roomsKey(userId))).map(normalizeHustleRoom).filter(Boolean);
  const next = [room, ...cached.filter((item) => item.id !== room.id)];
  await Storage.set(roomsKey(userId), next);
  return next;
};

const removeRoomFromList = async (userId, roomId) => {
  const cached = asArray(await Storage.get(roomsKey(userId))).map(normalizeHustleRoom).filter(Boolean);
  const next = cached.filter((room) => room.id !== String(roomId));
  await Storage.set(roomsKey(userId), next);
  return next;
};


export const refreshHustleRooms = async (userId) => {
  if (!validUser(userId)) return { ok: false, data: [] };
  try {
    if (getSyncState().online) await drainSyncQueue().catch(() => {});
    const { data, error } = await supabase.rpc('get_my_hustle_rooms');
    if (error) return { ok: false, error, data: asArray(await Storage.get(roomsKey(userId))) };
    const snapshotAt = data?.server_now ?? new Date().toISOString();
    const rooms = asArray(data?.rooms).map((row) => normalizeHustleRoom(row, snapshotAt)).filter(Boolean);
    await Storage.set(roomsKey(userId), rooms);
    return { ok: true, data: rooms };
  } catch (error) {
    return { ok: false, error, data: asArray(await Storage.get(roomsKey(userId))) };
  }
};

export const loadHustleRooms = async (userId, onFresh, { refresh = true } = {}) => {
  if (!validUser(userId)) return [];
  const cached = asArray(await Storage.get(roomsKey(userId))).map(normalizeHustleRoom).filter(Boolean);
  if (refresh) {
    refreshHustleRooms(userId).then((result) => {
      if (result.ok) onFresh?.(result.data);
    }).catch(() => {});
  }
  return cached;
};

export const refreshHustleRoom = async (userId, roomId) => {
  if (!validUser(userId) || !roomId) return { ok: false, data: null };
  try {
    if (getSyncState().online) await drainSyncQueue().catch(() => {});
    const { data, error } = await supabase.rpc('get_hustle_room_snapshot', {
      p_room_id: roomId,
      p_message_limit: 150,
    });
    if (error) {
      if (error.code === '42501' || error.code === 'P0002') {
        await Promise.all([
          Storage.remove(roomKey(userId, roomId)),
          removeRoomFromList(userId, roomId),
        ]);
      }
      return { ok: false, error, data: null };
    }
    let snapshot = normalizeHustleRoomSnapshot(data);
    if (!snapshot) return { ok: false, data: null };

    const cachedSnapshot = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
    const { data: focusData, error: focusError } = await supabase.rpc('get_hustle_room_focus_state', {
      p_room_id: roomId,
    });
    snapshot = {
      ...snapshot,
      focus: focusError
        ? (cachedSnapshot?.focus || normalizeFocusRoomState(null))
        : normalizeFocusRoomState(focusData),
    };
    await Promise.all([saveSnapshot(userId, snapshot), mergeRoomIntoList(userId, {
      ...snapshot.room,
      memberCount: snapshot.members.length,
      myMember: snapshot.members.find((member) => member.userId === String(userId)) || null,
    })]);
    return { ok: true, data: snapshot };
  } catch (error) {
    return { ok: false, error, data: null };
  }
};

export const loadHustleRoom = async (userId, roomId, onFresh, { refresh = true } = {}) => {
  if (!validUser(userId) || !roomId) return null;
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (refresh) {
    refreshHustleRoom(userId, roomId).then((result) => {
      if (result.ok) onFresh?.(result.data);
    }).catch(() => {});
  }
  return cached;
};

export const createHustleRoom = async (userId, {
  name,
  durationMinutes,
  chatEnabled = false,
  friendIds = [],
} = {}) => {
  if (!validUser(userId)) throw new Error('Sign in to create a room.');
  requireOnline();
  const trimmedName = String(name || '').trim();
  const minutes = Math.floor(Number(durationMinutes));
  const uniqueFriends = [...new Set(asArray(friendIds).map(String).filter(Boolean))]
    .filter((id) => id !== String(userId));
  if (!trimmedName || trimmedName.length > HUSTLE_ROOM_LIMITS.maxName) {
    throw new Error('Room name must be 1–60 characters.');
  }
  if (minutes < HUSTLE_ROOM_LIMITS.minMinutes || minutes > HUSTLE_ROOM_LIMITS.maxMinutes) {
    throw new Error('Choose a duration from 1 to 240 minutes.');
  }
  if (uniqueFriends.length < 1 || uniqueFriends.length > HUSTLE_ROOM_LIMITS.maxFriends) {
    throw new Error('Select between 1 and 19 friends.');
  }

  const { data, error } = await supabase.rpc('create_hustle_room', {
    p_name: trimmedName,
    p_duration_seconds: minutes * 60,
    p_chat_enabled: Boolean(chatEnabled),
    p_friend_ids: uniqueFriends,
    p_client_mutation_id: uuid(),
  });
  if (error) throw error;
  const snapshot = normalizeHustleRoomSnapshot(data);
  if (!snapshot) throw new Error('The room was created but could not be opened.');
  await Promise.all([saveSnapshot(userId, snapshot), mergeRoomIntoList(userId, {
    ...snapshot.room,
    memberCount: snapshot.members.length,
    myMember: snapshot.members.find((member) => member.userId === String(userId)) || null,
  })]);
  return snapshot;
};


const mergeAuthoritativeMember = (snapshot, rawMember, serverNow, userId) => {
  const previous = snapshot.members.find((member) => member.userId === String(userId));
  const authoritative = normalizeHustleRoomMember({
    ...previous,
    ...rawMember,
    snapshot_at: serverNow,
  }, serverNow);
  return {
    ...snapshot,
    serverNow,
    cachedAt: new Date().toISOString(),
    members: snapshot.members.map((member) => (
      member.userId === String(userId) ? authoritative : member
    )),
  };
};

export const updateMyHustleRoomProgress = async (userId, roomId, {
  timerStatus,
  taskLabel,
} = {}) => {
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (!cached?.room || cached.room.status !== 'active') throw new Error('This room is no longer active.');
  const previous = cached.members.find((member) => member.userId === String(userId));
  if (!previous) throw new Error('Room access is no longer available.');

  const nextStatus = ['not_started', 'running', 'paused', 'done'].includes(timerStatus)
    ? timerStatus
    : previous.timerStatus;
  const now = new Date();
  let elapsedSeconds = getHustleRoomElapsed(previous, cached.room.durationSeconds, now.getTime());
  if (nextStatus === 'done') elapsedSeconds = cached.room.durationSeconds;
  const nextMember = {
    ...previous,
    timerStatus: nextStatus,
    taskLabel: String(taskLabel ?? previous.taskLabel ?? '').trim().slice(0, HUSTLE_ROOM_LIMITS.maxTask),
    elapsedSeconds,
    anchorStartedAt: nextStatus === 'running' ? now.toISOString() : null,
    updatedAt: now.toISOString(),
  };
  let optimistic = {
    ...cached,
    cachedAt: now.toISOString(),
    members: cached.members.map((member) => (
      member.userId === String(userId) ? nextMember : member
    )),
  };
  optimistic.room = { ...optimistic.room, myMember: nextMember };
  await saveSnapshot(userId, optimistic);
  await mergeRoomIntoList(userId, optimistic.room);

  const clientMutationId = uuid();
  const result = await syncRpc('update_hustle_room_progress', {
    p_room_id: roomId,
    p_timer_status: nextStatus,
    p_task_label: nextMember.taskLabel || null,
    p_elapsed_seconds: elapsedSeconds,
    p_elapsed_captured_at: now.toISOString(),
    p_client_mutation_id: clientMutationId,
  }, {
    actorUserId: userId,
    entityId: roomId,
    clientMutationId,
  });

  if (result?.member) {
    optimistic = mergeAuthoritativeMember(
      optimistic,
      result.member,
      result.server_now ?? now.toISOString(),
      userId,
    );
    optimistic.room = {
      ...optimistic.room,
      myMember: optimistic.members.find((member) => member.userId === String(userId)),
    };
    await Promise.all([saveSnapshot(userId, optimistic), mergeRoomIntoList(userId, optimistic.room)]);
  } else {
    drainSyncQueue().catch(() => {});
  }

  if (nextStatus === 'done') {
    await recordFocusSession(userId, {
      seconds: elapsedSeconds,
      startedAt: new Date(now.getTime() - elapsedSeconds * 1000),
      endedAt: now,
      taskId: null,
      clientSessionId: `hustle_room_${roomId}_${userId}`,
    }).catch(() => {});
  }
  return optimistic;
};

const queuePayload = (queue) => asArray(queue)
  .filter((item) => item?.status !== 'completed')
  .map((item, index) => ({
    id: item.id,
    task_id: item.taskId != null ? String(item.taskId) : null,
    title: String(item.title || '').trim().slice(0, 300),
    note: item.note ? String(item.note).slice(0, 4000) : null,
    list_id: item.listId != null ? String(item.listId) : null,
    is_starred: Boolean(item.isStarred),
    estimated_minutes: item.estimatedMinutes == null
      ? null
      : Math.max(1, Math.min(1440, Math.floor(Number(item.estimatedMinutes) || 1))),
    order_index: index,
    status: ['queued', 'focusing', 'skipped'].includes(item.status) ? item.status : 'queued',
    focus_seconds: Math.max(0, Math.min(57600, Math.floor(Number(item.focusSeconds) || 0))),
    share_title: Boolean(item.shareTitle),
  }));

const saveFocusState = async (userId, roomId, focus) => {
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (!cached) throw new Error('Open this room once before changing its queue.');
  const next = { ...cached, focus: normalizeFocusRoomState(focus), cachedAt: new Date().toISOString() };
  await saveSnapshot(userId, next);
  return next;
};

const syncFocusQueue = async (userId, roomId, focus) => {
  const clientMutationId = uuid();
  const result = await syncRpc('replace_hustle_room_queue', {
    p_room_id: roomId,
    p_items: queuePayload(focus.queue),
    p_client_mutation_id: clientMutationId,
  }, { actorUserId: userId, entityId: roomId, clientMutationId });
  if (result?.queue) return saveFocusState(userId, roomId, result);
  drainSyncQueue().catch(() => {});
  return null;
};

export const addTasksToHustleRoomQueue = async (userId, roomId, tasks = []) => {
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (!cached) throw new Error('Room cache is unavailable.');
  const existing = cached.focus?.queue || [];
  const existingTaskIds = new Set(existing
    .filter((item) => item.status !== 'completed')
    .map((item) => item.taskId)
    .filter(Boolean)
    .map(String));
  const now = new Date().toISOString();
  const additions = asArray(tasks).filter((task) => (
    task?.id != null && !task.is_completed && !existingTaskIds.has(String(task.id))
  )).map((task, offset) => normalizeFocusRoomQueueItem({
    id: uuid(),
    room_id: roomId,
    user_id: userId,
    task_id: String(task.id),
    title: task.title,
    note: task.note ?? task.notes ?? null,
    list_id: task.list_id ?? null,
    is_starred: task.is_important,
    estimated_minutes: task.estimated_minutes ?? null,
    order_index: existing.length + offset,
    status: 'queued',
    focus_seconds: 0,
    share_title: false,
    created_at: now,
    updated_at: now,
  })).filter(Boolean);
  const focus = { ...cached.focus, queue: [...existing, ...additions] };
  const optimistic = await saveFocusState(userId, roomId, focus);
  syncFocusQueue(userId, roomId, focus).catch(() => {});
  return optimistic;
};

export const reorderHustleRoomQueue = async (userId, roomId, orderedItems) => {
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (!cached) throw new Error('Room cache is unavailable.');
  const completed = (cached.focus?.queue || []).filter((item) => item.status === 'completed');
  const active = asArray(orderedItems).map((item, index) => ({ ...item, orderIndex: index }));
  const focus = { ...cached.focus, queue: [...active, ...completed] };
  const optimistic = await saveFocusState(userId, roomId, focus);
  syncFocusQueue(userId, roomId, focus).catch(() => {});
  return optimistic;
};

export const updateHustleRoomQueueItemDetails = async (userId, roomId, itemId, { note } = {}) => {
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  const queue = cached?.focus?.queue || [];
  const previous = queue.find((item) => item.id === String(itemId));
  if (!cached || !previous) throw new Error('Queue item is unavailable.');
  const cleanNote = String(note || '').trim().slice(0, 4000) || null;
  const focus = {
    ...cached.focus,
    queue: queue.map((item) => item.id === previous.id
      ? { ...item, note: cleanNote, updatedAt: new Date().toISOString() }
      : item),
  };
  const optimistic = await saveFocusState(userId, roomId, focus);
  syncFocusQueue(userId, roomId, focus).catch(() => {});
  return optimistic;
};

export const updateHustleRoomQueueItem = async (userId, roomId, itemId, {
  status,
  xpEarned = 0,
  shareTitle,
} = {}) => {
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  const queue = cached?.focus?.queue || [];
  const previous = queue.find((item) => item.id === String(itemId));
  if (!cached || !previous) throw new Error('Queue item is unavailable.');
  const now = new Date();
  const nextStatus = ['queued', 'focusing', 'completed', 'skipped'].includes(status)
    ? status
    : previous.status;
  const focusSeconds = getFocusRoomTaskElapsed(previous, now.getTime());
  const updatedItem = {
    ...previous,
    status: nextStatus,
    focusSeconds,
    focusAnchorAt: nextStatus === 'focusing' ? now.toISOString() : null,
    completedAt: nextStatus === 'completed' ? now.toISOString() : null,
    xpEarned: nextStatus === 'completed' ? Math.max(previous.xpEarned, Number(xpEarned) || 0) : previous.xpEarned,
    shareTitle: shareTitle == null ? previous.shareTitle : Boolean(shareTitle),
    updatedAt: now.toISOString(),
  };
  const nextQueue = queue.map((item) => item.id === updatedItem.id ? updatedItem : item);
  const completedIncrement = previous.status !== 'completed' && nextStatus === 'completed' ? 1 : 0;
  const focusMembers = cached.focus?.members || [];
  const cachedMember = focusMembers.find((member) => member.userId === String(userId))
    || cached.members.find((member) => member.userId === String(userId));
  const seededMembers = focusMembers.some((member) => member.userId === String(userId))
    ? focusMembers
    : cachedMember ? [...focusMembers, cachedMember] : focusMembers;
  const members = seededMembers.map((member) => member.userId === String(userId) ? {
    ...member,
    presenceStatus: nextStatus === 'focusing' ? 'focusing' : 'online',
    currentQueueItemId: nextStatus === 'focusing' ? updatedItem.id : null,
    currentTaskTitle: nextStatus === 'focusing' && updatedItem.shareTitle ? updatedItem.title : null,
    tasksCompletedSession: member.tasksCompletedSession + completedIncrement,
  } : member);
  const aggregate = {
    ...cached.focus?.aggregate,
    tasksCompletedSession: members.reduce(
      (total, member) => total + Math.max(0, Number(member.tasksCompletedSession) || 0),
      0,
    ),
  };
  let optimistic = await saveFocusState(userId, roomId, {
    ...cached.focus,
    queue: nextQueue,
    members,
    aggregate,
  });
  const clientMutationId = uuid();
  const result = await syncRpc('update_hustle_room_queue_item', {
    p_room_id: roomId,
    p_item_id: updatedItem.id,
    p_status: nextStatus,
    p_focus_seconds: focusSeconds,
    p_xp_earned: Math.max(0, Math.min(500, Math.floor(Number(xpEarned) || 0))),
    p_share_title: updatedItem.shareTitle,
    p_client_mutation_id: clientMutationId,
  }, { actorUserId: userId, entityId: updatedItem.id, clientMutationId });
  if (result?.item || result?.member) {
    const authoritativeItem = result.item ? normalizeFocusRoomQueueItem(result.item) : null;
    let authoritativeMembers = optimistic.focus.members;
    if (result.member) {
      const previousMember = authoritativeMembers.find((member) => member.userId === String(userId))
        || cached.members.find((member) => member.userId === String(userId));
      const authoritativeMember = normalizeHustleRoomMember({
        ...previousMember,
        ...result.member,
      }, result.server_now ?? now.toISOString());
      if (authoritativeMember) {
        authoritativeMembers = authoritativeMembers.some((member) => member.userId === authoritativeMember.userId)
          ? authoritativeMembers.map((member) => member.userId === authoritativeMember.userId ? authoritativeMember : member)
          : [...authoritativeMembers, authoritativeMember];
      }
    }
    optimistic = await saveFocusState(userId, roomId, {
      ...optimistic.focus,
      queue: authoritativeItem
        ? optimistic.focus.queue.map((item) => item.id === authoritativeItem.id ? authoritativeItem : item)
        : optimistic.focus.queue,
      members: authoritativeMembers,
      aggregate: {
        ...optimistic.focus.aggregate,
        tasksCompletedSession: authoritativeMembers.reduce(
          (total, member) => total + Math.max(0, Number(member.tasksCompletedSession) || 0),
          0,
        ),
      },
      serverNow: result.server_now ?? optimistic.focus.serverNow,
    });
  } else drainSyncQueue().catch(() => {});
  return optimistic;
};

export const setHustleRoomBreak = async (userId, roomId, isBreaking) => {
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (!cached) throw new Error('Room cache is unavailable.');
  const now = new Date();
  const queue = (cached.focus?.queue || []).map((item) => {
    if (item.status !== 'focusing') return item;
    return {
      ...item,
      focusSeconds: getFocusRoomTaskElapsed(item, now.getTime()),
      focusAnchorAt: isBreaking ? null : now.toISOString(),
    };
  });
  const members = (cached.focus?.members || []).map((member) => member.userId === String(userId)
    ? { ...member, presenceStatus: isBreaking ? 'on_break' : (queue.some((item) => item.status === 'focusing') ? 'focusing' : 'online') }
    : member);
  const optimistic = await saveFocusState(userId, roomId, { ...cached.focus, queue, members });
  const clientMutationId = uuid();
  syncRpc('set_hustle_room_break', {
    p_room_id: roomId,
    p_is_breaking: Boolean(isBreaking),
    p_client_mutation_id: clientMutationId,
  }, { actorUserId: userId, entityId: roomId, clientMutationId }).then((result) => {
    if (!result) drainSyncQueue().catch(() => {});
  }).catch(() => {});
  return optimistic;
};

export const updateHustleRoomPrivacy = async (userId, roomId, { showTaskTitles, callbackPolicy }) => {
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (!cached) throw new Error('Room cache is unavailable.');
  const members = (cached.focus?.members || []).map((member) => member.userId === String(userId)
    ? { ...member, showTaskTitles: Boolean(showTaskTitles), callbackPolicy }
    : member);
  const optimistic = await saveFocusState(userId, roomId, { ...cached.focus, members });
  const clientMutationId = uuid();
  syncRpc('update_hustle_room_privacy', {
    p_room_id: roomId,
    p_show_titles: Boolean(showTaskTitles),
    p_callback_policy: ['everyone', 'room', 'nobody'].includes(callbackPolicy) ? callbackPolicy : 'room',
    p_client_mutation_id: clientMutationId,
  }, { actorUserId: userId, entityId: roomId, clientMutationId }).catch(() => {});
  return optimistic;
};

export const sendHustleRoomCallback = async (userId, roomId, recipientId) => {
  requireOnline();
  const { data, error } = await supabase.rpc('send_hustle_room_callback', {
    p_room_id: roomId,
    p_recipient_id: recipientId,
    p_client_mutation_id: uuid(),
  });
  if (error) throw error;
  return data;
};

export const markHustleRoomCallbacksRead = async (roomId) => {
  requireOnline();
  const { data, error } = await supabase.rpc('mark_hustle_room_callbacks_read', { p_room_id: roomId });
  if (error) throw error;
  return data;
};

export const sendHustleRoomMessage = async (userId, roomId, body) => {
  requireOnline();
  const trimmed = String(body || '').trim();
  if (!trimmed || trimmed.length > HUSTLE_ROOM_LIMITS.maxMessage) {
    throw new Error(`Message must be 1–${HUSTLE_ROOM_LIMITS.maxMessage} characters.`);
  }
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (!cached?.room?.chatEnabled) throw new Error('Chat is disabled in this room.');

  const clientMutationId = uuid();
  const optimisticMessage = normalizeHustleRoomMessage({
    id: clientMutationId,
    room_id: roomId,
    author_id: userId,
    body: trimmed,
    client_mutation_id: clientMutationId,
    created_at: new Date().toISOString(),
    pending: true,
  });
  let optimistic = { ...cached, messages: [...cached.messages, optimisticMessage] };
  await saveSnapshot(userId, optimistic);

  const result = await syncRpc('send_hustle_room_message', {
    p_room_id: roomId,
    p_body: trimmed,
    p_client_mutation_id: clientMutationId,
  }, { actorUserId: userId, entityId: roomId, clientMutationId });
  if (result?.message) {
    const message = normalizeHustleRoomMessage(result.message);
    optimistic = {
      ...optimistic,
      messages: optimistic.messages.map((item) => (
        item.clientMutationId === clientMutationId ? message : item
      )),
    };
    await saveSnapshot(userId, optimistic);
  }
  return optimistic;
};

export const leaveHustleRoom = async (userId, roomId) => {
  requireOnline();
  const { data, error } = await supabase.rpc('leave_hustle_room', {
    p_room_id: roomId,
    p_client_mutation_id: uuid(),
  });
  if (error) throw error;
  await Promise.all([
    Storage.remove(roomKey(userId, roomId)),
    removeRoomFromList(userId, roomId),
  ]);
  return data;
};

export const endHustleRoom = async (userId, roomId) => {
  requireOnline();
  const { data, error } = await supabase.rpc('end_hustle_room', {
    p_room_id: roomId,
    p_client_mutation_id: uuid(),
  });
  if (error) throw error;
  const cached = normalizeHustleRoomSnapshot(await Storage.get(roomKey(userId, roomId)));
  if (cached) {
    await saveSnapshot(userId, {
      ...cached,
      room: { ...cached.room, ...normalizeHustleRoom(data?.room), status: 'ended' },
      members: cached.members.map((member) => ({
        ...member,
        timerStatus: member.timerStatus === 'running' ? 'paused' : member.timerStatus,
        elapsedSeconds: getHustleRoomElapsed(member, cached.room.durationSeconds),
        anchorStartedAt: null,
      })),
    });
  }
  await removeRoomFromList(userId, roomId);
  return data;
};


const subscribeRoomTables = (channelName, roomId, onChange) => {
  let timer = null;
  const notify = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onChange?.();
    }, 120);
  };
  try {
    let channel = supabase.channel(channelName);
    ROOM_TABLES.forEach((table) => {
      const filter = roomId
        ? `${table === 'hustle_rooms' ? 'id' : 'room_id'}=eq.${roomId}`
        : undefined;
      channel = channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table,
        ...(filter ? { filter } : {}),
      }, notify);
    });
    channel = channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  } catch {
    if (timer) clearTimeout(timer);
    return () => {};
  }
};

export const subscribeToHustleRoomChanges = (roomId, onChange) => {
  if (!roomId) return () => {};
  const unsubscribeLocal = subscribeToLocalRoomSnapshot(roomId, onChange);
  const unsubscribeRemote = subscribeRoomTables(
    `hustle-room:${roomId}`,
    roomId,
    () => onChange?.(),
  );
  return () => {
    unsubscribeLocal();
    unsubscribeRemote();
  };
};

export const subscribeToHustleRoomsChanges = (userId, onChange) => (
  userId
    ? subscribeRoomTables(`hustle-rooms:${userId}`, null, onChange)
    : () => {}
);

export const isHustleRoomsOnline = () => getSyncState().online === true;

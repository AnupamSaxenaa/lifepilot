/**
 * Offline-first collaboration data layer.
 * Screens consume this module; raw Supabase access stays here.
 */
import NetInfo from '@react-native-community/netinfo';
import { cancelTaskReminder, scheduleTaskReminder } from '../utils/notifications';
import { Storage } from '../utils/storage';
import { loadLists, loadTasks } from './dataManager';
import { supabase } from './supabase';
import * as SyncQueue from './syncQueue';

const SCHEMA_FALLBACK_CODES = new Set(['42P01', '42703']);
const LOCAL_FIELDS = new Set(['_sync_status', '_deleted']);

export const COLLABORATION_TABLES = Object.freeze({
  spaces: 'spaces',
  members: 'space_members',
  tasks: 'tasks',
  lists: 'lists',
  comments: 'task_comments',
  activity: 'space_activity',
  inbox: 'inbox_notifications',
});

export const COLLABORATION_RPCS = Object.freeze({
  createSpace: 'create_space',
  linkList: 'link_list_to_space',
  inviteMember: 'create_space_invite',
  acceptInvite: 'accept_space_invite',
  revokeInvite: 'revoke_space_invite',
  changeRole: 'change_space_member_role',
  removeMember: 'remove_space_member',
  leaveSpace: 'leave_space',
  transferOwnership: 'transfer_space_ownership',
  archiveSpace: 'archive_space',
  mutateList: 'mutate_shared_list',
  createTask: 'mutate_shared_task',
  updateTask: 'mutate_shared_task',
  deleteTask: 'delete_shared_task',
  addComment: 'add_task_comment',
  editComment: 'edit_task_comment',
  deleteComment: 'delete_task_comment',
  memberDirectory: 'get_space_member_directory',
  spaceInvites: 'get_space_invites',
  markNotificationRead: 'mark_notification_read',
  markAllNotificationsRead: 'mark_all_notifications_read',
});

export const collaborationCacheKeys = (userId) => ({
  spaces: `collaboration_spaces_${userId}`,
  members: `collaboration_members_${userId}`,
  invites: `collaboration_invites_${userId}`,
  inbox: `collaboration_inbox_${userId}`,
  activity: `collaboration_activity_${userId}`,
  comments: `collaboration_comments_${userId}`,
  tasks: `tasks_${userId}`,
  lists: `lists_${userId}`,
});

const validUserId = (userId) => typeof userId === 'string' && userId.length > 0;
const sameId = (left, right) => left != null && right != null && String(left) === String(right);
export const idsEqual = sameId;

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
  const random = (Math.random() * 16) | 0;
  const value = char === 'x' ? random : (random & 0x3) | 0x8;
  return value.toString(16);
});

const isFallbackError = (error) => SCHEMA_FALLBACK_CODES.has(error?.code);
const isDeleted = (value) => Boolean(value?._deleted || value?.deleted_at);
const isServerDeleted = (value) => Boolean(value?.deleted_at);
const rows = (value) => (Array.isArray(value) ? value : []);
const visibleRows = (value) => rows(value).filter((item) => !isDeleted(item));
const mapCache = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const visibleMap = (value) => Object.entries(mapCache(value)).reduce((result, [key, items]) => {
  result[key] = visibleRows(items);
  return result;
}, {});
const groupById = (items, field) => visibleRows(items).reduce((groups, item) => {
  if (item?.[field] == null) return groups;
  const id = String(item[field]);
  groups[id] = [...rows(groups[id]), item];
  return groups;
}, {});

const stripSensitive = (value) => {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).reduce((safe, key) => {
    if (!/token/i.test(key)) safe[key] = stripSensitive(value[key]);
    return safe;
  }, {});
};

const stripLocalFields = (value = {}) => Object.keys(value).reduce((clean, key) => {
  if (!LOCAL_FIELDS.has(key)) clean[key] = value[key];
  return clean;
}, {});

const SHARED_LIST_PATCH_FIELDS = new Set(['name', 'order_index', 'icon']);
const sharedListPatch = (value = {}) => Object.keys(stripLocalFields(value)).reduce((patch, key) => {
  if (SHARED_LIST_PATCH_FIELDS.has(key)) patch[key] = value[key];
  return patch;
}, {});

const SHARED_TASK_PATCH_FIELDS = new Set([
  'title', 'is_completed', 'completed_at', 'is_important', 'due_date', 'reminder_time',
  'repeat_rule', 'quadrant', 'priority', 'added_to_today', 'order_index', 'list_id',
  'assigned_to', 'notes', 'subtasks',
]);
const sharedTaskPatch = (value = {}) => Object.keys(stripLocalFields(value)).reduce((patch, key) => {
  if (SHARED_TASK_PATCH_FIELDS.has(key)) patch[key] = value[key];
  return patch;
}, {});

const reminderMetadata = (task, userId) => ({
  userId,
  spaceId: task?.space_id ?? null,
  assignedTo: task?.assigned_to ?? null,
  createdBy: task?.created_by ?? task?.user_id ?? null,
});

const shouldScheduleSharedReminder = (task, userId) => (
  Boolean(task?.reminder_time)
  && !task?.is_completed
  && !isDeleted(task)
  && (
    sameId(task.assigned_to, userId)
    || (
      task.assigned_to == null
      && [task.created_by, task.user_id].some((actorId) => sameId(actorId, userId))
    )
  )
);

const syncSharedReminder = async (task, userId) => {
  const metadata = reminderMetadata(task, userId);
  if (shouldScheduleSharedReminder(task, userId)) {
    await scheduleTaskReminder(task.id, task.title, task.reminder_time, metadata).catch(() => {});
  } else if (task?.id != null) {
    await cancelTaskReminder(task.id, metadata).catch(() => {});
  }
};

const unwrapRpc = (result) => {
  if (result?.error) throw result.error;
  return result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
};

const runInBackground = (work) => {
  Promise.resolve().then(work).catch(() => {});
};

const readCache = async (key, fallback) => {
  const cached = await Storage.get(key);
  return cached == null ? fallback : cached;
};

const notifyFresh = (onFresh, value) => {
  if (typeof onFresh === 'function') onFresh(value);
};

const queryRows = async (table, configure = (query) => query, columns = '*') => {
  try {
    const response = await configure(supabase.from(table).select(columns));
    if (response.error) {
      return { ok: false, unavailable: isFallbackError(response.error), error: response.error, data: null };
    }
    return { ok: true, unavailable: false, error: null, data: visibleRows(response.data) };
  } catch (error) {
    return { ok: false, unavailable: isFallbackError(error), error, data: null };
  }
};

const queryRpcRows = async (name, params = {}) => {
  try {
    const response = await supabase.rpc(name, params);
    if (response.error) {
      return { ok: false, unavailable: isFallbackError(response.error), error: response.error, data: null };
    }
    return { ok: true, unavailable: false, error: null, data: visibleRows(response.data) };
  } catch (error) {
    return { ok: false, unavailable: isFallbackError(error), error, data: null };
  }
};

const queryOne = async (table, configure = (query) => query) => {
  try {
    const response = await configure(supabase.from(table).select('*')).maybeSingle();
    if (response.error) {
      return { ok: false, unavailable: isFallbackError(response.error), error: response.error, data: null };
    }
    return { ok: true, unavailable: false, error: null, data: response.data || null };
  } catch (error) {
    return { ok: false, unavailable: isFallbackError(error), error, data: null };
  }
};

const mergePreservingPending = (remote, local, pendingIds = null) => {
  const remoteById = new Map(visibleRows(remote).map((item) => [String(item.id), item]));
  for (const item of rows(local)) {
    const mutationId = item?.client_mutation_id == null ? null : String(item.client_mutation_id);
    const stillPending = pendingIds == null || (mutationId != null && pendingIds.has(mutationId));
    if (item?.id == null || item._sync_status !== 'pending' || !stillPending) continue;
    // Keep pending local tombstones in the cache so queued deletes remain
    // reconcilable; public filters hide them until the queue settles.
    remoteById.set(String(item.id), item);
  }
  return [...remoteById.values()];
};

const upsertById = (collection, row, eventType = 'UPDATE', pendingIds = null) => {
  const current = rows(collection);
  const id = row?.id;
  if (id == null) return current;
  const index = current.findIndex((item) => sameId(item.id, id));
  if (index >= 0) {
    const localMutationId = current[index]?.client_mutation_id;
    if (
      current[index]?._sync_status === 'pending'
      && (pendingIds == null || pendingIds.has(String(localMutationId)))
    ) return current;
  }
  if (eventType === 'DELETE' || isServerDeleted(row)) {
    return current.filter((item) => !sameId(item.id, id));
  }
  if (index < 0) return [row, ...current];
  const next = [...current];
  next[index] = { ...current[index], ...row, _sync_status: undefined };
  return next;
};

const requireOnline = async () => {
  const state = await NetInfo.fetch();
  if (state?.isConnected !== true || state?.isInternetReachable !== true) {
    const error = new Error('This collaboration action requires a verified internet connection.');
    error.code = 'OFFLINE';
    throw error;
  }
};

// Administrative RPCs intentionally bypass SyncQueue: permissions must be
// checked online, and invite secrets must never be serialized to storage.
const onlineRpc = async (name, params = {}) => {
  await requireOnline();
  return unwrapRpc(await supabase.rpc(name, params));
};

const queueRpc = async (name, params, options = null) => {
  if (typeof SyncQueue.enqueueRpc !== 'function') throw new Error('enqueueRpc is not available');
  const entryId = await SyncQueue.enqueueRpc(name, params, options);
  // The durable append is the only work callers wait for. Online delivery starts
  // immediately in the background; offline failures remain queued for reconnect.
  if (typeof SyncQueue.drainSyncQueue === 'function') {
    runInBackground(() => SyncQueue.drainSyncQueue());
  }
  return entryId;
};

export const getCollaborationSyncState = async () => ({
  pending: typeof SyncQueue.getPendingEntries === 'function' ? await SyncQueue.getPendingEntries() : [],
  conflicts: typeof SyncQueue.getConflicts === 'function' ? await SyncQueue.getConflicts() : [],
});

export const subscribeCollaborationSyncState = (listener) => (
  typeof SyncQueue.subscribeSyncState === 'function' ? SyncQueue.subscribeSyncState(listener) : () => {}
);

export const filterSpaces = (spaces, predicate = () => true) => visibleRows(spaces).filter(predicate);
export const filterMembersForSpace = (members, spaceId) => visibleRows(members)
  .filter((member) => sameId(member.space_id, spaceId));
export const filterListsForSpace = (lists, spaceId) => visibleRows(lists)
  .filter((list) => sameId(list.space_id, spaceId));
export const filterTasksForSpace = (tasks, spaceId, options = {}) => rows(tasks).filter((task) => (
  sameId(task.space_id, spaceId)
  && !isServerDeleted(task)
  && (options.includeDeleted || !task._deleted)
  && (options.includeCompleted || !task.is_completed)
));
export const filterCommentsForTask = (comments, taskId, options = {}) => rows(comments).filter((comment) => (
  sameId(comment.task_id, taskId)
  && !isServerDeleted(comment)
  && (options.includeDeleted || !comment._deleted)
));

export const refreshSpaces = async (userId) => {
  if (!validUserId(userId)) return { ok: false, data: [] };
  const keys = collaborationCacheKeys(userId);
  const previous = visibleRows(await Storage.get(keys.spaces));
  const response = await queryRows(COLLABORATION_TABLES.spaces);
  if (!response.ok) return { ...response, data: previous };

  const fresh = stripSensitive(response.data);
  await Storage.set(keys.spaces, fresh);
  const visible = new Set(fresh.map((space) => String(space.id)));
  const revoked = previous.filter((space) => space?.id != null && !visible.has(String(space.id)));
  for (const space of revoked) await purgeSpaceCache(userId, space.id);
  return { ...response, data: fresh, revokedSpaceIds: revoked.map((space) => space.id) };
};

export const loadSpaces = async (userId, onFresh) => {
  if (!validUserId(userId)) return [];
  const cached = visibleRows(await readCache(collaborationCacheKeys(userId).spaces, []));
  runInBackground(async () => {
    const fresh = await refreshSpaces(userId);
    if (fresh.ok) notifyFresh(onFresh, fresh.data);
  });
  return cached;
};

export const refreshInbox = async (userId) => {
  if (!validUserId(userId)) return { ok: false, data: [] };
  const key = collaborationCacheKeys(userId).inbox;
  const cached = rows(await Storage.get(key));
  const response = await queryRows(COLLABORATION_TABLES.inbox);
  if (!response.ok) return { ...response, data: visibleRows(cached) };
  const pendingIds = await getPendingClientMutationIds();
  const fresh = stripSensitive(mergePreservingPending(response.data, cached, pendingIds));
  await Storage.set(key, fresh);
  return { ...response, data: visibleRows(fresh) };
};

export const loadInbox = async (userId, onFresh) => {
  if (!validUserId(userId)) return [];
  const cached = visibleRows(await readCache(collaborationCacheKeys(userId).inbox, []));
  runInBackground(async () => {
    const fresh = await refreshInbox(userId);
    if (fresh.ok) notifyFresh(onFresh, fresh.data);
  });
  return cached;
};

export const refreshMemberDirectory = async (userId, spaceId) => {
  if (!validUserId(userId) || spaceId == null) return { ok: false, data: [] };
  const key = collaborationCacheKeys(userId).members;
  const id = String(spaceId);
  const cachedMap = mapCache(await readCache(key, {}));
  const response = await queryRpcRows(COLLABORATION_RPCS.memberDirectory, { p_space_id: spaceId });
  if (!response.ok) return { ...response, data: visibleRows(cachedMap[id]) };
  const fresh = visibleRows(stripSensitive(response.data));
  const latest = mapCache(await readCache(key, {}));
  latest[id] = fresh;
  await Storage.set(key, latest);
  return { ...response, data: fresh };
};

export const loadMemberDirectory = async (userId, spaceId, onFresh) => {
  if (!validUserId(userId) || spaceId == null) return [];
  const key = collaborationCacheKeys(userId).members;
  const id = String(spaceId);
  const cached = visibleRows(mapCache(await readCache(key, {}))[id]);
  runInBackground(async () => {
    const fresh = await refreshMemberDirectory(userId, spaceId);
    if (fresh.ok) notifyFresh(onFresh, fresh.data);
  });
  return cached;
};

export const refreshSpaceInvites = async (userId, spaceId) => {
  if (!validUserId(userId) || spaceId == null) return { ok: false, data: [] };
  const key = collaborationCacheKeys(userId).invites;
  const id = String(spaceId);
  const cachedMap = mapCache(await readCache(key, {}));
  const response = await queryRpcRows(COLLABORATION_RPCS.spaceInvites, { p_space_id: spaceId });
  if (!response.ok) return { ...response, data: visibleRows(cachedMap[id]) };
  const fresh = visibleRows(stripSensitive(response.data));
  const latest = mapCache(await readCache(key, {}));
  latest[id] = fresh;
  await Storage.set(key, latest);
  return { ...response, data: fresh };
};

export const loadSpaceInvites = async (userId, spaceId, onFresh) => {
  if (!validUserId(userId) || spaceId == null) return [];
  const key = collaborationCacheKeys(userId).invites;
  const id = String(spaceId);
  const cached = visibleRows(mapCache(await readCache(key, {}))[id]);
  runInBackground(async () => {
    const fresh = await refreshSpaceInvites(userId, spaceId);
    if (fresh.ok) notifyFresh(onFresh, fresh.data);
  });
  return cached;
};

export const refreshCollaboration = async (userId) => {
  if (!validUserId(userId)) return { authoritative: false };
  const keys = collaborationCacheKeys(userId);
  const cached = await Storage.getBatch([keys.members, keys.comments, keys.activity]);
  const cachedMembers = mapCache(cached[keys.members]);
  const spaces = await refreshSpaces(userId);
  const activeSpaces = visibleRows(spaces.data).filter((space) => !space?.archived_at);
  const activeSpaceIds = new Set(activeSpaces.map((space) => String(space.id)));

  const [inbox, workspace, commentsResult, activityResult, directoryResults] = await Promise.all([
    refreshInbox(userId),
    refreshVisibleWorkspace(userId),
    queryRows(COLLABORATION_TABLES.comments),
    queryRows(COLLABORATION_TABLES.activity),
    Promise.all(activeSpaces.map(async (space) => ({
      spaceId: String(space.id),
      response: await queryRpcRows(COLLABORATION_RPCS.memberDirectory, { p_space_id: space.id }),
    }))),
  ]);

  // Direct space_members SELECT is intentionally self-only under RLS. Always
  // hydrate complete directories through the safe RPC, preserving each cached
  // directory independently when offline or when one space refresh fails.
  const members = { ...cachedMembers };
  if (spaces.ok) {
    Object.keys(members).forEach((spaceId) => {
      if (!activeSpaceIds.has(String(spaceId))) delete members[spaceId];
    });
  }
  let memberMapChanged = Boolean(spaces.ok);
  directoryResults.forEach(({ spaceId, response }) => {
    if (!response.ok) return;
    members[spaceId] = visibleRows(stripSensitive(response.data));
    memberMapChanged = true;
  });

  const activity = activityResult.ok ? groupById(stripSensitive(activityResult.data), 'space_id') : mapCache(cached[keys.activity]);
  const remoteComments = commentsResult.ok ? groupById(stripSensitive(commentsResult.data), 'task_id') : null;
  const comments = remoteComments || mapCache(cached[keys.comments]);
  if (remoteComments) {
    const pendingIds = await getPendingClientMutationIds();
    const localComments = mapCache(cached[keys.comments]);
    Object.keys(localComments).forEach((taskId) => {
      comments[taskId] = mergePreservingPending(comments[taskId], localComments[taskId], pendingIds);
    });
  }
  const cacheUpdates = [];
  if (memberMapChanged) cacheUpdates.push([keys.members, members]);
  if (commentsResult.ok) cacheUpdates.push([keys.comments, comments]);
  if (activityResult.ok) cacheUpdates.push([keys.activity, activity]);
  if (cacheUpdates.length) await Storage.setBatch(cacheUpdates);
  const directoriesAuthoritative = directoryResults.every(({ response }) => response.ok);
  return {
    spaces: spaces.data,
    members: visibleMap(members),
    inbox: inbox.data,
    activity: visibleMap(activity),
    comments: visibleMap(comments),
    tasks: workspace.tasks,
    lists: workspace.lists,
    workspace,
    authoritative: spaces.ok && inbox.ok && workspace.authoritative
      && directoriesAuthoritative && commentsResult.ok && activityResult.ok,
  };
};

export const loadCollaboration = async (userId, onFresh, { refresh = true } = {}) => {
  if (!validUserId(userId)) return {
    spaces: [], members: {}, inbox: [], activity: {}, comments: {}, tasks: [], lists: [],
  };
  const keys = collaborationCacheKeys(userId);
  const cached = await Storage.getBatch(Object.values(keys));
  const initial = {
    spaces: visibleRows(cached[keys.spaces]),
    members: visibleMap(cached[keys.members]),
    inbox: visibleRows(cached[keys.inbox]),
    activity: visibleMap(cached[keys.activity]),
    comments: visibleMap(cached[keys.comments]),
    tasks: visibleRows(cached[keys.tasks]),
    lists: visibleRows(cached[keys.lists]),
  };
  if (refresh && (
    typeof SyncQueue.getSyncState !== 'function' || SyncQueue.getSyncState().online
  )) {
    runInBackground(async () => {
      const fresh = await refreshCollaboration(userId);
      if (fresh.authoritative) notifyFresh(onFresh, fresh);
    });
  }
  return initial;
};

export const refreshVisibleWorkspace = async (userId) => {
  if (!validUserId(userId)) return { tasks: [], lists: [], fallback: true };
  const keys = collaborationCacheKeys(userId);
  const [cachedTasks, cachedLists] = await Promise.all([
    readCache(keys.tasks, []),
    readCache(keys.lists, []),
  ]);
  const [taskResponse, listResponse] = await Promise.all([
    queryRows(COLLABORATION_TABLES.tasks, undefined, '*, space_id, collaboration_version'),
    queryRows(COLLABORATION_TABLES.lists, undefined, '*, space_id, collaboration_version'),
  ]);

  if (taskResponse.ok && listResponse.ok) {
    const pendingIds = await getPendingClientMutationIds();
    const tasks = mergePreservingPending(taskResponse.data, cachedTasks, pendingIds);
    const lists = mergePreservingPending(listResponse.data, cachedLists, pendingIds);
    await Storage.setBatch([[keys.tasks, tasks], [keys.lists, lists]]);

    // Realtime is not a replay log: after an offline period, the authoritative
    // refresh may be the first place this device sees a remote assignment,
    // completion, or deletion. Reconcile scoped reminders from the refreshed
    // cache, and explicitly cancel reminders for shared rows that disappeared.
    const visibleTaskIds = new Set(tasks.map((task) => String(task.id)));
    const removedSharedTasks = rows(cachedTasks)
      .filter((task) => task?.space_id != null && !visibleTaskIds.has(String(task.id)))
      .map((task) => ({ ...task, _deleted: true }));
    runInBackground(async () => {
      for (const task of [...tasks, ...removedSharedTasks]) {
        if (task?.space_id != null) await syncSharedReminder(task, userId);
      }
    });

    return {
      tasks: visibleRows(tasks),
      lists: visibleRows(lists),
      fallback: false,
      authoritative: true,
    };
  }

  if (taskResponse.unavailable || listResponse.unavailable) {
    // Legacy behavior deliberately retains its user_id filtering until the collaboration migration exists.
    const [tasks, lists] = await Promise.all([loadTasks(userId), loadLists(userId)]);
    return {
      tasks: visibleRows(tasks),
      lists: visibleRows(lists),
      fallback: true,
      authoritative: false,
    };
  }
  return {
    tasks: visibleRows(cachedTasks),
    lists: visibleRows(cachedLists),
    fallback: false,
    authoritative: false,
  };
};

export const loadSpaceDetail = async (userId, spaceId, onFresh) => {
  if (!validUserId(userId) || spaceId == null) return null;
  const keys = collaborationCacheKeys(userId);
  const cached = await Storage.getBatch([keys.spaces, keys.members, keys.tasks, keys.lists]);
  const id = String(spaceId);
  const detail = {
    space: visibleRows(cached[keys.spaces]).find((space) => sameId(space.id, id)) || null,
    members: visibleRows(rows(mapCache(cached[keys.members])[id])),
    tasks: filterTasksForSpace(cached[keys.tasks], id, { includeCompleted: true }),
    lists: filterListsForSpace(cached[keys.lists], id),
  };

  runInBackground(async () => {
    const [space, members, tasks, lists] = await Promise.all([
      queryOne(COLLABORATION_TABLES.spaces, (query) => query.eq('id', spaceId)),
      queryRpcRows(COLLABORATION_RPCS.memberDirectory, { p_space_id: spaceId }),
      queryRows(COLLABORATION_TABLES.tasks, (query) => query.eq('space_id', spaceId)),
      queryRows(COLLABORATION_TABLES.lists, (query) => query.eq('space_id', spaceId)),
    ]);
    if (![space, members, tasks, lists].every((result) => result.ok)) return;

    const allSpaces = upsertById(await readCache(keys.spaces, []), stripSensitive(space.data));
    const memberMap = mapCache(await readCache(keys.members, {}));
    memberMap[id] = stripSensitive(members.data);
    const latestTasks = rows(await readCache(keys.tasks, []));
    const latestLists = rows(await readCache(keys.lists, []));
    const pendingIds = await getPendingClientMutationIds();
    const allTasks = latestTasks.filter((task) => !sameId(task.space_id, id));
    const allLists = latestLists.filter((list) => !sameId(list.space_id, id));
    const cachedTasks = mergePreservingPending([...allTasks, ...tasks.data], latestTasks, pendingIds);
    const cachedLists = mergePreservingPending([...allLists, ...lists.data], latestLists, pendingIds);
    const fresh = {
      space: isServerDeleted(space.data) ? null : stripSensitive(space.data),
      members: visibleRows(stripSensitive(members.data)),
      tasks: filterTasksForSpace(cachedTasks, id, { includeCompleted: true }),
      lists: filterListsForSpace(cachedLists, id),
    };
    await Storage.setBatch([
      [keys.spaces, allSpaces], [keys.members, memberMap],
      [keys.tasks, cachedTasks], [keys.lists, cachedLists],
    ]);
    notifyFresh(onFresh, fresh);
  });
  return detail;
};

export const loadTaskComments = async (userId, taskId, onFresh) => {
  if (!validUserId(userId) || taskId == null) return [];
  const key = collaborationCacheKeys(userId).comments;
  const id = String(taskId);
  const cachedMap = mapCache(await readCache(key, {}));
  const cached = rows(cachedMap[id]);
  runInBackground(async () => {
    const response = await queryRows(COLLABORATION_TABLES.comments, (query) => query.eq('task_id', taskId));
    if (!response.ok) return;
    const latest = mapCache(await readCache(key, {}));
    const pendingIds = await getPendingClientMutationIds();
    latest[id] = mergePreservingPending(stripSensitive(response.data), latest[id], pendingIds);
    await Storage.set(key, latest);
    notifyFresh(onFresh, filterCommentsForTask(latest[id], taskId));
  });
  return filterCommentsForTask(cached, taskId);
};

export const loadSpaceActivity = async (userId, spaceId, onFresh) => {
  if (!validUserId(userId) || spaceId == null) return [];
  const key = collaborationCacheKeys(userId).activity;
  const id = String(spaceId);
  const cachedMap = mapCache(await readCache(key, {}));
  const cached = visibleRows(cachedMap[id]);
  runInBackground(async () => {
    const response = await queryRows(COLLABORATION_TABLES.activity, (query) => query.eq('space_id', spaceId));
    if (!response.ok) return;
    const latest = mapCache(await readCache(key, {}));
    latest[id] = stripSensitive(response.data);
    await Storage.set(key, latest);
    notifyFresh(onFresh, latest[id]);
  });
  return cached;
};

export const loadTaskById = async (userId, taskId, onFresh) => {
  if (!validUserId(userId) || taskId == null) return null;
  const key = collaborationCacheKeys(userId).tasks;
  const cachedTasks = rows(await readCache(key, []));
  const cached = cachedTasks.find((task) => sameId(task.id, taskId) && !isDeleted(task)) || null;
  runInBackground(async () => {
    const response = await queryOne(COLLABORATION_TABLES.tasks, (query) => query.eq('id', taskId));
    if (!response.ok) return;
    const latest = rows(await readCache(key, []));
    const local = latest.find((task) => sameId(task.id, taskId));
    if (local?._sync_status === 'pending') return;
    if (!response.data || isServerDeleted(response.data)) {
      await Storage.set(key, latest.filter((task) => !sameId(task.id, taskId)));
      notifyFresh(onFresh, null);
      return;
    }
    const updated = upsertById(latest, response.data);
    await Storage.set(key, updated);
    notifyFresh(onFresh, response.data);
  });
  return cached;
};

export const markNotificationRead = async (userId, notification) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  if (!notification?.id) throw new Error('A notification with an id is required');
  const key = collaborationCacheKeys(userId).inbox;
  const current = rows(await readCache(key, []));
  const existing = current.find((item) => sameId(item.id, notification.id)) || notification;
  if (existing.read_at) return existing;

  const mutationId = uuid();
  const expectedVersion = existing.version ?? 1;
  const updated = {
    ...existing,
    read_at: new Date().toISOString(),
    version: Number(expectedVersion) + 1,
    client_mutation_id: mutationId,
    _sync_status: 'pending',
  };
  const next = current.some((item) => sameId(item.id, existing.id))
    ? current.map((item) => (sameId(item.id, existing.id) ? updated : item))
    : [updated, ...current];
  await Storage.set(key, next);
  await queueRpc(COLLABORATION_RPCS.markNotificationRead, {
    p_notification_id: existing.id,
    p_expected_version: expectedVersion,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId: existing.space_id,
    entityId: existing.id,
    clientMutationId: mutationId,
  });
  return updated;
};

export const markAllNotificationsRead = async (userId) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const key = collaborationCacheKeys(userId).inbox;
  const current = rows(await readCache(key, []));
  const unread = current.filter((notification) => !notification.read_at);
  if (!unread.length) return visibleRows(current);

  const mutationId = uuid();
  const readAt = new Date().toISOString();
  const updated = current.map((notification) => (notification.read_at ? notification : {
    ...notification,
    read_at: readAt,
    version: Number(notification.version ?? 1) + 1,
    client_mutation_id: mutationId,
    _sync_status: 'pending',
  }));
  await Storage.set(key, updated);
  await queueRpc(COLLABORATION_RPCS.markAllNotificationsRead, {
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    clientMutationId: mutationId,
  });
  return visibleRows(updated);
};

export const resolveConflictDiscard = async (userId, conflictId, spaceId) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  if (conflictId == null) throw new Error('A conflictId is required');
  if (spaceId == null) throw new Error('A spaceId is required');
  if (typeof SyncQueue.clearConflict !== 'function') throw new Error('clearConflict is not available');

  const cleared = await SyncQueue.clearConflict(conflictId);
  const fresh = await refreshCollaboration(userId);
  const directory = await refreshMemberDirectory(userId, spaceId);
  return {
    ...fresh,
    members: {
      ...mapCache(fresh.members),
      [String(spaceId)]: directory.data,
    },
    conflictCleared: cleared,
    authoritative: Boolean(fresh.authoritative && directory.ok),
  };
};

const updateSpaceInviteCache = async (userId, spaceId, updater) => {
  if (!validUserId(userId) || spaceId == null || typeof updater !== 'function') return [];
  const key = collaborationCacheKeys(userId).invites;
  const id = String(spaceId);
  const latest = mapCache(await readCache(key, {}));
  const next = visibleRows(stripSensitive(updater(visibleRows(latest[id]))));
  latest[id] = next;
  await Storage.set(key, stripSensitive(latest));
  return next;
};

// Membership and invitation administration is intentionally online-only. Invite tokens
// are passed directly to the RPC and are never persisted, emitted, or logged.
export const createSpace = async (name) => onlineRpc(COLLABORATION_RPCS.createSpace, {
  p_name: name,
  p_client_mutation_id: uuid(),
});
export const linkListToSpace = async (spaceId, listId, expectedVersion = 1) => onlineRpc(COLLABORATION_RPCS.linkList, {
  p_space_id: spaceId,
  p_list_id: listId,
  p_expected_version: expectedVersion,
  p_client_mutation_id: uuid(),
});
export const inviteSpaceMember = async (spaceId, invitee, role = 'editor', options = {}) => {
  const target = invitee && typeof invitee === 'object'
    ? invitee
    : String(invitee || '').startsWith('@')
      ? { username: String(invitee).slice(1) }
      : { email: invitee };
  const expiresAt = options.expiresAt || target.expiresAt || new Date(Date.now() + 7 * 86400000).toISOString();
  const result = await onlineRpc(COLLABORATION_RPCS.inviteMember, {
    p_space_id: spaceId,
    p_role: role,
    p_expires_at: expiresAt,
    p_client_mutation_id: uuid(),
    p_invitee_email: target.email || null,
    p_invitee_username: target.username || null,
    p_invited_user_id: target.userId || target.user_id || null,
  });
  if (validUserId(options.userId) && result?.invite_id != null) {
    const safeInvite = {
      id: result.invite_id,
      space_id: result.space_id || spaceId,
      invitee_email: target.email || null,
      invited_user_id: target.userId || target.user_id || null,
      username: target.username || null,
      role: result.role || role,
      status: 'pending',
      expires_at: result.expires_at || expiresAt,
      version: result.version || 1,
      created_at: new Date().toISOString(),
    };
    await updateSpaceInviteCache(options.userId, spaceId, (current) => [
      safeInvite,
      ...current.filter((invite) => !sameId(invite.id, safeInvite.id)),
    ]).catch(() => {});
  }
  return result;
};
export const acceptSpaceInvite = async (rawInviteToken, expectedVersion = 1) => onlineRpc(COLLABORATION_RPCS.acceptInvite, {
  p_token: rawInviteToken,
  p_expected_version: expectedVersion,
  p_client_mutation_id: uuid(),
});
export const revokeSpaceInvite = async (inviteId, expectedVersion = 1, options = {}) => {
  const result = await onlineRpc(COLLABORATION_RPCS.revokeInvite, {
    p_invite_id: inviteId,
    p_expected_version: expectedVersion,
    p_client_mutation_id: uuid(),
  });
  if (validUserId(options.userId) && options.spaceId != null) {
    await updateSpaceInviteCache(options.userId, options.spaceId, (current) => (
      current.filter((invite) => !sameId(invite.id, inviteId))
    )).catch(() => {});
  }
  return result;
};
export const changeSpaceMemberRole = async (spaceId, memberId, role, expectedVersion = 1) => onlineRpc(COLLABORATION_RPCS.changeRole, {
  p_space_id: spaceId,
  p_member_id: memberId,
  p_role: role,
  p_expected_version: expectedVersion,
  p_client_mutation_id: uuid(),
});
export const removeSpaceMember = async (spaceId, memberId, expectedVersion = 1) => onlineRpc(COLLABORATION_RPCS.removeMember, {
  p_space_id: spaceId,
  p_member_id: memberId,
  p_expected_version: expectedVersion,
  p_client_mutation_id: uuid(),
});
export const leaveSpace = async (spaceId, expectedVersion = 1) => onlineRpc(COLLABORATION_RPCS.leaveSpace, {
  p_space_id: spaceId,
  p_expected_version: expectedVersion,
  p_client_mutation_id: uuid(),
});
export const transferSpaceOwnership = async (
  spaceId,
  memberId,
  expectedSpaceVersion = 1,
  expectedMemberVersion = 1,
) => onlineRpc(COLLABORATION_RPCS.transferOwnership, {
  p_space_id: spaceId,
  p_new_owner_id: memberId,
  p_expected_space_version: expectedSpaceVersion,
  p_expected_member_version: expectedMemberVersion,
  p_client_mutation_id: uuid(),
});
export const archiveSpace = async (spaceId, expectedVersion = 1) => onlineRpc(
  COLLABORATION_RPCS.archiveSpace,
  {
    p_space_id: spaceId,
    p_expected_version: expectedVersion,
    p_client_mutation_id: uuid(),
  },
);

// Concise aliases are useful to non-UI consumers while retaining explicit public names.
export const linkSpace = linkListToSpace;
export const inviteMember = inviteSpaceMember;
export const createSpaceMember = inviteSpaceMember;
export const acceptInvite = acceptSpaceInvite;
export const revokeInvite = revokeSpaceInvite;
export const changeRole = changeSpaceMemberRole;
export const removeMember = removeSpaceMember;
export const transferOwnership = transferSpaceOwnership;

export const createSharedList = async (userId, spaceOrListData, maybeListData) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const listData = maybeListData || spaceOrListData || {};
  const spaceId = maybeListData ? spaceOrListData : listData.space_id;
  const key = collaborationCacheKeys(userId).lists;
  const current = rows(await readCache(key, []));
  const mutationId = uuid();
  const now = new Date().toISOString();
  const list = {
    id: listData.id || uuid(),
    user_id: listData.user_id || userId,
    space_id: spaceId,
    collaboration_version: 1,
    created_at: now,
    updated_at: now,
    ...listData,
    created_by: listData.created_by || userId,
    updated_by: userId,
    client_mutation_id: mutationId,
    _sync_status: 'pending',
  };
  await Storage.set(key, [list, ...current.filter((item) => !sameId(item.id, list.id))]);
  await queueRpc(COLLABORATION_RPCS.mutateList, {
    p_space_id: list.space_id,
    p_list_id: list.id,
    p_patch: sharedListPatch(list),
    p_expected_version: 0,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId: list.space_id,
    entityId: list.id,
    clientMutationId: mutationId,
  });
  return list;
};

export const updateSharedList = async (userId, listId, fields, expectedVersion) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const key = collaborationCacheKeys(userId).lists;
  const current = rows(await readCache(key, []));
  const existing = current.find((list) => sameId(list.id, listId));
  if (!existing || isDeleted(existing)) return null;
  const mutationId = uuid();
  const version = expectedVersion ?? existing.collaboration_version ?? 1;
  const updated = {
    ...existing,
    ...fields,
    collaboration_version: Number(version) + 1,
    created_by: existing.created_by || existing.user_id || userId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
    client_mutation_id: mutationId,
    _sync_status: 'pending',
  };
  await Storage.set(key, current.map((list) => (sameId(list.id, listId) ? updated : list)));
  await queueRpc(COLLABORATION_RPCS.mutateList, {
    p_space_id: existing.space_id,
    p_list_id: listId,
    p_patch: sharedListPatch(fields),
    p_expected_version: version,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId: existing.space_id,
    entityId: listId,
    clientMutationId: mutationId,
  });
  return updated;
};

export const createSharedTask = async (userId, taskData) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const key = collaborationCacheKeys(userId).tasks;
  const current = rows(await readCache(key, []));
  const mutationId = uuid();
  const now = new Date().toISOString();
  const task = {
    id: taskData.id || uuid(),
    user_id: taskData.user_id || userId,
    is_completed: false,
    created_at: now,
    updated_at: now,
    collaboration_version: 1,
    ...taskData,
    created_by: taskData.created_by || userId,
    updated_by: userId,
    client_mutation_id: mutationId,
    _sync_status: 'pending',
  };
  await Storage.set(key, [task, ...current.filter((item) => !sameId(item.id, task.id))]);
  await syncSharedReminder(task, userId);
  await queueRpc(COLLABORATION_RPCS.createTask, {
    p_space_id: task.space_id,
    p_task_id: task.id,
    p_list_id: task.list_id,
    p_patch: sharedTaskPatch(task),
    p_expected_version: 0,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId: task.space_id,
    entityId: task.id,
    clientMutationId: mutationId,
  });
  return task;
};

export const updateSharedTask = async (userId, taskId, fields, expectedVersion) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const key = collaborationCacheKeys(userId).tasks;
  const current = rows(await readCache(key, []));
  const existing = current.find((task) => sameId(task.id, taskId));
  if (!existing) return null;
  const mutationId = uuid();
  const version = expectedVersion ?? existing.collaboration_version ?? 1;
  const updatedTask = {
    ...existing,
    ...fields,
    collaboration_version: Number(version) + 1,
    created_by: existing.created_by || existing.user_id || userId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
    client_mutation_id: mutationId,
    _sync_status: 'pending',
  };
  await Storage.set(key, current.map((task) => (sameId(task.id, taskId) ? updatedTask : task)));
  await syncSharedReminder(updatedTask, userId);
  await queueRpc(COLLABORATION_RPCS.updateTask, {
    p_space_id: existing.space_id,
    p_task_id: taskId,
    p_list_id: fields.list_id ?? existing.list_id,
    p_patch: sharedTaskPatch(fields),
    p_expected_version: version,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId: existing.space_id,
    entityId: taskId,
    clientMutationId: mutationId,
  });
  return updatedTask;
};

export const deleteSharedTask = async (userId, taskId, expectedVersion) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const key = collaborationCacheKeys(userId).tasks;
  const current = rows(await readCache(key, []));
  const existing = current.find((task) => sameId(task.id, taskId));
  if (!existing) return null;
  const mutationId = uuid();
  const version = expectedVersion ?? existing.collaboration_version ?? 1;
  const tombstone = {
    ...existing,
    _deleted: true,
    _sync_status: 'pending',
    client_mutation_id: mutationId,
    created_by: existing.created_by || existing.user_id || userId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  await Storage.set(key, current.map((task) => (sameId(task.id, taskId) ? tombstone : task)));
  await cancelTaskReminder(existing.id, reminderMetadata(existing, userId)).catch(() => {});
  await queueRpc(COLLABORATION_RPCS.deleteTask, {
    p_task_id: taskId,
    p_expected_version: version,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId: existing.space_id,
    entityId: taskId,
    clientMutationId: mutationId,
  });
  return tombstone;
};

const commentSpaceId = async (userId, taskId, existingComment = null) => {
  if (existingComment?.space_id != null) return existingComment.space_id;
  const tasks = rows(await readCache(collaborationCacheKeys(userId).tasks, []));
  return tasks.find((task) => sameId(task.id, taskId))?.space_id ?? null;
};

export const addTaskComment = async (userId, taskId, body) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const cleanBody = String(body || '').trim();
  if (!cleanBody) throw new Error('Comment text is required');
  const key = collaborationCacheKeys(userId).comments;
  const comments = mapCache(await readCache(key, {}));
  const id = String(taskId);
  const mutationId = uuid();
  const spaceId = await commentSpaceId(userId, taskId);
  const comment = {
    id: uuid(),
    space_id: spaceId,
    task_id: taskId,
    author_id: userId,
    body: cleanBody,
    version: 1,
    created_at: new Date().toISOString(),
    created_by: userId,
    updated_by: userId,
    client_mutation_id: mutationId,
    _sync_status: 'pending',
  };
  comments[id] = [comment, ...rows(comments[id])];
  await Storage.set(key, comments);
  await queueRpc(COLLABORATION_RPCS.addComment, {
    p_comment_id: comment.id,
    p_task_id: taskId,
    p_body: cleanBody,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId,
    entityId: comment.id,
    clientMutationId: mutationId,
  });
  return comment;
};

export const editTaskComment = async (userId, taskId, commentId, body, expectedVersion) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const cleanBody = String(body || '').trim();
  if (!cleanBody) throw new Error('Comment text is required');
  const key = collaborationCacheKeys(userId).comments;
  const comments = mapCache(await readCache(key, {}));
  const id = String(taskId);
  const existing = rows(comments[id]).find((comment) => sameId(comment.id, commentId));
  if (!existing) return null;
  const mutationId = uuid();
  const version = expectedVersion ?? existing.version ?? 1;
  const spaceId = await commentSpaceId(userId, taskId, existing);
  const updated = {
    ...existing,
    space_id: spaceId,
    body: cleanBody,
    version: Number(version) + 1,
    created_by: existing.created_by || existing.author_id || userId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
    client_mutation_id: mutationId,
    _sync_status: 'pending',
  };
  comments[id] = rows(comments[id]).map((comment) => (sameId(comment.id, commentId) ? updated : comment));
  await Storage.set(key, comments);
  await queueRpc(COLLABORATION_RPCS.editComment, {
    p_comment_id: commentId,
    p_body: cleanBody,
    p_expected_version: version,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId,
    entityId: commentId,
    clientMutationId: mutationId,
  });
  return updated;
};

export const deleteTaskComment = async (userId, taskId, commentId, expectedVersion) => {
  if (!validUserId(userId)) throw new Error('A valid userId is required');
  const key = collaborationCacheKeys(userId).comments;
  const comments = mapCache(await readCache(key, {}));
  const id = String(taskId);
  const existing = rows(comments[id]).find((comment) => sameId(comment.id, commentId));
  if (!existing) return null;
  const mutationId = uuid();
  const version = expectedVersion ?? existing.version ?? 1;
  const spaceId = await commentSpaceId(userId, taskId, existing);
  const tombstone = {
    ...existing,
    space_id: spaceId,
    _deleted: true,
    _sync_status: 'pending',
    created_by: existing.created_by || existing.author_id || userId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
    client_mutation_id: mutationId,
  };
  comments[id] = rows(comments[id]).map((comment) => (sameId(comment.id, commentId) ? tombstone : comment));
  await Storage.set(key, comments);
  await queueRpc(COLLABORATION_RPCS.deleteComment, {
    p_comment_id: commentId,
    p_expected_version: version,
    p_client_mutation_id: mutationId,
  }, {
    actorUserId: userId,
    spaceId,
    entityId: commentId,
    clientMutationId: mutationId,
  });
  return tombstone;
};

export const purgeSpaceCache = async (userId, spaceId) => {
  if (!validUserId(userId) || spaceId == null) return;
  const keys = collaborationCacheKeys(userId);
  const cached = await Storage.getBatch(Object.values(keys));
  const removedTasks = rows(cached[keys.tasks]).filter((task) => sameId(task.space_id, spaceId));
  const removedTaskIds = new Set(removedTasks.map((task) => String(task.id)));
  const members = mapCache(cached[keys.members]);
  const invites = mapCache(cached[keys.invites]);
  const activity = mapCache(cached[keys.activity]);
  const comments = mapCache(cached[keys.comments]);
  delete members[String(spaceId)];
  delete invites[String(spaceId)];
  delete activity[String(spaceId)];
  for (const taskId of removedTaskIds) delete comments[taskId];
  for (const task of removedTasks) {
    await cancelTaskReminder(task.id, reminderMetadata(task, userId)).catch(() => {});
  }
  await Storage.setBatch([
    [keys.spaces, rows(cached[keys.spaces]).filter((space) => !sameId(space.id, spaceId))],
    [keys.members, members],
    [keys.invites, invites],
    [keys.inbox, rows(cached[keys.inbox]).filter((item) => !sameId(item.space_id, spaceId))],
    [keys.activity, activity],
    [keys.comments, comments],
    [keys.tasks, rows(cached[keys.tasks]).filter((task) => !sameId(task.space_id, spaceId))],
    [keys.lists, rows(cached[keys.lists]).filter((list) => !sameId(list.space_id, spaceId))],
  ]);
};

const pendingMutationIds = (entries) => {
  const ids = new Set();
  const visit = (value, key = '') => {
    if (value == null) return;
    if (typeof value === 'object') {
      Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
    } else if (/client_mutation_id/i.test(key)) ids.add(String(value));
  };
  visit(entries);
  return ids;
};

export const getPendingClientMutationIds = async () => {
  if (typeof SyncQueue.getPendingEntries !== 'function') return new Set();
  return pendingMutationIds(await SyncQueue.getPendingEntries());
};

/** Patch only payloads that are safe to apply without an authoritative join/query. */
export const patchCollaborationCache = async (userId, table, eventType, rawRow, pendingIds = new Set()) => {
  if (!validUserId(userId) || !rawRow) return { patched: false };
  const row = stripSensitive(rawRow);
  if (row.client_mutation_id != null && pendingIds.has(String(row.client_mutation_id))) {
    return { patched: false, deduped: true };
  }
  const keys = collaborationCacheKeys(userId);
  const normalizedEvent = String(eventType || 'UPDATE').toUpperCase();
  const rowDeleted = normalizedEvent === 'DELETE' || isServerDeleted(row);

  if (table === COLLABORATION_TABLES.tasks || table === COLLABORATION_TABLES.lists) {
    const key = table === COLLABORATION_TABLES.tasks ? keys.tasks : keys.lists;
    const updated = upsertById(await readCache(key, []), row, normalizedEvent, pendingIds);
    await Storage.set(key, updated);
    if (table === COLLABORATION_TABLES.tasks) {
      runInBackground(() => syncSharedReminder(
        rowDeleted ? { ...row, _deleted: true } : row,
        userId,
      ));
    }
    return { patched: true };
  }
  if (table === COLLABORATION_TABLES.spaces || table === COLLABORATION_TABLES.inbox) {
    const key = table === COLLABORATION_TABLES.spaces ? keys.spaces : keys.inbox;
    const updated = upsertById(await readCache(key, []), row, normalizedEvent, pendingIds);
    await Storage.set(key, updated);
    return {
      patched: true,
      purgeSpaceId: table === COLLABORATION_TABLES.spaces && rowDeleted ? row.id : null,
    };
  }
  if (table === COLLABORATION_TABLES.members) {
    if (row.space_id == null) return { patched: false };
    const memberMap = mapCache(await readCache(keys.members, {}));
    const id = String(row.space_id);
    memberMap[id] = upsertById(memberMap[id], row, normalizedEvent, pendingIds);
    await Storage.set(keys.members, memberMap);
    const revoked = rowDeleted && sameId(row.user_id, userId);
    return { patched: true, purgeSpaceId: revoked ? row.space_id : null };
  }
  if (table === COLLABORATION_TABLES.comments) {
    if (row.task_id == null) return { patched: false };
    const commentMap = mapCache(await readCache(keys.comments, {}));
    const id = String(row.task_id);
    commentMap[id] = upsertById(commentMap[id], row, normalizedEvent, pendingIds);
    await Storage.set(keys.comments, commentMap);
    return { patched: true };
  }
  if (table === COLLABORATION_TABLES.activity) {
    if (row.space_id == null) return { patched: false };
    const activityMap = mapCache(await readCache(keys.activity, {}));
    const id = String(row.space_id);
    activityMap[id] = upsertById(activityMap[id], row, normalizedEvent, pendingIds);
    await Storage.set(keys.activity, activityMap);
    return { patched: true };
  }
  return { patched: false };
};

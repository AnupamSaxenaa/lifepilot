/**
 * LifePilot — Data Manager
 * 
 * Single source of truth for all data operations in the app.
 * Implements the offline-first pattern used by Microsoft To Do / Google Tasks:
 * 
 * READ:  Local cache (instant) → Supabase fetch (background) → update cache
 * WRITE: Update local state → save to cache → sync to Supabase (via SyncQueue)
 * 
 * Every screen should use this instead of calling Supabase directly.
 */
import { supabase } from '../lib/supabase';
import { recordFocusSession } from '../utils/focusSessions';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';
import { updateAllWidgets } from '../utils/widgetUpdater';
import { DEFAULT_CREDIT_FLOOR, normalizeAdStatus, normalizeBalance } from './creditRules';
import { startPresence, stopPresence } from './presenceManager';
import {
    drainSyncQueue,
    enqueueMutation,
    getPendingEntries,
    getQueueLength,
    getSyncState,
    syncToSupabase
} from './syncQueue';

const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const rows = (value) => (Array.isArray(value) ? value : []);
const isDeleted = (row) => Boolean(row?._deleted || row?.deleted_at);
const visibleRows = (value) => rows(value).filter((row) => !isDeleted(row));
const hasSpace = (row) => row?.space_id != null;
const loadCollaborationManager = () => import('./collaborationManager');
const taskRefreshes = new Map();
const listRefreshes = new Map();
const profileRefreshes = new Map();
const canAttemptBackgroundRefresh = () => {
  const state = getSyncState();
  return state.online || !state.connectivityKnown;
};

const RPC_TABLES = Object.freeze({
  mutate_shared_list: 'lists',
  mutate_shared_task: 'tasks',
  delete_shared_task: 'tasks',
});

const entityKey = (id) => (id == null ? null : String(id));

const pendingEntityId = (entry) => (
  entry?.entityId
  ?? entry?.data?.id
  ?? entry?.args?.p_task_id
  ?? entry?.args?.p_list_id
  ?? entry?.filter?.value
  ?? null
);

const pendingClientMutationId = (entry) => (
  entry?.clientMutationId
  ?? entry?.data?.client_mutation_id
  ?? entry?.args?.p_client_mutation_id
  ?? null
);

const entryTargetsTable = (entry, table) => (
  entry?.table === table || RPC_TABLES[entry?.rpc] === table
);

const entryBelongsToActor = (entry, userId) => (
  entry?.actorUserId == null || sameId(entry.actorUserId, userId)
);

const entryDeletesEntity = (entry) => (
  entry?.operation === 'delete' || entry?.rpc === 'delete_shared_task'
);

const getPendingTableEntries = async (userId, table) => (
  (await getPendingEntries())
    .filter((entry) => entryBelongsToActor(entry, userId) && entryTargetsTable(entry, table))
);

const entryMatchesRow = (entry, row) => {
  const rowId = entityKey(row?.id);
  const rowMutationId = entityKey(row?.client_mutation_id);
  const entryId = entityKey(pendingEntityId(entry));
  const entryMutationId = entityKey(pendingClientMutationId(entry));
  return Boolean(
    (rowId != null && entryId != null && rowId === entryId)
    || (rowMutationId != null && entryMutationId != null && rowMutationId === entryMutationId),
  );
};

/** Merge visible server rows while retaining only locally pending entities. */
const mergeServerWithPending = async (userId, table, serverRows, mergeRemote = (remote) => remote) => {
  const localRows = rows(await Storage.get(`${table}_${userId}`));
  const pendingEntries = await getPendingTableEntries(userId, table);
  const mergedById = new Map();

  for (const remote of rows(serverRows)) {
    const id = entityKey(remote?.id);
    if (id == null || remote.deleted_at) continue;
    const local = localRows.find((item) => sameId(item?.id, remote.id));
    mergedById.set(id, mergeRemote(remote, local));
  }

  // Keep server rows hidden while their local delete is still queued, even
  // when personal deletes have no cached tombstone.
  for (const entry of pendingEntries) {
    const id = entityKey(pendingEntityId(entry));
    if (id != null && entryDeletesEntity(entry)) mergedById.delete(id);
  }

  // Pending optimistic rows and tombstones win entity-by-entity. Matching by
  // client mutation also covers queued RPCs whose entity metadata is absent.
  for (const local of localRows) {
    const id = entityKey(local?.id);
    if (id != null && pendingEntries.some((entry) => entryMatchesRow(entry, local))) {
      mergedById.set(id, local);
    }
  }

  return [...mergedById.values()];
};

const mergeTaskRemoteFields = (remote, local) => ({
  ...remote,
  priority: remote.priority ?? local?.priority ?? 1,
  subtasks: remote.subtasks ?? local?.subtasks,
  notes: remote.notes ?? local?.notes,
});

// RFC4122 v4 compliant UUID generator for offline-first primary keys
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const performInitialSync = async (userId) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in performInitialSync:', userId);
    return;
  }
  if (!getSyncState().online) return;
  
  try {
    // 1. Fetch Profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (profile) await Storage.set(`profile_${userId}`, profile);

    // 2. Fetch every task visible through RLS (personal plus shared on 0016+).
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (!tasksError && tasks) {
      const mergedTasks = await mergeServerWithPending(
        userId,
        'tasks',
        tasks,
        mergeTaskRemoteFields,
      );
      await Storage.set(`tasks_${userId}`, mergedTasks);
      await updateAllWidgets();
    }

    // 3. Fetch every list visible through RLS. On databases before the
    // collaboration migration, owner-only RLS naturally yields personal rows.
    const { data: lists, error: listsError, serverOrdered } = await fetchListsFromServer();
    if (!listsError && lists) {
      const mergedLists = await mergeServerWithPending(userId, 'lists', lists);
      const orderedLists = serverOrdered && mergedLists.some((list) => list.order_index != null)
        ? [...mergedLists].sort((left, right) => (
            (left.order_index ?? Number.MAX_SAFE_INTEGER)
            - (right.order_index ?? Number.MAX_SAFE_INTEGER)
          ))
        : await applySavedListOrder(userId, mergedLists);
      await Storage.set(`lists_${userId}`, orderedLists);
      await Storage.set(LIST_ORDER_KEY(userId), orderedLists.map((list) => entityKey(list.id)));
    }

    // 4. Fetch Mindful Lock data (profile settings + schedules + locked apps).
    // Only fills in local cache if it's empty — never overwrites existing local
    // data, since local writes are always pushed to the cloud independently.
    try {
      const { hydrateMindfulLockFromCloud } = require('../utils/mindfulLock');
      await hydrateMindfulLockFromCloud(userId);
    } catch (e) {
      console.log('[DataManager] Mindful Lock hydration failed:', e.message);
    }

    // Credit any Shards owed for the user's current level (idempotent server-side).
    try {
      const { claimStoneShards } = require('./marketplace');
      await claimStoneShards(userId);
    } catch (e) {
      console.log('[DataManager] Shard claim failed:', e.message);
    }

    // Reconcile the native app-icon (activity-alias) state against the DB's
    // `equipped_icon` and current cosmetic ownership. Covers cases where the
    // native alias drifted from the DB (e.g. app reinstalled/updated) or where
    // ownership was revoked after the icon was equipped.
    try {
      const { reconcileAppIcon } = require('./marketplace');
      await reconcileAppIcon(userId, profile);
    } catch (e) {
      console.log('[DataManager] App icon reconciliation failed:', e.message);
    }

    await Storage.set(`initial_sync_done_${userId}`, true);
  } catch (e) {
    console.log('[DataManager] Initial sync failed:', e.message);
  }
};

// ─── Tasks ──────────────────────────────────────────────

/**
 * Load tasks: cache first (instant), then Supabase (background update).
 * Returns cached tasks immediately. Calls onFresh(tasks) when Supabase data arrives.
 * 
 * @param {string} userId
 * @param {function} onFresh - Called with fresh tasks from Supabase (may be null if offline)
 * @returns {Array} - Cached tasks (may be empty on first launch)
 */
// ── Synchronous warm caches ─────────────────────────────────
// AsyncStorage is async and JSON.parse of a large task array is not free, so a
// warm navigation previously painted an empty frame (or a skeleton/spinner)
// before the first setState landed. Screens can now seed their initial state
// from these maps and render real content on the FIRST frame.
const memTasks = new Map();
const memLists = new Map();
let memUserId = null;

/** Last known tasks for a user, or null. Synchronous — safe in useState(). */
export const getTasksSync = (userId) => (userId ? memTasks.get(userId) || null : null);
/** Last known lists for a user, or null. Synchronous. */
export const getListsSync = (userId) => (userId ? memLists.get(userId) || null : null);
/** Resolved user id from this session, or null. Synchronous. */
export const getCurrentUserIdSync = () => memUserId;

export const loadTasks = async (userId, onFresh, { refresh = true } = {}) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadTasks:', userId);
    return [];
  }

  const cached = await Storage.get(`tasks_${userId}`);
  if (Array.isArray(cached)) memTasks.set(userId, visibleRows(cached));

  if (refresh) {
    let inFlight = taskRefreshes.get(userId);
    if (!inFlight) {
      inFlight = (async () => {
        try {
          await drainSyncQueue();
          if (!canAttemptBackgroundRefresh()) return null;
          const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });

          if (!error && data) {
            const merged = await mergeServerWithPending(
              userId,
              'tasks',
              data,
              mergeTaskRemoteFields,
            );
            await cacheTasks(userId, merged);
            return visibleRows(merged);
          }
        } catch (err) {
          console.log('[DataManager] Background fetch error:', err);
        }
        return null;
      })().finally(() => taskRefreshes.delete(userId));
      taskRefreshes.set(userId, inFlight);
    }
    inFlight.then((fresh) => {
      // A failed background refresh is a no-op. It must never erase cache that
      // has already painted successfully.
      if (fresh !== null && onFresh) onFresh(fresh);
    }).catch(() => {});
  }

  return visibleRows(cached);
};

/** Resolve one task cache-first through the collaboration-aware loader. */
export const resolveTaskById = async (userId, taskId, onFresh) => {
  if (!userId || typeof userId !== 'string' || taskId == null) {
    console.error('[DataManager] Invalid resolveTaskById input:', userId, taskId);
    return null;
  }

  const { loadTaskById } = await loadCollaborationManager();
  return loadTaskById(userId, entityKey(taskId), onFresh);
};

/**
 * Save tasks to local cache only (called after optimistic UI updates).
 */
export const cacheTasks = async (userId, tasks) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in cacheTasks:', userId);
    return;
  }
  // Keep the synchronous mirror in step with every write, so the next
  // navigation paints current data rather than a stale or empty frame.
  if (Array.isArray(tasks)) memTasks.set(userId, rows(tasks));

  const existing = rows(await Storage.get(`tasks_${userId}`));
  const pendingTaskEntries = await getPendingTableEntries(userId, 'tasks');
  const cachedById = new Map(
    rows(tasks)
      .filter((task) => task?.id != null)
      .map((task) => [entityKey(task.id), task]),
  );
  for (const task of existing) {
    if (
      task?._deleted
      && task.id != null
      && pendingTaskEntries.some((entry) => entryMatchesRow(entry, task))
    ) {
      cachedById.set(entityKey(task.id), task);
    }
  }

  // One batched write instead of two sequential round-trips. Every task
  // mutation funnels through here, so this is the hottest write path in the app.
  await Storage.setBatch([
    [`tasks_${userId}`, [...cachedById.values()]],
    ['last_local_write_time', Date.now().toString()],
  ]);

  // Fire-and-forget, deliberately NOT awaited.
  //
  // This previously awaited, which put a full render of BOTH home-screen widgets
  // plus two native requestWidgetUpdate calls directly in front of the user on
  // every single task toggle, add, delete and edit — because all of them route
  // through cacheTasks. The widget is a passive mirror on another surface; nobody
  // is waiting on it to finish before their checkbox may tick.
  //
  // Not awaiting is safe here: requestWidgetUpdate does not need its caller to
  // stay alive to deliver, and updateAllWidgets already wraps every widget in
  // allSettled + try/catch so a failure cannot surface as an unhandled rejection.
  updateAllWidgets().catch(() => {});
};

/**
 * Add a new task: optimistic local + sync to Supabase.
 * Returns the new task list with the temp task included.
 * When Supabase succeeds, the temp ID is replaced with the real one.
 * 
 * @param {string} userId
 * @param {Array} currentTasks - Current task list
 * @param {object} taskData - { title, due_date, reminder_time, repeat_rule, ... }
 * @param {function} onSynced - Called with updated tasks after Supabase confirms
 * @returns {Array} - Updated task list with temp task
 */
export const addTask = async (userId, currentTasks, taskData, onSynced) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in addTask:', userId);
    return currentTasks;
  }
  
  const currentMinIndex = currentTasks.length > 0
    ? Math.min(...currentTasks.map(t => t.order_index || 0))
    : 0;

  const clientUuid = generateUUID();
  const tempTask = {
    id: clientUuid,
    user_id: userId,
    is_completed: false,
    is_important: false,
    priority: 1,
    quadrant: 'urgent-important',
    list_id: taskData.list_id || null,
    added_to_today: taskData.added_to_today || false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    order_index: currentMinIndex - 1,
    ...taskData,
  };

  const newTasks = [tempTask, ...currentTasks];
  await cacheTasks(userId, newTasks);

  if (hasSpace(tempTask)) {
    const { createSharedTask } = await loadCollaborationManager();
    const sharedTask = await createSharedTask(userId, tempTask);
    return newTasks.map((task) => (sameId(task.id, tempTask.id) ? sharedTask : task));
  }

  // Sync personal tasks to Supabase (queued if offline).
  const result = await syncToSupabase('tasks', 'insert', {
    id: tempTask.id, // client-generated UUID to preserve integrity of offline edits
    user_id: userId,
    title: tempTask.title,
    is_completed: false,
    is_important: false,
    due_date: tempTask.due_date || null,
    reminder_time: tempTask.reminder_time || null,
    repeat_rule: tempTask.repeat_rule || null,
    quadrant: tempTask.quadrant,
    priority: tempTask.priority ?? 1,
    list_id: tempTask.list_id,
    added_to_today: tempTask.added_to_today,
    order_index: tempTask.order_index,
  });

  if (result && onSynced) {
    const synced = newTasks.map((task) => (sameId(task.id, tempTask.id) ? result : task));
    await cacheTasks(userId, synced);
    onSynced(synced, result);
  }

  return newTasks;
};

/** Toggle task completion: optimistic + sync. */
export const toggleTaskCompletion = async (userId, currentTasks, taskId, currentStatus) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in toggleTaskCompletion:', userId);
    return currentTasks;
  }
  
  const target = currentTasks.find((task) => sameId(task.id, taskId));
  const newStatus = !currentStatus;
  const completedAt = newStatus ? new Date().toISOString() : null;
  const fields = { is_completed: newStatus, completed_at: completedAt };
  const updated = currentTasks.map((task) => (
    sameId(task.id, taskId) ? { ...task, ...fields } : task
  ));
  await cacheTasks(userId, updated);

  if (hasSpace(target)) {
    const { updateSharedTask } = await loadCollaborationManager();
    await updateSharedTask(userId, taskId, fields, target.collaboration_version);
  } else {
    syncToSupabase('tasks', 'update', fields, { column: 'id', value: taskId });
  }

  return updated;
};

/** Toggle task importance: optimistic + sync. */
export const toggleTaskImportance = async (userId, currentTasks, taskId, currentStatus) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in toggleTaskImportance:', userId);
    return currentTasks;
  }
  
  const target = currentTasks.find((task) => sameId(task.id, taskId));
  const fields = { is_important: !currentStatus };
  const updated = currentTasks.map((task) => (
    sameId(task.id, taskId) ? { ...task, ...fields } : task
  ));
  await cacheTasks(userId, updated);

  if (hasSpace(target)) {
    const { updateSharedTask } = await loadCollaborationManager();
    await updateSharedTask(userId, taskId, fields, target.collaboration_version);
  } else {
    syncToSupabase('tasks', 'update', fields, { column: 'id', value: taskId });
  }

  return updated;
};

/** Delete task: optimistic + sync. */
export const deleteTask = async (userId, currentTasks, taskId) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in deleteTask:', userId);
    return currentTasks;
  }

  // Read the latest cache so repeated deletes invoked with the same stale UI
  // array cannot restore a task removed by an earlier iteration.
  const cached = await Storage.get(`tasks_${userId}`);
  const source = Array.isArray(cached) ? cached : rows(currentTasks);
  const target = source.find((task) => sameId(task.id, taskId))
    || rows(currentTasks).find((task) => sameId(task.id, taskId));
  const updated = source.filter((task) => !sameId(task.id, taskId));

  // Paint the shared aggregate cache immediately too; collaborationManager
  // separately keeps its versioned tombstone for safe RPC replay.
  await cacheTasks(userId, updated);
  if (hasSpace(target)) {
    const { deleteSharedTask } = await loadCollaborationManager();
    await deleteSharedTask(userId, entityKey(taskId), target.collaboration_version);
  } else {
    syncToSupabase('tasks', 'delete', {}, { column: 'id', value: taskId });
  }
  await updateAllWidgets();

  return visibleRows(updated);
};

/** Delete every completed task local-first while preserving shared RPC rules. */
export const clearCompletedTasks = async (userId, currentTasks) => {
  if (!userId || typeof userId !== 'string') return rows(currentTasks);
  const cached = await Storage.get(`tasks_${userId}`);
  const source = Array.isArray(cached) ? cached : rows(currentTasks);
  const completed = source.filter((task) => task.is_completed && !isDeleted(task));
  let updated = source;
  for (const task of completed) {
    updated = await deleteTask(userId, updated, task.id);
  }
  return visibleRows(updated);
};

/** Update task fields (due date, reminder, repeat rule, etc.): optimistic + sync. */
export const updateTask = async (userId, currentTasks, taskId, fields) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in updateTask:', userId);
    return currentTasks;
  }
  
  const target = currentTasks.find((task) => sameId(task.id, taskId));
  const updated = currentTasks.map((task) => (
    sameId(task.id, taskId) ? { ...task, ...fields } : task
  ));
  await cacheTasks(userId, updated);

  if (hasSpace(target)) {
    const { updateSharedTask } = await loadCollaborationManager();
    await updateSharedTask(userId, taskId, fields, target.collaboration_version);
  } else {
    syncToSupabase('tasks', 'update', fields, { column: 'id', value: taskId });
  }

  return updated;
};

/** Reorder tasks (drag & drop): optimistic + sync each changed index. */
export const reorderTasks = async (userId, fullTasks, changedTasks, sortColumn = 'order_index') => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in reorderTasks:', userId);
    return fullTasks;
  }
  
  await cacheTasks(userId, fullTasks);
  let collaborationManager = null;
  for (const task of changedTasks) {
    if (hasSpace(task)) {
      collaborationManager ||= await loadCollaborationManager();
      await collaborationManager.updateSharedTask(
        userId,
        task.id,
        { [sortColumn]: task[sortColumn] },
        task.collaboration_version,
      );
    } else {
      syncToSupabase('tasks', 'update',
        { [sortColumn]: task[sortColumn] },
        { column: 'id', value: task.id }
      );
    }
  }

  return fullTasks;
};

// ─── Lists ──────────────────────────────────────────────

const LIST_ORDER_KEY = (userId) => `list_order_${userId}`;

const applySavedListOrder = async (userId, lists) => {
  const safeLists = Array.isArray(lists) ? lists : [];
  const saved = await Storage.get(LIST_ORDER_KEY(userId));
  const savedIds = Array.isArray(saved) ? saved.map(String) : [];
  const byId = new Map(safeLists.map((list) => [String(list.id), list]));
  const seen = new Set();
  const orderedIds = [];

  for (const id of savedIds) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }
  for (const list of safeLists) {
    const id = String(list.id);
    if (!seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }

  if (orderedIds.join('|') !== savedIds.join('|')) {
    await Storage.set(LIST_ORDER_KEY(userId), orderedIds);
  }
  return orderedIds.map((id) => byId.get(id));
};

export const cacheLists = async (userId, lists) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in cacheLists:', userId);
    return;
  }
  await Storage.set(`lists_${userId}`, lists);
};

export const loadLists = async (userId, onFresh, { refresh = true } = {}) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadLists:', userId);
    return null;
  }

  const cached = await Storage.get(`lists_${userId}`);
  const orderedCached = await applySavedListOrder(userId, cached || []);

  if (refresh) {
    let inFlight = listRefreshes.get(userId);
    if (!inFlight) {
      inFlight = (async () => {
        try {
          await drainSyncQueue();
          if (!canAttemptBackgroundRefresh()) return null;
          const { data, error, serverOrdered } = await fetchListsFromServer();

          if (!error && data) {
            const merged = await mergeServerWithPending(userId, 'lists', data);
            const hasServerOrder = serverOrdered && merged.some((list) => list.order_index != null);
            const orderedFresh = hasServerOrder
              ? [...merged].sort((left, right) => (
                  (left.order_index ?? Number.MAX_SAFE_INTEGER)
                  - (right.order_index ?? Number.MAX_SAFE_INTEGER)
                ))
              : await applySavedListOrder(userId, merged);
            if (hasServerOrder) {
              await Storage.set(LIST_ORDER_KEY(userId), orderedFresh.map((list) => String(list.id)));
            }
            await cacheLists(userId, orderedFresh);
            return visibleRows(orderedFresh);
          }
        } catch (error) {
          console.log('Sync lists error', error);
        }
        return null;
      })().finally(() => listRefreshes.delete(userId));
      listRefreshes.set(userId, inFlight);
    }
    inFlight.then((fresh) => {
      if (fresh !== null && onFresh) onFresh(fresh);
    }).catch(() => {});
  }

  return visibleRows(orderedCached);
};

/**
 * Read lists newest-order-aware. `order_index` arrives with migration 0013; if
 * this app talks to a database where it hasn't been applied yet, Postgres
 * reports undefined_column (42703) and we transparently fall back to the
 * legacy created_at ordering instead of failing the whole refresh.
 */
const fetchListsFromServer = async () => {
  const ordered = await supabase
    .from('lists')
    .select('*')
    .order('order_index', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (!ordered.error) return { data: ordered.data, error: null, serverOrdered: true };
  if (ordered.error.code !== '42703') return { data: null, error: ordered.error, serverOrdered: false };

  const legacy = await supabase
    .from('lists')
    .select('*')
    .order('created_at', { ascending: true });
  return { data: legacy.data, error: legacy.error, serverOrdered: false };
};

/** Persist custom-list display order locally first, then sync each changed row. */
export const reorderLists = async (userId, orderedLists) => {
  if (!userId || typeof userId !== 'string' || !Array.isArray(orderedLists)) {
    console.error('[DataManager] Invalid reorderLists input:', userId);
    return orderedLists || [];
  }

  const indexed = orderedLists.map((list, index) => ({ ...list, order_index: index }));

  await Storage.set(LIST_ORDER_KEY(userId), indexed.map((list) => String(list.id)));
  await cacheLists(userId, indexed);
  await Storage.set('last_local_write_time', Date.now());

  let collaborationManager = null;
  for (const [index, list] of orderedLists.entries()) {
    if (list.order_index === index) continue;
    if (hasSpace(list)) {
      collaborationManager ||= await loadCollaborationManager();
      await collaborationManager.updateSharedList(
        userId,
        list.id,
        { order_index: index },
        list.collaboration_version,
      );
    } else {
      syncToSupabase('lists', 'update', { order_index: index }, { column: 'id', value: list.id });
    }
  }

  return indexed;
};

export const addList = async (userId, currentLists, listName) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in addList:', userId);
    return currentLists;
  }

  const tempId = generateUUID();
  const tempList = {
    id: tempId,
    user_id: userId,
    name: listName,
    created_at: new Date().toISOString()
  };

  const newLists = [...currentLists, tempList];
  await reorderLists(userId, newLists);

  syncToSupabase('lists', 'insert', {
    id: tempId,
    user_id: userId,
    name: listName
  });

  return newLists;
};

export const deleteList = async (userId, currentLists, listId) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in deleteList:', userId);
    return currentLists;
  }

  const cached = await Storage.get(`lists_${userId}`);
  const source = Array.isArray(cached) ? cached : rows(currentLists);
  const target = source.find((list) => sameId(list.id, listId))
    || rows(currentLists).find((list) => sameId(list.id, listId));
  if (hasSpace(target)) {
    console.warn('[DataManager] Shared lists cannot be deleted from the personal list API.');
    return currentLists;
  }

  // Base each removal on the latest cache so bulk deletion loops cannot
  // resurrect lists by repeatedly passing their original array.
  const newLists = source.filter((list) => !sameId(list.id, listId));
  await reorderLists(userId, newLists);

  syncToSupabase('lists', 'delete', {}, { column: 'id', value: listId });
  return newLists;
};

export const renameList = async (userId, currentLists, listId, newName) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in renameList:', userId);
    return currentLists;
  }

  const target = currentLists.find((list) => sameId(list.id, listId));
  const newLists = currentLists.map((list) => (
    sameId(list.id, listId) ? { ...list, name: newName } : list
  ));
  await cacheLists(userId, newLists);

  if (hasSpace(target)) {
    const { updateSharedList } = await loadCollaborationManager();
    await updateSharedList(userId, listId, { name: newName }, target.collaboration_version);
  } else {
    syncToSupabase('lists', 'update', { name: newName }, { column: 'id', value: listId });
  }
  return newLists;
};

// ─── Profile ────────────────────────────────────────────

/**
 * Load profile: cache first, then Supabase.
 */
export const loadProfile = async (userId, onFresh, { refresh = true } = {}) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadProfile:', userId);
    return null;
  }

  const cached = await Storage.get(`profile_${userId}`);
  const fallback = cached || {
    id: userId,
    display_name: 'User',
    username: 'user',
    avatar_url: null,
    avatar_seed: Math.random().toString(36).substring(7),
  };
  // Persist the stable local placeholder once so first-run/offline rendering
  // never waits for Supabase auth metadata and never changes avatar seed.
  if (!cached) await Storage.set(`profile_${userId}`, fallback);

  if (refresh) {
    let inFlight = profileRefreshes.get(userId);
    if (!inFlight) {
      inFlight = (async () => {
        try {
          if (!canAttemptBackgroundRefresh()) return null;
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

          if (error) throw error;
          if (!data) return null;

          // Auto-heal a dashboard-uploaded avatar in the background. Any
          // profile write still enters the durable queue before delivery.
          if (!data.avatar_url) {
            try {
              const { data: files } = await supabase.storage.from('avatar').list(userId);
              const avatarFile = files?.find((file) => (
                file.name === 'avatar.jpg' || file.name === 'avatar.png' || file.name === 'avatar.jpeg'
              ));
              if (avatarFile) {
                const { data: urlData } = supabase.storage
                  .from('avatar')
                  .getPublicUrl(`${userId}/${avatarFile.name}`);
                data.avatar_url = `${urlData.publicUrl}?t=${Date.now()}`;
                syncToSupabase(
                  'profiles',
                  'update',
                  { avatar_url: data.avatar_url },
                  { column: 'id', value: userId },
                ).catch(() => {});
              }
            } catch (avatarError) {
              console.log('Error checking avatar bucket:', avatarError);
            }
          }

          await Storage.set(`profile_${userId}`, data);
          if (data.ai_memory) await Storage.set(`aimemory_${userId}`, data.ai_memory);
          // Seed the DISPLAY cache only, and only when nothing is cached yet, so
          // the credit pill has something to paint before get_ai_balance() answers.
          // The server is authoritative; this must never look like a grant. It is
          // deliberately the free floor and not a guess at the real total, since
          // purchased credits and per-account allowances both push the real
          // number higher — overstating it here would show credits that don't
          // exist until the server value lands a moment later.
          const cachedCredits = await Storage.get(`aicredits_${userId}`);
          if (cachedCredits === null || cachedCredits === undefined) {
            await Storage.set(`aicredits_${userId}`, String(DEFAULT_CREDIT_FLOOR));
          }
          return data;
        } catch (error) {
          if (error.code === 'PGRST116' || error.message?.includes('0 rows')) {
            syncToSupabase(
              'profiles',
              'upsert',
              fallback,
              { column: 'id', value: userId },
            ).catch(() => {});
            return fallback;
          }
          return null;
        }
      })().finally(() => profileRefreshes.delete(userId));
      profileRefreshes.set(userId, inFlight);
    }
    inFlight.then((fresh) => {
      if (fresh && onFresh) onFresh(fresh);
    }).catch(() => {});
  }

  return fallback;
};

/**
 * Update profile: optimistic + sync.
 */
export const updateProfile = async (userId, currentProfile, fields) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in updateProfile:', userId);
    return currentProfile;
  }
  
  const updated = { ...currentProfile, ...fields };
  await Storage.set(`profile_${userId}`, updated);

  syncToSupabase('profiles', 'update', fields, { column: 'id', value: userId });

  return updated;
};

// Rich alarm columns belong to migration 0011, which is not deployed. Keep
// them in a per-user map keyed by alarm ID until the server schema supports them.
// visual_config is local-only presentation state; order_index is a legacy server column.
const ALARM_RICH_OVERLAY_FIELDS = [
  'recurrence',
  'description',
  'label',
  'category',
  'sound_config',
  'vibration_pattern',
  'snooze_config',
  'mission',
  'smart_wake',
  'ambient',
  'flags',
  'group_id',
  'visual_config',
];
const ALARM_RICH_OVERLAY_FIELD_SET = new Set(ALARM_RICH_OVERLAY_FIELDS);
const alarmRichOverlayKey = (userId) => `alarm_rich_overlays_${userId}`;

const pickAlarmRichOverlay = (fields = {}) => ALARM_RICH_OVERLAY_FIELDS.reduce((overlay, field) => {
  if (Object.prototype.hasOwnProperty.call(fields, field)) overlay[field] = fields[field];
  return overlay;
}, {});

const omitAlarmRichOverlay = (fields = {}) => Object.keys(fields).reduce((legacy, field) => {
  if (!ALARM_RICH_OVERLAY_FIELD_SET.has(field)) legacy[field] = fields[field];
  return legacy;
}, {});

const readAlarmRichOverlays = async (userId) => {
  const overlays = await Storage.get(alarmRichOverlayKey(userId));
  return overlays && typeof overlays === 'object' && !Array.isArray(overlays) ? overlays : {};
};

const writeAlarmRichOverlays = async (userId, overlays) => {
  if (Object.keys(overlays).length === 0) {
    await Storage.remove(alarmRichOverlayKey(userId));
    return;
  }
  await Storage.set(alarmRichOverlayKey(userId), overlays);
};

const persistAlarmRichOverlays = async (userId, alarms) => {
  if (!Array.isArray(alarms) || alarms.length === 0) {
    await Storage.remove(alarmRichOverlayKey(userId));
    return;
  }

  const overlays = await readAlarmRichOverlays(userId);
  for (const alarm of alarms) {
    if (!alarm?.id) continue;
    const alarmId = String(alarm.id);
    const merged = { ...(overlays[alarmId] || {}), ...pickAlarmRichOverlay(alarm) };
    for (const field of Object.keys(merged)) {
      if (merged[field] === undefined) delete merged[field];
    }
    if (Object.keys(merged).length > 0) overlays[alarmId] = merged;
    else delete overlays[alarmId];
  }
  await writeAlarmRichOverlays(userId, overlays);
};

const removeAlarmRichOverlay = async (userId, alarmId) => {
  const overlays = await readAlarmRichOverlays(userId);
  delete overlays[String(alarmId)];
  await writeAlarmRichOverlays(userId, overlays);
};

const mergeAlarmRichOverlays = (alarms, overlays) => (Array.isArray(alarms) ? alarms : []).map((alarm) => ({
  ...alarm,
  ...pickAlarmRichOverlay(overlays[String(alarm.id)] || {}),
}));

/**
 * Permanently delete the signed-in user's account.
 *
 * The whole operation runs SERVER-SIDE in the `delete-account` edge function,
 * which derives the account from the caller's verified JWT and then calls
 * `public.delete_account()`. Doing it from the client is not possible: deleting
 * the `auth.users` row requires the service-role key, which must never ship in
 * an app bundle.
 *
 * The previous client-side version deleted only `tasks`, the `profiles` row and
 * three avatar blobs. It left the auth account intact — so a "deleted" user
 * could sign back in — and it never reported failure, so the UI claimed success
 * regardless. Both are Play policy problems as well as user-trust problems.
 *
 * THROWS on failure. Callers must not tell the user their account was deleted
 * unless this resolves.
 */
export const deleteUserAccountData = async (userId) => {
  if (!userId || typeof userId !== 'string') {
    throw new Error('invalid_user');
  }

  // Requires a live session: the function authenticates the caller and ignores
  // any id supplied by the client, so an expired token cannot delete anything.
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error('not_authenticated');
  }

  const { data, error } = await supabase.functions.invoke('delete-account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (error) {
    console.log('[DataManager] Account deletion failed:', error.message);
    throw new Error(error.message || 'deletion_failed');
  }
  if (!data?.ok) {
    console.log('[DataManager] Account deletion incomplete:', JSON.stringify(data));
    throw new Error('deletion_incomplete');
  }

  // Local-only leftovers. Safe to do after the server call because a failure
  // above throws, so we never wipe local state for an account that still exists.
  await Storage.remove(alarmRichOverlayKey(userId));

  return data.report;
};

// ─── AI credits ──────────────────────────────────────────
// The server is the only authority on credits. These helpers exist so screens
// never touch Supabase directly, and so the store can paint a cached balance
// instantly instead of showing a spinner over a number the user already knows.

const AI_BALANCE_CACHE = (userId) => `aibalance_${userId}`;
const AI_CREDITS_CACHE = (userId) => `aicredits_${userId}`;

/**
 * Ask the server for the authoritative balance.
 * Returns a normalized balance, or null when offline / the call fails.
 * Also refreshes the display caches so every surface agrees.
 */
export const fetchAiCreditBalance = async (userId) => {
  try {
    const { data, error } = await supabase.rpc('get_ai_balance');
    if (error || !data) return null;

    const balance = normalizeBalance(data);
    if (userId) {
      await Storage.set(AI_BALANCE_CACHE(userId), balance);
      // Kept in sync so the Aura credit pill and the store never disagree.
      await Storage.set(AI_CREDITS_CACHE(userId), String(balance.total));
    }
    return balance;
  } catch (e) {
    console.log('[DataManager] AI balance refresh failed:', e?.message);
    return null;
  }
};

/**
 * Read today's rewarded-ad allowance. Server-authoritative: the daily cap lives
 * in `grant_ad_credits`, so this is only for rendering an honest "N ads left".
 * Returns null when offline / the call fails.
 */
export const fetchAdRewardStatus = async () => {
  try {
    const { data, error } = await supabase.rpc('get_ad_reward_status');
    if (error || !data) return null;
    return normalizeAdStatus(data);
  } catch (e) {
    console.log('[DataManager] ad reward status failed:', e?.message);
    return null;
  }
};

/**
 * Cache-first balance read. Returns immediately with whatever is cached (or a
 * zeroed balance on first run) and calls `onFresh` once the server answers.
 */
export const loadAiCreditBalance = async (userId, onFresh) => {
  if (!userId || typeof userId !== 'string') {
    return normalizeBalance(null);
  }

  const cached = await Storage.get(AI_BALANCE_CACHE(userId));
  let fallback;
  if (cached && typeof cached === 'object') {
    fallback = normalizeBalance(cached);
  } else {
    // Fall back to the plain total the Aura pill may already have cached, so a
    // user who has used AI before doesn't see 0 for a moment.
    const legacyTotal = await Storage.get(AI_CREDITS_CACHE(userId));
    const parsed = parseInt(legacyTotal, 10);
    fallback = Number.isFinite(parsed)
      ? normalizeBalance({ daily_free: parsed, purchased: 0, total: parsed })
      : normalizeBalance(null);
  }

  fetchAiCreditBalance(userId).then((fresh) => {
    if (fresh && onFresh) onFresh(fresh);
  }).catch(() => {});

  return fallback;
};

// ─── Pro entitlement ─────────────────────────────────────
// `get_pro_status()` (migration 0030) is the only authority. The cache exists so
// gated UI renders instantly and correctly OFFLINE — a paying user who opens the
// app on a plane must not be shown a paywall. Because the cache is trusted while
// offline, it is only ever written from a server response, never inferred from a
// client-side purchase result.

const PRO_STATUS_CACHE = (userId) => `prostatus_${userId}`;

export const FREE_PRO_STATUS = Object.freeze({
  isPro: false,
  planType: 'free',
  expiresAt: null,
});

const normalizeProStatus = (raw) => {
  if (!raw || typeof raw !== 'object') return FREE_PRO_STATUS;
  const isPro = raw.is_pro === true || raw.isPro === true;
  return {
    isPro,
    // Never report a plan name for a lapsed account.
    planType: isPro ? String(raw.plan_type ?? raw.planType ?? 'free') : 'free',
    expiresAt: raw.expires_at ?? raw.expiresAt ?? null,
  };
};

/**
 * Ask the server whether this account currently holds Pro. Expiry is evaluated
 * server-side, so a missed EXPIRATION webhook cannot grant Pro forever.
 * Returns null when offline / the call fails — callers keep their cached value.
 */
export const fetchProStatus = async (userId) => {
  try {
    const { data, error } = await supabase.rpc('get_pro_status');
    if (error || !data) return null;
    const status = normalizeProStatus(data);
    if (userId) await Storage.set(PRO_STATUS_CACHE(userId), status);
    return status;
  } catch (e) {
    console.log('[DataManager] pro status refresh failed:', e?.message);
    return null;
  }
};

/**
 * Cache-first entitlement read. Returns immediately with the cached status (free
 * on first run) and calls `onFresh` once the server answers.
 */
export const loadProStatus = async (userId, onFresh) => {
  if (!normalizeUserId(userId)) return FREE_PRO_STATUS;

  let fallback = FREE_PRO_STATUS;
  try {
    const cached = await Storage.get(PRO_STATUS_CACHE(userId));
    if (cached && typeof cached === 'object') fallback = normalizeProStatus(cached);
  } catch (_e) {
    // A damaged cache must never block rendering.
  }

  fetchProStatus(userId).then((fresh) => {
    if (fresh && onFresh) onFresh(fresh);
  }).catch(() => {});

  return fallback;
};

/** Drop the cached entitlement, e.g. on sign-out so the next account starts clean. */
export const clearProStatusCache = async (userId) => {
  if (!normalizeUserId(userId)) return;
  await Storage.remove(PRO_STATUS_CACHE(userId));
};

// ─── Alarms ──────────────────────────────────────────────

/** Resolve the signed-in user without exposing Supabase to screens. */
const normalizeUserId = (userId) => (
  typeof userId === 'string' && userId.trim() ? userId.trim() : null
);

/**
 * Atomically switch the app-owned identity pointer used by screens, widgets,
 * and warm caches. The memory assignment is intentionally synchronous so an
 * auth event cannot leave the new Supabase session paired with the old user.
 */
export const setCurrentUserId = async (userId) => {
  const nextUserId = normalizeUserId(userId);
  memUserId = nextUserId;
  if (nextUserId) await Storage.set('current_user_id', nextUserId);
  else await Storage.remove('current_user_id');
  return nextUserId;
};

/**
 * Activate a real Supabase user and seed only that user's first local profile.
 * Existing profile caches win because they may contain newer edits than auth
 * metadata; a server refresh still replaces the seed silently in background.
 */
export const setAuthenticatedUser = async (user) => {
  const userId = await setCurrentUserId(user?.id);
  if (!userId) return null;

  const cacheKey = `profile_${userId}`;
  const cached = await Storage.get(cacheKey);
  if (cached) return userId;

  const metadata = user?.user_metadata || {};
  const emailName = String(user?.email || '').split('@')[0];
  const username = String(metadata.username || emailName || 'user').trim().toLowerCase();
  const displayName = String(
    metadata.display_name || metadata.full_name || metadata.name || username || 'User',
  ).trim();
  await Storage.set(cacheKey, {
    id: userId,
    username,
    display_name: displayName,
    avatar_url: metadata.avatar_url || metadata.picture || null,
    avatar_seed: userId,
    ...(metadata.dob ? { dob: metadata.dob } : {}),
    ...(metadata.preferred_language ? { preferred_language: metadata.preferred_language } : {}),
  });
  return userId;
};

/** End presence while authenticated, then remove the local auth identity. */
export const signOutCurrentUser = async () => {
  const signingOutUserId = memUserId;
  // Best effort and bounded: an offline end must never trap the user in-app.
  await stopPresence(signingOutUserId);

  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    // The auth session survived, so restore this device's active presence.
    if (signingOutUserId) startPresence(signingOutUserId).catch(() => {});
    throw error;
  }
  // Drop the cached entitlement. It's keyed per user so it couldn't leak across
  // accounts, but leaving it means a stale Pro flag survives on a shared device.
  await clearProStatusCache(signingOutUserId);
  await setCurrentUserId(null);
};

export const getCurrentUserId = async () => {
  // Read on every screen mount and constant within a session, so resolving it
  // from memory removes one storage round-trip from every navigation.
  if (memUserId) return memUserId;
  const cached = await Storage.get('current_user_id');
  if (cached && typeof cached === 'string') {
    memUserId = cached;
    return cached;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || null;
    if (userId) await setCurrentUserId(userId);
    return userId;
  } catch (e) {
    console.warn('[DataManager] Could not resolve current user:', e?.message || e);
    return null;
  }
};

export const cacheAlarms = async (userId, alarms) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in cacheAlarms:', userId);
    return;
  }
  await Storage.set(`alarms_${userId}`, alarms);
  await persistAlarmRichOverlays(userId, alarms);
  await Storage.set('last_local_write_time', Date.now().toString());
};

/** Persist alarm drag order locally first, then durably queue changed indexes. */
export const reorderAlarms = async (userId, fullAlarms, changedAlarms) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in reorderAlarms:', userId);
    return fullAlarms;
  }

  await cacheAlarms(userId, fullAlarms);
  for (const alarm of changedAlarms || []) {
    await enqueueMutation(
      'alarms',
      'update',
      { order_index: alarm.order_index },
      { column: 'id', value: alarm.id },
    );
  }
  drainSyncQueue().catch((error) => {
    console.log('[DataManager] Alarm reorder queued for later sync:', error?.message || error);
  });
  return fullAlarms;
};

export const loadAlarms = async (userId, onFresh) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadAlarms:', userId);
    return [];
  }
  
  const [cached, cachedOverlays] = await Promise.all([
    Storage.get(`alarms_${userId}`),
    readAlarmRichOverlays(userId),
  ]);
  const cachedWithOverlays = mergeAlarmRichOverlays(cached, cachedOverlays);
  
  const fetchStartTime = Date.now();
  const fetchBackground = async () => {
    try {
      await drainSyncQueue();
      if (!getSyncState().online) return;
      const { data, error } = await supabase
        .from('alarms')
        .select('*')
        .eq('user_id', userId)
        .order('time', { ascending: true });
        
      if (!error && data) {
        const qLen = await getQueueLength();
        const lastWriteStr = await Storage.get('last_local_write_time');
        const lastWriteTime = lastWriteStr ? parseInt(lastWriteStr, 10) : 0;
        
        // Only overwrite the cache if there are no pending mutations AND
        // no local updates occurred after this fetch was initiated.
        if (qLen === 0 && fetchStartTime > lastWriteTime) {
          const overlays = await readAlarmRichOverlays(userId);
          const merged = mergeAlarmRichOverlays(data, overlays);
          await Storage.set(`alarms_${userId}`, merged);
          if (onFresh) onFresh(merged);
        } else {
          console.log('[DataManager] Supabase alarms fetch discarded: Local updates occurred or are pending.');
        }
      }
    } catch (e) {
      console.log('[DataManager] Sync alarms error:', e.message || e);
    }
  };
  
  fetchBackground();
  return cachedWithOverlays;
};

export const addAlarm = async (userId, currentAlarms, alarmData) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in addAlarm:', userId);
    return currentAlarms;
  }
  
  const tempId = generateUUID();
  const tempAlarm = {
    id: tempId,
    user_id: userId,
    created_at: new Date().toISOString(),
    ...alarmData
  };
  
  const newAlarms = [...currentAlarms, tempAlarm];
  // Sort alarms by time
  newAlarms.sort((a, b) => a.time.localeCompare(b.time));
  await cacheAlarms(userId, newAlarms);
  
  syncToSupabase('alarms', 'insert', omitAlarmRichOverlay(tempAlarm));
  return newAlarms;
};

export const updateAlarm = async (userId, currentAlarms, alarmId, fields) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in updateAlarm:', userId);
    return currentAlarms;
  }
  
  const updated = currentAlarms.map((alarm) => (
    sameId(alarm.id, alarmId) ? { ...alarm, ...fields } : alarm
  ));
  updated.sort((a, b) => a.time.localeCompare(b.time));
  await cacheAlarms(userId, updated);

  const legacyFields = omitAlarmRichOverlay(fields);
  if (Object.keys(legacyFields).length > 0) {
    syncToSupabase('alarms', 'update', legacyFields, { column: 'id', value: alarmId });
  }
  return updated;
};


export const deleteAlarm = async (userId, currentAlarms, alarmId) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in deleteAlarm:', userId);
    return currentAlarms;
  }
  
  const updated = currentAlarms.filter((alarm) => !sameId(alarm.id, alarmId));
  await cacheAlarms(userId, updated);
  await removeAlarmRichOverlay(userId, alarmId);
  
  syncToSupabase('alarms', 'delete', {}, { column: 'id', value: alarmId });
  return updated;
};

/**
 * Patch rich alarm fields in the local cache while migration 0011 is not yet
 * deployed. Keeping this in dataManager preserves the screen/data boundary.
 * Once the migration is enabled in production, callers can move these fields
 * to updateAlarm without changing UI code.
 */
export const patchAlarmLocal = async (userId, currentAlarms, alarmId, fields) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in patchAlarmLocal:', userId);
    return currentAlarms;
  }
  const updated = currentAlarms.map((alarm) =>
    sameId(alarm.id, alarmId) ? { ...alarm, ...fields } : alarm,
  );
  await cacheAlarms(userId, updated);
  return updated;
};

/** Disable a fired one-time alarm locally first, then sync its legacy flag. */
export const disableAlarmAfterFire = async (userId, alarmId) => {
  if (!userId || typeof userId !== 'string' || !alarmId) return false;
  const current = (await Storage.get(`alarms_${userId}`)) || [];
  const exists = current.some((alarm) => sameId(alarm.id, alarmId));
  if (exists) {
    const updated = current.map((alarm) =>
      sameId(alarm.id, alarmId) ? { ...alarm, is_active: false } : alarm,
    );
    await cacheAlarms(userId, updated);
  }
  syncToSupabase('alarms', 'update', { is_active: false }, { column: 'id', value: alarmId });
  return true;
};

/**
 * Reset alarms without stale-array races: clear local cache immediately, then
 * enqueue every server deletion without waiting for network round-trips.
 */
export const resetAlarms = async (userId, currentAlarms = []) => {
  if (!userId || typeof userId !== 'string') return currentAlarms;
  const ids = Array.from(new Set((currentAlarms || []).map((alarm) => alarm.id).filter(Boolean)));
  await cacheAlarms(userId, []);
  await Storage.remove(alarmRichOverlayKey(userId));
  await Promise.all(ids.map((id) =>
    enqueueMutation('alarms', 'delete', {}, { column: 'id', value: id }),
  ));
  return [];
};

// ─── Alarm History (wake-session log) ────────────────────
// Powers the alarm dashboard/insights. Offline-first like everything else:
// records are written to local cache instantly and enqueued for Supabase.
// History is bounded locally so a single AsyncStorage blob can't grow forever.
const ALARM_HISTORY_CACHE_LIMIT = 400;

export const cacheAlarmHistory = async (userId, history) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in cacheAlarmHistory:', userId);
    return;
  }
  // Keep only the most recent N locally (server retains full history).
  const bounded = Array.isArray(history) ? history.slice(-ALARM_HISTORY_CACHE_LIMIT) : [];
  await Storage.set(`alarm_history_${userId}`, bounded);
  await Storage.set('last_local_write_time', Date.now().toString());
};

export const loadAlarmHistory = async (userId, onFresh) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadAlarmHistory:', userId);
    return [];
  }

  const cached = (await Storage.get(`alarm_history_${userId}`)) || [];

  const fetchStartTime = Date.now();
  const syncFromServer = async () => {
    try {
      await drainSyncQueue();
      if (!getSyncState().online) return;
      const { data, error } = await supabase
        .from('alarm_history')
        .select('*')
        .eq('user_id', userId)
        .order('triggered_at', { ascending: false })
        .limit(ALARM_HISTORY_CACHE_LIMIT);
      if (!error && Array.isArray(data)) {
        const ordered = [...data].reverse();
        const qLen = await getQueueLength();
        const lastWriteTime = parseInt((await Storage.get('last_local_write_time')) || '0', 10);
        // Only accept server data if nothing local is pending/newer.
        if (qLen === 0 && fetchStartTime > lastWriteTime) {
          await Storage.set(`alarm_history_${userId}`, ordered);
          if (onFresh) onFresh(ordered);
        } else {
          console.log('[DataManager] alarm_history fetch discarded: local updates pending.');
        }
      }
    } catch (e) {
      console.log('[DataManager] Sync alarm_history error:', e.message || e);
    }
  };

  syncFromServer();
  return cached;
};

// Append one wake-session record. `session` should match the alarm_history
// row shape (see 0011_alarm_system.sql). Returns the updated local list.
export const recordWakeSession = async (userId, session) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in recordWakeSession:', userId);
    return [];
  }

  const cached = (await Storage.get(`alarm_history_${userId}`)) || [];
  const record = {
    id: generateUUID(),
    user_id: userId,
    created_at: new Date().toISOString(),
    snooze_count: 0,
    ...session,
  };

  const updated = [...cached, record];
  await cacheAlarmHistory(userId, updated);

  syncToSupabase('alarm_history', 'insert', record);
  return updated;
};

/** Update reflection fields on the matching dismissed wake session without duplicating it. */
export const updateLatestWakeSessionReflection = async (userId, alarmId, triggeredAt, fields = {}) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in updateLatestWakeSessionReflection:', userId);
    return null;
  }

  const cached = (await Storage.get(`alarm_history_${userId}`)) || [];
  const dismissed = cached.filter((record) =>
    sameId(record?.alarm_id, alarmId) && record?.outcome === 'dismissed' && record?.id,
  );
  if (dismissed.length === 0) return null;

  const timestampOf = (record) => {
    const timestamp = Date.parse(record?.triggered_at || record?.created_at || '');
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
  };
  const exact = dismissed.filter((record) => record.triggered_at === triggeredAt);
  let record;
  if (exact.length > 0) {
    record = exact.reduce((latest, candidate) =>
      timestampOf(candidate) >= timestampOf(latest) ? candidate : latest,
    );
  } else {
    const targetTimestamp = Date.parse(triggeredAt || '');
    if (Number.isFinite(targetTimestamp)) {
      record = dismissed.reduce((closest, candidate) => {
        const candidateDistance = Math.abs(timestampOf(candidate) - targetTimestamp);
        const closestDistance = Math.abs(timestampOf(closest) - targetTimestamp);
        if (candidateDistance !== closestDistance) {
          return candidateDistance < closestDistance ? candidate : closest;
        }
        return timestampOf(candidate) >= timestampOf(closest) ? candidate : closest;
      });
    } else {
      record = dismissed.reduce((latest, candidate) =>
        timestampOf(candidate) >= timestampOf(latest) ? candidate : latest,
      );
    }
  }

  const safeFields = {};
  const allowedMoods = new Set(['great', 'good', 'okay', 'tired', 'rough']);
  if (Object.prototype.hasOwnProperty.call(fields, 'mood') &&
      (fields.mood === null || allowedMoods.has(fields.mood))) {
    safeFields.mood = fields.mood;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'notes') &&
      (fields.notes === null || typeof fields.notes === 'string')) {
    safeFields.notes = fields.notes === null || fields.notes.trim() === '' ? null : fields.notes;
  }

  const updatedRecord = { ...record, ...safeFields };
  const updatedHistory = cached.map((item) => (
    sameId(item.id, record.id) ? updatedRecord : item
  ));
  await cacheAlarmHistory(userId, updatedHistory);

  if (Object.keys(safeFields).length > 0) {
    await enqueueMutation(
      'alarm_history',
      'update',
      safeFields,
      { column: 'id', value: record.id },
    );
    drainSyncQueue().catch((error) => {
      console.warn('[DataManager] Wake reflection queue drain failed:', error?.message || error);
    });
  }

  return updatedRecord;
};

// Complete one queued Focus Room task through the same task/XP/history path
// used elsewhere. Queue state is updated only after the local task cache and XP
// have converged, while every remote write remains durable through SyncQueue.
export const completeFocusRoomTask = async (userId, roomId, queueItem) => {
  if (!userId || !roomId || !queueItem?.id) throw new Error('Focus task is unavailable.');
  const tasks = await loadTasks(userId, null, { refresh: false });
  const task = tasks.find((item) => sameId(item.id, queueItem.taskId));
  let xpEarned = Math.max(0, Number(queueItem.xpEarned) || 0);

  if (task && !task.is_completed) {
    let updated = await toggleTaskCompletion(userId, tasks, task.id, false);
    if (!task.space_id) {
      xpEarned = task.xp_awarded != null
        ? Math.max(0, Number(task.xp_awarded) || 0)
        : Gamification.xpForTask(task);
      updated = updated.map((item) => sameId(item.id, task.id)
        ? { ...item, xp_awarded: xpEarned }
        : item);
      await cacheTasks(userId, updated);
      if (xpEarned > 0) await Gamification.addXP(userId, xpEarned);
    }
  } else if (task?.xp_awarded != null) {
    xpEarned = Math.max(0, Number(task.xp_awarded) || 0);
  }

  const {
    getFocusRoomTaskElapsed,
    loadHustleRoom,
    updateHustleRoomQueueItem,
  } = await import('./hustleRoomsManager');
  const roomSnapshot = await loadHustleRoom(userId, roomId, null, { refresh: false });
  const roomMember = roomSnapshot?.focus?.members?.find((member) => sameId(member.userId, userId));
  const focusSeconds = roomMember?.presenceStatus === 'on_break'
    ? Math.max(0, Number(queueItem.focusSeconds) || 0)
    : getFocusRoomTaskElapsed(queueItem);
  if (focusSeconds >= 60) {
    const endedAt = new Date();
    await recordFocusSession(userId, {
      seconds: focusSeconds,
      startedAt: new Date(endedAt.getTime() - focusSeconds * 1000),
      endedAt,
      taskId: task?.id ?? queueItem.taskId ?? null,
      clientSessionId: `focus_room_${roomId}_${queueItem.id}`,
    }).catch(() => {});
  }

  return updateHustleRoomQueueItem(userId, roomId, queueItem.id, {
    status: 'completed',
    xpEarned,
    shareTitle: queueItem.shareTitle,
  });
};

// Friend data needed by room creation is also exposed through the central
// screen-facing boundary.
export { loadHustlers } from './hustlersManager';

// Hustle Rooms stay in a focused module, but screens consume them through this
// central data boundary just like every other offline-first feature.
export {
    addTasksToHustleRoomQueue,
    createHustleRoom,
    endHustleRoom,
    formatRoomClock,
    getFocusRoomTaskElapsed,
    getHustleRoomElapsed, HUSTLE_ROOM_LIMITS, isHustleRoomsOnline,
    leaveHustleRoom,
    loadHustleRoom,
    loadHustleRooms,
    markHustleRoomCallbacksRead,
    refreshHustleRoom,
    refreshHustleRooms,
    reorderHustleRoomQueue,
    sendHustleRoomCallback,
    sendHustleRoomMessage,
    setHustleRoomBreak,
    subscribeToHustleRoomChanges,
    subscribeToHustleRoomsChanges,
    updateHustleRoomPrivacy,
    updateHustleRoomQueueItem,
    updateHustleRoomQueueItemDetails,
    updateMyHustleRoomProgress
} from './hustleRoomsManager';

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
import { Storage } from '../utils/storage';
import { updateAllWidgets } from '../utils/widgetUpdater';
import { drainSyncQueue, enqueueMutation, getQueueLength, syncToSupabase } from './syncQueue';

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
  
  try {
    // 1. Fetch Profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (profile) await Storage.set(`profile_${userId}`, profile);

    // 2. Fetch Tasks
    const { data: tasks } = await supabase.from('tasks').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (tasks) await Storage.set(`tasks_${userId}`, tasks);

    // 3. Fetch Mindful Lock data (profile settings + schedules + locked apps).
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
export const loadTasks = async (userId, onFresh) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadTasks:', userId);
    return [];
  }
  
  // 1. Get cached instantly
  const cached = await Storage.get(`tasks_${userId}`);

  // 2. Fire and forget the background fetch
  const fetchBackground = async () => {
    try {
      await drainSyncQueue();
      
      // Capture write time BEFORE starting the fetch
      const lastWriteBeforeFetch = await Storage.get('last_local_write_time');
      const lastWriteTime = lastWriteBeforeFetch ? parseInt(lastWriteBeforeFetch, 10) : 0;
      
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        const qLen = await getQueueLength();
        
        // Capture write time AFTER fetch completes
        const lastWriteAfterFetch = await Storage.get('last_local_write_time');
        const lastWriteTimeAfter = lastWriteAfterFetch ? parseInt(lastWriteAfterFetch, 10) : 0;

        // Only overwrite cache if:
        // 1. No pending mutations in sync queue
        // 2. NO local writes occurred during the fetch (prevents overwriting edits)
        if (qLen === 0 && lastWriteTime === lastWriteTimeAfter) {
          // Merge local-only fields (e.g. priority) that Supabase may not have yet
          const localTasks = await Storage.get(`tasks_${userId}`) || [];
          const localMap = {};
          localTasks.forEach(t => { localMap[t.id] = t; });
          
          const merged = data.map(t => {
            const local = localMap[t.id];
            if (local) {
              // Preserve local fields that Supabase returned as null/undefined
              return {
                ...t,
                priority: t.priority ?? local.priority ?? 1,
                subtasks: t.subtasks ?? local.subtasks,
                notes: t.notes ?? local.notes,
              };
            }
            return { ...t, priority: t.priority ?? 1 };
          });
          
          await cacheTasks(userId, merged);
          if (onFresh) onFresh(merged);
        } else {
          console.log('[DataManager] Skipping cache update - local writes detected or sync queue not empty');
        }
      }
    } catch (err) {
      console.log('[DataManager] Background fetch error:', err);
      if (onFresh) onFresh(null);
    }
  };

  fetchBackground();
  return cached || [];
};

/**
 * Save tasks to local cache only (called after optimistic UI updates).
 */
export const cacheTasks = async (userId, tasks) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in cacheTasks:', userId);
    return;
  }
  await Storage.set(`tasks_${userId}`, tasks);
  await Storage.set('last_local_write_time', Date.now().toString());
  await updateAllWidgets(); // ← AWAIT the widget update!
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
  // Validate userId
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

  // Sync to Supabase (queued if offline)
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
    // Replace task in state/cache with fresh row from Supabase
    const synced = newTasks.map(t => t.id === tempTask.id ? result : t);
    await cacheTasks(userId, synced);
    onSynced(synced, result);
  }

  return newTasks;
};

/**
 * Toggle task completion: optimistic + sync.
 */
export const toggleTaskCompletion = async (userId, currentTasks, taskId, currentStatus) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in toggleTaskCompletion:', userId);
    return currentTasks;
  }
  
  const newStatus = !currentStatus;
  const completedAt = newStatus ? new Date().toISOString() : null;
  const updated = currentTasks.map(t =>
    t.id === taskId ? { ...t, is_completed: newStatus, completed_at: completedAt } : t
  );
  await cacheTasks(userId, updated);

  syncToSupabase('tasks', 'update',
    { is_completed: newStatus, completed_at: completedAt },
    { column: 'id', value: taskId }
  );

  return updated;
};

/**
 * Toggle task importance: optimistic + sync.
 */
export const toggleTaskImportance = async (userId, currentTasks, taskId, currentStatus) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in toggleTaskImportance:', userId);
    return currentTasks;
  }
  
  const newStatus = !currentStatus;
  const updated = currentTasks.map(t =>
    t.id === taskId ? { ...t, is_important: newStatus } : t
  );
  await cacheTasks(userId, updated);

  syncToSupabase('tasks', 'update',
    { is_important: newStatus },
    { column: 'id', value: taskId }
  );

  return updated;
};

/**
 * Delete task: optimistic + sync.
 */
export const deleteTask = async (userId, currentTasks, taskId) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in deleteTask:', userId);
    return currentTasks;
  }
  
  const updated = currentTasks.filter(t => t.id !== taskId);
  await cacheTasks(userId, updated);

  syncToSupabase('tasks', 'delete', {}, { column: 'id', value: taskId });

  return updated;
};

/**
 * Update task fields (due date, reminder, repeat rule, etc.): optimistic + sync.
 */
export const updateTask = async (userId, currentTasks, taskId, fields) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in updateTask:', userId);
    return currentTasks;
  }
  
  const updated = currentTasks.map(t =>
    t.id === taskId ? { ...t, ...fields } : t
  );
  await cacheTasks(userId, updated);

  syncToSupabase('tasks', 'update', fields, { column: 'id', value: taskId });

  return updated;
};

/**
 * Reorder tasks (drag & drop): optimistic + sync each changed index.
 */
export const reorderTasks = async (userId, fullTasks, changedTasks, sortColumn = 'order_index') => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in reorderTasks:', userId);
    return fullTasks;
  }
  
  // 1. Cache the complete task list
  await cacheTasks(userId, fullTasks);

  // 2. Sync only the drag-reordered tasks to Supabase in the background
  for (const task of changedTasks) {
    syncToSupabase('tasks', 'update',
      { [sortColumn]: task[sortColumn] },
      { column: 'id', value: task.id }
    );
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

export const loadLists = async (userId, onFresh) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadLists:', userId);
    return null;
  }

  const cached = await Storage.get(`lists_${userId}`);
  const orderedCached = await applySavedListOrder(userId, cached || []);

  const fetchBackground = async () => {
    try {
      await drainSyncQueue();
      const lastWriteBeforeFetch = await Storage.get('last_local_write_time');
      const { data, error, serverOrdered } = await fetchListsFromServer(userId);

      const queueLength = await getQueueLength();
      const lastWriteAfterFetch = await Storage.get('last_local_write_time');
      const localListsChanged = String(lastWriteBeforeFetch || '') !== String(lastWriteAfterFetch || '');

      if (!error && data && queueLength === 0 && !localListsChanged) {
        // When the server knows the order (migration 0013 applied) it is the
        // source of truth, so a reinstall or a second device restores the same
        // arrangement. Otherwise fall back to the locally remembered order.
        const hasServerOrder = serverOrdered && data.some((list) => list.order_index != null);
        const orderedFresh = hasServerOrder ? data : await applySavedListOrder(userId, data);
        if (hasServerOrder) {
          await Storage.set(LIST_ORDER_KEY(userId), orderedFresh.map((list) => String(list.id)));
        }
        await cacheLists(userId, orderedFresh);
        if (onFresh) onFresh(orderedFresh);
      }
    } catch (e) {
      console.log('Sync lists error', e);
    }
  };

  fetchBackground();
  return orderedCached;
};

/**
 * Read lists newest-order-aware. `order_index` arrives with migration 0013; if
 * this app talks to a database where it hasn't been applied yet, Postgres
 * reports undefined_column (42703) and we transparently fall back to the
 * legacy created_at ordering instead of failing the whole refresh.
 */
const fetchListsFromServer = async (userId) => {
  const ordered = await supabase
    .from('lists')
    .select('*')
    .eq('user_id', userId)
    .order('order_index', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (!ordered.error) return { data: ordered.data, error: null, serverOrdered: true };
  if (ordered.error.code !== '42703') return { data: null, error: ordered.error, serverOrdered: false };

  const legacy = await supabase
    .from('lists')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return { data: legacy.data, error: legacy.error, serverOrdered: false };
};

/**
 * Persist custom-list display order. Writes locally first (instant, offline
 * safe) and syncs `order_index` per moved row so the arrangement survives a
 * reinstall. If the column is missing the queue drops those updates as a fatal
 * schema error, leaving local ordering fully functional.
 */
export const reorderLists = async (userId, orderedLists) => {
  if (!userId || typeof userId !== 'string' || !Array.isArray(orderedLists)) {
    console.error('[DataManager] Invalid reorderLists input:', userId);
    return orderedLists || [];
  }

  const indexed = orderedLists.map((list, index) => ({ ...list, order_index: index }));

  await Storage.set(LIST_ORDER_KEY(userId), indexed.map((list) => String(list.id)));
  await cacheLists(userId, indexed);
  await Storage.set('last_local_write_time', Date.now());

  orderedLists.forEach((list, index) => {
    if (list.order_index === index) return; // Already at this position.
    syncToSupabase('lists', 'update', { order_index: index }, { column: 'id', value: list.id });
  });

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

  const newLists = currentLists.filter(l => l.id !== listId);
  await reorderLists(userId, newLists);

  syncToSupabase('lists', 'delete', {}, { column: 'id', value: listId });
  return newLists;
};

export const renameList = async (userId, currentLists, listId, newName) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in renameList:', userId);
    return currentLists;
  }

  const newLists = currentLists.map(l => l.id === listId ? { ...l, name: newName } : l);
  await cacheLists(userId, newLists);

  syncToSupabase('lists', 'update', { name: newName }, { column: 'id', value: listId });
  return newLists;
};

// ─── Profile ────────────────────────────────────────────

/**
 * Load profile: cache first, then Supabase.
 */
export const loadProfile = async (userId, onFresh) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadProfile:', userId);
    return null;
  }
  
  const cached = await Storage.get(`profile_${userId}`);

  const fetchBackground = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;

      if (data) {
        // Auto-heal missing avatar_url if the user uploaded directly via Supabase dashboard
        if (!data.avatar_url) {
          try {
            const { data: files } = await supabase.storage.from('avatar').list(userId);
            const avatarFile = files?.find(f => f.name === 'avatar.jpg' || f.name === 'avatar.png' || f.name === 'avatar.jpeg');
            if (avatarFile) {
               const { data: urlData } = supabase.storage.from('avatar').getPublicUrl(`${userId}/${avatarFile.name}`);
               data.avatar_url = urlData.publicUrl + `?t=${Date.now()}`;
               // Fire and forget update to save it for next time
               supabase.from('profiles').update({ avatar_url: data.avatar_url }).eq('id', userId).then();
            }
          } catch (e) {
            console.log('Error checking avatar bucket:', e);
          }
        }

        await Storage.set(`profile_${userId}`, data);
        
        // Pull down their AI brain if it exists
        if (data.ai_memory) {
          await Storage.set(`aimemory_${userId}`, data.ai_memory);
        }
        
        // AI credits are server-authoritative. Never copy legacy profile token
        // fields into the display cache; the get_ai_balance RPC owns updates.
        const cachedCredits = await Storage.get(`aicredits_${userId}`);
        if (cachedCredits === null || cachedCredits === undefined) {
          await Storage.set(`aicredits_${userId}`, '20');
        }
        
        if (onFresh) onFresh(data);
      }
    } catch (err) {
      // If row doesn't exist (PGRST116), create it!
      if (err.code === 'PGRST116' || err.message?.includes('0 rows')) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          let recoveredAvatarUrl = null;
          
          // 🛡️ Auto-Heal: Recover orphaned avatar from storage before creating profile
          try {
            const { data: files } = await supabase.storage.from('avatar').list(userId);
            const avatarFile = files?.find(f => f.name === 'avatar.jpg' || f.name === 'avatar.png' || f.name === 'avatar.jpeg');
            if (avatarFile) {
               const { data: urlData } = supabase.storage.from('avatar').getPublicUrl(`${userId}/${avatarFile.name}`);
               recoveredAvatarUrl = urlData.publicUrl + `?t=${Date.now()}`;
            }
          } catch (e) {
            console.log('Error checking avatar bucket during recovery:', e);
          }

          const newProfile = {
            id: userId,
            display_name: cached?.display_name || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
            username: cached?.username || session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'user',
            avatar_url: cached?.avatar_url || recoveredAvatarUrl || null,
            avatar_seed: cached?.avatar_seed || Math.random().toString(36).substring(7),
            preferred_language: cached?.preferred_language || session.user.user_metadata?.preferred_language || null,
          };
          
          const { data: insertedData, error: upsertError } = await supabase
            .from('profiles')
            .upsert(newProfile)
            .select()
            .single();
            
          if (upsertError) {
            console.warn('[DataManager] Failed to upsert profile, falling back to local memory:', upsertError.message);
          }
            
          // 🚀 GUARANTEE UI FIX: Even if upsert fails, update local cache and UI!
          const profileToSave = insertedData || newProfile;
          await Storage.set(`profile_${userId}`, profileToSave);
          if (onFresh) onFresh(profileToSave);
        }
      }
    }
  };
  
  fetchBackground();

  if (cached) return cached;
  
  // Instant fallback for first launch
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    return {
      id: userId,
      display_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
      username: session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'user',
      avatar_url: null,
      avatar_seed: Math.random().toString(36).substring(7)
    };
  }

  return null;
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
 * Delete all database records and storage objects for a user (called during account deletion).
 */
export const deleteUserAccountData = async (userId) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in deleteUserAccountData:', userId);
    return;
  }
  
  await supabase.from('tasks').delete().eq('user_id', userId);
  await supabase.from('profiles').delete().eq('id', userId);
  await Storage.remove(alarmRichOverlayKey(userId));
  try {
    await supabase.storage.from('avatar').remove([`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.jpeg`]);
  } catch (e) {
    console.log('[DataManager] Storage cleanup warning:', e.message);
  }
};

// ─── Alarms ──────────────────────────────────────────────

/** Resolve the signed-in user without exposing Supabase to screens. */
export const getCurrentUserId = async () => {
  const cached = await Storage.get('current_user_id');
  if (cached && typeof cached === 'string') return cached;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || null;
    if (userId) await Storage.set('current_user_id', userId);
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
  
  const updated = currentAlarms.map(a => a.id === alarmId ? { ...a, ...fields } : a);
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
  
  const updated = currentAlarms.filter(a => a.id !== alarmId);
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
    alarm.id === alarmId ? { ...alarm, ...fields } : alarm,
  );
  await cacheAlarms(userId, updated);
  return updated;
};

/** Disable a fired one-time alarm locally first, then sync its legacy flag. */
export const disableAlarmAfterFire = async (userId, alarmId) => {
  if (!userId || typeof userId !== 'string' || !alarmId) return false;
  const current = (await Storage.get(`alarms_${userId}`)) || [];
  const exists = current.some((alarm) => alarm.id === alarmId);
  if (exists) {
    const updated = current.map((alarm) =>
      alarm.id === alarmId ? { ...alarm, is_active: false } : alarm,
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
    record?.alarm_id === alarmId && record?.outcome === 'dismissed' && record?.id,
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
  const updatedHistory = cached.map((item) => item.id === record.id ? updatedRecord : item);
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

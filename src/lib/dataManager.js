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
import { Storage } from '../utils/storage';
import { supabase } from '../lib/supabase';
import { syncToSupabase, drainSyncQueue, getQueueLength } from './syncQueue';

// RFC4122 v4 compliant UUID generator for offline-first primary keys
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const performInitialSync = async (userId) => {
  try {
    // 1. Fetch Profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (profile) await Storage.set(`profile_${userId}`, profile);

    // 2. Fetch Tasks
    const { data: tasks } = await supabase.from('tasks').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (tasks) await Storage.set(`tasks_${userId}`, tasks);

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
  // 1. Get cached instantly
  const cached = await Storage.get(`tasks_${userId}`);

  // 2. Fire and forget the background fetch
  const fetchStartTime = Date.now();
  const fetchBackground = async () => {
    try {
      await drainSyncQueue();
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        const qLen = await getQueueLength();
        const lastWriteStr = await Storage.get('last_local_write_time');
        const lastWriteTime = lastWriteStr ? parseInt(lastWriteStr, 10) : 0;

        // Only overwrite the cache if there are no pending mutations AND
        // no local updates occurred after this fetch was initiated.
        if (qLen === 0 && fetchStartTime > lastWriteTime) {
          await Storage.set(`tasks_${userId}`, data);
          if (onFresh) onFresh(data);
        } else {
          console.log('[DataManager] Supabase fetch discarded: Local updates occurred or are pending.');
        }
      }
    } catch (e) {
      console.log('[DataManager] Supabase fetch failed (offline?):', e.message);
    }
  };
  
  fetchBackground();

  // 3. Return cached data immediately so UI doesn't block
  return cached || [];
};

/**
 * Save tasks to local cache only (called after optimistic UI updates).
 */
export const cacheTasks = async (userId, tasks) => {
  await Storage.set(`tasks_${userId}`, tasks);
  await Storage.set('last_local_write_time', Date.now().toString());
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
  const currentMinIndex = currentTasks.length > 0
    ? Math.min(...currentTasks.map(t => t.order_index || 0))
    : 0;

  const clientUuid = generateUUID();
  const tempTask = {
    id: clientUuid,
    user_id: userId,
    is_completed: false,
    is_important: false,
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
  const updated = currentTasks.filter(t => t.id !== taskId);
  await cacheTasks(userId, updated);

  syncToSupabase('tasks', 'delete', {}, { column: 'id', value: taskId });

  return updated;
};

/**
 * Update task fields (due date, reminder, repeat rule, etc.): optimistic + sync.
 */
export const updateTask = async (userId, currentTasks, taskId, fields) => {
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

export const cacheLists = async (userId, lists) => {
  await Storage.set(`lists_${userId}`, lists);
};

export const loadLists = async (userId, onFresh) => {
  const cached = await Storage.get(`lists_${userId}`);
  
  const fetchBackground = async () => {
    try {
      const { data, error } = await supabase
        .from('lists')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
        
      if (!error && data) {
        await cacheLists(userId, data);
        if (onFresh) onFresh(data);
      }
    } catch (e) {
      console.log('Sync lists error', e);
    }
  };
  
  fetchBackground();
  return cached || null;
};

export const addList = async (userId, currentLists, listName) => {
  const tempId = generateUUID();
  const tempList = {
    id: tempId,
    user_id: userId,
    name: listName,
    created_at: new Date().toISOString()
  };
  
  const newLists = [...currentLists, tempList];
  await cacheLists(userId, newLists);
  
  syncToSupabase('lists', 'insert', {
    id: tempId,
    user_id: userId,
    name: listName
  });
  
  return newLists;
};

export const deleteList = async (userId, currentLists, listId) => {
  const newLists = currentLists.filter(l => l.id !== listId);
  await cacheLists(userId, newLists);
  
  syncToSupabase('lists', 'delete', {}, { column: 'id', value: listId });
  return newLists;
};

export const renameList = async (userId, currentLists, listId, newName) => {
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
  const cached = await Storage.get(`profile_${userId}`);

  const fetchBackground = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (data) {
        await Storage.set(`profile_${userId}`, data);
        if (onFresh) onFresh(data);
      }
    } catch (err) {
      // If row doesn't exist (PGRST116), create it!
      if (err.code === 'PGRST116' || err.message?.includes('0 rows')) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const newProfile = {
            id: userId,
            display_name: cached?.display_name || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
            username: cached?.username || session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'user',
            avatar_url: cached?.avatar_url || null,
            avatar_seed: cached?.avatar_seed || Math.random().toString(36).substring(7),
          };
          
          const { data: insertedData } = await supabase
            .from('profiles')
            .upsert(newProfile)
            .select()
            .single();
            
          if (insertedData) {
            await Storage.set(`profile_${userId}`, insertedData);
            if (onFresh) onFresh(insertedData);
          }
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
      username: session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'user'
    };
  }

  return null;
};

/**
 * Update profile: optimistic + sync.
 */
export const updateProfile = async (userId, currentProfile, fields) => {
  const updated = { ...currentProfile, ...fields };
  await Storage.set(`profile_${userId}`, updated);

  syncToSupabase('profiles', 'update', fields, { column: 'id', value: userId });

  return updated;
};

/**
 * Delete all database records and storage objects for a user (called during account deletion).
 */
export const deleteUserAccountData = async (userId) => {
  await supabase.from('tasks').delete().eq('user_id', userId);
  await supabase.from('profiles').delete().eq('id', userId);
  try {
    await supabase.storage.from('avatar').remove([`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.jpeg`]);
  } catch (e) {
    console.log('[DataManager] Storage cleanup warning:', e.message);
  }
};

// ─── Alarms ──────────────────────────────────────────────

export const loadAlarms = async (userId, onFresh) => {
  const cached = await Storage.get(`alarms_${userId}`);
  
  const fetchBackground = async () => {
    try {
      const { data, error } = await supabase
        .from('alarms')
        .select('*')
        .eq('user_id', userId)
        .order('time', { ascending: true });
        
      if (!error && data) {
        await Storage.set(`alarms_${userId}`, data);
        if (onFresh) onFresh(data);
      }
    } catch (e) {
      console.log('Sync alarms error', e);
    }
  };
  
  fetchBackground();
  return cached || [];
};

export const addAlarm = async (userId, currentAlarms, alarmData) => {
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
  await Storage.set(`alarms_${userId}`, newAlarms);
  
  syncToSupabase('alarms', 'insert', tempAlarm);
  return newAlarms;
};

export const updateAlarm = async (userId, currentAlarms, alarmId, fields) => {
  const updated = currentAlarms.map(a => a.id === alarmId ? { ...a, ...fields } : a);
  updated.sort((a, b) => a.time.localeCompare(b.time));
  await Storage.set(`alarms_${userId}`, updated);

  syncToSupabase('alarms', 'update', fields, { column: 'id', value: alarmId });
  return updated;
};

export const deleteAlarm = async (userId, currentAlarms, alarmId) => {
  const updated = currentAlarms.filter(a => a.id !== alarmId);
  await Storage.set(`alarms_${userId}`, updated);
  
  syncToSupabase('alarms', 'delete', {}, { column: 'id', value: alarmId });
  return updated;
};

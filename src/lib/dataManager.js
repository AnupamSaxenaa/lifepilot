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
import { drainSyncQueue, getQueueLength, syncToSupabase } from './syncQueue';

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
  const fetchStartTime = Date.now();
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
          await cacheTasks(userId, data);
          if (onFresh) onFresh(data);
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

export const cacheLists = async (userId, lists) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in cacheLists:', userId);
    return;
  }
  await Storage.set(`lists_${userId}`, lists);
};

export const loadLists = async (userId, onFresh) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadLists:', userId);
    return null;
  }
  
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
  // Validate userId
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
  await cacheLists(userId, newLists);
  
  syncToSupabase('lists', 'insert', {
    id: tempId,
    user_id: userId,
    name: listName
  });
  
  return newLists;
};

export const deleteList = async (userId, currentLists, listId) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in deleteList:', userId);
    return currentLists;
  }
  
  const newLists = currentLists.filter(l => l.id !== listId);
  await cacheLists(userId, newLists);
  
  syncToSupabase('lists', 'delete', {}, { column: 'id', value: listId });
  return newLists;
};

export const renameList = async (userId, currentLists, listId, newName) => {
  // Validate userId
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
        
        // Handle AI Credits Daily Reset
        const today = new Date().toISOString().split('T')[0];
        let currentCredits = data.ai_credits ?? 20;
        
        if (data.username === 'terminator' || data.username === 'saxenaanupam2004') {
          currentCredits = 99999999;
          data.ai_credits = 99999999;
          data.last_credit_reset_date = today;
          
          supabase.from('profiles').update({ 
            ai_credits: 99999999, 
            last_credit_reset_date: today 
          }).eq('id', userId).then(({error}) => {
            if (error) console.log('Failed to set premium credits:', error.message);
          });
        } else if (data.last_credit_reset_date !== today) {
           currentCredits = 20;
           data.ai_credits = 20;
           data.last_credit_reset_date = today;
           
           supabase.from('profiles').update({ 
             ai_credits: 20, 
             last_credit_reset_date: today 
           }).eq('id', userId).then(({error}) => {
             if (error) console.log('Failed to reset credits:', error.message);
           });
        }
        await Storage.set(`aicredits_${userId}`, currentCredits.toString());
        
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
  try {
    await supabase.storage.from('avatar').remove([`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.jpeg`]);
  } catch (e) {
    console.log('[DataManager] Storage cleanup warning:', e.message);
  }
};

// ─── Alarms ──────────────────────────────────────────────

export const cacheAlarms = async (userId, alarms) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in cacheAlarms:', userId);
    return;
  }
  await Storage.set(`alarms_${userId}`, alarms);
  await Storage.set('last_local_write_time', Date.now().toString());
};

export const loadAlarms = async (userId, onFresh) => {
  // Validate userId
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in loadAlarms:', userId);
    return [];
  }
  
  const cached = await Storage.get(`alarms_${userId}`);
  
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
          await Storage.set(`alarms_${userId}`, data);
          if (onFresh) onFresh(data);
        } else {
          console.log('[DataManager] Supabase alarms fetch discarded: Local updates occurred or are pending.');
        }
      }
    } catch (e) {
      console.log('[DataManager] Sync alarms error:', e.message || e);
    }
  };
  
  fetchBackground();
  return cached || [];
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
  
  syncToSupabase('alarms', 'insert', tempAlarm);
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

  syncToSupabase('alarms', 'update', fields, { column: 'id', value: alarmId });
  return updated;
};

export const deleteAlarm = async (userId, currentAlarms, alarmId) => {
  if (!userId || typeof userId !== 'string') {
    console.error('[DataManager] Invalid userId in deleteAlarm:', userId);
    return currentAlarms;
  }
  
  const updated = currentAlarms.filter(a => a.id !== alarmId);
  await cacheAlarms(userId, updated);
  
  syncToSupabase('alarms', 'delete', {}, { column: 'id', value: alarmId });
  return updated;
};

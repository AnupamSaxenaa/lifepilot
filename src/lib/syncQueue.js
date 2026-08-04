/**
 * LifePilot — Offline Sync Queue
 * 
 * Production-grade offline mutation queue inspired by Microsoft To Do and Google Tasks.
 * 
 * HOW IT WORKS:
 * 1. Every Supabase write (insert/update/delete) goes through this queue
 * 2. If the write succeeds → done, nothing queued
 * 3. If the write fails (offline/timeout/error) → operation is saved to AsyncStorage
 * 4. On app launch, screen focus, or network recovery → queue is drained in FIFO order
 * 5. If a queued operation fails again → it stays in the queue for next retry
 * 6. Conflict resolution: last-write-wins (same as Google Tasks)
 * 
 * QUEUE ENTRY SHAPE:
 * {
 *   id: string,           // unique queue entry ID
 *   table: string,         // e.g. 'tasks', 'profiles'
 *   operation: 'insert' | 'update' | 'delete',
 *   data: object,          // the payload
 *   filter: object,        // { column, value } for update/delete
 *   createdAt: string,     // ISO timestamp
 *   retryCount: number,    // how many times we've retried
 * }
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';

const QUEUE_KEY = '@lifepilot_sync_queue';
const DEAD_LETTER_KEY = '@lifepilot_sync_dead_letter';
const MAX_RETRIES = 10;
const MAX_AGE_DAYS = 7; // Drop entries older than 7 days
const MAX_QUEUE_SIZE = 500; // Safety cap — a single AsyncStorage blob shouldn't grow unbounded

// ─── Queue Persistence ─────────────────────────────────

const loadQueue = async () => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveQueue = async (queue) => {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('[SyncQueue] Failed to persist queue:', e);
  }
};

// ─── Dead Letter Log ────────────────────────────────────
// When a mutation is permanently given up on (too old, too many retries, or
// a fatal schema error), it's no longer silently lost — it's recorded here
// so the app can surface "N changes failed to sync" to the user instead of
// data quietly disappearing with no trace.

const loadDeadLetters = async () => {
  try {
    const raw = await AsyncStorage.getItem(DEAD_LETTER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const recordDeadLetter = async (entry, reason) => {
  try {
    const letters = await loadDeadLetters();
    letters.push({
      table: entry.table,
      operation: entry.operation,
      reason,
      droppedAt: new Date().toISOString(),
      originalCreatedAt: entry.createdAt,
    });
    // Keep the log itself bounded too.
    const trimmed = letters.slice(-200);
    await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[SyncQueue] Failed to record dead letter:', e);
  }
};

/**
 * Mutations that were permanently given up on (never made it to the server).
 * Surface this count/list to the user so data loss is never silent.
 */
export const getDeadLetters = async () => loadDeadLetters();

export const clearDeadLetters = async () => {
  await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify([]));
};

// ─── Public API ─────────────────────────────────────────

export const getQueueLength = async () => {
  const queue = await loadQueue();
  return queue.length;
};

/**
 * Execute a Supabase mutation. If it fails, queue it for retry.
 * Local state should ALREADY be updated before calling this (optimistic UI).
 * 
 * @param {string} table - Supabase table name
 * @param {'insert'|'update'|'delete'} operation
 * @param {object} data - Payload for insert/update
 * @param {object} [filter] - { column: string, value: any } for update/delete
 * @returns {object|null} - Supabase response data on success, null on queued
 */
export const syncToSupabase = async (table, operation, data = {}, filter = null) => {
  // 1. Synchronously save to queue FIRST to protect against app kills during network request
  const queueId = await enqueue(table, operation, data, filter);

  try {
    // 2. Try to execute
    const result = await executeOperation(table, operation, data, filter);
    
    // 3. If successful, remove from queue
    await dequeue(queueId);
    return result;
  } catch (error) {
    if (error?.__fatal) {
      // This will never succeed no matter how many times we retry it — don't
      // leave it stuck in the queue forever. Record it and remove it now.
      await dequeue(queueId);
      await recordDeadLetter({ table, operation, createdAt: new Date().toISOString() }, error.message || 'fatal_error');
      console.warn(`[SyncQueue] Dropped ${operation} on ${table} — fatal error:`, error.message);
      return null;
    }
    // Network error or Supabase down → leave in queue for retry
    console.log(`[SyncQueue] Left ${operation} on ${table} in queue due to error:`, error.message || error);
    return null;
  }
};

/**
 * Durably queue a mutation WITHOUT attempting the network round-trip inline.
 *
 * This exists for callers running in a tight, latency-sensitive context where
 * blocking on a Supabase request is harmful — most notably the Android
 * home-screen widget's headless click task. Widget click tasks are serialized
 * by the OS, so if one tap awaits a full network request the NEXT tap (e.g.
 * opening the steps dropdown) is stuck waiting behind it.
 *
 * The mutation is persisted to the same queue `syncToSupabase` uses, so it is
 * guaranteed durable and will be pushed to the server by the normal drain
 * triggers (app launch, screen focus, network recovery). Returns as soon as
 * the (single) AsyncStorage write completes.
 *
 * @returns {Promise<string>} the queue entry id
 */
export const enqueueMutation = async (table, operation, data = {}, filter = null) => {
  return enqueue(table, operation, data, filter);
};

/**
 * Drain the queue — retry all pending operations in order.
 * Call this on:
 * - App launch (after auth)
 * - Screen focus
 * - Network recovery
 * 
 * @returns {{ succeeded: number, failed: number, remaining: number }}
 */
export const drainSyncQueue = async () => {
  const queue = await loadQueue();
  if (queue.length === 0) return { succeeded: 0, failed: 0, remaining: 0 };

  console.log(`[SyncQueue] Draining ${queue.length} queued operations...`);

  const survivors = [];
  let succeeded = 0;
  let failed = 0;
  const now = Date.now();

  for (const entry of queue) {
    // ✅ Check if entry is too old (7+ days)
    const ageMs = now - new Date(entry.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    
    if (ageDays > MAX_AGE_DAYS) {
      console.warn(`[SyncQueue] Dropping stale entry (${ageDays.toFixed(1)} days old):`, entry);
      await recordDeadLetter(entry, 'stale');
      continue;
    }
    
    if (entry.retryCount >= MAX_RETRIES) {
      // Give up on this entry — it's been tried too many times
      console.warn(`[SyncQueue] Dropping entry after ${MAX_RETRIES} retries:`, entry);
      await recordDeadLetter(entry, 'max_retries');
      continue;
    }

    try {
      await executeOperation(entry.table, entry.operation, entry.data, entry.filter);
      succeeded++;
    } catch (err) {
      if (err?.__fatal) {
        // Fatal/permanent error (schema mismatch, etc) — retrying won't help.
        await recordDeadLetter(entry, err.message || 'fatal_error');
        continue;
      }
      entry.retryCount = (entry.retryCount || 0) + 1;
      survivors.push(entry);
      failed++;
    }
  }

  await saveQueue(survivors);
  console.log(`[SyncQueue] Drain complete: ${succeeded} synced, ${failed} still pending`);
  return { succeeded, failed, remaining: survivors.length };
};

/**
 * Get the number of pending operations in the queue.
 */
export const getPendingCount = async () => {
  const queue = await loadQueue();
  return queue.length;
};

/**
 * Clear the entire sync queue (e.g. on logout).
 */
export const clearSyncQueue = async () => {
  await saveQueue([]);
};

// ─── Internal ───────────────────────────────────────────

const enqueue = async (table, operation, data, filter) => {
  const queue = await loadQueue();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  queue.push({
    id,
    table,
    operation,
    data,
    filter,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });

  // Safety cap: if a device is offline for a very long time, don't let a
  // single AsyncStorage blob grow unbounded. Drop the OLDEST entries first
  // (they're the most likely to be superseded by later edits anyway) and
  // record them so they're visible instead of silently vanishing.
  if (queue.length > MAX_QUEUE_SIZE) {
    const overflow = queue.length - MAX_QUEUE_SIZE;
    const dropped = queue.splice(0, overflow);
    for (const entry of dropped) {
      await recordDeadLetter(entry, 'queue_overflow');
    }
    console.warn(`[SyncQueue] Queue exceeded ${MAX_QUEUE_SIZE} — dropped ${overflow} oldest entries.`);
  }

  await saveQueue(queue);
  return id;
};

const dequeue = async (id) => {
  const queue = await loadQueue();
  const filtered = queue.filter(entry => entry.id !== id);
  await saveQueue(filtered);
};

// Postgres/PostgREST error CODES that mean "this will never succeed no
// matter how many times we retry" — matched on the structured `code` field
// (stable across Postgres versions), not on free-text message content, which
// is brittle and can accidentally match transient/legitimate errors.
//   PGRST204 — no rows returned when one was expected (schema/data mismatch)
//   42703    — undefined_column
//   42P01    — undefined_table
const FATAL_ERROR_CODES = new Set(['PGRST204', '42703', '42P01']);

const executeOperation = async (table, operation, data, filter) => {
  const handleError = (error) => {
    if (error && FATAL_ERROR_CODES.has(error.code)) {
      console.warn(`[SyncQueue] Fatal schema error, giving up on ${operation} on ${table}:`, error.message);
      const fatalErr = new Error(error.message || 'fatal_schema_error');
      fatalErr.__fatal = true;
      throw fatalErr;
    }
    throw error;
  };

  let query;
  switch (operation) {
    case 'insert': {
      const { data: result, error } = await supabase.from(table).insert(data).select().single();
      if (error) return handleError(error);
      return result;
    }
    case 'upsert': {
      // filter.column is used as the conflict target (e.g. 'user_id')
      const conflictCol = filter?.column;
      const { data: result, error } = await supabase
        .from(table)
        .upsert(data, conflictCol ? { onConflict: conflictCol } : undefined)
        .select()
        .single();
      if (error) return handleError(error);
      return result;
    }
    case 'update': {
      if (!filter) throw new Error('Update requires a filter');
      const { data: result, error } = await supabase
        .from(table)
        .update(data)
        .eq(filter.column, filter.value)
        .select()
        .single();
      if (error) return handleError(error);
      return result;
    }
    case 'delete': {
      if (!filter) throw new Error('Delete requires a filter');
      const { error } = await supabase
        .from(table)
        .delete()
        .eq(filter.column, filter.value);
      if (error) return handleError(error);
      return null;
    }
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
};

// ─── Network Recovery Listener ──────────────────────────

let _unsubscribeNetInfo = null;
let _wasOffline = false;

/**
 * Start listening for network changes. When connectivity is restored
 * after being offline, automatically drain the sync queue.
 * Call once at app startup (e.g. in App.js).
 * 
 * @returns {function} unsubscribe — call to stop listening
 */
export const setupNetworkListener = () => {
  if (_unsubscribeNetInfo) return _unsubscribeNetInfo; // Already listening

  _unsubscribeNetInfo = NetInfo.addEventListener(async (state) => {
    const isOnline = state.isConnected && state.isInternetReachable !== false;

    if (!isOnline) {
      _wasOffline = true;
      console.log('[SyncQueue] Device went offline');
      return;
    }

    if (_wasOffline && isOnline) {
      _wasOffline = false;
      console.log('[SyncQueue] Back online — draining sync queue...');
      try {
        const result = await drainSyncQueue();
        if (result.succeeded > 0) {
          console.log(`[SyncQueue] Auto-synced ${result.succeeded} operations on reconnect`);
        }
      } catch (e) {
        console.warn('[SyncQueue] Auto-drain failed:', e.message);
      }
    }
  });

  return _unsubscribeNetInfo;
};

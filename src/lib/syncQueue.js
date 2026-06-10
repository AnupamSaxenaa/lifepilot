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
import { supabase } from '../lib/supabase';

const QUEUE_KEY = '@lifepilot_sync_queue';
const MAX_RETRIES = 10;

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
  try {
    const result = await executeOperation(table, operation, data, filter);
    return result;
  } catch (error) {
    // Network error or Supabase down → queue for retry
    console.log(`[SyncQueue] Queuing ${operation} on ${table}:`, error.message || error);
    await enqueue(table, operation, data, filter);
    return null;
  }
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

  for (const entry of queue) {
    if (entry.retryCount >= MAX_RETRIES) {
      // Give up on this entry — it's been tried too many times
      console.warn(`[SyncQueue] Dropping entry after ${MAX_RETRIES} retries:`, entry);
      continue;
    }

    try {
      await executeOperation(entry.table, entry.operation, entry.data, entry.filter);
      succeeded++;
    } catch {
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
  queue.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    table,
    operation,
    data,
    filter,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
  await saveQueue(queue);
};

const executeOperation = async (table, operation, data, filter) => {
  let query;

  switch (operation) {
    case 'insert': {
      const { data: result, error } = await supabase.from(table).insert(data).select().single();
      if (error) throw error;
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
      if (error) throw error;
      return result;
    }
    case 'delete': {
      if (!filter) throw new Error('Delete requires a filter');
      const { error } = await supabase
        .from(table)
        .delete()
        .eq(filter.column, filter.value);
      if (error) throw error;
      return null;
    }
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
};

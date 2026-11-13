/**
 * LifePilot — durable offline mutation queue.
 *
 * Table mutations retain their original positional API. Version 2 entries add
 * collaboration scope and idempotency metadata, and RPC mutations share the
 * same durable queue and retry lifecycle.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';

const QUEUE_KEY = '@lifepilot_sync_queue';
const DEAD_LETTER_KEY = '@lifepilot_sync_dead_letter';
const CONFLICT_KEY = '@lifepilot_sync_conflicts';
const QUEUE_ENTRY_VERSION = 2;
// A large queue is worth surfacing, but never worth deleting valid offline
// work. Entries leave only after success, an explicit conflict, or a fatal
// schema error that retrying cannot fix.
const QUEUE_WARNING_SIZE = 5000;

let _activeSyncUser = null;
// null means NetInfo has not produced an authoritative state yet. Treat that
// as offline for delivery while still accepting every durable local write.
let _isOnline = null;
let _pendingCount = 0;
let _conflictCount = 0;
const _stateListeners = new Set();

const createSerializer = () => {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
};

const withQueueLock = createSerializer();
const withDrainLock = createSerializer();
const withDeadLetterLock = createSerializer();
const withConflictLock = createSerializer();
const _executingEntryIds = new Set();

const stateSnapshot = () => ({
  online: _isOnline === true,
  connectivityKnown: _isOnline !== null,
  pending: _pendingCount,
  conflicts: _conflictCount,
});

const emitSyncState = () => {
  const snapshot = stateSnapshot();
  _stateListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[SyncQueue] Sync state listener failed:', error?.message || error);
    }
  });
};

const parseArray = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadQueue = async () => {
  try {
    const queue = parseArray(await AsyncStorage.getItem(QUEUE_KEY));
    _pendingCount = queue.length;
    return queue;
  } catch {
    return [];
  }
};

const saveQueue = async (queue) => {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    _pendingCount = queue.length;
    emitSyncState();
  } catch (error) {
    console.warn('[SyncQueue] Failed to persist queue:', error);
    throw error;
  }
};

const loadDeadLetters = async () => {
  try {
    return parseArray(await AsyncStorage.getItem(DEAD_LETTER_KEY));
  } catch {
    return [];
  }
};

const recordDeadLetter = (entry, reason) => withDeadLetterLock(async () => {
  try {
    const letters = await loadDeadLetters();
    letters.push({
      table: entry.table,
      rpc: entry.rpc,
      operation: entry.operation,
      reason,
      droppedAt: new Date().toISOString(),
      originalCreatedAt: entry.createdAt,
      actorUserId: entry.actorUserId ?? null,
      spaceId: entry.spaceId ?? null,
      entityId: entry.entityId ?? null,
      clientMutationId: entry.clientMutationId ?? null,
    });
    await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(letters.slice(-200)));
  } catch (error) {
    console.warn('[SyncQueue] Failed to record dead letter:', error);
  }
});

const loadConflicts = async () => {
  try {
    const conflicts = parseArray(await AsyncStorage.getItem(CONFLICT_KEY));
    _conflictCount = conflicts.length;
    return conflicts;
  } catch {
    return [];
  }
};

const saveConflicts = async (conflicts) => {
  await AsyncStorage.setItem(CONFLICT_KEY, JSON.stringify(conflicts.slice(-500)));
  _conflictCount = Math.min(conflicts.length, 500);
  emitSyncState();
};

const generateUuid = () => {
  let timestamp = Date.now();
  let performanceTime = typeof performance !== 'undefined' && performance.now
    ? performance.now() * 1000
    : 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    let random = Math.random() * 16;
    if (timestamp > 0) {
      random = (timestamp + random) % 16 | 0;
      timestamp = Math.floor(timestamp / 16);
    } else {
      random = (performanceTime + random) % 16 | 0;
      performanceTime = Math.floor(performanceTime / 16);
    }
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
};

const scopeSource = (scopeOrOptions) => {
  if (!scopeOrOptions || typeof scopeOrOptions !== 'object') return {};
  const nested = scopeOrOptions.scope;
  return nested && typeof nested === 'object'
    ? { ...nested, ...scopeOrOptions }
    : scopeOrOptions;
};

const valueFrom = (object, keys) => {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
};

const buildMetadata = (scopeOrOptions, inferred = {}) => {
  const source = scopeSource(scopeOrOptions);
  return {
    actorUserId: valueFrom(source, ['actorUserId', 'userId'])
      ?? inferred.actorUserId
      ?? _activeSyncUser
      ?? null,
    spaceId: valueFrom(source, ['spaceId']) ?? inferred.spaceId ?? null,
    entityId: valueFrom(source, ['entityId']) ?? inferred.entityId ?? null,
    clientMutationId: valueFrom(source, ['clientMutationId']) || generateUuid(),
    expectedVersion: valueFrom(source, ['expectedVersion']) ?? inferred.expectedVersion ?? null,
  };
};

const buildTableEntry = (table, operation, data, filter, options) => ({
  id: generateUuid(),
  version: QUEUE_ENTRY_VERSION,
  queueVersion: QUEUE_ENTRY_VERSION,
  kind: 'table',
  table,
  operation,
  data,
  filter,
  ...buildMetadata(options, {
    actorUserId: valueFrom(data, ['actorUserId', 'actor_user_id', 'user_id']),
    spaceId: valueFrom(data, ['spaceId', 'space_id']),
    entityId: valueFrom(data, ['entityId', 'entity_id', 'id']) ?? filter?.value,
    expectedVersion: valueFrom(data, ['expectedVersion', 'expected_version']),
  }),
  createdAt: new Date().toISOString(),
  retryCount: 0,
});

const buildRpcEntry = (rpc, args, options) => ({
  id: generateUuid(),
  version: QUEUE_ENTRY_VERSION,
  queueVersion: QUEUE_ENTRY_VERSION,
  kind: 'rpc',
  rpc,
  args,
  operation: 'rpc',
  ...buildMetadata(options, {
    actorUserId: valueFrom(args, ['actorUserId', 'actor_user_id', 'p_actor_user_id', 'user_id', 'p_user_id']),
    spaceId: valueFrom(args, ['spaceId', 'space_id', 'p_space_id']),
    entityId: valueFrom(args, ['entityId', 'entity_id', 'p_entity_id', 'id', 'p_id']),
    expectedVersion: valueFrom(args, ['expectedVersion', 'expected_version', 'p_expected_version']),
  }),
  createdAt: new Date().toISOString(),
  retryCount: 0,
});

const matchesScope = (entry, requestedScope) => {
  if (!requestedScope || typeof requestedScope !== 'object') return true;
  const scope = scopeSource(requestedScope);
  const actorUserId = valueFrom(scope, ['actorUserId', 'userId']);
  if (
    actorUserId !== undefined
    && entry.actorUserId !== actorUserId
    && !(scope.includeUnscoped === true && entry.actorUserId == null)
  ) return false;
  if (scope.spaceId !== undefined && entry.spaceId !== scope.spaceId) return false;
  if (scope.entityId !== undefined && entry.entityId !== scope.entityId) return false;
  if (scope.clientMutationId !== undefined && entry.clientMutationId !== scope.clientMutationId) return false;
  return true;
};

const canDrainEntry = (entry) => (
  entry.actorUserId == null
  || (_activeSyncUser != null && entry.actorUserId === _activeSyncUser)
);

const VERSION_CONFLICT_CODES = new Set(['40001']);
const PERMISSION_CONFLICT_CODES = new Set(['42501']);
const VALIDATION_CONFLICT_CODES = new Set(['22023', '23503', '23514']);
const FATAL_ERROR_CODES = new Set([
  'PGRST202',
  'PGRST204',
  'PGRST205',
  '42703',
  '42883',
  '42P01',
  // Data-type errors are permanent for a given payload: retrying the exact same
  // value can never succeed. Treating them as retryable let a single malformed
  // entry (a UUID task id sent at a bigint column) sit at the head of the queue
  // and block every later mutation behind it indefinitely.
  '22P02', // invalid input syntax / invalid_text_representation
  '22003', // numeric value out of range
  '22007', // invalid datetime format
  '22008', // datetime field overflow
]);

const classifyError = (error) => {
  const code = error?.code;
  const message = String(error?.message || error || 'unknown_sync_error');
  const normalized = new Error(message);
  normalized.code = code;
  normalized.details = error?.details;
  normalized.hint = error?.hint;

  if (VERSION_CONFLICT_CODES.has(code) || message.toLowerCase().includes('collaboration_conflict')) {
    normalized.__conflict = 'version_conflict';
  } else if (PERMISSION_CONFLICT_CODES.has(code)) {
    normalized.__conflict = 'permission_revoked';
  } else if (VALIDATION_CONFLICT_CODES.has(code)) {
    normalized.__conflict = 'validation_conflict';
  } else if (FATAL_ERROR_CODES.has(code)) {
    normalized.__fatal = true;
  }
  return normalized;
};

const recordConflict = (entry, error) => withConflictLock(async () => {
  const conflicts = await loadConflicts();
  const existingIndex = conflicts.findIndex((conflict) => (
    conflict.clientMutationId === entry.clientMutationId
    || conflict.entry?.id === entry.id
  ));
  const conflict = {
    id: existingIndex >= 0 ? conflicts[existingIndex].id : generateUuid(),
    type: error.__conflict,
    code: error.code ?? null,
    message: error.message,
    conflictedAt: new Date().toISOString(),
    actorUserId: entry.actorUserId ?? null,
    spaceId: entry.spaceId ?? null,
    entityId: entry.entityId ?? null,
    clientMutationId: entry.clientMutationId ?? null,
    expectedVersion: entry.expectedVersion ?? null,
    entry,
  };
  if (existingIndex >= 0) conflicts[existingIndex] = conflict;
  else conflicts.push(conflict);
  await saveConflicts(conflicts);
  return conflict;
});

const executeOperation = async (table, operation, data, filter) => {
  let response;
  switch (operation) {
    case 'insert':
      response = await supabase.from(table).insert(data).select().single();
      break;
    case 'upsert': {
      const conflictColumn = filter?.column;
      response = await supabase
        .from(table)
        .upsert(data, conflictColumn ? { onConflict: conflictColumn } : undefined)
        .select()
        .single();
      break;
    }
    case 'update':
      if (!filter) throw new Error('Update requires a filter');
      response = await supabase
        .from(table)
        .update(data)
        .eq(filter.column, filter.value)
        .select()
        .single();
      break;
    case 'delete': {
      if (!filter) throw new Error('Delete requires a filter');
      const { error } = await supabase
        .from(table)
        .delete()
        .eq(filter.column, filter.value);
      if (error) throw classifyError(error);
      return null;
    }
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  if (response.error) throw classifyError(response.error);
  return response.data;
};

const executeEntry = async (entry) => {
  if (entry.kind === 'rpc' || entry.operation === 'rpc') {
    const { data, error } = await supabase.rpc(entry.rpc, entry.args || {});
    if (error) throw classifyError(error);
    return data;
  }
  return executeOperation(entry.table, entry.operation, entry.data, entry.filter);
};

const appendEntry = async (queue, entry) => {
  queue.push(entry);
  if (queue.length === QUEUE_WARNING_SIZE + 1) {
    console.warn(`[SyncQueue] Queue exceeded ${QUEUE_WARNING_SIZE} entries; retaining all offline work.`);
  }
  await saveQueue(queue);
  return entry.id;
};

const enqueueEntry = (entry) => withQueueLock(async () => {
  const queue = await loadQueue();
  return appendEntry(queue, entry);
});

const removeQueuedEntry = async (entryId) => {
  const latestQueue = await loadQueue();
  await saveQueue(latestQueue.filter((queuedEntry) => queuedEntry.id !== entryId));
};

const persistAndExecute = async (entry) => {
  await withQueueLock(async () => {
    const queue = await loadQueue();
    await appendEntry(queue, entry);
  });

  // Persistence is the success condition while offline. The first verified
  // online NetInfo event (or a later foreground drain) will deliver it.
  if (_isOnline !== true) return null;

  _executingEntryIds.add(entry.id);
  try {
    const result = await executeEntry(entry);
    await withQueueLock(() => removeQueuedEntry(entry.id));
    return result;
  } catch (rawError) {
    const error = rawError?.__fatal || rawError?.__conflict ? rawError : classifyError(rawError);
    if (error.__conflict) {
      await withQueueLock(async () => {
        await recordConflict(entry, error);
        await removeQueuedEntry(entry.id);
      });
      console.warn(`[SyncQueue] Persisted ${error.__conflict}:`, error.message);
      return null;
    }
    if (error.__fatal) {
      await withQueueLock(async () => {
        await recordDeadLetter(entry, error.message || 'fatal_schema_error');
        await removeQueuedEntry(entry.id);
      });
      console.warn('[SyncQueue] Dropped mutation after fatal schema error:', error.message);
      return null;
    }
    console.log('[SyncQueue] Mutation remains queued:', error.message || error);
    return null;
  } finally {
    _executingEntryIds.delete(entry.id);
  }
};

export const setActiveSyncUser = (userId) => {
  _activeSyncUser = userId || null;
  emitSyncState();
};

export const getSyncState = () => stateSnapshot();

export const syncToSupabase = async (
  table,
  operation,
  data = {},
  filter = null,
  options = null,
) => persistAndExecute(buildTableEntry(table, operation, data, filter, options));

export const enqueueMutation = async (
  table,
  operation,
  data = {},
  filter = null,
  options = null,
) => enqueueEntry(buildTableEntry(table, operation, data, filter, options));

export const syncRpc = async (rpc, args = {}, scopeOrOptions = null) => (
  persistAndExecute(buildRpcEntry(rpc, args, scopeOrOptions))
);

export const enqueueRpc = async (rpc, args = {}, scopeOrOptions = null) => (
  enqueueEntry(buildRpcEntry(rpc, args, scopeOrOptions))
);

export const getPendingEntries = async (scope = null) => {
  const queue = await loadQueue();
  return queue.filter((entry) => matchesScope(entry, scope));
};

export const getPendingCount = async (scope = null) => (
  (await getPendingEntries(scope)).length
);

export const getQueueLength = async () => getPendingCount();

export const clearSyncQueue = async () => withQueueLock(async () => {
  await saveQueue([]);
});

export const getDeadLetters = async (scope = null) => {
  const letters = await loadDeadLetters();
  return letters.filter((letter) => matchesScope(letter, scope));
};

export const clearDeadLetters = async (scope = null) => withDeadLetterLock(async () => {
  const letters = await loadDeadLetters();
  const remaining = scope
    ? letters.filter((letter) => !matchesScope(letter, scope))
    : [];
  await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(remaining));
});

export const getConflicts = async (scope = null) => {
  const conflicts = await loadConflicts();
  return conflicts.filter((conflict) => matchesScope(conflict, scope));
};

export const clearConflict = async (conflictId) => withConflictLock(async () => {
  const conflicts = await loadConflicts();
  const remaining = conflictId == null
    ? []
    : conflicts.filter((conflict) => (
      conflict.id !== conflictId && conflict.clientMutationId !== conflictId
    ));
  const removed = remaining.length !== conflicts.length;
  await saveConflicts(remaining);
  return removed;
});

export const subscribeSyncState = (listener) => {
  if (typeof listener !== 'function') throw new TypeError('Sync state listener must be a function');
  _stateListeners.add(listener);
  listener(stateSnapshot());
  Promise.all([loadQueue(), loadConflicts()])
    .then(() => emitSyncState())
    .catch(() => {});
  return () => _stateListeners.delete(listener);
};

const mergeDrainSurvivors = (latestQueue, processedIds, survivors) => {
  const survivorById = new Map(survivors.map((entry) => [entry.id, entry]));
  return latestQueue
    .filter((entry) => !processedIds.has(entry.id) || survivorById.has(entry.id))
    .map((entry) => survivorById.get(entry.id) || entry);
};

const probeSyncConnectivity = async () => {
  if (_isOnline === true) return true;
  try {
    const state = await NetInfo.fetch();
    const verifiedOnline = state.isConnected === true && state.isInternetReachable === true;
    const verifiedOffline = state.isConnected === false || state.isInternetReachable === false;
    const nextOnline = verifiedOnline ? true : verifiedOffline ? false : null;
    if (_isOnline !== nextOnline) {
      _isOnline = nextOnline;
      emitSyncState();
    }
    return verifiedOnline;
  } catch {
    return false;
  }
};

export const drainSyncQueue = async () => withDrainLock(async () => {
  const queue = await withQueueLock(() => loadQueue());
  if (_isOnline !== true) await probeSyncConnectivity();
  if (_isOnline !== true) {
    return {
      succeeded: 0,
      failed: 0,
      remaining: queue.length,
      offline: true,
      connectivityKnown: _isOnline !== null,
    };
  }
  if (queue.length === 0) return { succeeded: 0, failed: 0, remaining: 0 };

  const survivors = [];
  const deadLetters = [];
  const conflicts = [];
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index];
    if (_executingEntryIds.has(entry.id) || !canDrainEntry(entry)) {
      survivors.push(entry);
      continue;
    }

    try {
      await executeEntry(entry);
      succeeded += 1;
    } catch (rawError) {
      const error = rawError?.__fatal || rawError?.__conflict ? rawError : classifyError(rawError);
      if (error.__conflict) {
        conflicts.push([entry, error]);
        continue;
      }
      if (error.__fatal) {
        deadLetters.push([entry, error.message || 'fatal_schema_error']);
        continue;
      }

      // A transient transport/server failure is not evidence that any local
      // mutation is invalid. Preserve this entry and the untouched tail, then
      // wait for the next verified-online/foreground drain instead of creating
      // a request storm or aging valid user work toward deletion.
      survivors.push(entry, ...queue.slice(index + 1));
      failed += 1;
      break;
    }
  }

  const processedIds = new Set(queue.map((entry) => entry.id));
  const remaining = await withQueueLock(async () => {
    for (const [entry, reason] of deadLetters) {
      await recordDeadLetter(entry, reason);
    }
    for (const [entry, error] of conflicts) {
      await recordConflict(entry, error);
    }
    const latestQueue = await loadQueue();
    const mergedQueue = mergeDrainSurvivors(latestQueue, processedIds, survivors);
    await saveQueue(mergedQueue);
    return mergedQueue.length;
  });

  console.log(`[SyncQueue] Drain complete: ${succeeded} synced, ${failed} still pending`);
  return { succeeded, failed, remaining };
});

let _unsubscribeNetInfo = null;
let _hasNetworkState = false;
let _wasOffline = false;

export const setupNetworkListener = () => {
  if (_unsubscribeNetInfo) return _unsubscribeNetInfo;

  const unsubscribe = NetInfo.addEventListener(async (state) => {
    const verifiedOnline = state.isConnected === true && state.isInternetReachable === true;
    const verifiedOffline = state.isConnected === false || state.isInternetReachable === false;
    const nextOnline = verifiedOnline ? true : verifiedOffline ? false : null;

    if (nextOnline === null) {
      if (_isOnline !== null) {
        _isOnline = null;
        emitSyncState();
      }
      return;
    }

    const shouldDrain = nextOnline && (!_hasNetworkState || _wasOffline);
    _hasNetworkState = true;
    if (_isOnline !== nextOnline) {
      _isOnline = nextOnline;
      emitSyncState();
    }

    if (!nextOnline) {
      _wasOffline = true;
      console.log('[SyncQueue] Device went offline');
      return;
    }

    _wasOffline = false;
    if (!shouldDrain) return;

    console.log('[SyncQueue] Verified online — draining sync queue...');
    try {
      const result = await drainSyncQueue();
      if (result.succeeded > 0) {
        console.log(`[SyncQueue] Auto-synced ${result.succeeded} operations`);
      }
    } catch (error) {
      console.warn('[SyncQueue] Auto-drain failed:', error?.message || error);
    }
  });

  _unsubscribeNetInfo = () => {
    unsubscribe?.();
    _unsubscribeNetInfo = null;
    _hasNetworkState = false;
    _wasOffline = false;
    _isOnline = null;
    emitSyncState();
  };
  return _unsubscribeNetInfo;
};

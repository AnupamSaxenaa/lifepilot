/**
 * Single authenticated realtime coordinator for collaboration data.
 * It patches safe row events locally and debounces authoritative refreshes.
 */
import {
    COLLABORATION_TABLES,
    getPendingClientMutationIds,
    patchCollaborationCache,
    purgeSpaceCache,
    refreshCollaboration,
    subscribeCollaborationSyncState,
} from './collaborationManager';
import { supabase } from './supabase';

const listeners = new Set();
const REFRESH_DEBOUNCE_MS = 300;

let activeUserId = null;
let channel = null;
let authSubscription = null;
let syncSubscription = null;
let refreshTimer = null;
let generation = 0;

const sanitize = (value) => {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).reduce((safe, key) => {
    if (!/^(token|invite_token|raw_token)$/i.test(key)) safe[key] = sanitize(value[key]);
    return safe;
  }, {});
};

const publish = (event) => {
  const safeEvent = sanitize(event);
  listeners.forEach((listener) => {
    try {
      listener(safeEvent);
    } catch {
      // One consumer must not interrupt cache reconciliation for the others.
    }
  });
};

export const subscribeCollaboration = (listener) => {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const scheduleAuthoritativeRefresh = (reason = 'realtime') => {
  if (!activeUserId) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  const scheduledUserId = activeUserId;
  const scheduledGeneration = generation;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    if (scheduledGeneration !== generation || scheduledUserId !== activeUserId) return;
    const result = await refreshCollaboration(scheduledUserId).catch(() => null);
    if (!result || scheduledGeneration !== generation || scheduledUserId !== activeUserId) return;
    publish({ type: 'refresh', reason, userId: scheduledUserId, data: result });
  }, REFRESH_DEBOUNCE_MS);
};

const handleDatabaseEvent = async (table, payload, eventGeneration) => {
  if (!activeUserId || eventGeneration !== generation) return;
  const userId = activeUserId;
  const eventType = payload?.eventType || 'UPDATE';
  const row = eventType === 'DELETE' ? payload?.old : payload?.new;
  if (!row) {
    scheduleAuthoritativeRefresh(`${table}:${eventType}`);
    return;
  }

  const pendingIds = await getPendingClientMutationIds().catch(() => new Set());
  if (eventGeneration !== generation || userId !== activeUserId) return;
  const patch = await patchCollaborationCache(userId, table, eventType, row, pendingIds);
  if (patch.purgeSpaceId != null) {
    await purgeSpaceCache(userId, patch.purgeSpaceId);
    publish({ type: 'membership_revoked', spaceId: patch.purgeSpaceId, userId });
  }
  if (patch.patched) {
    publish({ type: 'row', table, eventType, row, userId });
  }
  // Joins, permissions, and membership visibility are server-authoritative.
  scheduleAuthoritativeRefresh(`${table}:${eventType}`);
};

const addTableSubscription = (realtimeChannel, table, eventGeneration) => realtimeChannel.on(
  'postgres_changes',
  { event: '*', schema: 'public', table },
  (payload) => handleDatabaseEvent(table, payload, eventGeneration).catch(() => {
    scheduleAuthoritativeRefresh(`${table}:patch_error`);
  }),
);

export const stopCollaborationRealtime = async () => {
  generation += 1;
  activeUserId = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (typeof syncSubscription === 'function') syncSubscription();
  syncSubscription = null;
  if (authSubscription) authSubscription.unsubscribe();
  authSubscription = null;
  const oldChannel = channel;
  channel = null;
  if (oldChannel) {
    try {
      await supabase.removeChannel(oldChannel);
    } catch {
      // Already disconnected or client teardown; local coordinator is stopped.
    }
  }
  publish({ type: 'stopped' });
};

export const startCollaborationRealtime = async (userId) => {
  if (typeof userId !== 'string' || !userId) throw new Error('A valid userId is required');
  if (activeUserId === userId && channel) return stopCollaborationRealtime;
  if (activeUserId || channel) await stopCollaborationRealtime();

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data?.session?.user?.id || String(data.session.user.id) !== String(userId)) {
    throw new Error('An authenticated session for this user is required');
  }

  activeUserId = userId;
  generation += 1;
  const currentGeneration = generation;
  let realtimeChannel = supabase.channel(`collaboration:${userId}`);
  Object.values(COLLABORATION_TABLES).forEach((table) => {
    realtimeChannel = addTableSubscription(realtimeChannel, table, currentGeneration);
  });
  channel = realtimeChannel.subscribe((status) => {
    if (currentGeneration !== generation) return;
    publish({ type: 'status', status, userId });
    if (status === 'SUBSCRIBED') scheduleAuthoritativeRefresh('subscribed');
  });

  const authResult = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user || String(session.user.id) !== String(activeUserId)) {
      stopCollaborationRealtime().catch(() => {});
    }
  });
  authSubscription = authResult?.data?.subscription || null;
  syncSubscription = subscribeCollaborationSyncState(() => {
    scheduleAuthoritativeRefresh('sync_state');
  });
  publish({ type: 'started', userId });
  return stopCollaborationRealtime;
};

export const getCollaborationRealtimeState = () => ({
  active: Boolean(activeUserId && channel),
  userId: activeUserId,
});

// Authenticated, per-app-session presence coordinator.
// Presence is deliberately never queued: replaying a stale heartbeat would lie.
import { supabase } from './supabase';

const HEARTBEAT_MS = 60 * 1000;
const DEFAULT_STOP_TIMEOUT_MS = 1500;

// This UUID is only a collision-resistant row key; authorization always comes
// from auth.uid() inside the RPCs, so it is intentionally not a secret/token.
const createSessionId = () => {
  let timestamp = Date.now();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = (timestamp + Math.random() * 16) % 16 | 0;
    timestamp = Math.floor(timestamp / 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
};

let currentSession = null;
let heartbeatTimer = null;
let lifecycle = Promise.resolve();

const clearHeartbeatTimer = () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
};

const enqueue = (operation) => {
  const result = lifecycle.catch(() => {}).then(operation);
  lifecycle = result.catch(() => {});
  return result;
};

const callPresenceRpc = async (name, sessionId) => {
  try {
    const { error } = await supabase.rpc(name, { p_session_id: sessionId });
    return !error;
  } catch {
    return false;
  }
};

const heartbeat = (session) => enqueue(async () => {
  if (currentSession !== session || !session.running) return false;
  return callPresenceRpc('heartbeat_presence', session.sessionId);
});

const waitAtMost = async (promise, timeoutMs) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timeout = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/** Begin/reopen this app session and heartbeat while the app is active. */
export const startPresence = (userId) => {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!normalizedUserId) return Promise.resolve(false);

  if (!currentSession || currentSession.userId !== normalizedUserId) {
    clearHeartbeatTimer();
    currentSession = {
      userId: normalizedUserId,
      sessionId: createSessionId(),
      running: false,
      ended: true,
    };
  }

  const session = currentSession;
  if (session.running) return lifecycle.then(() => true, () => false);

  session.running = true;
  session.ended = false;
  const begun = enqueue(async () => {
    if (currentSession !== session || !session.running) return false;
    return callPresenceRpc('begin_presence', session.sessionId);
  });
  heartbeatTimer = setInterval(() => { heartbeat(session); }, HEARTBEAT_MS);
  return begun;
};

/** End the current session immediately, retaining its ID for a later foreground. */
export const endPresence = (userId) => {
  const session = currentSession;
  if (!session || (userId && session.userId !== String(userId))) {
    return Promise.resolve(false);
  }

  clearHeartbeatTimer();
  session.running = false;
  if (session.ended) return lifecycle.then(() => true, () => false);

  session.ended = true;
  return enqueue(() => callPresenceRpc('end_presence', session.sessionId));
};

/**
 * Permanently release the current coordinator generation (logout/account swap).
 * The bounded wait keeps logout responsive when offline; timestamp decay remains
 * the fallback when the final authenticated RPC cannot reach the server.
 */
export const stopPresence = async (userId, { timeoutMs = DEFAULT_STOP_TIMEOUT_MS } = {}) => {
  const session = currentSession;
  if (!session || (userId && session.userId !== String(userId))) return true;

  const ending = endPresence(session.userId);
  if (currentSession === session) currentSession = null;
  clearHeartbeatTimer();
  return waitAtMost(ending, timeoutMs);
};
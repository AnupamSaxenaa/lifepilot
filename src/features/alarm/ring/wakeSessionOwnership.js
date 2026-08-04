// Process-local guard against the same Notifee wake intent mounting more than
// one alarm controller (for example, full-screen launch followed by a tap).
// Durable recovery remains owned by wakeSessionRecovery; this only protects
// concurrent React roots in the current process.
const ownedWakeSessions = new Set();

export const claimWakeSessionOwnership = (wakeSessionId) => {
  if (!wakeSessionId || ownedWakeSessions.has(wakeSessionId)) return false;
  ownedWakeSessions.add(wakeSessionId);
  return true;
};

export const releaseWakeSessionOwnership = (wakeSessionId) => {
  if (!wakeSessionId) return false;
  return ownedWakeSessions.delete(wakeSessionId);
};

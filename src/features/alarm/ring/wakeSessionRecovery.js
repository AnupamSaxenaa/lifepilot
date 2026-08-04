import i18n from 'i18next';
import { recordWakeSession } from '../../../lib/dataManager';
import { Storage } from '../../../utils/storage';
import { normalizeAlarm } from '../data/alarmModel';
import { rescheduleAlarm, showMissedAlarmRecovery } from '../scheduler/alarmScheduler';

const PENDING_KEY = 'alarm_pending_wake_sessions';
const ACTIVE_STALE_MS = 2 * 60 * 1000;
const SNOOZE_GRACE_MS = 2 * 60 * 1000;

let mutationChain = Promise.resolve();

const mutatePending = (mutator) => {
  const operation = mutationChain.catch(() => {}).then(async () => {
    const current = await Storage.get(PENDING_KEY);
    const pending = current && typeof current === 'object' && !Array.isArray(current)
      ? current
      : {};
    const next = await mutator({ ...pending });
    if (Object.keys(next).length === 0) await Storage.remove(PENDING_KEY);
    else await Storage.set(PENDING_KEY, next);
    return next;
  });
  // Keep future mutations usable even if an individual mutator rejects.
  mutationChain = operation.catch(() => {});
  return operation;
};

// Persist a complete, normalized scheduling snapshot. Recovery prefers the
// latest cached alarm, but this fallback must still preserve rich settings if
// the alarm was deleted or the cache is temporarily unavailable.
const safeAlarmSnapshot = (alarm = {}) => normalizeAlarm({
  ...alarm,
  user_id: alarm.user_id || null,
});

export const beginWakeSession = async ({
  wakeSessionId,
  alarm,
  userId,
  occurrenceEpoch,
  startedAt,
  snoozeCount = 0,
}) => {
  if (!wakeSessionId || !alarm?.id) return false;
  const resolvedUserId = userId || alarm.user_id || await Storage.get('current_user_id');
  if (!resolvedUserId) return false;

  const now = Date.now();
  await mutatePending((pending) => {
    const existing = pending[wakeSessionId] || {};
    pending[wakeSessionId] = {
      ...existing,
      wakeSessionId,
      userId: resolvedUserId,
      alarm: safeAlarmSnapshot(alarm),
      occurrenceEpoch: Number(occurrenceEpoch) || now,
      startedAt: Number(existing.startedAt || startedAt) || now,
      snoozeCount: Math.max(Number(existing.snoozeCount) || 0, Number(snoozeCount) || 0),
      state: 'ringing',
      expectedAt: null,
      lastHeartbeatAt: now,
    };
    return pending;
  });
  return true;
};

export const heartbeatWakeSession = (wakeSessionId) => {
  if (!wakeSessionId) return Promise.resolve(false);
  return mutatePending((pending) => {
    if (!pending[wakeSessionId]) return pending;
    pending[wakeSessionId] = {
      ...pending[wakeSessionId],
      state: 'ringing',
      lastHeartbeatAt: Date.now(),
    };
    return pending;
  }).then(() => true);
};

export const markWakeSessionSnoozed = (wakeSessionId, expectedAt, snoozeCount) => {
  if (!wakeSessionId) return Promise.resolve(false);
  return mutatePending((pending) => {
    if (!pending[wakeSessionId]) return pending;
    pending[wakeSessionId] = {
      ...pending[wakeSessionId],
      state: 'snoozed',
      expectedAt: Number(expectedAt) || Date.now(),
      snoozeCount: Math.max(Number(snoozeCount) || 0, Number(pending[wakeSessionId].snoozeCount) || 0),
      lastHeartbeatAt: Date.now(),
    };
    return pending;
  }).then(() => true);
};

export const resolveWakeSession = (wakeSessionId) => {
  if (!wakeSessionId) return Promise.resolve(false);
  return mutatePending((pending) => {
    delete pending[wakeSessionId];
    return pending;
  }).then(() => true);
};

const translated = (key, fallback, options) => {
  if (!i18n.isInitialized) return fallback;
  // i18next exposes `t` on its initialized singleton instance.
  // eslint-disable-next-line import/no-named-as-default-member
  const value = i18n.t(key, options);
  return value && value !== key ? value : fallback;
};

const isInterrupted = (session, now, force) => {
  if (session.state === 'snoozed') {
    return now >= (Number(session.expectedAt) || Number.POSITIVE_INFINITY) + SNOOZE_GRACE_MS;
  }
  if (force) return now > (Number(session.startedAt) || 0);
  return now - (Number(session.lastHeartbeatAt) || Number(session.startedAt) || 0) >= ACTIVE_STALE_MS;
};

/** Recover wake sessions left unresolved by a killed/crashed process. */
export const recoverInterruptedWakeSessions = async ({ now = Date.now(), force = false } = {}) => {
  await mutationChain;
  const stored = await Storage.get(PENDING_KEY);
  const pending = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const interrupted = Object.values(pending).filter((session) => isInterrupted(session, now, force));
  if (interrupted.length === 0) return [];

  const recovered = [];
  for (const session of interrupted) {
    const snapshot = session.alarm || {};
    if (!session.userId || !snapshot.id) {
      await resolveWakeSession(session.wakeSessionId);
      continue;
    }

    // Use the newest complete local alarm when possible; the persisted snapshot
    // remains a fully normalized offline fallback.
    const cachedAlarms = (await Storage.get(`alarms_${session.userId}`)) || [];
    const alarm = normalizeAlarm(
      cachedAlarms.find((candidate) => candidate.id === snapshot.id) || snapshot,
    );
    const recoveryNote = `wake_session_id=${session.wakeSessionId};recovery=interrupted_or_force_closed`;
    const triggeredAt = new Date(Number(session.occurrenceEpoch || session.startedAt) || now).toISOString();

    // The stable note makes history idempotent if the process dies again after
    // the local record is written but before the pending marker is removed.
    const history = (await Storage.get(`alarm_history_${session.userId}`)) || [];
    if (!history.some((record) => record?.notes === recoveryNote)) {
      await recordWakeSession(session.userId, {
        alarm_id: alarm.id,
        triggered_at: triggeredAt,
        outcome: 'missed',
        snooze_count: Number(session.snoozeCount) || 0,
        challenge_ids: [],
        notes: recoveryNote,
      });
    }

    // Re-arm first because scheduler cancellation removes alarm notifications.
    // The recovery notice uses a separate id namespace and is displayed last.
    if (alarm.recurrence?.mode !== 'once') {
      await rescheduleAlarm(alarm, new Date(now)).catch((error) => {
        console.warn('[WakeRecovery] reschedule failed:', error?.message || error);
      });
    }
    const title = translated('alarmRing.missedRecoveryTitle', 'Missed alarm');
    const body = translated(
      'alarmRing.missedRecoveryBody',
      'This alarm may have been interrupted. Tap to review it.',
    );
    await showMissedAlarmRecovery(alarm, session, { title, body }).catch((error) => {
      console.warn('[WakeRecovery] notification failed:', error?.message || error);
    });

    await resolveWakeSession(session.wakeSessionId);
    recovered.push(session.wakeSessionId);
  }
  return recovered;
};

export const _internals = { PENDING_KEY, ACTIVE_STALE_MS, SNOOZE_GRACE_MS, isInterrupted };

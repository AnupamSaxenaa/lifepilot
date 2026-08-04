/**
 * LifePilot — Wake-Session Controller
 * ------------------------------------------------------------------
 * The state machine governing a single alarm "wake session" from firing to
 * final dismissal. Owns:
 *   • Starting/stopping audio + vibration
 *   • Gating dismissal on mission completion (Property 5 — dismiss gate)
 *   • Snooze with max-count + progressive shortening (Property 6)
 *   • Recording the wake session to history (offline-first via dataManager)
 *   • Scheduling the next occurrence / a snooze occurrence via alarmScheduler
 *
 * This module is intentionally UI-agnostic (no React) so it's easy to unit
 * test and reason about independent of the ring screen's rendering.
 *
 * States: RINGING -> MISSION_ACTIVE (optional) -> DISMISSED | SNOOZED | MISSED
 */
import { disableAlarmAfterFire, recordWakeSession } from '../../../lib/dataManager';
import { Gamification } from '../../../utils/gamification';
import { DEFAULT_SNOOZE_CONFIG } from '../data/alarmModel';
import {
    cancelAlarm,
    cancelCurrentNotification,
    cancelOccurrenceCompanions,
    rescheduleAlarm,
    scheduleSnooze as scheduleSnoozeOccurrence,
} from '../scheduler/alarmScheduler';
import { forceMaxVolume, startAlarmAudio, stopAlarmAudio } from './audioPlayer';
import { startVibration, stopVibration } from './vibrationPlayer';

export const WAKE_STATES = {
  RINGING: 'RINGING',
  MISSION_ACTIVE: 'MISSION_ACTIVE',
  DISMISSED: 'DISMISSED',
  SNOOZED: 'SNOOZED',
  MISSED: 'MISSED',
};


/**
 * Create a controller instance for one wake session.
 * @param {object} alarm  normalized alarm object (see alarmModel.js)
 * @param {object} [opts]
 * @param {Function} [opts.onStateChange] (state) => void
 */
export const createAlarmController = (alarm, opts = {}) => {
  const { onStateChange } = opts;

  let state = WAKE_STATES.RINGING;
  let snoozeCount = Math.max(0, Number(opts.initialSnoozeCount) || 0);
  let lastSnoozeMinutes = Math.max(0, Number(opts.initialLastSnoozeMinutes) || 0);
  let missionIndex = 0;
  const startedAt = Number(opts.sessionStartedAt) || Date.now();
  const occurrenceEpoch = Number(opts.occurrenceEpoch) || startedAt;
  const wakeSessionId = opts.wakeSessionId || `${alarm.id}_${occurrenceEpoch}`;
  const notificationId = opts.notificationId || null;
  let missionCompletedAt = null;

  // Emergency mode (Req 17.1) must never be trivially dismissible: if the
  // user didn't configure a mission, force a minimal one so a single tap
  // can't silence a critical alarm.
  const isEmergency = !!(alarm.flags && alarm.flags.emergency);
  const configuredMission = Array.isArray(alarm.mission) ? alarm.mission : [];
  const mission = (isEmergency && configuredMission.length === 0)
    ? [{ id: 'math', difficulty: 'medium', config: { questionCount: 2 } }]
    : configuredMission;
  const usedChallengeIds = [];

  const setState = (next) => {
    state = next;
    if (onStateChange) onStateChange(state);
  };

  // Audio setup is asynchronous. A screen can unmount while it is awaiting the
  // native player, so terminal cleanup must prevent that stale continuation
  // from starting an ownerless, infinitely-looping vibration.
  let avCancelled = false;

  const startAV = async () => {
    const soundCfg = alarm.sound_config || {};
    const emergency = !!(alarm.flags && alarm.flags.emergency);
    const audioStarted = await startAlarmAudio({
      soundUri: soundCfg.uri || alarm.sound_uri,
      volume: soundCfg.volume,
      fadeInMs: soundCfg.fadeInMs,
      emergency,
    });
    if (avCancelled) {
      if (audioStarted) stopAlarmAudio();
      return;
    }
    // The notification uses loopSound as a killed/blocked-UI fallback. Once
    // Expo audio is confirmed playing, cancel that notification so two tones
    // never overlap. If Expo audio fails, leave the OS fallback ringing.
    if (audioStarted && notificationId) {
      await cancelCurrentNotification(notificationId);
    }
    if (avCancelled) {
      if (audioStarted) stopAlarmAudio();
      return;
    }
    startVibration(alarm.vibration_pattern || (alarm.vibrate === false ? 'none' : 'strong'));
  };

  const stopAV = () => {
    avCancelled = true;
    stopAlarmAudio();
    stopVibration();
  };

  // Kick off audio/vibration immediately on creation.
  startAV();

  /** Escalate to full volume (e.g. after a warn-about-oversleeping timeout). */
  const escalate = () => {
    forceMaxVolume();
  };

  /** Begin the mission (if any). Returns the first challenge descriptor or null. */
  const startMission = () => {
    if (!mission.length) return null;
    setState(WAKE_STATES.MISSION_ACTIVE);
    missionIndex = 0;
    return mission[0];
  };

  /** Advance past the current challenge. Returns the next challenge, or null if the mission is complete. */
  const advanceMission = (challengeId) => {
    if (challengeId) usedChallengeIds.push(challengeId);
    missionIndex += 1;
    if (missionIndex >= mission.length) {
      missionCompletedAt = Date.now();
      return null;
    }
    return mission[missionIndex];
  };

  const missionRemaining = () => Math.max(0, mission.length - missionIndex);
  const isMissionComplete = () => mission.length === 0 || missionIndex >= mission.length;

  const recordSession = async (userId, outcome, metadata = {}) => {
    if (!userId) return;
    const now = Date.now();
    try {
      await recordWakeSession(userId, {
        alarm_id: alarm.id,
        triggered_at: new Date(startedAt).toISOString(),
        outcome,
        snooze_count: snoozeCount,
        challenge_ids: usedChallengeIds,
        dismiss_duration_ms: outcome === 'dismissed' ? now - startedAt : null,
        wake_duration_ms: missionCompletedAt ? missionCompletedAt - startedAt : null,
        ...metadata,
      });
    } catch (e) {
      console.warn('[AlarmController] recordSession failed:', e?.message || e);
    }
  };

  /**
   * Dismiss the alarm. Blocked (no-op, returns false) if the mission is
   * incomplete (Property 5 — dismiss gate) — callers should route the user
   * back into the mission instead.
   */
  const scheduleAfterDismiss = async (userId) => {
    if (alarm.recurrence?.mode === 'once') {
      // Persist the logical disabled state; otherwise boot restore would arm
      // tomorrow's wall-clock time for this single-shot alarm.
      if (userId) {
        const disabled = await disableAlarmAfterFire(userId, alarm.id);
        if (disabled === false) throw new Error('Failed to disable one-time alarm');
      }
      await rescheduleAlarm({ ...alarm, is_active: false }, new Date());
      return;
    }
    await rescheduleAlarm(alarm, new Date());
  };

  const finalizeDismiss = async (userId, { forceReason = null, reward = true } = {}) => {
    // Normal dismissal is only committed after the next occurrence (or the
    // native disable for a one-time alarm) is safely scheduled. The force path
    // deliberately remains best-effort so a render crash can always escape.
    if (!forceReason) {
      try {
        await scheduleAfterDismiss(userId);
      } catch (e) {
        console.warn('[AlarmController] dismiss scheduling failed:', e?.message || e);
        return false;
      }
    }

    stopAV();
    setState(WAKE_STATES.DISMISSED);
    await cancelCurrentNotification(notificationId).catch(() => {});
    if (forceReason) await cancelAlarm(alarm.id).catch(() => {});
    await recordSession(userId, 'dismissed', forceReason ? { notes: `force_dismiss:${forceReason}` } : {});

    if (forceReason) {
      await scheduleAfterDismiss(userId).catch((e) => {
        console.warn('[AlarmController] force-dismiss scheduling failed:', e?.message || e);
      });
    }

    if (reward && userId) {
      const xp = Gamification.xpForAlarm({ snoozeCount });
      await Gamification.addXP(userId, xp).catch(() => {});
    }
    return true;
  };

  const dismiss = async (userId) => {
    if (!isMissionComplete()) return false;
    return finalizeDismiss(userId);
  };

  /** Render-error escape hatch only; normal UI must always call dismiss(). */
  const forceDismiss = async (userId, reason = 'render_error') =>
    finalizeDismiss(userId, { forceReason: reason, reward: false });

  /**
   * Snooze the alarm. Enforces `snooze_config.disabled` and `maxCount`
   * (Property 6). Returns { ok, minutes } — ok=false if snoozing is not
   * allowed right now.
   */
  const snooze = async (userId, requestedMinutes) => {
    const cfg = alarm.snooze_config || {};
    // Emergency alarms never allow snoozing — waking fully is the point.
    if (cfg.disabled || isEmergency) return { ok: false, reason: isEmergency ? 'emergency' : 'disabled' };
    const maxCount = cfg.maxCount != null ? cfg.maxCount : 3;
    if (snoozeCount >= maxCount) return { ok: false, reason: 'max_reached' };

    const presets = Array.isArray(cfg.presets) && cfg.presets.length
      ? cfg.presets
      : DEFAULT_SNOOZE_CONFIG.presets;
    const requested = Number(requestedMinutes);
    let minutes = Number.isFinite(requested) && requested > 0
      ? requested
      : (cfg.defaultMin || presets[0] || 5);
    if (cfg.progressive) {
      const descending = [...presets].filter((v) => Number(v) > 0).sort((a, b) => b - a);
      const progressiveMax = descending[Math.min(snoozeCount, descending.length - 1)] || minutes;
      minutes = Math.min(minutes, progressiveMax, lastSnoozeMinutes || Number.POSITIVE_INFINITY);
    }
    minutes = Math.max(1, Math.round(minutes));

    const nextSnoozeCount = snoozeCount + 1;
    try {
      await scheduleSnoozeOccurrence(alarm, minutes, {
        snoozeCount: nextSnoozeCount,
        lastSnoozeMinutes: minutes,
        sessionStartedAt: startedAt,
        sourceOccurrenceEpoch: occurrenceEpoch,
        wakeSessionId,
      });
    } catch (e) {
      console.warn('[AlarmController] snooze scheduling failed:', e?.message || e);
      if (state !== WAKE_STATES.RINGING) setState(WAKE_STATES.RINGING);
      return { ok: false, reason: 'schedule_failed' };
    }

    // Scheduling is now durable, so it is safe to silence and transition.
    snoozeCount = nextSnoozeCount;
    lastSnoozeMinutes = minutes;
    stopAV();
    setState(WAKE_STATES.SNOOZED);
    await cancelCurrentNotification(notificationId).catch(() => {});
    await cancelOccurrenceCompanions(alarm.id, occurrenceEpoch).catch(() => {});
    await recordSession(userId, 'snoozed', {
      notes: `wake_session_id=${wakeSessionId};snooze_count=${snoozeCount};minutes=${minutes}`,
    });
    return { ok: true, minutes };
  };

  /** Mark the session missed (e.g. the ring screen was torn down without user action). */
  const markMissed = async (userId) => {
    stopAV();
    setState(WAKE_STATES.MISSED);
    await cancelCurrentNotification(notificationId).catch(() => {});
    await recordSession(userId, 'missed');
  };

  return {
    getState: () => state,
    getSnoozeCount: () => snoozeCount,
    getMissionRemaining: missionRemaining,
    isMissionComplete,
    startMission,
    advanceMission,
    escalate,
    dismiss,
    forceDismiss,
    snooze,
    markMissed,
    // Synchronously cancels pending async AV startup before React teardown.
    dispose: stopAV,
    // Exposed for the ring screen to render "N/M" mission progress.
    missionLength: mission.length,
    isEmergency,
  };
};

/**
 * Last-resort render fallback when React failed before a controller existed.
 * This is deliberately separate from normal dismissal so mission gating cannot
 * be bypassed by any regular action path.
 */
export const forceDismissAlarm = async (alarm, { userId, notificationId, reason = 'render_error' } = {}) => {
  stopAlarmAudio();
  stopVibration();
  await cancelCurrentNotification(notificationId).catch(() => {});
  await cancelAlarm(alarm?.id).catch(() => {});
  if (alarm?.recurrence?.mode === 'once') {
    if (userId) await disableAlarmAfterFire(userId, alarm.id).catch(() => {});
    // A render failure can happen before user context is restored. The native
    // schedule must still stay disabled for every one-time alarm.
    await rescheduleAlarm({ ...alarm, is_active: false }, new Date()).catch(() => {});
  } else if (alarm) {
    await rescheduleAlarm(alarm, new Date()).catch(() => {});
  }
  if (userId && alarm?.id) {
    await recordWakeSession(userId, {
      alarm_id: alarm.id,
      triggered_at: new Date().toISOString(),
      outcome: 'dismissed',
      snooze_count: 0,
      challenge_ids: [],
      notes: `force_dismiss:${reason}`,
    }).catch(() => {});
  }
  return true;
};
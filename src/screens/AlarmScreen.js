/**
 * LifePilot — Alarm Ring Screen
 * ------------------------------------------------------------------
 * The immersive, distraction-free screen shown when an alarm fires (full-
 * screen intent via Notifee -> headless-registered `AlarmScreen` component).
 *
 * Responsibilities:
 *   • Parse the alarm payload from `props.notification.data` (see
 *     alarmScheduler.js `buildNotification`)
 *   • Drive a `alarmController` wake-session (audio/vibration/mission gate)
 *   • Render large time/title/greeting/date, themed animated background,
 *     large Dismiss/Snooze, a challenge-progress card, motivation, streak
 *   • Disable the hardware back button (anti-cheat: Property 5 / Req 12.4)
 *   • Honor reduced-motion / high-contrast / large-text accessibility prefs
 *   • Wrapped in an error boundary that ALWAYS keeps a working Dismiss button
 *     so a rendering bug can never trap the user in a ringing state
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AccessibilityInfo,
    Alert,
    BackHandler,
    Dimensions,
    Linking,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { LiquidAura } from '../components/LiquidAura';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { MissionRunner } from '../features/alarm/challenges/MissionRunner';
import { normalizeAlarm, PRESET_LABELS } from '../features/alarm/data/alarmModel';
import { getDailyMotivation } from '../features/alarm/motivation';
import { createAlarmController, forceDismissAlarm, WAKE_STATES } from '../features/alarm/ring/alarmController';
import { AmbientPreWake } from '../features/alarm/ring/AmbientPreWake';
import { deriveVisibleSnoozePresets } from '../features/alarm/ring/snoozeOptions';
import {
    claimWakeSessionOwnership,
    releaseWakeSessionOwnership,
} from '../features/alarm/ring/wakeSessionOwnership';
import {
    beginWakeSession,
    heartbeatWakeSession,
    markWakeSessionSnoozed,
    resolveWakeSession,
} from '../features/alarm/ring/wakeSessionRecovery';
import { cancelAmbientNotification } from '../features/alarm/scheduler/alarmScheduler';
import { getCachedWeather } from '../features/alarm/weather';
import { updateLatestWakeSessionReflection } from '../lib/dataManager';
import { readableOn } from '../theme/contrast';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';

const { width, height } = Dimensions.get('window');

// Precalculate star positions outside render to maintain component purity.
const STARS_DATA = [...Array(60)].map(() => ({
  size: Math.random() * 3 + 1,
  left: Math.random() * width,
  top: Math.random() * height,
  opacity: Math.random() * 0.6 + 0.2,
}));

const Starfield = ({ reducedMotion }) => {
  if (reducedMotion) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {STARS_DATA.map((star, i) => (
          <View key={i} style={[styles.star, { width: star.size, height: star.size, left: star.left, top: star.top, opacity: star.opacity }]} />
        ))}
      </View>
    );
  }
  // Simple static field for the ring screen (kept lightweight — this renders
  // the instant the OS wakes the device, so no heavy animation setup here).
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {STARS_DATA.map((star, i) => (
        <View key={i} style={[styles.star, { width: star.size, height: star.size, left: star.left, top: star.top, opacity: star.opacity }]} />
      ))}
    </View>
  );
};

// Minimal, always-functional fallback UI — used by the error boundary below.
class RingErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    console.error('[AlarmScreen] Render error, falling back to safe dismiss UI:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>{this.props.alarmLabel || 'Alarm'}</Text>
          <TouchableOpacity
            style={styles.fallbackDismiss}
            onPress={this.props.onEmergencyDismiss}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={this.props.dismissLabel || 'Dismiss alarm'}
          >
            <Text style={styles.fallbackDismissText}>{this.props.dismissLabel || 'Dismiss'}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function AlarmScreen(props) {
  const { t } = useTranslation();
  const themeContext = useAppTheme();
  const notification = useMemo(() => props.notification || {}, [props.notification]);
  const data = useMemo(() => notification.data || {}, [notification.data]);

  const alarm = useMemo(() => {
    let mission = [];
    let snoozeConfig = {};
    let recurrence = {};
    let label = null;
    let visualConfig = {};
    try { mission = data.mission ? JSON.parse(data.mission) : []; } catch (_e) {}
    try { snoozeConfig = data.snoozeConfig ? JSON.parse(data.snoozeConfig) : {}; } catch (_e) {}
    try { recurrence = data.recurrence ? JSON.parse(data.recurrence) : {}; } catch (_e) {}
    try { label = data.label ? JSON.parse(data.label) : null; } catch (_e) {}
    try { visualConfig = data.visualConfig ? JSON.parse(data.visualConfig) : {}; } catch (_e) {}
    return normalizeAlarm({
      id: data.alarmId || 'unknown',
      user_id: data.userId || null,
      title: notification.title,
      description: notification.body,
      label,
      visual_config: visualConfig,
      recurrence,
      sound_uri: data.soundUri,
      sound_config: { uri: data.soundUri, volume: parseInt(data.volume, 10) || 100, fadeInMs: parseInt(data.fadeInMs, 10) || 0 },
      vibration_pattern: data.vibrationPattern,
      mission,
      snooze_config: snoozeConfig,
      flags: { emergency: data.emergency === 'true' },
    });
  }, [data, notification]);

  const labelKey = alarm.label?.key || alarm.label?.preset ||
    (PRESET_LABELS.includes(alarm.label?.text) ? alarm.label.text : null);
  const customLabelText = alarm.label?.customText || alarm.label?.custom_text ||
    (alarm.label?.text && !labelKey ? alarm.label.text : null);
  const configuredLabel = customLabelText || (labelKey ? t(`alarmOptions.labels.${labelKey}`) : null);
  const alarmBoundaryLabel = configuredLabel || alarm.title || t('alarmRing.alarmLabel');
  const dismissBoundaryLabel = t('alarmRing.dismissAlarm');
  const initialSnoozeCount = Math.max(0, Number(data.snoozeCount) || 0);
  const wakeSessionId = data.wakeSessionId || `${alarm.id}_${Number(data.occurrenceEpoch) || Date.now()}`;
  const triggeredAt = useMemo(
    () => new Date(Number(data.sessionStartedAt) || Date.now()).toISOString(),
    [data.sessionStartedAt],
  );

  const controllerRef = useRef(null);
  const snoozePendingRef = useRef(false);
  const reflectionPendingRef = useRef(false);
  const [wakeState, setWakeState] = useState(WAKE_STATES.RINGING);
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const userIdRef = useRef(data.userId || null);
  const [streak, setStreak] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [snoozeFeedback, setSnoozeFeedback] = useState(null);
  const [snoozePending, setSnoozePending] = useState(false);
  const [cachedWeather, setCachedWeather] = useState(null);
  const [use24HourFormat, setUse24HourFormat] = useState(false);
  const [reflectionMood, setReflectionMood] = useState(null);
  const [reflectionNotes, setReflectionNotes] = useState('');
  const [reflectionPending, setReflectionPending] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [resolvedState, setResolvedState] = useState(null);

  // Ambient pre-wake: this notification fired `leadMin` minutes before the
  // real alarm time (see alarmScheduler's ambient trigger). While ambient,
  // we show ONLY the gentle pre-wake visual — no audio/vibration/mission —
  // then transition into the normal ring flow below once the lead time ends.
  const isAmbient = data.ambient === 'true';
  const leadMinutes = parseInt(data.leadMin, 10) || 10;
  const [ambientActive] = useState(isAmbient);
  const [ambientAwaitingPrimary, setAmbientAwaitingPrimary] = useState(false);

  // The ring clock is live; a static Date captured during first render quickly
  // becomes misleading during long missions.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      getCachedWeather(),
      Storage.get('time_format_24'),
    ]).then(([weather, formatSetting]) => {
      if (!mounted) return;
      setCachedWeather(weather);
      setUse24HourFormat(formatSetting === true || formatSetting === 'true');
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // The guaranteed primary trigger owns ringing. It cancels the separately
  // displayed ambient notification so only one full-screen session remains.
  useEffect(() => {
    if (!isAmbient) {
      cancelAmbientNotification(alarm.id, Number(data.occurrenceEpoch)).catch(() => {});
    }
  }, [alarm.id, data.occurrenceEpoch, isAmbient]);

  // Disable hardware back — anti-cheat (Req 12.4).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  // Resolve accessibility + user context; start the controller once we're
  // actually ringing (i.e. not while still in the ambient pre-wake phase).
  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (mounted) setReducedMotion(!!v); })
      .catch(() => {});

    // Android exposes "high text contrast" via isHighTextContrastEnabled on
    // recent RN versions; guarded with optional chaining since it's not on
    // every platform/RN version. Falls back to false (normal contrast).
    AccessibilityInfo.isHighTextContrastEnabled?.()
      .then((v) => { if (mounted) setHighContrast(!!v); })
      .catch(() => {});

    (async () => {
      const uid = data.userId || await Storage.get('current_user_id');
      if (mounted) {
        userIdRef.current = uid;
      }
      if (uid) {
        try {
          const state = await Gamification.getState(uid);
          if (mounted && state) setStreak(state.streak || 0);
        } catch (_e) {}
      }
    })();

    if (ambientActive) {
      // Ambient never creates a ring controller. The independently scheduled
      // primary notification is the sole owner of audio/history/mission state.
      return () => { mounted = false; };
    }

    if (!claimWakeSessionOwnership(wakeSessionId)) {
      console.warn(`[AlarmScreen] Duplicate wake session ignored: ${wakeSessionId}`);
      const closeTimer = setTimeout(() => BackHandler.exitApp(), 0);
      return () => {
        mounted = false;
        clearTimeout(closeTimer);
      };
    }

    const ctrl = createAlarmController(alarm, {
      onStateChange: setWakeState,
      initialSnoozeCount,
      initialLastSnoozeMinutes: Number(data.lastSnoozeMinutes) || 0,
      sessionStartedAt: Number(data.sessionStartedAt) || Date.now(),
      occurrenceEpoch: Number(data.occurrenceEpoch) || Date.now(),
      wakeSessionId,
      notificationId: notification.id,
    });
    controllerRef.current = ctrl;
    beginWakeSession({
      wakeSessionId,
      alarm,
      userId: data.userId,
      occurrenceEpoch: Number(data.occurrenceEpoch) || Date.now(),
      startedAt: Number(data.sessionStartedAt) || Date.now(),
      snoozeCount: initialSnoozeCount,
    }).catch(() => {});
    const heartbeatTimer = setInterval(() => {
      heartbeatWakeSession(wakeSessionId).catch(() => {});
    }, 30000);
    const first = ctrl.startMission();
    setCurrentChallenge(first);

    return () => {
      mounted = false;
      clearInterval(heartbeatTimer);
      // Cancel synchronously before any asynchronous missed-session work; this
      // prevents an in-flight audio start from beginning vibration after unmount.
      ctrl.dispose();
      releaseWakeSessionOwnership(wakeSessionId);
      // If the screen is torn down without an explicit user action, treat it
      // as missed rather than silently losing the session record.
      if (ctrl.getState() === WAKE_STATES.RINGING || ctrl.getState() === WAKE_STATES.MISSION_ACTIVE) {
        ctrl.markMissed(userIdRef.current)
          .then(() => resolveWakeSession(wakeSessionId))
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientActive]);

  const handleChallengeComplete = () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const next = ctrl.advanceMission(currentChallenge?.id);
    setCurrentChallenge(next);
  };

  const handleDismiss = async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    if (!ctrl.isMissionComplete()) {
      Alert.alert(t('alarmRing.notYetTitle'), t('alarmRing.completeChallenge'));
      return;
    }
    const dismissed = await ctrl.dismiss(userIdRef.current);
    if (dismissed) {
      await resolveWakeSession(wakeSessionId);
      setResolvedState('dismissed');
    }
  };

  const handleEmergencyDismiss = async () => {
    // Used only by the error-boundary fallback: it must work even when the
    // controller effect never mounted.
    const ctrl = controllerRef.current;
    if (ctrl) {
      await ctrl.forceDismiss(userIdRef.current, 'render_error').catch(() => {});
    } else {
      await forceDismissAlarm(alarm, {
        userId: userIdRef.current,
        notificationId: notification.id,
        reason: 'controller_unavailable',
      }).catch(() => {});
    }
    await resolveWakeSession(wakeSessionId);
    setResolvedState('dismissed');
  };

  const handleSnooze = async (minutes) => {
    const ctrl = controllerRef.current;
    if (!ctrl || snoozePendingRef.current) return;
    snoozePendingRef.current = true;
    setSnoozePending(true);
    try {
      const res = await ctrl.snooze(userIdRef.current, minutes);
      if (res.ok) {
        await markWakeSessionSnoozed(
          wakeSessionId,
          Date.now() + res.minutes * 60 * 1000,
          ctrl.getSnoozeCount(),
        );
        setResolvedState('snoozed');
        return;
      }
      const msg = res.reason === 'max_reached'
        ? t('alarmRing.maxSnoozes')
        : res.reason === 'emergency'
          ? t('alarmRing.emergencySnoozeDisabled')
          : res.reason === 'schedule_failed'
            ? t('alarmRing.snoozeScheduleFailed')
            : t('alarmRing.snoozeDisabled');
      setSnoozeFeedback(msg);
      setTimeout(() => setSnoozeFeedback(null), 2500);
    } finally {
      snoozePendingRef.current = false;
      setSnoozePending(false);
    }
  };

  const handleSaveReflection = async () => {
    if (!reflectionMood || reflectionSaved || reflectionPendingRef.current) return;
    reflectionPendingRef.current = true;
    setReflectionPending(true);
    try {
      const updatedRecord = await updateLatestWakeSessionReflection(
        userIdRef.current,
        alarm.id,
        triggeredAt,
        { mood: reflectionMood, notes: reflectionNotes.trim() },
      );
      if (!updatedRecord) {
        Alert.alert(t('common.error'), t('alarmRing.reflectionSaveFailed'));
        return;
      }
      setReflectionSaved(true);
    } catch (_e) {
      Alert.alert(t('common.error'), t('alarmRing.reflectionSaveFailed'));
    } finally {
      reflectionPendingRef.current = false;
      setReflectionPending(false);
    }
  };

  const timeString = now.toLocaleTimeString([], use24HourFormat
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: 'numeric', minute: '2-digit', hour12: true });
  const { greeting, affirmation } = getDailyMotivation(t);
  const visualConfig = alarm.visual_config || {};
  const clockStyle = visualConfig.clockStyle || 'minimal';
  const backgroundMode = visualConfig.backgroundMode || 'dark';
  const selectedPalette = highContrast ? 'highContrast' : (visualConfig.palette || 'standard');
  const hour = now.getHours();
  const dynamicBackground = hour >= 5 && hour < 11
    ? '#243B53'
    : hour >= 11 && hour < 18
      ? '#155E75'
      : hour >= 18 && hour < 22
        ? '#4C1D4F'
        : '#111827';
  const highContrastLight = backgroundMode === 'light';
  const backgroundColor = selectedPalette === 'highContrast'
    ? (highContrastLight ? '#FFFFFF' : '#000000')
    : backgroundMode === 'light'
      ? '#F4F7FB'
      : backgroundMode === 'dynamic'
        ? dynamicBackground
        : '#050509';
  const isLightBackground = selectedPalette === 'highContrast'
    ? highContrastLight
    : backgroundMode === 'light';
  const foregroundColor = isLightBackground ? '#111111' : '#FFFFFF';
  const mutedColor = isLightBackground ? '#4B5563' : '#D1D5DB';
  const standardAccent = alarm.label?.color || themeContext?.theme?.accent ||
    (COLORS.dark && COLORS.dark.accent) || '#FFFFFF';
  const accent = selectedPalette === 'deuteranopia'
    ? '#56B4E9'
    : selectedPalette === 'tritanopia'
      ? '#E69F00'
      : selectedPalette === 'highContrast'
        ? (isLightBackground ? '#000000' : '#FFFFFF')
        : standardAccent;
  // The dismiss button is filled with `accent`, which can be a user-picked alarm
  // label colour, an accessibility-palette colour, or the equipped theme accent
  // (white by default). Derive its label instead of guessing per palette — the
  // old per-palette ternary returned '#FFFFFF' for the standard palette, i.e.
  // white-on-white.
  const onAccentColor = readableOn(accent);
  const labelColor = selectedPalette === 'standard'
    ? (alarm.label?.color || accent)
    : accent;
  const weatherAvailable = cachedWeather?.temperature !== null && cachedWeather?.temperature !== undefined;

  const missionActive = wakeState === WAKE_STATES.MISSION_ACTIVE && currentChallenge;
  const missionTotal = controllerRef.current?.missionLength || 0;
  const missionRemaining = controllerRef.current?.getMissionRemaining ? controllerRef.current.getMissionRemaining() : 0;
  const missionDone = missionTotal - missionRemaining;
  const maxSnoozeCount = alarm.snooze_config?.maxCount ?? 3;
  const canShowSnooze = !missionActive && !alarm.snooze_config?.disabled &&
    !alarm.flags?.emergency && initialSnoozeCount < maxSnoozeCount;
  const showStarfield = backgroundMode !== 'light' && selectedPalette !== 'highContrast';

  if (ambientActive) {
    return (
      <RingErrorBoundary
        onEmergencyDismiss={handleEmergencyDismiss}
        alarmLabel={alarmBoundaryLabel}
        dismissLabel={dismissBoundaryLabel}
      >
        <AmbientPreWake
          leadMinutes={leadMinutes}
          targetEpoch={Number(data.occurrenceEpoch) || undefined}
          awaitingPrimary={ambientAwaitingPrimary}
          onTransition={() => setAmbientAwaitingPrimary(true)}
        />
      </RingErrorBoundary>
    );
  }

  if (resolvedState) {
    const moods = [
      ['great', 'alarmRing.moodGreat'],
      ['good', 'alarmRing.moodGood'],
      ['okay', 'alarmRing.moodOkay'],
      ['tired', 'alarmRing.moodTired'],
      ['rough', 'alarmRing.moodRough'],
    ];
    return (
      <RingErrorBoundary
        onEmergencyDismiss={handleEmergencyDismiss}
        alarmLabel={alarmBoundaryLabel}
        dismissLabel={dismissBoundaryLabel}
      >
        <View style={styles.resolvedContainer}>
          <Text style={styles.resolvedTitle}>
            {resolvedState === 'snoozed' ? t('alarmRing.snoozedTitle') : t('alarmRing.dismissedTitle')}
          </Text>
          <Text style={styles.resolvedSubtitle}>
            {resolvedState === 'snoozed' ? t('alarmRing.snoozedSubtitle') : t('alarmRing.dismissedSubtitle')}
          </Text>

          {resolvedState === 'dismissed' && (
            <View style={styles.reflectionCard}>
              <Text style={styles.reflectionTitle}>{t('alarmRing.reflectionTitle')}</Text>
              <Text style={styles.reflectionHint}>{t('alarmRing.reflectionHint')}</Text>
              <View style={styles.moodRow}>
                {moods.map(([mood, key]) => (
                  <TouchableOpacity
                    key={mood}
                    style={[styles.moodChoice, reflectionMood === mood && styles.moodChoiceSelected]}
                    onPress={() => !reflectionSaved && setReflectionMood(mood)}
                    disabled={reflectionSaved || reflectionPending}
                    accessibilityRole="button"
                    accessibilityState={{ selected: reflectionMood === mood, disabled: reflectionSaved || reflectionPending }}
                  >
                    <Text style={[styles.moodChoiceText, reflectionMood === mood && styles.moodChoiceTextSelected]}>
                      {t(key)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.reflectionInput}
                value={reflectionNotes}
                onChangeText={setReflectionNotes}
                placeholder={t('alarmRing.reflectionPlaceholder')}
                placeholderTextColor="#71717A"
                editable={!reflectionSaved && !reflectionPending}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[
                  styles.reflectionSave,
                  (!reflectionMood || reflectionPending || reflectionSaved) && styles.reflectionSaveDisabled,
                ]}
                onPress={handleSaveReflection}
                disabled={!reflectionMood || reflectionPending || reflectionSaved}
                accessibilityRole="button"
              >
                <Text style={styles.reflectionSaveText}>
                  {reflectionSaved ? t('alarmRing.reflectionSaved') : t('alarmRing.reflectionSave')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={styles.resolvedButton}
            onPress={() => {
              if (typeof props.onClose === 'function') {
                props.onClose(resolvedState);
                if (resolvedState === 'dismissed') {
                  Linking.openURL('lifepilot://morning-focus').catch(() => {});
                }
                return;
              }
              if (resolvedState === 'dismissed') {
                Linking.openURL('lifepilot://morning-focus').catch(() => BackHandler.exitApp());
              } else {
                BackHandler.exitApp();
              }
            }}
          >
            <Text style={styles.resolvedButtonText}>{t('alarmRing.close')}</Text>
          </TouchableOpacity>
        </View>
      </RingErrorBoundary>
    );
  }

  return (
    <RingErrorBoundary
      onEmergencyDismiss={handleEmergencyDismiss}
      alarmLabel={alarmBoundaryLabel}
      dismissLabel={dismissBoundaryLabel}
    >
      <View style={[styles.container, { backgroundColor }]}>
        {showStarfield && <Starfield reducedMotion={reducedMotion} />}

        <View style={styles.content}>
          <Text style={[styles.date, { color: mutedColor }]}>
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
          <View
            style={[
              styles.clockFrame,
              clockStyle === 'material' && [
                styles.clockMaterial,
                { borderColor: accent, backgroundColor: isLightBackground ? '#FFFFFF' : 'rgba(0,0,0,0.24)' },
              ],
              clockStyle === 'glass' && [
                styles.clockGlass,
                { borderColor: isLightBackground ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.38)' },
              ],
            ]}
          >
            <Text
              style={[
                styles.time,
                { color: foregroundColor },
                clockStyle === 'material' && styles.timeMaterial,
                clockStyle === 'glass' && styles.timeGlass,
              ]}
              accessibilityRole="text"
            >
              {timeString}
            </Text>
          </View>
          <Text style={[styles.greeting, { color: mutedColor }]}>{greeting}</Text>
          {configuredLabel && (
            <Text style={[styles.configuredLabel, { color: labelColor }]} numberOfLines={2}>
              {configuredLabel}
            </Text>
          )}
          {alarm.title && <Text style={[styles.alarmTitle, { color: foregroundColor }]} numberOfLines={2}>{alarm.title}</Text>}
          {weatherAvailable && (
            <Text style={[styles.weatherSummary, { color: mutedColor }]}>
              {t('alarmRing.weatherSummary', {
                temperature: cachedWeather.temperature,
                rain: cachedWeather.rainProbability ?? 0,
              })}
            </Text>
          )}

          {!reducedMotion && (
            <View style={styles.auraContainer}>
              <LiquidAura isProcessing={missionActive} />
            </View>
          )}

          {streak > 0 && (
            <View style={[styles.streakPill, { borderColor: '#FB923C' }]}>
              <Text style={[styles.streakText, { color: '#FB923C' }]}>🔥 {t('alarmRing.dayStreak', { count: streak })}</Text>
            </View>
          )}

          {missionActive ? (
            <View style={[styles.challengeCard, { borderColor: accent }]}>
              <Text style={[styles.challengeProgress, { color: mutedColor }]}>
                {t('alarmRing.missionStep', { current: missionDone + 1, total: missionTotal })}
              </Text>
              <Text style={[styles.challengeTitle, { color: foregroundColor }]}>
                {t(`alarmChallenges.${currentChallenge?.id}`, currentChallenge?.id || '')}
              </Text>
              <MissionRunner challenge={currentChallenge} onStepComplete={handleChallengeComplete} />
            </View>
          ) : (
            <View style={styles.motivationContainer}>
              <Text style={[styles.motivationText, { color: foregroundColor }]}>{affirmation}</Text>
            </View>
          )}

          {snoozeFeedback && <Text style={[styles.snoozeFeedback, { color: '#FBBF24' }]}>{snoozeFeedback}</Text>}

          {canShowSnooze && (
            <View style={styles.snoozeContainer}>
              <Text style={[styles.snoozeLabel, { color: mutedColor }]}>{t('alarmRing.snoozeFor')}</Text>
              <View style={styles.snoozeRow}>
                {deriveVisibleSnoozePresets(alarm.snooze_config, 3).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.snoozeBtn,
                      { borderColor: accent, backgroundColor: isLightBackground ? '#FFFFFF' : 'rgba(0,0,0,0.28)' },
                      snoozePending && styles.snoozeBtnDisabled,
                    ]}
                    onPress={() => handleSnooze(m)}
                    disabled={snoozePending}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('alarmRing.snoozeMinutes', { minutes: m })}
                  >
                    <Text style={[styles.btnTextSm, { color: foregroundColor }]}>{m}m</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.dismissBtn,
              { backgroundColor: accent, shadowColor: accent },
              missionActive && styles.dismissBtnDisabled,
            ]}
            onPress={handleDismiss}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('alarmRing.dismiss')}
          >
            <Text style={[styles.btnText, { color: onAccentColor }]}>
              {t('alarmRing.dismiss')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </RingErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  star: { position: 'absolute', backgroundColor: '#FFF', borderRadius: 50 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 10, paddingHorizontal: 24 },
  date: { color: '#A1A1AA', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  clockFrame: { alignItems: 'center', justifyContent: 'center', minWidth: 250, marginBottom: 8 },
  clockMaterial: {
    borderWidth: 3,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    elevation: 8,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  clockGlass: {
    borderWidth: 1,
    borderRadius: 30,
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  time: { fontSize: 64, color: '#FFF', fontWeight: '300' },
  timeMaterial: { fontWeight: '800', fontSize: 58 },
  timeGlass: { fontWeight: '500', letterSpacing: 3 },
  greeting: { color: '#E4E4E7', fontSize: 16, fontWeight: '600', marginBottom: 2 },
  configuredLabel: { fontSize: 18, fontWeight: '800', marginTop: 6, textAlign: 'center' },
  alarmTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', marginTop: 5, textAlign: 'center' },
  weatherSummary: { fontSize: 13, fontWeight: '600', marginTop: 7, textAlign: 'center' },
  auraContainer: { width: 220, height: 220, justifyContent: 'center', alignItems: 'center', marginVertical: 12 },
  streakPill: { backgroundColor: 'rgba(0,0,0,0.16)', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginBottom: 14 },
  streakText: { color: '#FB923C', fontSize: 13, fontWeight: '700' },
  motivationContainer: { minHeight: 70, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 22, width: '100%' },
  motivationText: { color: '#E4E4E7', fontSize: 18, fontWeight: '500', textAlign: 'center', lineHeight: 26, fontStyle: 'italic' },
  challengeCard: { width: '100%', borderWidth: 1, borderRadius: 20, padding: 20, marginBottom: 22, backgroundColor: 'rgba(0,0,0,0.18)', alignItems: 'center' },
  challengeProgress: { color: '#A1A1AA', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
  challengeTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', marginBottom: 16, textTransform: 'capitalize' },
  challengeCompleteBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 20 },
  challengeCompleteText: { color: '#000', fontWeight: '800', fontSize: 14 },
  snoozeFeedback: { color: '#FBBF24', fontSize: 13, marginBottom: 10, fontWeight: '600', textAlign: 'center' },
  snoozeContainer: { marginBottom: 22, width: '100%', alignItems: 'center' },
  snoozeLabel: { color: '#A1A1AA', fontSize: 14, marginBottom: 10 },
  snoozeRow: { flexDirection: 'row', gap: 14 },
  snoozeBtn: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 16, alignItems: 'center', borderWidth: 1 },
  snoozeBtnDisabled: { opacity: 0.45 },
  dismissBtn: { padding: 18, borderRadius: 30, width: '100%', alignItems: 'center', marginTop: 6, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10 },
  dismissBtnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 19, color: '#FFF', fontWeight: '700' },
  btnTextSm: { fontSize: 16, color: '#FFF', fontWeight: '600' },
  resolvedContainer: { flex: 1, backgroundColor: '#09090B', alignItems: 'center', justifyContent: 'center', padding: 24 },
  resolvedTitle: { color: '#FFF', fontSize: 30, fontWeight: '700', textAlign: 'center' },
  resolvedSubtitle: { color: '#A1A1AA', fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  reflectionCard: { width: '100%', maxWidth: 520, borderWidth: 1, borderColor: '#3F3F46', backgroundColor: '#18181B', borderRadius: 20, padding: 16, marginBottom: 20 },
  reflectionTitle: { color: '#FFF', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  reflectionHint: { color: '#A1A1AA', fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 5, marginBottom: 13 },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  moodChoice: { borderWidth: 1, borderColor: '#52525B', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#27272A' },
  moodChoiceSelected: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  moodChoiceText: { color: '#E4E4E7', fontSize: 13, fontWeight: '700' },
  moodChoiceTextSelected: { color: '#000000' },
  reflectionInput: { minHeight: 72, maxHeight: 120, borderWidth: 1, borderColor: '#3F3F46', borderRadius: 14, color: '#FFF', backgroundColor: '#09090B', paddingHorizontal: 12, paddingVertical: 10, marginTop: 13, textAlignVertical: 'top' },
  reflectionSave: { backgroundColor: '#FFFFFF', alignItems: 'center', borderRadius: 16, paddingVertical: 12, marginTop: 12 },
  reflectionSaveDisabled: { opacity: 0.4 },
  reflectionSaveText: { color: '#000000', fontSize: 15, fontWeight: '800' },
  resolvedButton: { backgroundColor: '#27272A', paddingHorizontal: 30, paddingVertical: 14, borderRadius: 24 },
  resolvedButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  fallbackContainer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 },
  fallbackTitle: { color: '#FFF', fontSize: 28, fontWeight: '700', marginBottom: 30 },
  // This is the LAST-RESORT dismiss button shown when the alarm UI crashed, so
  // its label has to be readable no matter what. White on #FB7185 was 2.69:1;
  // a deeper red with white text reaches 5.9:1.
  fallbackDismiss: { backgroundColor: '#BE123C', paddingVertical: 18, paddingHorizontal: 50, borderRadius: 30 },
  fallbackDismissText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
});

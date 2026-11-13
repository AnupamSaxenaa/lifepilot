// ─── Mindful Lock Core Engine ───────────────────────────
// Manages distraction apps, usage logging, streaks, scores,
// and the adaptive tapering system.
// ────────────────────────────────────────────────────────

import { NativeModules, Platform } from 'react-native';
import { syncToSupabase } from '../lib/syncQueue';
import { Storage } from './storage';

const { AppBlocker } = NativeModules;

/**
 * Determine the effective blocking mode right now, given the user's global
 * `blockingMode` and any schedule rules. A schedule that's currently "active"
 * (matches today's day-of-week and current time window) overrides the base
 * mode. If no schedule is active, falls back to the base `blockingMode`.
 *
 * Schedule shape (profile.schedules[]):
 *   { id, days: [0-6] (0=Sun), start: 'HH:MM', end: 'HH:MM', mode: 'cbt'|'strict', enabled: true }
 */
export const getEffectiveBlockingMode = (profile, now = new Date()) => {
  const schedules = Array.isArray(profile?.schedules) ? profile.schedules : [];
  const activeSchedules = schedules.filter(s => s.enabled !== false && isScheduleActive(s, now));

  if (activeSchedules.length > 0) {
    // If ANY active schedule says strict, be strict (safety-first: strict wins ties).
    const hasStrict = activeSchedules.some(s => s.mode === 'strict');
    return hasStrict ? 'strict' : 'cbt';
  }

  return profile?.blockingMode || 'cbt';
};

/**
 * Whether a single schedule rule is active at the given moment.
 * Handles overnight windows where start > end (e.g. 22:00 -> 07:00).
 */
export const isScheduleActive = (schedule, now = new Date()) => {
  if (!schedule || !schedule.start || !schedule.end) return false;
  const day = now.getDay(); // 0=Sun..6=Sat
  if (Array.isArray(schedule.days) && schedule.days.length > 0 && !schedule.days.includes(day)) {
    return false;
  }

  const [startH, startM] = schedule.start.split(':').map(Number);
  const [endH, endM] = schedule.end.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes === endMinutes) return false; // zero-length window, ignore

  if (startMinutes < endMinutes) {
    // Same-day window, e.g. 09:00 -> 17:00
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Overnight window, e.g. 22:00 -> 07:00
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
};

export const syncAppBlocker = async (userId) => {
  if (Platform.OS !== 'android' || !AppBlocker) return;
  
  const apps = await getApps(userId);
  const profile = await getProfile(userId);

  // Per-app rules carry EACH app's own configured lock mode. We do NOT bake
  // in "strict" here — the native side re-evaluates schedules live (on every
  // app-switch event) and forces hard-block itself when a schedule or the
  // manual toggle says strict. This avoids staleness: JS only syncs when the
  // app opens, but schedules must flip even while LifePilot is closed.
  const rules = {};
  apps.forEach(a => {
    const pkg = a.packageName || a.name.toLowerCase();
    rules[pkg] = {
      unblockUntil: a.unblockUntil && a.unblockUntil > Date.now() ? a.unblockUntil : 0,
      lockMode: a.lockMode || 'allowance',
      // Push TODAY's budget, not the raw configured one, so a tapering app is
      // enforced against the same number the progress bar is drawn against.
      dailyBudgetMinutes: getTodaysBudget(a) || 0,
    };
  });
  
  AppBlocker.updateBlockedApps(JSON.stringify(rules));

  // Push the base mode + schedules so the native accessibility service can
  // compute the CURRENT effective mode itself, live, on every app switch —
  // with no dependency on the JS layer having run recently.
  if (AppBlocker.updateSchedules) {
    AppBlocker.updateSchedules(JSON.stringify({
      baseMode: profile?.blockingMode || 'cbt',
      schedules: Array.isArray(profile?.schedules) ? profile.schedules : [],
    }));
  }
};

// ═══════════════════════════════════════════════════════
// SCHEDULES — Context-aware auto-switching of blocking mode
// ═══════════════════════════════════════════════════════

export const getSchedules = async (userId) => {
  const profile = await getProfile(userId);
  return Array.isArray(profile?.schedules) ? profile.schedules : [];
};

export const addSchedule = async (userId, { days, start, end, mode = 'strict', label = '' }) => {
  const profile = await getProfile(userId);
  const schedules = Array.isArray(profile.schedules) ? profile.schedules : [];
  const newSchedule = {
    id: generateUUID(),
    days,   // e.g. [1,2,3,4,5] for Mon-Fri
    start,  // 'HH:MM'
    end,    // 'HH:MM'
    mode,   // 'strict' | 'cbt'
    label,
    enabled: true,
  };
  const updated = [...schedules, newSchedule];
  await saveProfile(userId, { schedules: updated });
  await syncAppBlocker(userId);
  return updated;
};

export const updateSchedule = async (userId, scheduleId, updates) => {
  const profile = await getProfile(userId);
  const schedules = Array.isArray(profile.schedules) ? profile.schedules : [];
  const updated = schedules.map(s => s.id === scheduleId ? { ...s, ...updates } : s);
  await saveProfile(userId, { schedules: updated });
  await syncAppBlocker(userId);
  return updated;
};

export const removeSchedule = async (userId, scheduleId) => {
  const profile = await getProfile(userId);
  const schedules = Array.isArray(profile.schedules) ? profile.schedules : [];
  const updated = schedules.filter(s => s.id !== scheduleId);
  await saveProfile(userId, { schedules: updated });
  await syncAppBlocker(userId);
  return updated;
};

// ═══════════════════════════════════════════════════════
// PRO QUOTA — re-exported from the pure module
// ═══════════════════════════════════════════════════════
// The arithmetic lives in `src/lib/proLimits.js` (no imports, unit-tested, same
// convention as creditRules.js). Re-exported here so Mindful Lock callers have a
// single import site.
export {
    canLockMoreApps,
    canUseSchedules, FREE_LOCKED_APP_LIMIT, lockedAppQuota
} from '../lib/proLimits';

export const getInstalledApps = async () => {
  if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.getInstalledApps) return [];
  try {
    const jsonStr = await AppBlocker.getInstalledApps();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to get installed apps:', e);
    return [];
  }
};

// ═══════════════════════════════════════════════════════
// LIVE USAGE (native-owned)
// ═══════════════════════════════════════════════════════

// The package key the native side tracks an app under. Must match the key
// syncAppBlocker() writes into the blockedApps rules.
export const nativePackageKey = (app) => app?.packageName || app?.name?.toLowerCase() || '';

/**
 * Live usage in MILLISECONDS for every given app, in one bridge round-trip.
 * "Live" means banked time plus the in-flight slice of the session currently on
 * screen — which is what lets the progress bar move while an app is open.
 * Returns a { packageKey: ms } map; empty on iOS or if the bridge is missing.
 */
export const getUsageSnapshot = async (apps) => {
  if (Platform.OS !== 'android' || !AppBlocker || !Array.isArray(apps) || apps.length === 0) return {};
  const keys = apps.map(nativePackageKey).filter(Boolean);
  if (keys.length === 0) return {};

  try {
    if (AppBlocker.getUsageSnapshot) {
      const json = await AppBlocker.getUsageSnapshot(JSON.stringify(keys));
      return JSON.parse(json) || {};
    }
    // Older native build without the batched method — fall back to per-app.
    if (AppBlocker.getUsageToday) {
      const entries = await Promise.all(keys.map(async (key) => {
        try {
          return [key, await AppBlocker.getUsageToday(key)];
        } catch {
          return [key, 0];
        }
      }));
      return Object.fromEntries(entries);
    }
  } catch {
    // Keep whatever the caller already had.
  }
  return {};
};

/**
 * Merges a live usage snapshot into an app list, setting `usageMs` (precise)
 * and `usageToday` (whole minutes, what the rest of the app already expects).
 */
export const withLiveUsage = (apps, snapshot) => {
  if (!snapshot || Object.keys(snapshot).length === 0) return apps;
  return apps.map((app) => {
    const ms = snapshot[nativePackageKey(app)];
    if (typeof ms !== 'number') return app;
    return { ...app, usageMs: ms, usageToday: Math.floor(ms / 60000) };
  });
};

// ═══════════════════════════════════════════════════════
// OVERLAY PERMISSION ("Display over other apps")
// ═══════════════════════════════════════════════════════
// Android 10+ blocks background activity starts, so without this permission the
// accessibility service's attempt to show the block screen is dropped SILENTLY.
// Accessibility alone is not enough — this is the difference between "nothing
// happens" and the block screen actually appearing.

export const hasOverlayPermission = async () => {
  if (Platform.OS !== 'android' || !AppBlocker?.hasOverlayPermission) return true;
  try {
    return !!(await AppBlocker.hasOverlayPermission());
  } catch {
    return true; // don't nag on an older native build that lacks the method
  }
};

export const requestOverlayPermission = () => {
  if (Platform.OS !== 'android') return;
  AppBlocker?.requestOverlayPermission?.();
};

const generateUUID = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// ─── Storage Keys ───────────────────────────────────────
const KEYS = {
  apps: (uid) => `mindful_apps_${uid}`,
  log: (uid) => `mindful_log_${uid}`,
  profile: (uid) => `mindful_profile_${uid}`,
};

// ─── Default Profile ────────────────────────────────────
const DEFAULT_PROFILE = {
  goal: '',
  coachPersona: 'gentle',
  blockingMode: 'cbt', // 'cbt' or 'strict' (Android only)
  streak: 0,
  bestStreak: 0,
  totalTimeSaved: 0,
  distractionScore: 50,
  dangerWindows: [],
  lastReflection: null,
  lastStreakDate: null,
  onboardingComplete: false,
};

// ═══════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════

export const getProfile = async (userId) => {
  const data = await Storage.get(KEYS.profile(userId));
  return { ...DEFAULT_PROFILE, ...(data || {}) };
};

// Maps the local (camelCase) profile shape to the mindful_profiles table columns.
const profileToRow = (userId, profile) => ({
  user_id: userId,
  goal: profile.goal ?? '',
  coach_persona: profile.coachPersona ?? 'gentle',
  blocking_mode: profile.blockingMode ?? 'cbt',
  streak: profile.streak ?? 0,
  best_streak: profile.bestStreak ?? 0,
  total_time_saved: profile.totalTimeSaved ?? 0,
  distraction_score: profile.distractionScore ?? 50,
  danger_windows: profile.dangerWindows ?? [],
  last_reflection: profile.lastReflection ?? null,
  last_streak_date: profile.lastStreakDate ?? null,
  onboarding_complete: profile.onboardingComplete ?? false,
  schedules: profile.schedules ?? [],
});

const rowToProfile = (row) => ({
  goal: row.goal ?? '',
  coachPersona: row.coach_persona ?? 'gentle',
  blockingMode: row.blocking_mode ?? 'cbt',
  streak: row.streak ?? 0,
  bestStreak: row.best_streak ?? 0,
  totalTimeSaved: row.total_time_saved ?? 0,
  distractionScore: row.distraction_score ?? 50,
  dangerWindows: row.danger_windows ?? [],
  lastReflection: row.last_reflection ?? null,
  lastStreakDate: row.last_streak_date ?? null,
  onboardingComplete: row.onboarding_complete ?? false,
  schedules: row.schedules ?? [],
});

export const saveProfile = async (userId, updates) => {
  const current = await getProfile(userId);
  const merged = { ...current, ...updates };
  // 1. Update local cache FIRST (optimistic, offline-safe — matches app-wide pattern)
  await Storage.set(KEYS.profile(userId), merged);

  // 2. Queue the cloud sync. syncToSupabase persists to the offline queue
  // BEFORE attempting the network call, so this survives app kills/offline
  // and auto-retries on reconnect — no data is lost either way.
  syncToSupabase('mindful_profiles', 'upsert', profileToRow(userId, merged), { column: 'user_id' });

  if (updates.blockingMode !== undefined || updates.schedules !== undefined) {
    await syncAppBlocker(userId);
  }
  return merged;
};

/**
 * One-time cloud hydration for Mindful Lock data. Call this after login /
 * on app init (mirrors dataManager's performInitialSync). If the local
 * cache is empty (fresh install, cleared data, or new device) but a cloud
 * profile/app-list exists, pull it down so nothing is lost. If local data
 * already exists, we leave it alone — local writes always push to the
 * cloud via saveProfile/addApp/etc, so the cloud stays a live backup.
 */
export const hydrateMindfulLockFromCloud = async (userId) => {
  if (!userId) return;
  try {
    const { supabase } = require('../lib/supabase');

    const localProfile = await Storage.get(KEYS.profile(userId));
    if (!localProfile) {
      const { data: profileRow } = await supabase
        .from('mindful_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileRow) {
        await Storage.set(KEYS.profile(userId), { ...DEFAULT_PROFILE, ...rowToProfile(profileRow) });
      }
    }

    const localApps = await Storage.get(KEYS.apps(userId));
    if (!localApps || localApps.length === 0) {
      const { data: appRows } = await supabase
        .from('mindful_apps')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (appRows && appRows.length > 0) {
        const apps = appRows.map(rowToApp);
        await Storage.set(KEYS.apps(userId), apps);
        await syncAppBlocker(userId);
      }
    }
  } catch (e) {
    console.log('[MindfulLock] Cloud hydration skipped/failed:', e.message);
  }
};

// ═══════════════════════════════════════════════════════
// APPS CRUD
// ═══════════════════════════════════════════════════════

// Maps a local app object to the mindful_apps table row shape.
const appToRow = (userId, app) => ({
  id: app.id,
  user_id: userId,
  name: app.name,
  package_name: app.packageName || '',
  icon: app.icon || '📱',
  bundle: app.bundle ?? null,
  lock_mode: app.lockMode || 'allowance',
  daily_budget_minutes: app.dailyBudgetMinutes ?? 60,
  schedule: app.schedule ?? null,
  taper_config: app.taperConfig ?? null,
  temp_allowance_minutes: app.tempAllowanceMinutes ?? 0,
  temp_allowance_date: app.tempAllowanceDate ?? null,
  unblock_until: app.unblockUntil ?? 0,
});

const rowToApp = (row) => ({
  id: row.id,
  name: row.name,
  packageName: row.package_name || '',
  icon: row.icon || '📱',
  bundle: row.bundle,
  lockMode: row.lock_mode || 'allowance',
  dailyBudgetMinutes: row.daily_budget_minutes ?? 60,
  schedule: row.schedule,
  taperConfig: row.taper_config,
  tempAllowanceMinutes: row.temp_allowance_minutes ?? 0,
  tempAllowanceDate: row.temp_allowance_date,
  unblockUntil: row.unblock_until ?? 0,
  usageToday: 0, // usage is native/device-local by design, never cloud-synced
  createdAt: row.created_at,
});

export const getApps = async (userId) => {
  return (await Storage.get(KEYS.apps(userId))) || [];
};

export const addApp = async (userId, { name, packageName = '', icon = '📱', bundle = null, lockMode = 'allowance', dailyBudgetMinutes = 60, schedule = null, taperConfig = null }) => {
  const apps = await getApps(userId);
  const newApp = {
    id: generateUUID(),
    name,
    packageName,
    icon,
    bundle,
    lockMode,
    dailyBudgetMinutes,
    schedule,
    taperConfig,
    usageToday: 0,
    createdAt: new Date().toISOString(),
  };
  apps.push(newApp);
  await Storage.set(KEYS.apps(userId), apps);

  // Start today's allowance from zero for a newly added app.
  //
  // Native only accrues usage for apps that are already tracked, so this matters
  // for the remove-then-re-add-same-day case: without it the app inherits the
  // total it built up during its earlier stint and a fresh budget is spent before
  // the user opens it once. Adding an app should always grant a full allowance
  // for the rest of today. Must run BEFORE syncAppBlocker, or the ticker can
  // bank a slice against the app between the write and the reset.
  if (Platform.OS === 'android' && packageName) {
    try {
      AppBlocker?.resetUsage?.(packageName);
    } catch (_e) {
      // Older native build without the method — the isTracked guard already
      // covers the common case, so this is a refinement, not a requirement.
    }
  }

  await syncAppBlocker(userId);
  syncToSupabase('mindful_apps', 'insert', appToRow(userId, newApp));
  return newApp;
};

export const updateApp = async (userId, appId, updates) => {
  const apps = await getApps(userId);
  const idx = apps.findIndex(a => a.id === appId);
  if (idx === -1) return null;
  apps[idx] = { ...apps[idx], ...updates };
  await Storage.set(KEYS.apps(userId), apps);
  await syncAppBlocker(userId);
  syncToSupabase('mindful_apps', 'update', appToRow(userId, apps[idx]), { column: 'id', value: appId });
  return apps[idx];
};

export const removeApp = async (userId, appId) => {
  const apps = await getApps(userId);
  const filtered = apps.filter(a => a.id !== appId);
  await Storage.set(KEYS.apps(userId), filtered);
  await syncAppBlocker(userId);
  syncToSupabase('mindful_apps', 'delete', {}, { column: 'id', value: appId });
};

export const logUsage = async (userId, appId, minutes) => {
  const apps = await getApps(userId);
  const idx = apps.findIndex(a => a.id === appId);
  if (idx !== -1) {
    apps[idx].usageToday = (apps[idx].usageToday || 0) + minutes;
    await Storage.set(KEYS.apps(userId), apps);
  }
};

// ═══════════════════════════════════════════════════════
// EVENT LOG
// ═══════════════════════════════════════════════════════

export const getLog = async (userId) => {
  return (await Storage.get(KEYS.log(userId))) || [];
};

export const grantTempAllowance = async (userId, appId, minutes) => {
  const apps = await getApps(userId);
  const idx = apps.findIndex(a => a.id === appId);
  if (idx !== -1) {
    apps[idx].tempAllowanceMinutes = (apps[idx].tempAllowanceMinutes || 0) + minutes;
    apps[idx].tempAllowanceDate = new Date().toDateString();
    apps[idx].unblockUntil = Date.now() + minutes * 60 * 1000;
    await Storage.set(KEYS.apps(userId), apps);
    await syncAppBlocker(userId);
    syncToSupabase('mindful_apps', 'update', appToRow(userId, apps[idx]), { column: 'id', value: appId });
  }
};

export const addLogEntry = async (userId, { appId, appName, action, reason = '', duration = 0, aiResponse = '' }) => {
  const log = await getLog(userId);
  const entry = {
    id: generateUUID(),
    appId,
    appName,
    action, // 'resisted' | 'used' | 'override'
    reason,
    duration,
    aiResponse,
    timestamp: new Date().toISOString(),
  };
  log.unshift(entry); // newest first
  // Keep last 500 entries
  if (log.length > 500) log.length = 500;
  await Storage.set(KEYS.log(userId), log);
  
  // Sync to database
  syncToSupabase('mindful_activity_log', 'insert', {
    id: entry.id,
    user_id: userId,
    app_id: entry.appId,
    app_name: entry.appName,
    action: entry.action,
    reason: entry.reason,
    duration: entry.duration,
    ai_response: entry.aiResponse,
    created_at: entry.timestamp
  });

  return entry;
};

export const clearLog = async (userId) => {
  await Storage.set(KEYS.log(userId), []);
};

// ═══════════════════════════════════════════════════════
// ADAPTIVE TAPERING
// ═══════════════════════════════════════════════════════

export const getTodaysBudget = (app) => {
  if (!app.taperConfig) return app.dailyBudgetMinutes;

  const { startBudget, targetBudget, startDate, endDate } = app.taperConfig;
  const now = Date.now();
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();

  if (now <= start) return startBudget;
  if (now >= end) return targetBudget;

  const progress = (now - start) / (end - start);
  return Math.round(startBudget + (targetBudget - startBudget) * progress);
};

// ═══════════════════════════════════════════════════════
// BUNDLES
// ═══════════════════════════════════════════════════════

export const getBundles = async (userId) => {
  const apps = await getApps(userId);
  const bundles = {};
  apps.forEach(app => {
    if (app.bundle) {
      if (!bundles[app.bundle]) bundles[app.bundle] = [];
      bundles[app.bundle].push(app);
    }
  });
  return bundles;
};

export const getBundleUsage = (bundleApps) => {
  return bundleApps.reduce((sum, app) => sum + (app.usageToday || 0), 0);
};

export const getBundleBudget = (bundleApps) => {
  return bundleApps.reduce((sum, app) => sum + getTodaysBudget(app), 0);
};

// ═══════════════════════════════════════════════════════
// DAILY RESET
// ═══════════════════════════════════════════════════════

export const resetDailyUsage = async (userId) => {
  const apps = await getApps(userId);
  const updated = apps.map(a => ({ ...a, usageToday: 0 }));
  await Storage.set(KEYS.apps(userId), updated);
};

// ═══════════════════════════════════════════════════════
// DISTRACTION SCORE (0-100)
// ═══════════════════════════════════════════════════════

export const getDistractionScore = async (userId) => {
  const log = await getLog(userId);
  const profile = await getProfile(userId);

  // Last 7 days
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentLog = log.filter(e => new Date(e.timestamp).getTime() > weekAgo);

  const resisted = recentLog.filter(e => e.action === 'resisted').length;
  const used = recentLog.filter(e => e.action === 'used' || e.action === 'override').length;
  const total = resisted + used;

  // 70% resistance rate
  const resistanceScore = total > 0 ? (resisted / total) * 100 : 50;

  // 20% streak (cap at 30 days = 100%)
  const streakScore = Math.min((profile.streak / 30) * 100, 100);

  // 10% trend (compare this week vs last week)
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const lastWeekLog = log.filter(e => {
    const t = new Date(e.timestamp).getTime();
    return t > twoWeeksAgo && t <= weekAgo;
  });
  const lastWeekResisted = lastWeekLog.filter(e => e.action === 'resisted').length;
  const lastWeekTotal = lastWeekResisted + lastWeekLog.filter(e => e.action !== 'resisted').length;
  const lastWeekRate = lastWeekTotal > 0 ? lastWeekResisted / lastWeekTotal : 0.5;
  const thisWeekRate = total > 0 ? resisted / total : 0.5;
  const trendScore = thisWeekRate >= lastWeekRate ? 100 : (thisWeekRate / Math.max(lastWeekRate, 0.01)) * 100;

  const score = Math.round(resistanceScore * 0.7 + streakScore * 0.2 + trendScore * 0.1);
  return Math.max(0, Math.min(100, score));
};

// ═══════════════════════════════════════════════════════
// DANGER WINDOWS
// ═══════════════════════════════════════════════════════

export const getDangerWindows = async (userId) => {
  const log = await getLog(userId);
  const usedEvents = log.filter(e => e.action === 'used' || e.action === 'override');

  // Count by hour of day
  const hourCounts = new Array(24).fill(0);
  usedEvents.forEach(e => {
    const hour = new Date(e.timestamp).getHours();
    hourCounts[hour]++;
  });

  const max = Math.max(...hourCounts, 1);
  const windows = [];
  hourCounts.forEach((count, hour) => {
    if (count > 0 && count / max >= 0.5) {
      windows.push({ hour, risk: +(count / max).toFixed(2), count });
    }
  });

  return windows.sort((a, b) => b.risk - a.risk);
};

// ═══════════════════════════════════════════════════════
// TIME SAVED
// ═══════════════════════════════════════════════════════

export const getTimeSavedToday = async (userId) => {
  const apps = await getApps(userId);
  let saved = 0;
  apps.forEach(app => {
    const budget = getTodaysBudget(app);
    const used = app.usageToday || 0;
    if (used < budget) saved += budget - used;
  });
  return saved;
};

export const getTimeEquivalent = (minutes) => {
  if (minutes < 5) return 'a few deep breaths';
  if (minutes < 15) return 'a short walk';
  if (minutes < 30) return 'a podcast episode';
  if (minutes < 60) return '3 chapters of a book';
  if (minutes < 90) return 'a full workout';
  if (minutes < 120) return 'a full movie';
  if (minutes < 180) return 'learning a new recipe and cooking it';
  return `${Math.round(minutes / 60)} hours of real life`;
};

// ═══════════════════════════════════════════════════════
// STREAK
// ═══════════════════════════════════════════════════════

export const checkMindfulStreak = async (userId) => {
  const profile = await getProfile(userId);
  const today = new Date().toDateString();

  if (profile.lastStreakDate === today) return profile; // Already checked today

  const apps = await getApps(userId);
  const allUnderBudget = apps.every(app => {
    const budget = getTodaysBudget(app);
    return (app.usageToday || 0) <= budget;
  });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday = profile.lastStreakDate === yesterday.toDateString();

  let newStreak = profile.streak;
  if (wasYesterday && allUnderBudget) {
    newStreak++;
  } else if (!wasYesterday && profile.lastStreakDate) {
    newStreak = allUnderBudget ? 1 : 0;
  } else if (!profile.lastStreakDate) {
    newStreak = allUnderBudget ? 1 : 0;
  }

  const bestStreak = Math.max(profile.bestStreak, newStreak);

  return saveProfile(userId, {
    streak: newStreak,
    bestStreak,
    lastStreakDate: today,
  });
};

// ═══════════════════════════════════════════════════════
// TODAY STATS (for UI)
// ═══════════════════════════════════════════════════════

export const getTodayStats = async (userId) => {
  const log = await getLog(userId);
  const today = new Date().toDateString();
  const todayLog = log.filter(e => new Date(e.timestamp).toDateString() === today);

  const resisted = todayLog.filter(e => e.action === 'resisted').length;
  const used = todayLog.filter(e => e.action === 'used' || e.action === 'override').length;
  const timeSaved = await getTimeSavedToday(userId);

  return { resisted, used, timeSaved, todayLog };
};

// ═══════════════════════════════════════════════════════
// COACH PERSONA TEMPLATES (fallback when AI is unavailable)
// ═══════════════════════════════════════════════════════

export const PERSONA_TEMPLATES = {
  gentle: [
    "Hey, you're doing amazing today. Is this really what your best self would choose right now?",
    "I know it's tempting. But remember why you started this journey. You've got this! 💛",
    "Just checking in — you told me {goal}. Want to stay on track?",
    "You've already resisted {resistCount} times today. That's incredible strength. One more?",
  ],
  tough: [
    "Put. The. Phone. Down. You said you'd {goal}. Prove it.",
    "You're about to throw away today's streak for what? 15 minutes of scrolling? Come on.",
    "Champions don't cave to boredom. Get back to what matters.",
    "You've resisted {resistCount} times today. Don't break the chain now.",
  ],
  stoic: [
    "The obstacle is the way. What would your wisest self choose in this moment?",
    "Between stimulus and response, there is a space. In that space is your freedom.",
    "You seek temporary pleasure while your goal — {goal} — requires patience.",
    "Discipline is choosing what you want most over what you want now.",
  ],
  witty: [
    "Oh look, someone's about to doomscroll again. Your {goal} isn't completing itself, chief. 😏",
    "Plot twist: the phone didn't actually call YOUR name. You can just... not.",
    "You've dodged it {resistCount} times today. Don't fumble on the goal line!",
    "Breaking news: Scientists confirm scrolling does NOT count as cardio.",
  ],
};

export const getPersonaFallback = (persona, goal, resistCount) => {
  const templates = PERSONA_TEMPLATES[persona] || PERSONA_TEMPLATES.gentle;
  const template = templates[Math.floor(Math.random() * templates.length)];
  return template
    .replace('{goal}', goal || 'focus on what matters')
    .replace('{resistCount}', String(resistCount || 0));
};

export const REPLACEMENT_ACTIVITIES = [
  '📖 Read 5 pages of that book you\'ve been meaning to start',
  '🚶 Take a 2-minute walk — just around the room',
  '💬 Text a friend something nice instead',
  '🧘 Do 10 deep breaths right now',
  '✏️ Write down one thing you\'re grateful for',
  '💪 Do 10 push-ups or stretches',
  '🎵 Put on your favorite song and just listen',
  '🥤 Go get a glass of water',
  '📝 Journal for 2 minutes about how you feel',
  '🌅 Look out a window for 30 seconds',
];

export const getReplacementActivity = () => {
  return REPLACEMENT_ACTIVITIES[Math.floor(Math.random() * REPLACEMENT_ACTIVITIES.length)];
};

// ─── Mindful Lock Core Engine ───────────────────────────
// Manages distraction apps, usage logging, streaks, scores,
// and the adaptive tapering system.
// ────────────────────────────────────────────────────────

import { Storage } from './storage';
import { syncToSupabase } from '../lib/syncQueue';
import { NativeModules, Platform } from 'react-native';

const { AppBlocker } = NativeModules;

export const syncAppBlocker = async (userId) => {
  if (Platform.OS !== 'android' || !AppBlocker) return;
  
  const apps = await getApps(userId);
  const profile = await getProfile(userId);
  
  const today = new Date().toDateString();
  const rules = apps.map(a => {
    let budget = a.dailyBudgetMinutes || 0;
    if (a.tempAllowanceDate === today && a.tempAllowanceMinutes) {
      budget += a.tempAllowanceMinutes;
    }
    return {
      packageName: a.packageName || a.name.toLowerCase(),
      allowanceMinutes: budget
    };
  });
  AppBlocker.updateBlockedApps(JSON.stringify(rules));
};

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

export const saveProfile = async (userId, updates) => {
  const current = await getProfile(userId);
  const merged = { ...current, ...updates };
  await Storage.set(KEYS.profile(userId), merged);
  if (updates.blockingMode !== undefined) {
    await syncAppBlocker(userId);
  }
  return merged;
};

// ═══════════════════════════════════════════════════════
// APPS CRUD
// ═══════════════════════════════════════════════════════

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
  await syncAppBlocker(userId);
  return newApp;
};

export const updateApp = async (userId, appId, updates) => {
  const apps = await getApps(userId);
  const idx = apps.findIndex(a => a.id === appId);
  if (idx === -1) return null;
  apps[idx] = { ...apps[idx], ...updates };
  await Storage.set(KEYS.apps(userId), apps);
  await syncAppBlocker(userId);
  return apps[idx];
};

export const removeApp = async (userId, appId) => {
  const apps = await getApps(userId);
  const filtered = apps.filter(a => a.id !== appId);
  await Storage.set(KEYS.apps(userId), filtered);
  await syncAppBlocker(userId);
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
    await Storage.set(KEYS.apps(userId), apps);
    await syncAppBlocker(userId);
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

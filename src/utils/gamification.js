import { supabase } from '../lib/supabase';
import { syncRpc, syncToSupabase } from '../lib/syncQueue';
import { Storage } from './storage';
import { XpEvents } from './xpEvents';

export const Gamification = {
  // Single source of truth for how much XP a task is worth, by priority.
  // Used by every task screen so completion and un-completion always agree.
  xpForTask(task) {
    const p = task?.priority;
    if (p === 3) return 50;
    if (p === 2) return 40;
    if (p === 0) return 5;
    return 10; // priority 1 / undefined = basic task
  },

  // XP for completing a single step (subtask). Kept small on purpose: a step
  // is a fraction of a task, so it rewards momentum without inflating levels.
  // Symmetric: +2 on complete, −2 on uncheck.
  xpForSubtask() {
    return 2;
  },

  // XP for successfully dismissing an alarm (a "good wake"). A snooze-free
  // dismissal is worth more than one that required snoozing, to reward
  // consistency without punishing snoozing beyond the loss of the bonus.
  // Never negative — waking up at all, even with snoozes, is still a win.
  xpForAlarm({ snoozeCount = 0 } = {}) {
    const base = 15;
    const noSnoozeBonus = snoozeCount === 0 ? 10 : 0;
    return base + noSnoozeBonus;
  },

  getLevelFromXP(xp) {
    let level = 1;
    // Required XP for (level + 1) is 50 * level * (level + 3)
    while (xp >= 50 * level * (level + 3)) {
      level++;
    }
    return level;
  },
  
  getRequiredXPForLevel(level) {
    if (level <= 1) return 0;
    return 50 * (level - 1) * ((level - 1) + 3);
  },

  toLocalDayKey(value = new Date()) {
    // `null` must stay null. A default parameter only covers `undefined`, so
    // this used to reach `new Date(null)` — the 1970 epoch — and a user with no
    // last active date was treated as absent for ~20,000 days.
    if (value === null || value === '') return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  addDays(dayKey, amount) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey || '')) return null;
    const [year, month, day] = dayKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + amount);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  },

  daysBetween(fromDay, toDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay || '') || !/^\d{4}-\d{2}-\d{2}$/.test(toDay || '')) return null;
    const toUtc = (key) => {
      const [year, month, day] = key.split('-').map(Number);
      return Date.UTC(year, month - 1, day);
    };
    return Math.round((toUtc(toDay) - toUtc(fromDay)) / 86400000);
  },

  normalizeHistory(items) {
    if (!Array.isArray(items)) return [];
    const allowed = new Set(['active', 'frozen', 'broken', 'missed']);
    const byDay = new Map();
    items.slice(-500).forEach((item) => {
      const date = this.toLocalDayKey(item?.date);
      if (!date || !allowed.has(item?.type)) return;
      byDay.set(date, {
        date,
        type: item.type,
        streakBefore: Math.max(0, Number(item.streakBefore) || 0),
        streakAfter: Math.max(0, Number(item.streakAfter) || 0),
        xpSpent: Math.max(0, Number(item.xpSpent) || 0),
        reason: typeof item.reason === 'string' ? item.reason : null,
        createdAt: item.createdAt || new Date().toISOString(),
      });
    });
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
  },

  recordHistory(state, event) {
    const history = this.normalizeHistory(state.streakHistory);
    const date = this.toLocalDayKey(event?.date);
    if (!date) return;
    const next = history.filter((item) => item.date !== date);
    next.push({
      date,
      type: event.type,
      streakBefore: Math.max(0, Number(event.streakBefore) || 0),
      streakAfter: Math.max(0, Number(event.streakAfter) || 0),
      xpSpent: Math.max(0, Number(event.xpSpent) || 0),
      reason: event.reason || null,
      createdAt: event.createdAt || new Date().toISOString(),
    });
    state.streakHistory = this.normalizeHistory(next);
    state.streakHistoryVersion = 1;
  },

  /**
   * A streak of N ending on lastActiveDate means those N consecutive days were
   * active, so the calendar can be reconstructed for accounts whose streak
   * predates history tracking. Existing entries are never overwritten — a
   * recorded freeze or break inside the run stays exactly as it happened.
   */
  backfillStreakRun(state) {
    const anchor = this.toLocalDayKey(state.lastActiveDate);
    const streak = Math.max(0, Number(state.streak) || 0);
    if (!anchor || streak <= 0) return false;

    const existing = new Set(this.normalizeHistory(state.streakHistory).map((item) => item.date));
    const pending = [];
    for (let offset = 0; offset < Math.min(streak, 400); offset += 1) {
      const date = this.addDays(anchor, -offset);
      if (!date || existing.has(date)) continue;
      pending.push({
        date,
        type: 'active',
        streakBefore: Math.max(0, streak - offset - 1),
        streakAfter: streak - offset,
        reason: 'backfilled',
      });
    }
    if (pending.length === 0) return false;
    pending.forEach((event) => this.recordHistory(state, event));
    return true;
  },

  async getState(userId) {
    if (!userId) return null;
    const defaultState = {
      xp: 0,
      level: 1,
      streak: 0,
      lastActiveDate: null,
      tasksCompletedToday: 0,
      streakHistoryVersion: 1,
      streakHistory: [],
      lastStreakResult: null,
    };

    let state = await Storage.get(`gamification_${userId}`);

    // A cache miss may hydrate the aggregate from the server. History remains
    // local-first because the current profile schema stores only aggregates.
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('xp, streak, level, last_active_date, tasks_completed_today')
          .eq('id', userId)
          .single();

        if (data) {
          state = {
            ...defaultState,
            xp: Math.max(0, Number(data.xp) || 0),
            level: this.getLevelFromXP(data.xp || 0),
            streak: Math.max(0, Number(data.streak) || 0),
            lastActiveDate: this.toLocalDayKey(data.last_active_date),
            tasksCompletedToday: Math.max(0, Number(data.tasks_completed_today) || 0),
          };
          await Storage.set(`gamification_${userId}`, state);
        }
      } catch (err) {
        console.log('[Gamification] Error fetching state for fresh install:', err.message);
      }
    }

    const normalized = state && typeof state === 'object' && !Array.isArray(state)
      ? { ...defaultState, ...state }
      : { ...defaultState };
    normalized.xp = Math.max(0, Number(normalized.xp) || 0);
    normalized.level = Math.max(1, Number(normalized.level) || this.getLevelFromXP(normalized.xp));
    normalized.streak = Math.max(0, Number(normalized.streak) || 0);
    normalized.tasksCompletedToday = Math.max(0, Number(normalized.tasksCompletedToday) || 0);
    normalized.lastActiveDate = this.toLocalDayKey(normalized.lastActiveDate);
    normalized.streakHistory = this.normalizeHistory(normalized.streakHistory);
    return normalized;
  },

  async saveState(userId, state) {
    if (!userId) return;
    const normalized = {
      ...state,
      lastActiveDate: this.toLocalDayKey(state.lastActiveDate),
      streakHistoryVersion: 1,
      streakHistory: this.normalizeHistory(state.streakHistory),
    };

    // Local state is committed first. The aggregate profile mutation is then
    // queued durably, so offline streak and freeze changes survive restarts.
    await Storage.set(`gamification_${userId}`, normalized);
    syncToSupabase('profiles', 'update', {
      xp: normalized.xp,
      level: normalized.level,
      streak: normalized.streak,
      last_active_date: normalized.lastActiveDate,
      tasks_completed_today: normalized.tasksCompletedToday,
    }, { column: 'id', value: userId });
  },

  async checkStreak(userId) {
    const state = await this.getState(userId);
    if (!state) return null;

    const today = this.toLocalDayKey();
    const lastActive = this.toLocalDayKey(state.lastActiveDate);
    const streakBefore = Math.max(0, Number(state.streak) || 0);
    const levelAtStart = Math.max(Number(state.level) || 1, this.getLevelFromXP(state.xp));
    let streakAdvanced = false;
    let result = 'continued';
    let missedDays = 0;
    let xpSpent = 0;

    // Migrate old aggregate-only state into the calendar once, without
    // inventing historical freeze/break events that the old model never kept.
    if (lastActive === today) {
      const hadToday = state.streakHistory.some((item) => item.date === today);
      if (!hadToday) {
        this.recordHistory(state, {
          date: today,
          type: 'active',
          streakBefore,
          streakAfter: streakBefore,
          reason: 'history_started',
        });
      }
      const backfilled = this.backfillStreakRun(state);
      if (!hadToday || backfilled) {
        state.lastStreakResult = { date: today, outcome: 'history_started', missedDays: 0, xpSpent: 0 };
        await this.saveState(userId, state);
      }
      return state;
    }

    if (!lastActive) {
      state.streak = streakBefore > 0 ? streakBefore : 1;
      result = streakBefore > 0 ? 'recovered' : 'started';
    } else {
      const elapsedDays = this.daysBetween(lastActive, today);

      if (elapsedDays === 1) {
        state.streak = Math.max(1, streakBefore + 1);
        streakAdvanced = true;
      } else if (elapsedDays != null && elapsedDays > 1) {
        missedDays = elapsedDays - 1;
        const freezeSetting = await Storage.get(`streak_freeze_enabled_${userId}`);
        const freezeEnabled = freezeSetting === true || freezeSetting === 'true';
        const levelFloor = this.getRequiredXPForLevel(levelAtStart);
        const spendableXP = Math.max(0, state.xp - levelFloor);
        const requiredCost = 500 * missedDays;
        const canFullyProtect = freezeEnabled && streakBefore > 0 && spendableXP >= requiredCost;

        if (canFullyProtect) {
          xpSpent = requiredCost;
          state.xp -= requiredCost;
          for (let offset = 1; offset <= missedDays; offset += 1) {
            this.recordHistory(state, {
              date: this.addDays(lastActive, offset),
              type: 'frozen',
              streakBefore,
              streakAfter: streakBefore,
              xpSpent: 500,
              reason: 'auto_freeze',
            });
          }
          state.streak = streakBefore + 1;
          streakAdvanced = true;
          result = 'frozen';
        } else {
          for (let offset = 1; offset <= missedDays; offset += 1) {
            this.recordHistory(state, {
              date: this.addDays(lastActive, offset),
              type: offset === 1 ? 'broken' : 'missed',
              streakBefore: offset === 1 ? streakBefore : 0,
              streakAfter: 0,
              reason: freezeEnabled ? 'insufficient_safe_xp' : 'freeze_disabled',
            });
          }
          state.streak = 1;
          result = freezeEnabled && streakBefore > 0 ? 'freeze_unfunded' : 'reset';
        }
      } else {
        // A clock/timezone correction must never charge XP or destroy a streak.
        state.streak = Math.max(1, streakBefore);
        result = 'clock_adjusted';
      }
    }

    if (streakAdvanced && [7, 14, 30, 60, 100].includes(state.streak)) {
      state.xp += 500;
      result = result === 'frozen' ? 'frozen_milestone' : 'milestone';
    }

    state.lastActiveDate = today;
    state.tasksCompletedToday = 0;
    state.level = Math.max(levelAtStart, this.getLevelFromXP(state.xp));
    this.recordHistory(state, {
      date: today,
      type: 'active',
      streakBefore,
      streakAfter: state.streak,
      reason: result,
    });
    this.backfillStreakRun(state);
    state.lastStreakResult = { date: today, outcome: result, missedDays, xpSpent };
    await this.saveState(userId, state);
    return state;
  },

  async addXP(userId, amount) {
    const state = await this.checkStreak(userId);
    if (!state) return;

    state.xp += amount;
    // Prevent negative XP
    state.xp = Math.max(0, state.xp);
    
    // Level formula using dynamic curve
    state.level = this.getLevelFromXP(state.xp);

    if (amount > 0) {
      state.tasksCompletedToday += 1;
    } else if (amount < 0 && state.tasksCompletedToday > 0) {
      state.tasksCompletedToday -= 1;
    }

    // Surface a small "+X XP / −X XP" popup app-wide (single wiring point).
    XpEvents.emit(amount);

    // Mirror the completion into the shared daily rollup that the leaderboard
    // reads. Queued via RPC so it replays when offline, and the local day is
    // sent from the device because the server only knows UTC.
    if (amount !== 0) {
      syncRpc('bump_daily_tasks', {
        p_local_day: this.toLocalDayKey(),
        p_delta: amount > 0 ? 1 : -1,
      }).catch(() => {});
    }

    await this.saveState(userId, state);
    return state;
  }
};

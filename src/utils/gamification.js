import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
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

  async getState(userId) {
    if (!userId) return null;
    const defaultState = {
      xp: 0,
      level: 1,
      streak: 0,
      lastActiveDate: null,
      tasksCompletedToday: 0
    };
    
    let state = await Storage.get(`gamification_${userId}`);
    
    // HYDRATION FIX: If completely missing from local storage (e.g., fresh install or cache clear),
    // fetch the real state directly from the server so we don't accidentally overwrite the server with 0s.
    if (!state) {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('xp, streak, level, last_active_date, tasks_completed_today')
          .eq('id', userId)
          .single();
          
        if (data) {
          state = {
            xp: data.xp || 0,
            level: this.getLevelFromXP(data.xp || 0),
            streak: data.streak || 0,
            lastActiveDate: data.last_active_date ? new Date(data.last_active_date).toDateString() : null,
            tasksCompletedToday: data.tasks_completed_today || 0
          };
          await Storage.set(`gamification_${userId}`, state);
        }
      } catch (err) {
        console.log('[Gamification] Error fetching state for fresh install:', err.message);
      }
    }

    // We no longer check against Storage profile.xp here because the profile in Storage 
    // is often stale. If the user deducts XP, state.xp becomes lower than the stale 
    // profile.xp, causing this function to wrongly revert the deduction. 
    // Cross-device server sync is handled separately in DashboardScreen's backgroundOps.

    return state ? { ...defaultState, ...state } : defaultState;
  },

  async saveState(userId, state) {
    if (!userId) return;
    await Storage.set(`gamification_${userId}`, state);
    
    // Sync to Supabase profiles table for cross-device persistence
    syncToSupabase('profiles', 'update', {
      xp: state.xp,
      level: state.level,
      streak: state.streak,
      last_active_date: state.lastActiveDate,
      tasks_completed_today: state.tasksCompletedToday
    }, { column: 'id', value: userId });
  },

  async checkStreak(userId) {
    const state = await this.getState(userId);
    if (!state) return;

    // Streak protection must never lower the level the user had when this check
    // started. Only XP earned above this level's cumulative floor is spendable.
    const levelAtStart = Math.max(Number(state.level) || 1, this.getLevelFromXP(state.xp || 0));
    const today = new Date().toDateString();
    const lastActive = state.lastActiveDate;

    // If active today, do nothing.
    if (lastActive === today) return state;

    // If last active was exactly yesterday, streak continues! Otherwise, we check for a Streak Freeze.
    if (lastActive) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toDateString();

      if (lastActive === yesterdayStr) {
        // NEW STREAK LOGIC: Increment streak just by opening the app on a new day!
        state.streak += 1;
        state.lastActiveDate = today;
        console.log(`[Gamification] Streak increased to ${state.streak} just by opening the app!`);

        // Milestone Bonus
        if ([7, 14, 30, 60, 100].includes(state.streak)) {
          state.xp += 500;
          console.log(`[Gamification] Milestone Reached! ${state.streak} Days. +500 XP`);
        }
      } else {
        // Calculate days missed
        const lastDate = new Date(lastActive);
        const currentDate = new Date(today);
        // Reset times to midnight for accurate day diff
        lastDate.setHours(0,0,0,0);
        currentDate.setHours(0,0,0,0);

        const daysMissed = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24)) - 1;

        // Protection is opt-in. A missing setting is disabled, so XP is never
        // spent until the user explicitly enables Auto Streak Freeze.
        const freezeSetting = await Storage.get(`streak_freeze_enabled_${userId}`);
        const freezeEnabled = freezeSetting === true || freezeSetting === 'true';

        if (daysMissed > 0 && state.streak > 0 && freezeEnabled) {
          const requestedCost = 500 * daysMissed;
          const levelFloor = this.getRequiredXPForLevel(levelAtStart);
          const spendableXP = Math.max(0, state.xp - levelFloor);

          if (spendableXP > 0) {
            // Spend at most the XP earned inside the current level. Example: if
            // only 30 XP was earned after reaching this level, protection costs
            // 30 XP—not 500—and can never remove the level or its stone.
            const actualCost = Math.min(requestedCost, spendableXP);
            state.xp = Math.max(levelFloor, state.xp - actualCost);
            console.log(`[Gamification] Streak Freeze activated for ${daysMissed} day(s). Cost: ${actualCost}/${requestedCost} XP; level floor preserved.`);

            // Resume streak from today.
            state.streak += 1;
            state.lastActiveDate = today;
          } else {
            state.streak = 1; // No current-level XP is available to fund protection.
            state.lastActiveDate = today;
          }
        } else {
          state.streak = 1; // start new streak today
          state.lastActiveDate = today;
        }
      }
    } else if (state.streak > 0) {
      // lastActiveDate is null but streak exists — recovering from fresh install/cache wipe.
      // Preserve the streak and mark today as the active date instead of resetting.
      console.log(`[Gamification] Recovering streak of ${state.streak} from server (no lastActiveDate).`);
      state.lastActiveDate = today;
    } else {
      state.streak = 1; // First day ever!
      state.lastActiveDate = today;
    }

    state.tasksCompletedToday = 0; // Reset daily count
    state.level = Math.max(levelAtStart, this.getLevelFromXP(state.xp));
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

    await this.saveState(userId, state);
    return state;
  }
};

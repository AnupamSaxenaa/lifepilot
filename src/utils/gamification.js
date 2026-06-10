import { Storage } from './storage';

export const Gamification = {
  async getState(userId) {
    if (!userId) return null;
    const defaultState = {
      xp: 0,
      level: 1,
      streak: 0,
      lastActiveDate: null,
      tasksCompletedToday: 0
    };
    const state = await Storage.get(`gamification_${userId}`);
    return state ? { ...defaultState, ...state } : defaultState;
  },

  async saveState(userId, state) {
    if (!userId) return;
    await Storage.set(`gamification_${userId}`, state);
  },

  async checkStreak(userId) {
    const state = await this.getState(userId);
    if (!state) return;
    
    const today = new Date().toDateString();
    const lastActive = state.lastActiveDate;

    // If active today, do nothing.
    if (lastActive === today) return state;

    // If last active was exactly yesterday, streak continues! Otherwise, reset.
    if (lastActive) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (lastActive !== yesterday.toDateString()) {
        state.streak = 0; // Streak broken
      }
    } else {
      state.streak = 0;
    }

    state.tasksCompletedToday = 0; // Reset daily count
    await this.saveState(userId, state);
    return state;
  },

  async addXP(userId, amount) {
    const state = await this.checkStreak(userId);
    if (!state) return;

    state.xp += amount;
    
    // Level formula: Level = floor(xp / 100) + 1
    state.level = Math.floor(state.xp / 100) + 1;

    const today = new Date().toDateString();
    
    // First task of the day triggers the streak!
    if (amount > 0 && state.lastActiveDate !== today) {
      state.streak += 1;
      state.lastActiveDate = today;
    }

    if (amount > 0) {
      state.tasksCompletedToday += 1;
    } else if (amount < 0 && state.tasksCompletedToday > 0) {
      state.tasksCompletedToday -= 1;
    }

    await this.saveState(userId, state);
    return state;
  }
};

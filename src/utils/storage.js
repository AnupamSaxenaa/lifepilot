import AsyncStorage from '@react-native-async-storage/async-storage';

export const Storage = {
  async set(key, value) {
    try {
      const jsonValue = JSON.stringify(value);
      await AsyncStorage.setItem(`@lifepilot_${key}`, jsonValue);
    } catch (e) {
      console.error('Storage set error:', e);
    }
  },

  async get(key) {
    try {
      const jsonValue = await AsyncStorage.getItem(`@lifepilot_${key}`);
      return jsonValue != null ? JSON.parse(jsonValue) : null;
    } catch (e) {
      console.error('Storage get error:', e);
      return null;
    }
  },

  async remove(key) {
    try {
      await AsyncStorage.removeItem(`@lifepilot_${key}`);
    } catch (e) {
      console.error('Storage remove error:', e);
    }
  },

  // ⚡ PERFORMANCE: Batch multiple set operations into 1 disk write
  async setBatch(entries) {
    try {
      const pairs = entries.map(([key, value]) => [
        `@lifepilot_${key}`,
        JSON.stringify(value)
      ]);
      await AsyncStorage.multiSet(pairs);
    } catch (e) {
      console.error('Storage setBatch error:', e);
    }
  },

  /**
   * Remove every LifePilot key. Used on sign-out and account deletion.
   *
   * This existed as a CALL SITE long before it existed as a method:
   * `SettingsScreen.handleDeleteAccount` awaited `Storage.clear()`, which threw
   * "undefined is not a function" as an unhandled rejection — so deletion always
   * appeared to hang even when the server side had completed.
   *
   * Deliberately NOT `AsyncStorage.clear()`. That wipes the whole store,
   * including the Supabase auth session and any other library's keys. We only
   * own the `@lifepilot_` prefix, so we only remove that.
   */
  async clear() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const ours = keys.filter((key) => key.startsWith('@lifepilot_'));
      if (ours.length > 0) await AsyncStorage.multiRemove(ours);
      return ours.length;
    } catch (e) {
      console.error('Storage clear error:', e);
      return 0;
    }
  },

  // ⚡ PERFORMANCE: Batch multiple get operations into 1 disk read
  async getBatch(keys) {
    try {
      const prefixedKeys = keys.map(k => `@lifepilot_${k}`);
      const pairs = await AsyncStorage.multiGet(prefixedKeys);
      return pairs.reduce((acc, [key, value]) => {
        const originalKey = key.replace('@lifepilot_', '');
        acc[originalKey] = value ? JSON.parse(value) : null;
        return acc;
      }, {});
    } catch (e) {
      console.error('Storage getBatch error:', e);
      return {};
    }
  }
};

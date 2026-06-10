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
  }
};

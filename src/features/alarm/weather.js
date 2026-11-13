/**
 * LifePilot — Weather (optional, graceful-degradation)
 * ------------------------------------------------------------------
 * Fetches current weather from Open-Meteo (free, no API key) using the
 * device's approximate location (`expo-location`). Caches the last
 * successful result offline-first so it can still render (marked stale)
 * without a network hit, and returns `null` whenever anything is
 * unavailable — permission denied, no location fix, offline, or a fetch
 * error — so calling UI can simply hide the weather section (Req 15.3).
 *
 * Requires `expo-location` + its config plugin (added to app.json) — a
 * native-build dependency; harmless to import before that build lands since
 * every failure path here is caught and returns null.
 */
import { Storage } from '../../utils/storage';

const CACHE_KEY = 'alarm_weather_cache';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — weather doesn't need to be more frequent

/** Read the last successful weather snapshot without requesting permission/network. */
export const getCachedWeather = async () => {
  try {
    const cached = await Storage.get(CACHE_KEY);
    return cached?.data || null;
  } catch (_e) {
    return null;
  }
};

let Location = null;
try {
  Location = require('expo-location');
} catch (_e) {
  Location = null;
}

const weatherCodeToSuggestion = (code, precipProb) => {
  // WMO weather codes (Open-Meteo). Grouped coarsely for simple suggestions.
  if (precipProb >= 50 || (code >= 51 && code <= 99)) return 'alarmWeather.suggestUmbrella';
  if (code >= 45 && code <= 48) return 'alarmWeather.suggestFog';
  if (code === 0 || code === 1) return null; // clear, no suggestion needed
  return null;
};

/** Resolve current weather, or null if unavailable for any reason. */
export const getCurrentWeather = async () => {
  try {
    const cached = await Storage.get(CACHE_KEY);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data;
    }

    if (!Location) return cached ? cached.data : null;

    const { status } = await Location.getForegroundPermissionsAsync();
    let granted = status === 'granted';
    if (!granted) {
      const req = await Location.requestForegroundPermissionsAsync();
      granted = req.status === 'granted';
    }
    if (!granted) return cached ? cached.data : null;

    const pos = await Location.getLastKnownPositionAsync({}) || await Location.getCurrentPositionAsync({});
    if (!pos) return cached ? cached.data : null;

    const { latitude, longitude } = pos.coords;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation_probability,weather_code,uv_index` +
      `&daily=sunrise,sunset&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) return cached ? cached.data : null;
    const json = await res.json();

    const current = json.current || {};
    const daily = json.daily || {};
    const data = {
      temperature: current.temperature_2m ?? null,
      feelsLike: current.apparent_temperature ?? null,
      humidity: current.relative_humidity_2m ?? null,
      windSpeed: current.wind_speed_10m ?? null,
      rainProbability: current.precipitation_probability ?? null,
      uvIndex: current.uv_index ?? null,
      weatherCode: current.weather_code ?? null,
      sunrise: daily.sunrise ? daily.sunrise[0] : null,
      sunset: daily.sunset ? daily.sunset[0] : null,
      suggestionKey: weatherCodeToSuggestion(current.weather_code, current.precipitation_probability),
    };

    await Storage.set(CACHE_KEY, { fetchedAt: Date.now(), data });
    return data;
  } catch (e) {
    console.warn('[Weather] getCurrentWeather failed, degrading gracefully:', e?.message || e);
    const cached = await Storage.get(CACHE_KEY).catch(() => null);
    return cached ? cached.data : null;
  }
};

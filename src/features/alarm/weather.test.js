const mockStore = new Map();
const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
};

jest.mock('../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key) => mockStore.get(key) ?? null),
    set: jest.fn(async (key, value) => mockStore.set(key, value)),
  },
}));
jest.mock('expo-location', () => mockLocation);

const { getCachedWeather, getCurrentWeather } = require('./weather');
const CACHE_KEY = 'alarm_weather_cache';
const NOW = 2_000_000_000_000;

const position = { coords: { latitude: 28.6, longitude: 77.2 } };
const response = {
  current: {
    temperature_2m: 28,
    apparent_temperature: 30,
    relative_humidity_2m: 65,
    wind_speed_10m: 12,
    precipitation_probability: 60,
    weather_code: 61,
    uv_index: 4,
  },
  daily: { sunrise: ['2026-07-16T05:30'], sunset: ['2026-07-16T19:20'] },
};

describe('alarm weather cache', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    global.fetch = jest.fn();
    Object.values(mockLocation).forEach((fn) => fn.mockReset());
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(position);
    mockLocation.getCurrentPositionAsync.mockResolvedValue(position);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns a fresh snapshot without permission or network work', async () => {
    const data = { temperature: 25 };
    mockStore.set(CACHE_KEY, { fetchedAt: NOW - 1000, data });
    await expect(getCurrentWeather()).resolves.toEqual(data);
    expect(mockLocation.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });


  test('refreshes expired weather and stores the complete snapshot', async () => {
    mockStore.set(CACHE_KEY, { fetchedAt: NOW - 31 * 60 * 1000, data: { temperature: 20 } });
    global.fetch.mockResolvedValue({ ok: true, json: async () => response });

    const data = await getCurrentWeather();

    expect(data).toEqual(expect.objectContaining({
      temperature: 28,
      feelsLike: 30,
      rainProbability: 60,
      suggestionKey: 'alarmWeather.suggestUmbrella',
      sunrise: '2026-07-16T05:30',
    }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('latitude=28.6'));
    expect(mockStore.get(CACHE_KEY)).toEqual({ fetchedAt: NOW, data });
  });

  test('uses current position when no last-known location exists', async () => {
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    global.fetch.mockResolvedValue({ ok: true, json: async () => response });

    await getCurrentWeather();

    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  test('returns stale cache when permission is denied or fetch fails', async () => {
    const stale = { temperature: 19 };
    mockStore.set(CACHE_KEY, { fetchedAt: NOW - 60 * 60 * 1000, data: stale });
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(getCurrentWeather()).resolves.toEqual(stale);

    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    global.fetch.mockRejectedValue(new Error('offline'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(getCurrentWeather()).resolves.toEqual(stale);
    warn.mockRestore();
  });

  test('cached-only read returns the latest snapshot or null', async () => {
    await expect(getCachedWeather()).resolves.toBeNull();
    mockStore.set(CACHE_KEY, { fetchedAt: NOW, data: { temperature: 22 } });
    await expect(getCachedWeather()).resolves.toEqual({ temperature: 22 });
  });
});
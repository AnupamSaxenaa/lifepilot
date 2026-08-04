/**
 * LifePilot — Public Holiday Calendar
 * ------------------------------------------------------------------
 * Fetches public holidays for a country/year from the free Nager.Date API
 * (no API key, no native module — pure fetch) and caches them offline. Used
 * to let a recurring alarm skip public holidays (Req 2.8).
 *
 * Degrades gracefully: if the country is unsupported or the network/API call
 * fails, returns an empty list (never throws) and the caller simply has no
 * holidays to skip that year — never breaks the underlying alarm.
 */
import { Storage } from '../../utils/storage';

const CACHE_KEY = (country, year) => `alarm_holidays_${country}_${year}`;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // holidays for a year rarely change; 7-day cache is generous

/**
 * @returns {Promise<string[]>} ISO 'YYYY-MM-DD' dates that are public holidays
 */
export const getPublicHolidays = async (countryCode, year) => {
  if (!countryCode || !year) return [];
  const cacheKey = CACHE_KEY(countryCode, year);
  try {
    const cached = await Storage.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.dates;
    }

    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
    if (!res.ok) return cached ? cached.dates : [];
    const json = await res.json();
    const dates = Array.isArray(json) ? json.map((h) => h.date) : [];

    await Storage.set(cacheKey, { fetchedAt: Date.now(), dates });
    return dates;
  } catch (e) {
    console.warn('[Holidays] getPublicHolidays failed, degrading gracefully:', e?.message || e);
    const cached = await Storage.get(cacheKey).catch(() => null);
    return cached ? cached.dates : [];
  }
};

/** Common country codes for the picker; names are resolved through i18n. */
export const SUPPORTED_HOLIDAY_COUNTRIES = [
  'US', 'GB', 'IN', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'BR',
  'MX', 'JP', 'CN', 'ID', 'PK', 'BD', 'NG', 'RU', 'TR', 'VN',
].map((code) => ({ code, i18nKey: `alarmHolidays.countries.${code}` }));

/**
 * Resolve this year's + next year's public holidays for `countryCode` and
 * attach them separately from user-created `skipDates`. Keeping generated
 * dates separate means changing/disabling the country cannot accidentally
 * retain stale holidays or erase manual skips.
 */
export const applyHolidaySkips = async (rule, countryCode) => {
  if (!countryCode) {
    return {
      ...rule,
      skipPublicHolidays: false,
      holidayCountry: null,
      holidayDates: [],
    };
  }
  const now = new Date();
  const [thisYear, nextYear] = await Promise.all([
    getPublicHolidays(countryCode, now.getFullYear()),
    getPublicHolidays(countryCode, now.getFullYear() + 1),
  ]);
  return {
    ...rule,
    skipPublicHolidays: true,
    holidayCountry: countryCode,
    holidayDates: Array.from(new Set([...thisYear, ...nextYear])).sort(),
  };
};

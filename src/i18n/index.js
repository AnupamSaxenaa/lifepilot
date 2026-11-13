// ─── i18n Setup ──────────────────────────────────────────────
// One-time init, called from App.js before rendering. Resolution order:
//   1. User's manually-picked language (persisted to AsyncStorage)
//   2. Device locale (via expo-localization), matched against our supported set
//   3. English fallback
//
// Translation files live in ./locales/<code>.json — each is a flat-ish JSON
// tree loaded synchronously at bundle time (they're small, this keeps things
// simple and avoids async-loading jank on first paint).
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import { Storage } from '../utils/storage';
import { DEFAULT_LANGUAGE_CODE, RTL_LANGUAGE_CODES, SUPPORTED_LANGUAGES } from './languages';

// English is the fallback for every other language, so it is always needed and
// therefore always loaded eagerly.
import en from './locales/en.json';

// ─── Lazy locale loading ──────────────────────────────────────────────────
// The other twenty locales sit behind thunks instead of top-level imports.
//
// WHY: src/i18n/locales is 2.0 MB of JSON and this module imported all of it, so
// every consumer paid to parse and materialise twenty languages nobody was
// reading. That lands on two paths which both matter:
//
//   • app cold start — App.js imports this module at the top level
//   • EVERY home-screen widget tap — the widget's headless task boots a JS
//     context and evaluates App.js's module graph before the tap handler can run,
//     so ticking a checkbox on the widget was parsing twenty translation files
//     first. The widgets reference no translations at all.
//
// Metro still bundles every file, so the download does not change. What changes is
// that a `require` inside a thunk is evaluated only when that language is actually
// selected, so startup materialises English plus at most the one language in use.
//
// Adding a language means a line here and one in ./languages. The require path
// must stay a literal string — Metro resolves these statically.
const LOCALE_LOADERS = {
  ar: () => require('./locales/ar.json'),
  bn: () => require('./locales/bn.json'),
  de: () => require('./locales/de.json'),
  es: () => require('./locales/es.json'),
  fr: () => require('./locales/fr.json'),
  hi: () => require('./locales/hi.json'),
  id: () => require('./locales/id.json'),
  it: () => require('./locales/it.json'),
  ja: () => require('./locales/ja.json'),
  ko: () => require('./locales/ko.json'),
  nl: () => require('./locales/nl.json'),
  pl: () => require('./locales/pl.json'),
  pt: () => require('./locales/pt.json'),
  ru: () => require('./locales/ru.json'),
  th: () => require('./locales/th.json'),
  tr: () => require('./locales/tr.json'),
  ur: () => require('./locales/ur.json'),
  vi: () => require('./locales/vi.json'),
  'zh-Hans': () => require('./locales/zh-Hans.json'),
  'zh-Hant': () => require('./locales/zh-Hant.json'),
};

// English is registered up front; everything else is added on demand.
const loadedLocales = new Set([DEFAULT_LANGUAGE_CODE]);

/** Evaluate a locale's thunk, tolerating both CJS and ESM interop shapes. */
const localeBundle = (code) => {
  const loader = LOCALE_LOADERS[code];
  if (!loader) return null;
  try {
    const mod = loader();
    return mod?.default || mod || null;
  } catch (error) {
    // A missing or malformed locale must not break the app; i18next falls back to
    // English, which is always loaded.
    console.warn(`[i18n] Could not load locale "${code}":`, error?.message || error);
    return null;
  }
};

/**
 * Register `code`'s translations with i18next AFTER init.
 *
 * Only valid once i18next is initialised: bundles handed to addResourceBundle
 * before init() are discarded when init builds its store, which silently left the
 * startup language untranslated. The initial language is therefore passed through
 * `resources` in initI18n instead — see buildInitialResources.
 *
 * Safe to call repeatedly; the tracking set short-circuits repeat calls.
 */
const ensureLocaleLoaded = (code) => {
  if (!code || loadedLocales.has(code)) return;
  const bundle = localeBundle(code);
  if (!bundle) return;
  // deep=false, overwrite=false: never clobber a bundle already present.
  i18n.addResourceBundle(code, 'translation', bundle, false, false);
  loadedLocales.add(code);
};

/**
 * The resources i18next is initialised with: English, plus the startup language
 * when it differs. Passing it here rather than adding it afterwards means the very
 * first render is already translated, with no flash of English.
 */
const buildInitialResources = (initialLanguage) => {
  const resources = { en: { translation: en } };
  if (initialLanguage && initialLanguage !== DEFAULT_LANGUAGE_CODE) {
    const bundle = localeBundle(initialLanguage);
    if (bundle) {
      resources[initialLanguage] = { translation: bundle };
      loadedLocales.add(initialLanguage);
    }
  }
  return resources;
};



const LANGUAGE_STORAGE_KEY = 'app_language';
const SUPPORTED_CODES = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

// Matches a raw device locale tag (e.g. "pt-BR", "zh-CN", "en-US") to one of
// our supported codes, falling back to a base-language match, then default.
const resolveDeviceLanguage = () => {
  try {
    const locales = Localization.getLocales?.() || [];
    for (const loc of locales) {
      const tag = loc?.languageTag; // e.g. "pt-BR"
      const base = loc?.languageCode; // e.g. "pt"
      if (tag === 'zh-CN' || tag === 'zh-SG') return 'zh-Hans';
      if (tag === 'zh-TW' || tag === 'zh-HK' || tag === 'zh-MO') return 'zh-Hant';
      if (tag && SUPPORTED_CODES.has(tag)) return tag;
      if (base && SUPPORTED_CODES.has(base)) return base;
    }
  } catch (_e) {}
  return DEFAULT_LANGUAGE_CODE;
};

// Applies RTL layout direction for the given language, if needed. Changing
// this requires an app reload to fully re-layout (RN limitation) — we only
// force a reload when the RTL-ness actually changes, not on every switch.
const applyRTL = (code) => {
  const shouldBeRTL = RTL_LANGUAGE_CODES.includes(code);
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
    return true; // caller should trigger a reload
  }
  return false;
};

let i18nInitPromise = null;

export const initI18n = () => {
  if (i18n.isInitialized) return Promise.resolve(i18n);
  if (i18nInitPromise) return i18nInitPromise;

  i18nInitPromise = (async () => {
    let initialLanguage = DEFAULT_LANGUAGE_CODE;
    try {
      const saved = await Storage.get(LANGUAGE_STORAGE_KEY);
      if (saved && SUPPORTED_CODES.has(saved)) {
        initialLanguage = saved;
      } else {
        initialLanguage = resolveDeviceLanguage();
      }
    } catch (_e) {
      initialLanguage = resolveDeviceLanguage();
    }

    applyRTL(initialLanguage);

    await i18n.use(initReactI18next).init({
      // Built per-launch so the startup language is present from the first render.
      resources: buildInitialResources(initialLanguage),
      lng: initialLanguage,
      fallbackLng: DEFAULT_LANGUAGE_CODE,
      compatibilityJSON: 'v4',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });

    return i18n;
  })().catch((error) => {
    i18nInitPromise = null;
    throw error;
  });

  return i18nInitPromise;
};

// Call from Settings when the user manually picks a language. Returns
// `{ needsReload }` — true if RTL direction changed and a full app reload is
// required for layout to update correctly (RN can't re-flip direction live).
export const setAppLanguage = async (code) => {
  if (!SUPPORTED_CODES.has(code)) return { needsReload: false };
  await Storage.set(LANGUAGE_STORAGE_KEY, code);
  const needsReload = applyRTL(code);
  // Must happen before changeLanguage: switching to a language whose bundle is
  // not registered yet would render raw translation keys until it arrived.
  ensureLocaleLoaded(code);
  await i18n.changeLanguage(code);
  return { needsReload };
};

export const getCurrentLanguage = () => i18n.language || DEFAULT_LANGUAGE_CODE;

// True once the user (on THIS device) has explicitly picked a language,
// either during registration or from Settings. Used to decide whether a
// profile's cross-device `preferred_language` should override what's
// currently active — we never want to silently overwrite a choice the user
// just made on this device.
const hasExplicitLocalChoice = async () => {
  try {
    const saved = await Storage.get(LANGUAGE_STORAGE_KEY);
    return !!(saved && SUPPORTED_CODES.has(saved));
  } catch (_e) {
    return false;
  }
};

// Call after a profile loads (e.g. fresh login on a new device). If this
// device has no explicit local language choice yet, and the profile carries
// a `preferred_language` from another device/registration, adopt it so the
// user's choice follows them. Returns `{ changed, needsReload }`.
export const syncLanguageFromProfile = async (preferredLanguage) => {
  if (!preferredLanguage || !SUPPORTED_CODES.has(preferredLanguage)) {
    return { changed: false, needsReload: false };
  }
  if (preferredLanguage === getCurrentLanguage()) {
    // Already matches — still persist so this device now has an explicit
    // choice recorded (avoids re-checking the profile every launch).
    await Storage.set(LANGUAGE_STORAGE_KEY, preferredLanguage);
    return { changed: false, needsReload: false };
  }
  if (await hasExplicitLocalChoice()) {
    return { changed: false, needsReload: false }; // respect this device's own pick
  }
  const { needsReload } = await setAppLanguage(preferredLanguage);
  return { changed: true, needsReload };
};

export default i18n;

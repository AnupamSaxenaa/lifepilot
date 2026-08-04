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

import ar from './locales/ar.json';
import bn from './locales/bn.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import hi from './locales/hi.json';
import id from './locales/id.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import nl from './locales/nl.json';
import pl from './locales/pl.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import th from './locales/th.json';
import tr from './locales/tr.json';
import ur from './locales/ur.json';
import vi from './locales/vi.json';
import zhHans from './locales/zh-Hans.json';
import zhHant from './locales/zh-Hant.json';

const resources = {
  en: { translation: en },
  es: { translation: es },
  pt: { translation: pt },
  fr: { translation: fr },
  de: { translation: de },
  it: { translation: it },
  ru: { translation: ru },
  tr: { translation: tr },
  ar: { translation: ar },
  hi: { translation: hi },
  bn: { translation: bn },
  ur: { translation: ur },
  id: { translation: id },
  vi: { translation: vi },
  th: { translation: th },
  ja: { translation: ja },
  ko: { translation: ko },
  'zh-Hans': { translation: zhHans },
  'zh-Hant': { translation: zhHant },
  pl: { translation: pl },
  nl: { translation: nl },
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
      resources,
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

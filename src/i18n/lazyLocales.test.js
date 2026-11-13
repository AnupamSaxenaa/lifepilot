/**
 * Guards the lazy locale loading in src/i18n/index.js.
 *
 * src/i18n used to statically import all 21 locale files — 2.0 MB of JSON — so
 * every consumer parsed twenty languages nobody was reading. That cost landed on
 * app cold start AND on every home-screen widget tap, because the widget's
 * headless task evaluates App.js's module graph before it can handle the tap.
 *
 * Only English is eager now; the rest load on demand. The failure mode if that
 * goes wrong is severe and quiet — twenty languages silently falling back to
 * English, or rendering raw translation keys — and it would not show up in any
 * other test, so these assert the contract directly.
 */

const mockStore = new Map();

jest.mock('../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
    set: jest.fn(async (key, value) => { mockStore.set(key, value); }),
  },
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
}));

// jest.config.js deliberately skips the react-native preset (see the comment
// there), so `react-native` cannot be imported in tests. The i18n module only
// touches I18nManager, for RTL direction, which stubs cleanly.
jest.mock('react-native', () => ({
  I18nManager: {
    isRTL: false,
    allowRTL: jest.fn(),
    forceRTL: jest.fn(),
  },
}));

// A key that exists in every locale file, used to prove a real translated bundle
// was registered rather than an English fallback.
const PROBE_KEY = 'settings.sectionAiCredits';

const loadFresh = () => {
  let mod;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    mod = require('./index');
  });
  return mod;
};

describe('lazy locale loading', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('defaults to English when nothing is saved', async () => {
    const { initI18n, getCurrentLanguage } = loadFresh();
    await initI18n();
    expect(getCurrentLanguage()).toBe('en');
  });

  it('loads and applies a saved non-English language on init', async () => {
    mockStore.set('app_language', 'es');
    const { initI18n, getCurrentLanguage } = loadFresh();
    const i18n = await initI18n();

    expect(getCurrentLanguage()).toBe('es');
    // The Spanish bundle must be registered, not merely selected.
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true);

    const value = i18n.t(PROBE_KEY);
    expect(value).toBeTruthy();
    expect(value).not.toBe(PROBE_KEY); // a raw key means nothing was registered
  });

  it('does not eagerly register languages that are not in use', async () => {
    mockStore.set('app_language', 'es');
    const { initI18n } = loadFresh();
    const i18n = await initI18n();

    // The whole point of the change: unused bundles must be absent.
    expect(i18n.hasResourceBundle('ja', 'translation')).toBe(false);
    expect(i18n.hasResourceBundle('ru', 'translation')).toBe(false);
    expect(i18n.hasResourceBundle('zh-Hans', 'translation')).toBe(false);
  });

  it('always keeps English registered as the fallback', async () => {
    mockStore.set('app_language', 'ja');
    const { initI18n } = loadFresh();
    const i18n = await initI18n();
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('ja', 'translation')).toBe(true);
  });

  it('loads a bundle on demand when the user switches language', async () => {
    const { initI18n, setAppLanguage, getCurrentLanguage } = loadFresh();
    const i18n = await initI18n();

    expect(i18n.hasResourceBundle('de', 'translation')).toBe(false);

    await setAppLanguage('de');

    expect(getCurrentLanguage()).toBe('de');
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(true);
    const value = i18n.t(PROBE_KEY);
    expect(value).not.toBe(PROBE_KEY);
  });

  it('handles the hyphenated Chinese codes, which are easy to key wrong', async () => {
    const { initI18n, setAppLanguage } = loadFresh();
    const i18n = await initI18n();

    await setAppLanguage('zh-Hans');
    expect(i18n.hasResourceBundle('zh-Hans', 'translation')).toBe(true);
    expect(i18n.t(PROBE_KEY)).not.toBe(PROBE_KEY);
  });

  it('persists the chosen language so the next launch loads the same bundle', async () => {
    const { initI18n, setAppLanguage } = loadFresh();
    await initI18n();
    await setAppLanguage('fr');
    expect(mockStore.get('app_language')).toBe('fr');
  });

  it('ignores an unsupported language instead of throwing', async () => {
    const { initI18n, setAppLanguage, getCurrentLanguage } = loadFresh();
    await initI18n();
    const before = getCurrentLanguage();
    await expect(setAppLanguage('kl')).resolves.toEqual({ needsReload: false });
    expect(getCurrentLanguage()).toBe(before);
  });

  it('every supported language has a working loader', async () => {
    // Catches the most likely regression: adding a language to ./languages and
    // forgetting the matching LOCALE_LOADERS entry, which would leave that
    // language silently falling back to English in production.
    // eslint-disable-next-line global-require
    const { SUPPORTED_LANGUAGES } = require('./languages');
    const { initI18n, setAppLanguage } = loadFresh();
    const i18n = await initI18n();

    for (const { code } of SUPPORTED_LANGUAGES) {
      await setAppLanguage(code);
      expect(i18n.hasResourceBundle(code, 'translation')).toBe(true);
    }
  });
});

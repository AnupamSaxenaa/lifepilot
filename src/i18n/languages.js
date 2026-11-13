// ─── Supported Languages ─────────────────────────────────────
// This is the same tier of language coverage major apps (Google, Meta, etc.)
// ship as "full" localization — it covers the vast majority of the world's
// smartphone users. `rtl: true` languages need I18nManager RTL layout.
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano' },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский' },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা' },
  { code: 'ur', label: 'Urdu', nativeLabel: 'اردو', rtl: true },
  { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt' },
  { code: 'th', label: 'Thai', nativeLabel: 'ไทย' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)', nativeLabel: '简体中文' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)', nativeLabel: '繁體中文' },
  { code: 'pl', label: 'Polish', nativeLabel: 'Polski' },
  { code: 'nl', label: 'Dutch', nativeLabel: 'Nederlands' },
];

export const RTL_LANGUAGE_CODES = SUPPORTED_LANGUAGES.filter((l) => l.rtl).map((l) => l.code);
export const DEFAULT_LANGUAGE_CODE = 'en';

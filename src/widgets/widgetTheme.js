/**
 * Widget theme + config resolver.
 * ------------------------------------------------------------------
 * The home-screen widget mirrors the SAME look the user equipped in the
 * Marketplace. `ThemeContext` already resolves the equipped theme/accent/font
 * and caches it to AsyncStorage as `resolved_theme_<uid>` on every launch /
 * foreground / cosmetic change — so the widget just reads that cache. No
 * separate widget theme picker needed; it always tracks the app 1:1.
 *
 * Everything here is pure Storage reads (no network) so it's safe to call from
 * the headless widget task, which has a very tight execution budget.
 */
import { opacityToHex, resolveReadablePalette } from '../theme/contrast';
import { Storage } from '../utils/storage';

const DEFAULTS = {
  bg: '#000000',
  surface: '#131316',
  accent: '#FFFFFF',
  text: '#F2F2F2',
  muted: '#8E8E93',
  fontFamily: undefined,
};

// Android widgets can only render font families that ship with the OS. The
// marketplace fonts normalize to these built-in families, so they render;
// anything else (a bundled TTF the widget process can't see) is dropped so we
// never show tofu/fallback boxes.
const WIDGET_SAFE_FONTS = new Set([
  'sans-serif',
  'sans-serif-medium',
  'sans-serif-light',
  'sans-serif-thin',
  'sans-serif-condensed',
  'sans-serif-black',
  'monospace',
  'serif',
  'serif-monospace',
  'casual',
  'cursive',
]);
// The colour maths lives in src/theme/contrast.js so the app theme and the
// widgets share exactly one implementation. Re-exported below because widget
// modules (and the check-* harnesses) import these from this file.
export {
    blend, contrastRatio, luminance,
    opacityToHex, resolveReadablePalette,
    semanticColor, withAlpha
} from '../theme/contrast';


/**
 * Resolve the widget's visual theme + user config + its own data in two reads.
 *
 * @param {string[]} extraKeyTemplates user-scoped storage keys to fetch in the
 *   same batch as the theme. Use `{uid}` where the user id goes, e.g.
 *   `'tasks_{uid}'`. Results come back on `extra`, keyed by the template.
 * @returns {Promise<{
 *   userId: string|null,
 *   theme: {bg,surface,accent,text,muted,fontFamily},
 *   palette: object,        // contrast-safe colours derived from the background
 *   opacity: number,        // 0-100
 *   bgColor: string,        // theme bg with opacity applied (#RRGGBBAA)
 *   listId: string,         // 'today' | 'inbox' | 'starred' | 'planned' | <listId>
 *   hideCompleted: boolean,
 *   expandedTaskId: string|null,
 *   extra: Record<string, any>,
 * }>}
 */
export const resolveWidgetContext = async (extraKeyTemplates = []) => {
  // ⚡ PERF: the headless widget task has a very tight execution budget and
  // every AsyncStorage round-trip costs. This used to be three sequential
  // reads (`current_user_id`, then config, then the widget's own data batch).
  // `current_user_id` now rides along with the config read, and callers pass
  // their user-scoped keys as templates containing `{uid}` so their data is
  // fetched in the SAME batch as the theme — two round-trips total instead of
  // three, which is the difference you feel when tapping a widget control.
  const configBatch = await Storage.getBatch([
    'current_user_id',
    'widget_bg_opacity',
    'widget_list_id',
    'widget_hide_completed',
    'widget_bg_style',
    'widget_last_w',
    'widget_last_h',
    'widget_expanded_task',
  ]);

  const userId = configBatch['current_user_id'];

  const resolvedExtraKeys = userId
    ? extraKeyTemplates.map((tpl) => tpl.replace('{uid}', userId))
    : [];
  const secondBatch = await Storage.getBatch([
    ...(userId ? [`resolved_theme_${userId}`] : []),
    ...resolvedExtraKeys,
  ]);

  // Config keys stay reachable under their original names.
  const batch = { ...configBatch, ...secondBatch };
  const extra = {};
  resolvedExtraKeys.forEach((key, i) => { extra[extraKeyTemplates[i]] = secondBatch[key]; });

  let theme = { ...DEFAULTS };
  if (userId) {
    try {
      const raw = batch[`resolved_theme_${userId}`];
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        theme = {
          bg: parsed.bg || DEFAULTS.bg,
          surface: parsed.surface || DEFAULTS.surface,
          accent: parsed.accent || DEFAULTS.accent,
          text: parsed.text || DEFAULTS.text,
          muted: parsed.muted || DEFAULTS.muted,
          fontFamily: WIDGET_SAFE_FONTS.has(parsed.fontFamily) ? parsed.fontFamily : undefined,
        };
      }
    } catch (_e) {}
  }

  const opacityRaw = batch['widget_bg_opacity'];
  const opacity = opacityRaw != null ? parseInt(opacityRaw, 10) : 90;

  const listId = batch['widget_list_id'] || 'today';
  const hideCompleted = batch['widget_hide_completed'] === 'true';
  // Which single task has its steps open. One-at-a-time (see the handler) means
  // toggling is a pure write with no read-modify-write of an array.
  const expandedTaskId = batch['widget_expanded_task'] || null;
  const bgStyle = batch['widget_bg_style'] || 'solid'; // solid|translucent|frost|grain

  // Effective opacity per style: translucent/frost/grain read lighter so the
  // home-screen wallpaper shows through as intended.
  const styleOpacity = {
    solid: opacity,
    translucent: Math.min(opacity, 45),
    frost: Math.min(opacity, 65),
    grain: Math.min(opacity, 70),
  }[bgStyle] ?? opacity;

  const baseHex = (theme.bg || '#000000').slice(0, 7);
  const bgColor = `${baseHex}${opacityToHex(styleOpacity)}`;

  // Last size the native handler saw (persisted on every render), so an
  // app-triggered update — which has no widgetInfo — still picks the right
  // responsive layout instead of defaulting.
  let lastW = 0;
  let lastH = 0;
  try {
    const wRaw = batch['widget_last_w'];
    const hRaw = batch['widget_last_h'];
    lastW = wRaw ? parseInt(wRaw, 10) : 0;
    lastH = hRaw ? parseInt(hRaw, 10) : 0;
  } catch (_e) {}

  // Legible foreground derived from the equipped background, so light themes
  // don't render invisible text.
  const palette = resolveReadablePalette(theme);

  return { userId, theme, palette, opacity, bgColor, baseHex, listId, hideCompleted, bgStyle, styleOpacity, lastW, lastH, expandedTaskId, extra };
};

/**
 * Build a subtle grain/noise SVG overlay for the "grain" background style.
 * androidsvg (what the widget renderer uses) supports basic shapes + patterns,
 * so we tile tiny faint dots to fake a film-grain texture. Kept very low
 * opacity so it reads as texture, not clutter.
 */
export const buildGrainSvg = (dotColor) => {
  const c = (dotColor || '#FFFFFF').slice(0, 7);
  return `<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="g" width="4" height="4" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.6" fill="${c}" fill-opacity="0.06"/>
      <circle cx="3" cy="3" r="0.5" fill="${c}" fill-opacity="0.045"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>`;
};

/**
 * Human label for the currently selected widget list.
 */
export const getListLabel = (listId, listMap) => {
  switch (listId) {
    case 'today': return 'TODAY';
    case 'inbox': return 'INBOX';
    case 'starred': return 'STARRED';
    case 'planned': return 'PLANNED';
    default: return (listMap[listId] || 'LIST').toUpperCase();
  }
};

/**
 * Filter + sort tasks for the selected widget list.
 * Mirrors the app's own list semantics as closely as the cached data allows.
 */
export const selectTasksForList = (allTasks, listId) => {
  const todayStr = new Date().toDateString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const isForToday = (t) => {
    if (t.added_to_today) return true;
    if (t.due_date) {
      const d = new Date(t.due_date);
      if (d < todayStart || d.toDateString() === todayStr) return true;
    }
    if (t.reminder_time) {
      const d = new Date(t.reminder_time);
      if (d < todayStart || d.toDateString() === todayStr) return true;
    }
    if (!t.list_id && !t.due_date && !t.reminder_time) return true;
    return false;
  };

  let predicate;
  switch (listId) {
    case 'today':
      predicate = isForToday;
      break;
    case 'inbox':
      predicate = (t) => !t.list_id;
      break;
    case 'starred':
      predicate = (t) => t.is_important;
      break;
    case 'planned':
      predicate = (t) => !!t.due_date || !!t.reminder_time;
      break;
    default:
      predicate = (t) => t.list_id === listId;
  }

  return allTasks.filter(predicate);
};

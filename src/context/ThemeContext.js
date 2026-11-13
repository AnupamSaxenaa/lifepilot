// ─── Theme Context ───────────────────────────────────────────
// Applies the user's EQUIPPED cosmetics (accent color, palette, font) app-wide.
// Ownership is validated against the server-authoritative user_cosmetics list
// before anything is applied — equipping something you don't own is a no-op,
// so a tampered equipped_* value can never unlock a cosmetic for free.
//
// HOW IT APPLIES APP-WIDE (without editing every screen):
//   • FONT   — the `jsx`/`jsxs` exports of react/jsx-runtime are patched once
//              so every <Text>/<TextInput> in the app picks up the equipped
//              font family automatically (see patchGlobalFont below for why
//              this is the only interception point that actually works on
//              RN 0.85's Text/TextInput implementation).
//   • PALETTE— the shared COLORS object (src/theme/theme.js) that most screens
//              and glass components read from is mutated in place, so equipping
//              a theme repaints backgrounds/surfaces everywhere on next render.
//   • ACCENT — exposed via useTheme().theme.accent AND mirrored onto
//              COLORS.*.accent for components that read the shared palette.
// ─────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TextInput } from 'react-native';
import { getCatalog, getOwnedCosmetics } from '../lib/marketplace';
import { resolveReadablePalette } from '../theme/contrast';
import { COLORS } from '../theme/theme';
import { Storage } from '../utils/storage';

// Some catalog font families aren't real platform families (e.g. the design
// name "System-Rounded"). Normalize them to something the OS actually renders,
// so every purchased font produces a visible change.
const normalizeFontFamily = (family) => {
  if (!family) return undefined;
  const map = {
    'System-Rounded': Platform.select({ ios: 'System', android: 'sans-serif-medium' }),
    'System': Platform.select({ ios: 'System', android: 'sans-serif' }),
  };
  return map[family] || family;
};

// Default LifePilot look — monochrome black / white / grey (X + ChatGPT feel).
export const DEFAULT_THEME = {
  bg: '#000000',
  surface: '#131316',
  accent: '#FFFFFF',
  text: '#F2F2F2',
  muted: '#8E8E93',
  fontFamily: undefined, // system default
};

// Snapshot the original shared palette ONCE so we can always restore defaults.
const ORIGINAL_COLORS = JSON.parse(JSON.stringify(COLORS));

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  refreshTheme: async () => {},
});

const EQUIP_CACHE = (uid) => `equipped_cosmetics_${uid}`;
const RESOLVED_CACHE = (uid) => `resolved_theme_${uid}`;
// Set once the very first theme application for an account finishes. Returning
// users skip the "applying your theme" screen entirely — their look is already
// painted from cache, so showing a loader again would be pure friction.
const THEME_APPLIED = (uid) => `theme_applied_${uid}`;

// ── Global font patch (RN 0.85-safe) ─────────────────────────
// RN 0.85's <Text>/<TextInput> are plain function components (component(...)
// syntax) with NO `.render` static, NO `defaultProps`, and are exported from
// `react-native` as GETTER-ONLY properties (see react-native/index.js —
// `get Text() { return require(...).default }`), so neither of the old
// approaches (patch Comp.render / reassign RN.Text) can work on this RN
// version — both are silent no-ops, which is why fonts never applied.
//
// The one universal interception point left is the JSX runtime itself: with
// the automatic JSX transform (which Expo/Babel uses by default), every
// `<Text>` or `<TextInput>` in the whole app compiles down to a call to
// `jsx(Text, props, key)` from `react/jsx-runtime`. That module's `jsx`/`jsxs`
// exports ARE plain writable properties, so we wrap them once here: whenever
// the element type is Text or TextInput, inject the equipped font family into
// its props before the real jsx() runs.
let currentFontFamily = undefined;

// ── Global "thin/light" typography remap ─────────────────────
// The monochrome makeover wants X/ChatGPT-style light typography without
// hand-editing hundreds of StyleSheet fontWeight declarations. Every <Text>/
// <TextInput> flows through the JSX runtime, so we downshift heavy weights to
// lighter ones here in one place. Explicit weights still lose to nothing —
// we OVERRIDE them (appended last) on purpose so the whole app goes light.
const LIGHTEN_WEIGHT = {
  '900': '500',
  '800': '500',
  '700': '500',
  bold: '500',
  '600': '400',
  '500': '400',
  '400': '300',
  normal: '300',
};

const patchGlobalFont = () => {
  let jsxRuntime;
  try {
    jsxRuntime = require('react/jsx-runtime');
  } catch (_e) {
    return; // Classic JSX transform or unavailable — nothing we can hook.
  }
  if (jsxRuntime.__lpFontPatched) return;

  // Reference-stable weight objects, so the injected style never allocates a
  // fresh object per element.
  const WEIGHT_STYLES = Object.freeze(
    Object.fromEntries(
      Object.entries(LIGHTEN_WEIGHT).map(([from, to]) => [from, Object.freeze({ fontWeight: to })]),
    ),
  );
  // Memoized results keyed on the caller's original style reference. Almost all
  // styles come from StyleSheet.create and are stable ids or stable arrays, so
  // this hits constantly. WeakMap for objects/arrays, Map for numeric ids.
  const arrayCache = new WeakMap();
  const idCache = new Map();
  const flatCache = new WeakMap();

  const flattenOnce = (style) => {
    if (style == null) return null;
    if (typeof style === 'number') {
      let flat = idCache.get(style);
      if (flat === undefined) {
        try { flat = StyleSheet.flatten(style); } catch (_e) { flat = null; }
        idCache.set(style, flat);
      }
      return flat;
    }
    if (typeof style !== 'object') return null;
    let flat = flatCache.get(style);
    if (flat === undefined) {
      try { flat = StyleSheet.flatten(style); } catch (_e) { flat = null; }
      flatCache.set(style, flat);
    }
    return flat;
  };

  const injectFont = (type, props) => {
    if ((type !== Text && type !== TextInput) || !props) return props;
    const existing = props.style;

    // Fast path: reuse the exact array produced for this style reference last
    // time. This is what keeps the `style` prop IDENTITY stable across renders —
    // previously a new array was built for every <Text> on every render, so
    // React always saw a changed prop, always sent a native style update, and
    // no memoized text-bearing component could ever bail out.
    const cache = existing == null
      ? null
      : (typeof existing === 'number' ? idCache : (typeof existing === 'object' ? arrayCache : null));
    if (cache) {
      const cachedStyle = cache === idCache
        ? idCache.get(`s:${existing}`)
        : arrayCache.get(existing);
      if (cachedStyle !== undefined) {
        return cachedStyle === null ? props : { ...props, style: cachedStyle };
      }
    }

    const flat = flattenOnce(existing);
    const hasExplicitFont = !!(flat && flat.fontFamily);
    const base = (currentFontFamily && !hasExplicitFont)
      ? { fontFamily: currentFontFamily }
      : null;
    const currentWeight = flat && flat.fontWeight != null ? String(flat.fontWeight) : 'normal';
    const mapped = WEIGHT_STYLES[currentWeight] || null;
    // Already at the target weight: nothing to override, so skip the work.
    const weightOverride = (mapped && mapped.fontWeight !== currentWeight) ? mapped : null;

    if (!base && !weightOverride) {
      if (cache === arrayCache) arrayCache.set(existing, null);
      else if (cache === idCache) idCache.set(`s:${existing}`, null);
      return props;
    }

    const nextStyle = [base, existing, weightOverride].filter(Boolean);
    if (cache === arrayCache) arrayCache.set(existing, nextStyle);
    else if (cache === idCache) idCache.set(`s:${existing}`, nextStyle);
    return { ...props, style: nextStyle };
  };

  for (const key of ['jsx', 'jsxs', 'jsxDEV']) {
    const orig = jsxRuntime[key];
    if (typeof orig !== 'function') continue;
    jsxRuntime[key] = function patchedJsx(type, props, ...rest) {
      return orig.call(this, type, injectFont(type, props), ...rest);
    };
  }
  jsxRuntime.__lpFontPatched = true;
};
patchGlobalFont();

// Mutate the shared COLORS palette in place (both schemes) so screens that read
// from it repaint. Passing null restores the original palette.
//
// The foreground is DERIVED from the equipped background, never inherited. A
// marketplace theme only supplies bg/surface/accent, so the old code left
// `text`/`textMuted`/glass colours at their dark-mode values — which on a light
// theme meant near-white text on a near-white background, i.e. invisible labels
// and buttons. `resolveReadablePalette` picks a foreground that actually passes
// contrast against whatever background is equipped.
const applyPalette = (palette) => {
  const src = palette || null;
  for (const scheme of ['dark', 'light']) {
    const target = COLORS[scheme];
    const original = ORIGINAL_COLORS[scheme];
    if (!target || !original) continue;
    if (!src) {
      // Restore defaults.
      Object.assign(target, JSON.parse(JSON.stringify(original)));
      continue;
    }
    // Only the dark scheme gets fully reskinned (the app is dark-first); light
    // stays readable but picks up the accent.
    if (scheme === 'dark') {
      const readable = resolveReadablePalette({ bg: src.bg, accent: src.accent });
      target.background = src.bg || original.background;
      target.surface = src.surface || original.surface;
      target.border = src.border || readable.hairline;
      target.text = readable.text;
      target.textMuted = readable.muted;
      // Glass surfaces are washed in whichever direction keeps the text on them
      // readable (see resolveReadablePalette) instead of always washing white.
      target.glassBackground = readable.panel;
      target.glassBorder = readable.panelBorder;
      // `primary` backs filled buttons; its label uses `onAccent`.
      target.primary = readable.accent;
      target.danger = readable.danger;
      target.success = readable.success;
      // Labels/glyphs drawn ON those fills. Without these, anything reading the
      // shared palette has no choice but to hardcode '#FFF' — which is
      // invisible on the default white accent.
      target.onAccent = readable.onAccent;
      target.onSuccess = readable.onSuccess;
      target.onDanger = readable.onDanger;
    }
    if (src.accent) {
      const readable = resolveReadablePalette({ bg: src.bg, accent: src.accent });
      // An accent that can't be seen against the background is not an accent.
      target.accent = scheme === 'dark' ? readable.accent : src.accent;
      target.onAccent = readable.onAccent;
    }
  }
};

// Instantly apply a resolved theme object (no validation) — used to paint from
// cache before the network responds, so the look never "flashes" back to default.
const applyResolved = (t) => {
  currentFontFamily = t.fontFamily;
  applyPalette({ bg: t.bg, surface: t.surface, accent: t.accent });
};

/**
 * Fill in the readable foreground for a theme that only declares bg/surface/
 * accent, so `useTheme().theme.text` is legible on the equipped background.
 * Anything the theme states explicitly is respected.
 */
const withReadableForeground = (t) => {
  const readable = resolveReadablePalette({ bg: t.bg, accent: t.accent });
  return {
    ...t,
    text: t.text && t.text !== DEFAULT_THEME.text ? t.text : readable.text,
    muted: t.muted && t.muted !== DEFAULT_THEME.muted ? t.muted : readable.muted,
    accent: readable.accent,
    // The colour any label/icon drawn ON the accent must use. The default accent
    // is #FFFFFF, so a hardcoded white label is invisible — always pair
    // `theme.accent` as a background with `theme.onAccent` as its foreground.
    onAccent: readable.onAccent,
    hairline: readable.hairline,
    fill: readable.fill,
    danger: readable.danger,
    success: readable.success,
    onSuccess: readable.onSuccess,
    onDanger: readable.onDanger,
    isLightBg: readable.isLightBg,
  };
};

const { ActivityIndicator, View } = require('react-native');

/**
 * The "applying your theme" screen.
 *
 * It is an OVERLAY, not a replacement for the app. Rendering it instead of
 * `children` used to unmount the whole navigator; when hydration finished and
 * children remounted, React Navigation fell back to `initialRouteName`, which
 * on a first login is still the signed-out route — so a successful login landed
 * on the intro cards instead of the Dashboard. Keeping children mounted behind
 * the overlay preserves navigation state.
 */
const ThemeHydrationScreen = () => (
  <View style={hydrationStyles.container} pointerEvents="auto">
    <ActivityIndicator color="#FFFFFF" size="small" />
    <Text accessibilityRole="text" style={hydrationStyles.label}>
      Applying your chosen theme…
    </Text>
  </View>
);

export const ThemeProvider = ({ userId, children, showHydrationScreen = true }) => {
  const [theme, setThemeState] = useState(DEFAULT_THEME);
  const [hydratedUserId, setHydratedUserId] = useState(null);
  // Only the account's first-ever theme application gets a loading screen.
  const [firstApplyUserId, setFirstApplyUserId] = useState(null);
  const isHydrating = Boolean(
    userId
    && showHydrationScreen
    && firstApplyUserId === userId
    && hydratedUserId !== userId,
  );
  // Bumped whenever the theme changes so opted-in consumers can re-render.
  const [themeVersion, setThemeVersion] = useState(0);

  // Every path into state goes through the foreground derivation, so no caller
  // can accidentally publish a theme whose text is invisible on its background.
  const setTheme = useCallback((t) => {
    setThemeState(withReadableForeground(t));
    setThemeVersion((v) => v + 1);
  }, []);

  const refreshTheme = useCallback(async ({ onLocalReady } = {}) => {
    let localReadySent = false;
    const signalLocalReady = () => {
      if (localReadySent) return;
      localReadySent = true;
      onLocalReady?.();
    };

    if (!userId) {
      applyResolved(DEFAULT_THEME);
      setTheme(DEFAULT_THEME);
      signalLocalReady();
      return;
    }

    // 0. INSTANT PAINT: apply the last resolved theme from cache before any
    // network validation. The loading screen only covers this local read.
    try {
      const cachedResolved = await Storage.get(RESOLVED_CACHE(userId));
      if (cachedResolved) {
        const cachedTheme = typeof cachedResolved === 'string'
          ? JSON.parse(cachedResolved)
          : cachedResolved;
        applyResolved(cachedTheme);
        setTheme(cachedTheme);
      }
    } catch (_e) {
      // A damaged cache must never prevent the app from rendering.
    } finally {
      signalLocalReady();
    }

    try {
      // 1. Equipped selections — cached first, then server (source of truth).
      let equipped = {};
      const cached = await Storage.get(EQUIP_CACHE(userId));
      if (cached) {
        try { equipped = typeof cached === 'string' ? JSON.parse(cached) : cached; } catch (_e) {}
      }

      let profileLoaded = false;
      try {
        const { supabase } = require('../lib/supabase');
        const { data, error } = await supabase
          .from('profiles')
          .select('equipped_theme, equipped_accent, equipped_font')
          .eq('id', userId)
          .single();
        if (!error && data) {
          profileLoaded = true;
          equipped = {
            theme: data.equipped_theme,
            accent: data.equipped_accent,
            font: data.equipped_font,
          };
          await Storage.set(EQUIP_CACHE(userId), JSON.stringify(equipped));
        }
      } catch (_e) {}

      // 2. Validate ownership — never apply a cosmetic the user doesn't own.
      const [owned, catalog] = await Promise.all([
        getOwnedCosmetics(userId),
        getCatalog(),
      ]);

      // If the profile couldn't be read (auth token not ready right after a
      // fresh login, or offline), keep the locally resolved appearance.
      if (!profileLoaded) return;

      const ownedSet = new Set(owned);
      const byId = Object.fromEntries((catalog || []).map((c) => [c.id, c]));
      const enforce = ownedSet.size > 0;
      const owns = (id) => !enforce || ownedSet.has(id);

      let next = { ...DEFAULT_THEME };

      if (equipped.theme && owns(equipped.theme) && byId[equipped.theme]) {
        const m = byId[equipped.theme].metadata || {};
        next = { ...next, bg: m.bg || next.bg, surface: m.surface || next.surface, accent: m.accent || next.accent };
      }
      if (equipped.accent && owns(equipped.accent) && byId[equipped.accent]) {
        const m = byId[equipped.accent].metadata || {};
        if (m.color) next.accent = m.color;
      }
      if (equipped.font && owns(equipped.font) && byId[equipped.font]) {
        const m = byId[equipped.font].metadata || {};
        next.fontFamily = normalizeFontFamily(m.family);
      }

      applyResolved(next);
      setTheme(next);
      await Storage.set(RESOLVED_CACHE(userId), JSON.stringify(next));
    } catch (_e) {
      // Leave whatever is currently applied (cache or default) intact.
    } finally {
      signalLocalReady();
    }
  }, [userId, setTheme]);

  // Hydrate again whenever the authenticated identity changes. The loading
  // screen only appears on an account's first application; after that the
  // cached look paints instantly and children render straight away.
  useEffect(() => {
    let active = true;
    let finishTimer;
    let finished = false;
    const startedAt = Date.now();

    const run = async () => {
      let showLoader = false;
      if (userId && showHydrationScreen) {
        try {
          const alreadyApplied = await Storage.get(THEME_APPLIED(userId));
          showLoader = !alreadyApplied;
        } catch (_e) {
          // If the flag can't be read, don't block the app behind a loader.
          showLoader = false;
        }
        if (active && showLoader) setFirstApplyUserId(userId);
      }

      const finishHydration = () => {
        if (finished) return;
        finished = true;
        const remaining = showLoader ? Math.max(0, 450 - (Date.now() - startedAt)) : 0;
        finishTimer = setTimeout(() => {
          if (!active) return;
          setHydratedUserId(userId || null);
          if (userId) {
            Storage.set(THEME_APPLIED(userId), 'true').catch(() => {});
          }
        }, remaining);
      };

      try {
        await refreshTheme({ onLocalReady: finishHydration });
      } finally {
        finishHydration();
      }
    };

    run().catch(() => {});
    return () => {
      active = false;
      if (finishTimer) clearTimeout(finishTimer);
    };
  }, [refreshTheme, showHydrationScreen, userId]);

  // Re-run when the Supabase session becomes ready and when the app returns to
  // the foreground. These background refreshes never cover cached UI.
  useEffect(() => {
    if (!userId) return undefined;
    let authSub;
    try {
      const { supabase } = require('../lib/supabase');
      const res = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          refreshTheme();
        }
      });
      authSub = res?.data?.subscription;
    } catch (_e) {}

    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshTheme();
    });

    return () => {
      try { authSub?.unsubscribe?.(); } catch (_e) {}
      try { appSub?.remove?.(); } catch (_e) {}
    };
  }, [userId, refreshTheme]);

  return (
    <ThemeContext.Provider value={{ theme, refreshTheme, themeVersion, isHydrating }}>
      {children}
      {isHydrating && showHydrationScreen ? <ThemeHydrationScreen /> : null}
    </ThemeContext.Provider>
  );
};

const hydrationStyles = StyleSheet.create({
  container: {
    // Absolute, not flex:1 — this sits ON TOP of the app so the navigator
    // underneath stays mounted and keeps its route.
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#000000',
  },
  label: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: 0.2,
  },
});

export const useTheme = () => useContext(ThemeContext);

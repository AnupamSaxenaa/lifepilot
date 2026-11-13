/**
 * Colour contrast utilities — shared by the in-app theme and the home-screen
 * widgets.
 *
 * These live outside both so there is ONE implementation of the readable-palette
 * derivation. The app and the widgets had the same bug for the same reason: a
 * marketplace theme only supplies bg/surface/accent, so a light background kept
 * dark-mode text and rendered near-white on near-white. Deriving the foreground
 * from the background fixes both, and only has to be right once.
 */

const DEFAULTS = { bg: '#000000', accent: '#FFFFFF' };


/** Clamp + convert a 0–100 opacity to a 2-char uppercase hex alpha. */
export const opacityToHex = (opacityVal) => {
  const clamped = Math.max(0, Math.min(100, isNaN(opacityVal) ? 100 : opacityVal));
  return Math.round((clamped / 100) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
};

/** Parse #RGB/#RRGGBB into {r,g,b} 0–255. Returns null when unparseable. */
const hexToRgb = (hex) => {
  if (typeof hex !== 'string') return null;
  let value = hex.trim().replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  if (value.length < 6) return null;
  const int = parseInt(value.slice(0, 6), 16);
  if (Number.isNaN(int)) return null;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
};

/** WCAG relative luminance (0 = black, 1 = white). */
export const luminance = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
};

/** WCAG contrast ratio between two colours (1 = identical, 21 = max). */
export const contrastRatio = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * Composite `fg` over `bg` at `alpha` and return a SOLID hex.
 * Used for secondary text so its contrast is measurable and predictable —
 * an alpha suffix would hide the real rendered colour from any check.
 */
export const blend = (fg, bg, alpha) => {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!f || !b) return fg;
  const a = Math.max(0, Math.min(1, alpha));
  const mix = (x, y) => Math.round(x * a + y * (1 - a));
  return `#${[mix(f.r, b.r), mix(f.g, b.g), mix(f.b, b.b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
};

/**
 * The foreground to draw ON a given fill — dark ink or light ink, whichever
 * separates better from it.
 *
 * Use this for ANY filled surface whose colour isn't known at authoring time:
 * the theme accent (white by default, so a hardcoded '#FFF' label is
 * invisible), a user-picked alarm label colour, or a semantic success/danger
 * fill. Prefer `theme.onAccent` when the fill is the theme accent — that's this
 * function already applied.
 */
export const readableOn = (fill, dark = '#0B0B0D', light = '#FFFFFF') => (
  contrastRatio(dark, fill) >= contrastRatio(light, fill) ? dark : light
);

/**
 * Build a palette guaranteed to be legible on the equipped background.
 *
 * Why this exists: `ThemeContext` only overrides bg/surface/accent/font when a
 * marketplace theme is equipped — `text` and `muted` keep their dark-mode
 * defaults. On a light theme that produced near-white text on a light widget,
 * i.e. invisible. Here the foreground is derived from the background instead of
 * trusted, and the accent falls back to plain text when it can't be read.
 */
export const resolveReadablePalette = (theme) => {
  const bg = (theme?.bg || DEFAULTS.bg).slice(0, 7);

  // Pick whichever foreground genuinely wins against this background rather
  // than trusting a light/dark threshold. A mid-tone theme (e.g. #7A7A7A) sits
  // near both ends, and guessing there is what makes text vanish.
  const SOFT_DARK = '#101013';
  const SOFT_LIGHT = '#F5F5F7';
  const preferDark = contrastRatio(SOFT_DARK, bg) >= contrastRatio(SOFT_LIGHT, bg);
  const isLightBg = preferDark;

  let text = preferDark ? SOFT_DARK : SOFT_LIGHT;
  // Mid-tone backgrounds cap what any colour can achieve, so escalate from the
  // softened ink to pure black/white to claw back the last bit of contrast.
  if (contrastRatio(text, bg) < 4.5) {
    const pure = preferDark ? '#000000' : '#FFFFFF';
    if (contrastRatio(pure, bg) > contrastRatio(text, bg)) text = pure;
  }

  // Secondary text keeps a visible hierarchy, but only if it stays readable.
  // The fallback is composited to a solid colour (not alpha) so its contrast is
  // exactly what renders, with nothing hidden behind transparency.
  const preferredMuted = preferDark ? '#4A4A52' : '#C2C2CB';
  const muted = contrastRatio(preferredMuted, bg) >= 3
    ? preferredMuted
    : blend(text, bg, 0.8);

  // Hairlines/fills read as a wash of the foreground, so they work either way.
  const hairline = withAlpha(text, isLightBg ? 0.14 : 0.12);
  const fill = withAlpha(text, isLightBg ? 0.07 : 0.09);

  // An accent is only usable if it separates from the background; otherwise
  // (white accent on a white theme) fall back to the derived foreground.
  const rawAccent = (theme?.accent || DEFAULTS.accent).slice(0, 7);
  const accent = contrastRatio(rawAccent, bg) >= 2.2 ? rawAccent : text;
  // Text drawn ON the accent (e.g. inside a filled check) must invert again.
  const onAccent = readableOn(accent);

  // State colours (missed / done) resolved against this exact background, so
  // "red" and "green" stay legible on light, dark and mid-tone themes alike.
  const danger = semanticColor('danger', bg);
  const success = semanticColor('success', bg);
  // Text/glyphs drawn ON those fills (e.g. the tick inside a filled circle)
  // must invert independently — the ramp can land on a pale or a deep shade.
  const onSuccess = readableOn(success);
  const onDanger = readableOn(danger);

  // A raised "glass" panel has to satisfy two things at once: be visible against
  // the background, AND still carry readable text.
  //
  // Washing it with the foreground (the obvious choice) works on a near-black or
  // near-white theme, but backfires on a mid-tone: there the text is already at
  // its contrast ceiling, so pulling the panel toward the text colour drops the
  // text below AA. When that happens we wash AWAY from the text instead, which
  // both keeps the panel visible and widens the gap.
  const panelAlpha = isLightBg ? 0.06 : 0.08;
  const borderAlpha = isLightBg ? 0.16 : 0.1;
  const antiText = preferDark ? '#FFFFFF' : '#000000';
  const towardText = blend(text, bg, panelAlpha);
  const panelTint = contrastRatio(text, towardText) >= 4.5 ? text : antiText;

  const panel = withAlpha(panelTint, panelAlpha);
  const panelBorder = withAlpha(panelTint, borderAlpha);
  // The panel as it actually renders, for callers that need a real colour
  // (measuring contrast against an alpha value is meaningless).
  const panelSolid = blend(panelTint, bg, panelAlpha);

  return {
    bg,
    text,
    muted,
    hairline,
    fill,
    accent,
    onAccent,
    isLightBg,
    danger,
    success,
    onSuccess,
    onDanger,
    panel,
    panelBorder,
    panelSolid,
  };
};

/**
 * Shade ramps for semantic state colours, ordered LIGHTEST → DARKEST.
 *
 * A single fixed red/green cannot work across marketplace themes: #FB7185 on a
 * white widget is ~2.3:1, which is unreadable. `semanticColor` walks the ramp
 * and returns the first shade that actually passes against the live background.
 * One ordering serves both ends — on a dark background the lightest shade
 * passes immediately (staying vivid), and on a light background the light
 * shades fail so it walks down to a darker one.
 */
const SEMANTIC_RAMPS = {
  danger: ['#FCA5A5', '#FB7185', '#F43F5E', '#E11D48', '#BE123C', '#9F1239', '#881337'],
  success: ['#A7F3D0', '#6EE7B7', '#34D399', '#10B981', '#059669', '#047857', '#065F46'],
};

/**
 * Pick a readable shade of a semantic colour for the given background.
 *
 * @param {'danger'|'success'} kind
 * @param {string} bg          background hex the colour will be drawn on
 * @param {number} min         preferred WCAG ratio, met by the ramp where possible
 * @param {number} fallbackMin floor to guarantee when no shade can reach `min`
 *
 * On a mid-tone background no red reaches AA at all (the best is ~2.3:1 against
 * #7A7A7A), so forcing 4.5 there drives both red and green to near-black and the
 * two states stop being distinguishable — which is the one thing the colour is
 * for. Instead we guarantee the 3:1 non-text/large-text threshold and keep the
 * hue. That is safe here because the state is redundantly encoded and never
 * relies on colour alone: elapsed rows are struck through, a done task is a
 * filled circle with a tick while a missed one is hollow, and the header spells
 * out the missed count.
 */
export const semanticColor = (kind, bg, min = 4.5, fallbackMin = 3) => {
  const ramp = SEMANTIC_RAMPS[kind] || SEMANTIC_RAMPS.danger;
  const background = (bg || DEFAULTS.bg).slice(0, 7);

  let best = ramp[0];
  let bestRatio = -1;
  for (const shade of ramp) {
    const ratio = contrastRatio(shade, background);
    if (ratio >= min) return shade;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = shade;
    }
  }

  // No shade reached `min`. Lift the closest one toward black or white just far
  // enough to clear `fallbackMin`, taking whichever direction needs the least
  // mixing so the hue survives as strongly as possible.
  let winner = null;
  let winnerMix = Infinity;
  for (const target of ['#FFFFFF', '#000000']) {
    for (let mix = 0.05; mix <= 1.0001; mix += 0.05) {
      const candidate = blend(target, best, mix);
      if (contrastRatio(candidate, background) >= fallbackMin) {
        if (mix < winnerMix) {
          winner = candidate;
          winnerMix = mix;
        }
        break;
      }
    }
  }
  return winner || best;
};

/** Lighten/darken helper isn't needed — we compose with alpha suffixes. */
export const withAlpha = (hex, alpha01) => {
  const a = Math.round(Math.max(0, Math.min(1, alpha01)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  // Only handle #RRGGBB; if already has alpha, replace it.
  const base = hex.length >= 7 ? hex.slice(0, 7) : hex;
  return `${base}${a}`;
};

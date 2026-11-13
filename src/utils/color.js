// ─── Color helpers ───────────────────────────────────────────
// Small, dependency-free helpers used to derive accent tints/shades so the
// whole app can follow the user's equipped accent instead of hardcoded purple.
// ─────────────────────────────────────────────────────────────

// Parse a #RGB / #RRGGBB / #RRGGBBAA hex string into {r,g,b,a}.
const parseHex = (hex) => {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  if (h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = parseInt(h.slice(6, 8), 16) / 255;
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b, a };
};

/**
 * Return `hex` as an `rgba(r,g,b,alpha)` string. Falls back to the accent
 * purple if the input can't be parsed, so styling never breaks.
 */
export const withAlpha = (hex, alpha = 1) => {
  const c = parseHex(hex) || { r: 168, g: 85, b: 247 };
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
};

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const toHex2 = (n) => clamp(n).toString(16).padStart(2, '0');

/**
 * Lighten (amount > 0) or darken (amount < 0) a hex color by mixing toward
 * white/black. `amount` is 0..1. Returns a #RRGGBB string.
 */
export const shade = (hex, amount = 0) => {
  const c = parseHex(hex) || { r: 168, g: 85, b: 247 };
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const r = c.r + (target - c.r) * t;
  const g = c.g + (target - c.g) * t;
  const b = c.b + (target - c.b) * t;
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
};

export const lighten = (hex, amount = 0.3) => shade(hex, Math.abs(amount));
export const darken = (hex, amount = 0.3) => shade(hex, -Math.abs(amount));

/**
 * Blend two hex colors. `t` is 0..1 (0 = colorA, 1 = colorB).
 * Returns a #RRGGBB string. Falls back gracefully on bad input.
 */
export const mix = (hexA, hexB, t = 0.5) => {
  const a = parseHex(hexA) || { r: 0, g: 0, b: 0 };
  const b = parseHex(hexB) || { r: 168, g: 85, b: 247 };
  const k = Math.max(0, Math.min(1, t));
  return `#${toHex2(a.r + (b.r - a.r) * k)}${toHex2(a.g + (b.g - a.g) * k)}${toHex2(a.b + (b.b - a.b) * k)}`;
};

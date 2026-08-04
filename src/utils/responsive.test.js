/**
 * Guards the sizing rules for centred modal cards with a scrollable body.
 *
 * The regression this exists to prevent: swapping the card's fixed `height` for
 * a `maxHeight` left it auto-height, so the `flex: 1` ScrollView inside had no
 * resolved parent height and collapsed to zero — Aura's draft schedule rendered
 * with a header and footer and no plan rows.
 */
// The nativewind babel plugin injects an import into every file; stub it so this
// pure module can be tested without pulling in React Native's ESM entry point.
jest.mock('nativewind', () => ({ NativeWindStyleSheet: { create: jest.fn() } }));

const {
  getCardLayout,
  getScaledType,
  isNarrow,
  isShort,
  MAX_CARD_WIDTH,
  MAX_CARD_HEIGHT,
} = require('./responsive');

// A spread of real Android viewports in dp, smallest first.
const SCREENS = [
  ['tiny (Android Go)', 320, 480],
  ['small', 360, 640],
  ['common mid', 393, 786],
  ['tall flagship', 412, 915],
  ['very tall', 412, 1000],
  ['landscape phone', 915, 412],
  ['tablet portrait', 800, 1280],
  ['tablet landscape', 1280, 800],
  ['foldable unfolded', 673, 841],
  ['split screen', 360, 380],
];

describe('getCardLayout', () => {
  it.each(SCREENS)('%s (%ix%i): height is a resolved number', (_label, w, h) => {
    const layout = getCardLayout(w, h);
    // This is the whole point — an undefined/NaN height collapses the body.
    expect(typeof layout.height).toBe('number');
    expect(Number.isFinite(layout.height)).toBe(true);
    expect(layout.height).toBeGreaterThan(0);
  });

  it.each(SCREENS)('%s (%ix%i): card fits inside the viewport', (_label, w, h) => {
    const layout = getCardLayout(w, h);
    expect(layout.height).toBeLessThanOrEqual(h);
    expect(layout.width).toBeLessThanOrEqual(w);
  });

  it.each(SCREENS)('%s (%ix%i): leaves room for header, footer and rows', (_label, w, h) => {
    const layout = getCardLayout(w, h);
    // Header (~44) + footer (~60) + padding must still leave usable list space.
    const chrome = 44 + 60 + layout.padding * 2;
    expect(layout.height - chrome).toBeGreaterThan(80);
  });

  it('caps size so the card is not a slab on large screens', () => {
    const tablet = getCardLayout(1280, 1600);
    expect(tablet.width).toBe(MAX_CARD_WIDTH);
    expect(tablet.height).toBeLessThanOrEqual(MAX_CARD_HEIGHT);
  });

  it('gives short screens a larger share of the viewport', () => {
    const short = getCardLayout(400, 600);
    const tall = getCardLayout(400, 1000);
    expect(short.height / 600).toBeGreaterThan(tall.height / 1000);
  });

  it('tightens padding on narrow screens', () => {
    expect(getCardLayout(320, 640).padding).toBeLessThan(getCardLayout(412, 915).padding);
  });

  it('never returns NaN for missing or absurd input', () => {
    for (const args of [[undefined, undefined], [0, 0], [NaN, NaN], [-100, -100], [null, null]]) {
      const layout = getCardLayout(args[0], args[1]);
      expect(Number.isFinite(layout.height)).toBe(true);
      expect(Number.isFinite(layout.width)).toBe(true);
      expect(layout.height).toBeGreaterThan(0);
      expect(layout.width).toBeGreaterThan(0);
    }
  });
});

describe('getScaledType', () => {
  it('shrinks type on small screens but never to nothing', () => {
    for (const [, w, h] of SCREENS) {
      const t = getScaledType(w, h);
      for (const [key, value] of Object.entries(t)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(11);
        expect(value).toBeLessThanOrEqual(24);
        expect(typeof key).toBe('string');
      }
    }
  });

  it('keeps the title at least as large as body text', () => {
    for (const [, w, h] of SCREENS) {
      const t = getScaledType(w, h);
      expect(t.title).toBeGreaterThanOrEqual(t.itemTitle);
    }
  });

  it('scales down as the screen narrows', () => {
    expect(getScaledType(320, 640).title).toBeLessThan(getScaledType(412, 915).title);
    expect(getScaledType(320, 640).action).toBeLessThan(getScaledType(412, 915).action);
  });
});

describe('breakpoints', () => {
  it('classifies narrow and short screens', () => {
    expect(isNarrow(320)).toBe(true);
    expect(isNarrow(412)).toBe(false);
    expect(isShort(600)).toBe(true);
    expect(isShort(915)).toBe(false);
  });
});

/**
 * Responsive layout helpers.
 *
 * These are pure functions of the LIVE window size (from `useWindowDimensions`),
 * never a module-scope `Dimensions.get('window')` snapshot — that value is
 * captured once at import and is wrong after a rotation, in split screen, and on
 * foldables.
 *
 * They live here, outside the components, so the sizing rules can be tested. The
 * rule that matters most is the one that broke Aura's draft schedule: a modal
 * card whose body is a `flex: 1` ScrollView MUST have a resolved height. With
 * only a `maxHeight` the card is auto-height, the flex child has nothing to
 * resolve against, and the list collapses to zero — the card renders with a
 * header and footer and no rows.
 */

/** Screens narrower than this get tighter padding and smaller type. */
export const NARROW_WIDTH = 360;
/** Screens shorter than this get a taller card ratio and smaller type. */
export const SHORT_HEIGHT = 700;

/** Largest a centred modal card should ever get, so it isn't a slab on tablets. */
export const MAX_CARD_WIDTH = 520;
export const MAX_CARD_HEIGHT = 720;
/** Below this the card can't show a usable number of rows. */
export const MIN_CARD_HEIGHT = 320;

export const isNarrow = (winW) => winW < NARROW_WIDTH;
export const isShort = (winH) => winH < SHORT_HEIGHT;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Layout for a centred modal card that contains a scrollable body.
 *
 * @param {number} winW live window width
 * @param {number} winH live window height
 * @returns {{width:number, height:number, padding:number}}
 *   `height` is always a resolved number — never undefined and never only a
 *   maxHeight — so a `flex: 1` body can actually take up space.
 */
export function getCardLayout(winW, winH) {
  const w = Number.isFinite(winW) && winW > 0 ? winW : NARROW_WIDTH;
  const h = Number.isFinite(winH) && winH > 0 ? winH : SHORT_HEIGHT;
  const narrow = isNarrow(w);
  const short = isShort(h);

  return {
    width: Math.min(w - (narrow ? 20 : 32), MAX_CARD_WIDTH),
    // Short screens give the card a bigger share of the viewport, because the
    // header and footer take a fixed amount and the remainder is the list.
    height: clamp(
      Math.round(h * (short ? 0.82 : 0.76)),
      // Never taller than the viewport itself, even on a very short screen.
      Math.min(MIN_CARD_HEIGHT, Math.round(h * 0.95)),
      Math.min(MAX_CARD_HEIGHT, Math.round(h * 0.95)),
    ),
    padding: narrow ? 14 : 20,
  };
}

/**
 * Type and icon sizes that step down together, so a small screen shrinks
 * consistently instead of one label wrapping while its neighbour doesn't.
 */
export function getScaledType(winW, winH) {
  const narrow = isNarrow(winW);
  const short = isShort(winH);
  return {
    title: narrow ? 18 : short ? 20 : 22,
    headerIcon: narrow ? 20 : 24,
    itemTitle: narrow ? 14 : 16,
    itemTime: narrow ? 11 : 12,
    action: narrow ? 13 : short ? 14 : 16,
    actionIcon: narrow ? 15 : 18,
  };
}

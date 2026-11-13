import { FlexWidget, OverlapWidget, TextWidget } from 'react-native-android-widget';
import { getPriorityColor } from '../config/priorityConfig';
import { withAlpha } from './widgetTheme';

/**
 * Shared building blocks for the home-screen widgets.
 *
 * These exist because `react-native-android-widget` maps to RemoteViews, and
 * RemoteViews supports far less than React Native does. Two limits shape
 * everything here:
 *
 *   1. There is NO `textDecorationLine`. Passing it is silently dropped, which
 *      is why "completed" rows only ever faded instead of being struck through.
 *      `StrikeText` draws the line itself.
 *   2. There is NO `flexWrap`. A row of tags cannot reflow, so callers must
 *      budget how many tags they show per widget size (see `pickTags`).
 */

/**
 * Text with an optional real strikethrough.
 *
 * The strike is a 1dp bar drawn over the glyphs inside an OverlapWidget
 * (FrameLayout). The OverlapWidget wraps its content, and Android re-measures
 * MATCH_PARENT children of a wrap_content FrameLayout against the resolved
 * parent size — so the bar spans exactly the text width, not the whole row.
 *
 * Struck text is forced to a single line: one centered bar through a two-line
 * block would sit in the gap between lines rather than through either of them.
 */
export function StrikeText({
  text,
  color,
  struck,
  strikeColor,
  fontSize = 14,
  fontWeight = '400',
  letterSpacing,
  fontStyle = {},
  maxLines = 1,
  truncate = 'END',
}) {
  const textStyle = {
    fontSize,
    color,
    fontWeight,
    ...(letterSpacing != null ? { letterSpacing } : {}),
    ...fontStyle,
  };

  if (!struck) {
    return <TextWidget text={text} maxLines={maxLines} truncate={truncate} style={textStyle} />;
  }

  return (
    <OverlapWidget style={{ width: 'wrap_content', height: 'wrap_content' }}>
      <TextWidget text={text} maxLines={1} truncate={truncate} style={textStyle} />
      <FlexWidget
        style={{ width: 'match_parent', height: 'match_parent', justifyContent: 'center' }}
      >
        <FlexWidget
          style={{ width: 'match_parent', height: 1, backgroundColor: strikeColor || color }}
        />
      </FlexWidget>
    </OverlapWidget>
  );
}

/**
 * A tag pill. Discrete pills read as real tags; the previous single
 * "9:30 AM · Nov 8 · Daily" string read as a caption and lost the sense that
 * each item is a distinct property of the task.
 */
export function Chip({ label, color, tint, fontStyle = {}, fontSize = 9.5 }) {
  return (
    <FlexWidget
      style={{
        backgroundColor: tint,
        borderRadius: 6,
        paddingHorizontal: 5,
        paddingVertical: 1,
        marginRight: 4,
      }}
    >
      <TextWidget
        text={label}
        maxLines={1}
        style={{ fontSize, color, fontWeight: '400', ...fontStyle }}
      />
    </FlexWidget>
  );
}

/**
 * Priority flag, built from two rectangles instead of a glyph or an icon font.
 *
 * The app marks EVERY priority with a coloured `Flag` icon, so the widget must
 * too — collapsing it to "urgent/high only" silently dropped the flag from most
 * tasks. A drawn flag can't fall back to a tofu box the way `⚑` can on OEM
 * fonts, and it costs two FlexWidgets rather than an SVG parse per row.
 */
export function PriorityFlag({ priority, size = 10 }) {
  const color = getPriorityColor(priority);
  const poleWidth = 1.5;
  const bannerWidth = Math.round(size * 0.55);
  const bannerHeight = Math.round(size * 0.45);

  return (
    <FlexWidget
      style={{ flexDirection: 'row', height: size, alignItems: 'flex-start', marginRight: 5 }}
    >
      <FlexWidget style={{ width: poleWidth, height: size, backgroundColor: color }} />
      <FlexWidget
        style={{
          width: bannerWidth,
          height: bannerHeight,
          backgroundColor: color,
          borderTopRightRadius: 1,
          borderBottomRightRadius: 1,
        }}
      />
    </FlexWidget>
  );
}

/**
 * True when the task carries a priority to flag.
 *
 * Deliberately identical to the app's `shouldShowFlag`: a task with NO priority
 * set shows nothing, and every explicitly set level — Low and Normal included —
 * gets its coloured flag. Narrowing this to "urgent/high only" is what made the
 * widget appear to drop flags that the task really had.
 */
export const hasPriorityFlag = (priority) => priority !== undefined && priority !== null;

/**
 * Choose which tags survive at this widget size.
 *
 * Without `flexWrap` an overlong tag row just clips, so the most informative
 * tags have to win. `tags` is expected in descending priority order; each entry
 * may declare `keep: true` to be exempt from the budget.
 */
export function pickTags(tags, budget) {
  const present = tags.filter(Boolean);
  const kept = present.filter((tg) => tg.keep);
  const rest = present.filter((tg) => !tg.keep);
  return [...kept, ...rest.slice(0, Math.max(0, budget - kept.length))];
}

/** Soft background tint for a chip, derived so it works on light and dark. */
export const chipTint = (theme, color) =>
  color ? withAlpha(color, theme.isLightBg ? 0.14 : 0.18) : theme.fill;

/* eslint-disable react-hooks/error-boundaries -- The rule warns that JSX built inside try/catch won't have its render errors caught, which is true of React's deferred rendering but not here: react-native-android-widget evaluates this tree synchronously (inside this awaited function) to build Android RemoteViews, so the try/catch really is the correct — and only — error boundary a headless widget task can have. */
import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';
import { annotatePlan, minutesOfDay } from './planRowState';
import { StrikeText } from './widgetPrimitives';
import { resolveWidgetContext, withAlpha } from './widgetTheme';

/**
 * LifePilot — Today's Plan widget
 * ---------------------------------------------------------------------------
 * Mirrors the schedule Aura generated for TODAY (saved as `generated_plan_<uid>`
 * with a matching date key) and lets the user tick off real tasks straight from
 * the home screen, exactly like the Today widget.
 *
 * The widget is time-aware, which is the point of it: glancing at the home
 * screen should tell you where you are in the day without opening the app.
 *
 *   • done     — ticked task            → green, struck through
 *   • missed   — real task, window gone → red, struck through
 *   • past     — Aura block, window gone→ struck through, dimmed, no colour
 *                (a meal or sleep block isn't something you "fail")
 *   • now      — the row covering this moment → accent rail + brighter text
 *   • upcoming — untouched
 *
 * A thin now-line is drawn between the last elapsed row and the next one, so
 * the boundary between "behind me" and "ahead of me" is readable at a glance.
 *
 * Two details worth knowing:
 *   • Completion is read LIVE from the task cache, not from the plan's own
 *     `completed` flag, so ticking in the app and on the widget agree.
 *   • Rows Aura invents (meals, sleep, focus) carry `taskId: null`. They show
 *     for context but are not tappable, because there is no task to toggle.
 */
export async function PlannerWidget(props) {
  try {
    // ⚡ PERF: the plan + tasks reads ride along in the theme batch, so a render
    // costs two AsyncStorage round-trips instead of three.
    const ctx = await resolveWidgetContext([
      'generated_plan_{uid}',
      'generated_plan_date_{uid}',
      'tasks_{uid}',
    ]);
    const { userId, palette } = ctx;
    const theme = palette;
    const font = ctx.theme?.fontFamily;
    const fontStyle = font ? { fontFamily: font } : {};

    // Honour the same background style/opacity the user picked for the Today
    // widget, so both widgets read as one family on the home screen.
    const bgColor = ctx.bgColor || theme.bg;

    if (!userId) {
      return <Shell bgColor={bgColor}><Notice theme={theme} fontStyle={fontStyle} text="Log in to see your plan" /></Shell>;
    }

    const planDate = ctx.extra['generated_plan_date_{uid}'];
    const rawPlan = ctx.extra['generated_plan_{uid}'];
    const tasks = ctx.extra['tasks_{uid}'] || [];
    const todayStr = new Date().toDateString();

    // A plan is only valid for the day it was built for.
    const hasStoredPlan = Array.isArray(rawPlan) && rawPlan.length > 0;
    const isToday = planDate === todayStr;
    const rawRows = isToday && hasStoredPlan ? rawPlan : [];

    if (rawRows.length === 0) {
      // "Expired" only makes sense if a plan actually exists for another day.
      // Telling a first-time user that yesterday's plan expired is nonsense.
      return (
        <Shell bgColor={bgColor}>
          <Notice
            theme={theme}
            fontStyle={fontStyle}
            text={hasStoredPlan && !isToday
              ? "Yesterday's plan expired. Build today's."
              : 'No plan yet — open Aura to build one'}
          />
        </Shell>
      );
    }

    const doneById = new Map();
    for (const task of tasks) {
      if (task && task.id != null) doneById.set(String(task.id), !!task.is_completed);
    }

    const nowMinutes = minutesOfDay();
    const rows = annotatePlan(rawRows, { doneById, nowMinutes });

    if (rows.length === 0) {
      return (
        <Shell bgColor={bgColor}>
          <Notice theme={theme} fontStyle={fontStyle} text="No plan yet — open Aura to build one" />
        </Shell>
      );
    }

    // Responsive to BOTH axes. The widget can now be shrunk to 110dp (the old
    // 180dp floor is what made it feel unresizable), and at that width a fixed
    // 58dp time column plus the rail and checkbox overflowed the row.
    const { height, width } = props.widgetInfo || {};
    const w = width || ctx.lastW || 0;
    const maxRows = !height ? 7 : height < 160 ? 3 : height < 260 ? 6 : height < 380 ? 9 : 14;
    const narrow = w > 0 && w < 220;
    const tiny = w > 0 && w < 160;

    // Scroll the window to where the user actually is: once most of the day has
    // elapsed, a fixed "first N rows" view would show nothing but struck-out
    // history. Keep one elapsed row for context, then fill forward.
    const firstLive = rows.findIndex((r) => r.state === 'now' || r.state === 'upcoming');
    const start = firstLive <= 0 || rows.length <= maxRows
      ? 0
      : Math.min(Math.max(0, firstLive - 1), Math.max(0, rows.length - maxRows));
    const visible = rows.slice(start, start + maxRows);
    const hiddenBefore = start;
    const hiddenAfter = Math.max(0, rows.length - (start + visible.length));

    const trackable = rows.filter((r) => r.kind === 'task').length;
    const doneCount = rows.filter((r) => r.state === 'done').length;
    const missedCount = rows.filter((r) => r.state === 'missed').length;

    return (
      <Shell bgColor={bgColor}>
        <FlexWidget
          style={{
            height: 'match_parent',
            width: 'match_parent',
            paddingTop: narrow ? 11 : 16,
            paddingBottom: narrow ? 8 : 12,
            paddingHorizontal: tiny ? 8 : narrow ? 10 : 16,
          }}
          clickAction="OPEN_APP"
        >
          {/* Header: label, progress, and a missed count only when it exists.
              At tiny widths the title is dropped rather than letting the
              progress counters get squeezed off the row. */}
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
            {!tiny && (
              <TextWidget
                text="TODAY'S PLAN"
                maxLines={1}
                style={{ fontSize: 10, color: theme.muted, fontWeight: '500', letterSpacing: narrow ? 1 : 2, ...fontStyle }}
              />
            )}
            <FlexWidget style={{ flex: 1 }} />
            {trackable > 0 && (
              <TextWidget
                text={`${doneCount}/${trackable}`}
                style={{ fontSize: 10, color: theme.muted, fontWeight: '400', ...fontStyle }}
              />
            )}
            {missedCount > 0 && (
              <TextWidget
                text={narrow ? `  ${missedCount}!` : `  ${missedCount} missed`}
                style={{ fontSize: 10, color: theme.danger, fontWeight: '400', ...fontStyle }}
              />
            )}
          </FlexWidget>

          <FlexWidget style={{ height: 1, width: 'match_parent', backgroundColor: theme.hairline, marginTop: narrow ? 8 : 12, marginBottom: 8 }} />

          <ListWidget style={{ flex: 1 }}>
            {hiddenBefore > 0 && (
              <TextWidget
                text={`↑ ${hiddenBefore} earlier`}
                style={{ fontSize: 9.5, color: theme.muted, marginBottom: 4, ...fontStyle }}
              />
            )}

            {visible.map((row, index) => (
              <PlanRow
                key={`${row.taskId || 'b'}-${start + index}`}
                row={row}
                theme={theme}
                fontStyle={fontStyle}
                narrow={narrow}
                tiny={tiny}
              />
            ))}

            {hiddenAfter > 0 && (
              <TextWidget
                text={`↓ ${hiddenAfter} later`}
                style={{ fontSize: 9.5, color: theme.muted, marginTop: 5, ...fontStyle }}
              />
            )}
          </ListWidget>
        </FlexWidget>
      </Shell>
    );
  } catch (error) {
    console.error('[PlannerWidget] Error:', error);
    return <Shell><Notice text="Couldn't load plan" /></Shell>;
  }
}

/**
 * Resolve every colour a row needs from its state, so the row markup stays flat
 * and the state → appearance mapping lives in exactly one place.
 */
function rowLook(state, theme) {
  switch (state) {
    case 'done':
      return { time: theme.muted, title: theme.success, strike: theme.success, mark: theme.success, rail: false };
    case 'missed':
      return { time: theme.danger, title: theme.danger, strike: theme.danger, mark: theme.danger, rail: false };
    case 'past':
      // An Aura block that has simply elapsed: cut, faded, deliberately colourless.
      return {
        time: withAlpha(theme.text, 0.3),
        title: withAlpha(theme.text, 0.34),
        strike: withAlpha(theme.text, 0.34),
        mark: withAlpha(theme.text, 0.3),
        rail: false,
      };
    case 'now':
      return { time: theme.accent, title: theme.text, strike: null, mark: theme.accent, rail: true };
    default:
      return { time: theme.muted, title: theme.text, strike: null, mark: withAlpha(theme.text, 0.35), rail: false };
  }
}

/**
 * Drop the meridiem at narrow widths: "9:30 AM" → "9:30". The column has to
 * shrink to fit a 110dp widget, and the AM/PM is the least useful character
 * there — the rows are in chronological order, so the time of day is obvious.
 */
const compactTime = (raw) => {
  const s = String(raw || '');
  // Keep only the start of a range too ("9:30 AM - 10:30 AM" → "9:30").
  const first = s.split(/\s*(?:-|–|—|to|until)\s*/i)[0] || s;
  return first.replace(/\s*(am|pm|a\.m\.|p\.m\.)\s*$/i, '').trim() || first.trim();
};

function PlanRow({ row, theme, fontStyle, narrow, tiny }) {
  const isTask = row.kind === 'task';
  const look = rowLook(row.state, theme);
  const done = row.state === 'done';

  const markSize = narrow ? 16 : 18;
  const timeWidth = tiny ? 34 : narrow ? 42 : 58;
  const timeText = narrow ? compactTime(row.time) : String(row.time || '');

  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: narrow ? 4 : 5, width: 'match_parent' }}>
      {/* Accent rail marks the row you are inside right now. Always occupies
          space so rows never shift horizontally as time moves. */}
      <FlexWidget
        style={{
          width: 2,
          height: markSize,
          borderRadius: 1,
          backgroundColor: look.rail ? theme.accent : '#00000000',
          marginRight: narrow ? 5 : 8,
        }}
      />

      {/* At the smallest size the time column is dropped entirely: a 110dp
          widget only has ~90dp of content width, and keeping rail + time +
          checkbox left about 26dp for the title, which shows nothing useful.
          The rows are chronological, so the order still carries the sequence. */}
      {!tiny && (
        <FlexWidget style={{ width: timeWidth }}>
          <TextWidget
            text={timeText}
            maxLines={1}
            style={{ fontSize: narrow ? 9.5 : 10.5, color: look.time, fontWeight: row.state === 'now' ? '500' : '400', ...fontStyle }}
          />
        </FlexWidget>
      )}

      {isTask ? (
        <FlexWidget
          clickAction="CUSTOM_ACTION"
          clickActionData={{ action: 'TOGGLE_TASK', taskId: row.taskId, currentStatus: done ? 'true' : 'false' }}
          style={{
            width: markSize,
            height: markSize,
            borderRadius: markSize / 2,
            borderWidth: done ? 0 : 1.5,
            borderColor: look.mark,
            backgroundColor: done ? theme.success : '#00000000',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: narrow ? 7 : 10,
          }}
        >
          {done && <TextWidget text="✓" style={{ fontSize: narrow ? 9 : 10, color: theme.onSuccess, ...fontStyle }} />}
        </FlexWidget>
      ) : (
        // Aura-invented block (meal, break, focus): context only, nothing to tick.
        <FlexWidget style={{ width: markSize, height: markSize, justifyContent: 'center', alignItems: 'center', marginRight: narrow ? 7 : 10 }}>
          <FlexWidget style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: look.mark }} />
        </FlexWidget>
      )}

      <FlexWidget style={{ flex: 1 }}>
        <StrikeText
          text={String(row.title || '')}
          color={look.title}
          struck={row.struck}
          strikeColor={look.strike}
          fontSize={narrow ? 11.5 : 13}
          fontWeight="400"
          fontStyle={fontStyle}
          maxLines={1}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

function Shell({ bgColor, children }) {
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: bgColor || '#000000', borderRadius: 24 }}>
      {children}
    </FlexWidget>
  );
}

function Notice({ theme, fontStyle, text }) {
  const t = theme || { muted: '#9A9AA3' };
  return (
    <FlexWidget
      style={{ flex: 1, height: 'match_parent', width: 'match_parent', justifyContent: 'center', alignItems: 'center', padding: 18 }}
      clickAction="OPEN_APP"
    >
      <TextWidget
        text={text}
        style={{ fontSize: 12.5, color: t.muted, fontWeight: '400', textAlign: 'center', ...(fontStyle || {}) }}
      />
    </FlexWidget>
  );
}

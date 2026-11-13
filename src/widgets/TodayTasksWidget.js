/* eslint-disable react-hooks/error-boundaries -- The rule warns that JSX built inside try/catch won't have its render errors caught, which is true of React's deferred rendering but not here: react-native-android-widget evaluates this tree synchronously (inside this awaited function) to build Android RemoteViews, so the try/catch really is the correct — and only — error boundary a headless widget task can have. */
import { FlexWidget, ListWidget, OverlapWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import { getPriorityColor } from '../config/priorityConfig';
import { Storage } from '../utils/storage';
import { Chip, chipTint, hasPriorityFlag, pickTags, PriorityFlag, StrikeText } from './widgetPrimitives';
import {
    buildGrainSvg,
    getListLabel,
    resolveWidgetContext,
    selectTasksForList,
    withAlpha,
} from './widgetTheme';

// Title-case a repeat rule ("daily" -> "Daily", "every 2 weeks" -> "Every 2 Weeks")
const formatRepeat = (rule) => {
    if (!rule || typeof rule !== 'string') return null;
    return rule
        .split(' ')
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
};

const formatTime = (value) =>
  new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const formatDay = (value) =>
  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Resolve a size "bucket" from the widget's actual dp dimensions so the layout
// adapts as the user resizes. Falls back to the last size the native handler
// saw (persisted) so app-triggered refreshes pick the right density too.
const getBucket = (w, h) => {
  if (!w || !h) return 'medium';
  if (h < 130) return 'nano';          // 1-row tall strip
  if (w < 180 || h < 220) return 'small';
  if (h < 380) return 'medium';
  return 'large';
};

// How many tag chips fit on one line at each size. RemoteViews has no
// `flexWrap`, so an over-full tag row clips rather than reflowing — the budget
// is what keeps the most useful tags visible instead of the first few.
const TAG_BUDGET = { large: 4, medium: 3, small: 2, nano: 0 };

/**
 * LifePilot — "Thread of the Day" Widget (responsive + themed)
 * ------------------------------------------------------------------
 * • Mirrors the app's equipped theme / accent / font (Marketplace).
 * • Background styles: Solid · Translucent · Frosted · Grain (set in app).
 * • Fully responsive: nano / small / medium / large layouts as you resize.
 * • Shows a task's REAL tags the way the app does: a coloured priority flag
 *   plus discrete chips for due date, reminder, repeat, steps, notes and list.
 * • Two-way sync: tapping a node toggles completion instantly.
 */
export async function TodayTasksWidget(props) {
  try {
    // ⚡ PERF: the tasks/lists reads ride along in the theme batch, so a full
    // render costs two AsyncStorage round-trips instead of three.
    const ctx = await resolveWidgetContext(['tasks_{uid}', 'lists_{uid}']);
    const { userId, palette, listId, hideCompleted, lastW, lastH, expandedTaskId } = ctx;
    // `palette` replaces the raw theme for anything drawn: it guarantees the
    // foreground contrasts with whatever background the user equipped.
    const theme = palette;

    if (!userId) {
      return <ChromeWrapper ctx={ctx}><EmptyState theme={theme} message="Log in to see your tasks" /></ChromeWrapper>;
    }

    const allTasks = ctx.extra['tasks_{uid}'] || [];
    const allLists = ctx.extra['lists_{uid}'] || [];
    const listMap = {};
    allLists.forEach((l) => { if (l && l.id != null) listMap[l.id] = l.name; });

    const { height, width } = props.widgetInfo || {};
    const w = width || lastW || 0;
    const h = height || lastH || 0;
    // Persist the size we actually rendered at, for app-triggered updates.
    // One multiSet, and only when it actually changed — this used to fire two
    // writes on every single render, including every widget tap.
    if (width && height && (width !== lastW || height !== lastH)) {
      Storage.setBatch([['widget_last_w', String(width)], ['widget_last_h', String(height)]]);
    }
    const bucket = getBucket(w, h);

    const maxTasks = bucket === 'large' ? 12 : bucket === 'medium' ? 7 : bucket === 'small' ? 4 : 2;
    // Each step becomes its own collection item, and every item is rasterized to
    // a bitmap — so this cap is what keeps an expand tap from turning into a
    // long render. The rest stay reachable by opening the task.
    const maxSteps = bucket === 'large' ? 10 : bucket === 'medium' ? 7 : 4;

    const scoped = selectTasksForList(allTasks, listId);
    const todayStr = new Date().toDateString();

    const activeTasks = scoped
      .filter((t) => !t.is_completed)
      .sort((a, b) => {
        const ia = a.order_index ?? Infinity;
        const ib = b.order_index ?? Infinity;
        return ia - ib || new Date(b.created_at) - new Date(a.created_at);
      })
      .slice(0, maxTasks);

    const completedTasks = (hideCompleted || bucket === 'nano' || bucket === 'small')
      ? []
      : scoped
          .filter((t) => {
            if (!t.is_completed) return false;
            const cd = t.completed_at ? new Date(t.completed_at).toDateString() : null;
            return cd === todayStr;
          })
          .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0))
          .slice(0, bucket === 'large' ? 4 : 2);

    const totalToday = scoped.filter((t) => {
      if (t.is_completed) {
        const cd = t.completed_at ? new Date(t.completed_at).toDateString() : null;
        return cd === todayStr;
      }
      return true;
    }).length;
    const doneToday = scoped.filter((t) => {
      if (!t.is_completed) return false;
      const cd = t.completed_at ? new Date(t.completed_at).toDateString() : null;
      return cd === todayStr;
    }).length;
    const remainingToday = Math.max(0, totalToday - doneToday);

    const font = ctx.theme?.fontFamily;
    const fontStyle = font ? { fontFamily: font } : {};
    const label = getListLabel(listId, listMap);

    // ── NANO: a single glanceable strip ──────────────────
    if (bucket === 'nano') {
      const next = activeTasks[0];
      return (
        <ChromeWrapper ctx={ctx}>
          <FlexWidget
            style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}
            clickAction="OPEN_APP"
          >
            <FlexWidget style={{ alignItems: 'center', marginRight: 14 }}>
              <TextWidget text={`${remainingToday}`} style={{ fontSize: 28, color: theme.text, fontWeight: '300', ...fontStyle }} />
              <TextWidget text="LEFT" style={{ fontSize: 8, color: theme.muted, fontWeight: '500', letterSpacing: 1.8, ...fontStyle }} />
            </FlexWidget>
            <FlexWidget style={{ flex: 1 }}>
              <TextWidget text={label} style={{ fontSize: 9.5, color: theme.muted, fontWeight: '500', letterSpacing: 1.8, marginBottom: 4, ...fontStyle }} />
              <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
                {next && hasPriorityFlag(next.priority) && <PriorityFlag priority={next.priority} size={9} />}
                <FlexWidget style={{ flex: 1 }}>
                  <TextWidget
                    text={next ? next.title : 'All clear'}
                    style={{ fontSize: 14, color: theme.text, fontWeight: '400', ...fontStyle }}
                    maxLines={1}
                  />
                </FlexWidget>
              </FlexWidget>
            </FlexWidget>
          </FlexWidget>
        </ChromeWrapper>
      );
    }

    const compact = bucket === 'small';
    const tagBudget = TAG_BUDGET[bucket] ?? 3;

    return (
      <ChromeWrapper ctx={ctx}>
        {/* NO clickAction ON THIS CONTAINER.
            A clickable widget becomes an invisible overlay sized to its own
            bounds, stacked above the widget content. This container is
            match_parent, so putting "open the app" here laid a full-bleed
            clickable sheet over the ListWidget below: the task/step tap targets
            never received a tap, and because that overlay is clickable-but-not-
            scrollable the launcher swallowed vertical drags and opened the app
            drawer instead of scrolling the list.
            "Open the app" now lives on the header label, which sits outside the
            list and can be tapped safely. */}
        <FlexWidget
          style={{
            height: 'match_parent',
            width: 'match_parent',
            paddingTop: 18,
            paddingBottom: 14,
            paddingLeft: 18,
            paddingRight: 18,
          }}
        >
          {/* Header: list name, progress fraction, and a quick-add affordance */}
          <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 'match_parent' }}>
            <FlexWidget
              style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
              clickAction="OPEN_APP"
            >
              <TextWidget text={label} style={{ fontSize: 10, color: theme.muted, fontWeight: '500', letterSpacing: 2, ...fontStyle }} />
              <TextWidget text={`   ${doneToday}/${totalToday}`} style={{ fontSize: 10, color: theme.muted, fontWeight: '400', letterSpacing: 0.5, ...fontStyle }} />
            </FlexWidget>
            <FlexWidget
              clickAction="OPEN_URI"
              clickActionData={{ uri: 'lifepilot://today' }}
              style={{ width: 24, height: 24, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: theme.fill }}
            >
              <TextWidget text="+" style={{ fontSize: 16, color: theme.text, marginTop: -2, ...fontStyle }} />
            </FlexWidget>
          </FlexWidget>

          {/* Hairline progress (flex weights → size-independent) */}
          <FlexWidget style={{ flexDirection: 'row', height: 2, width: 'match_parent', backgroundColor: theme.hairline, borderRadius: 1, marginTop: 13, marginBottom: 15 }}>
            {doneToday > 0 && <FlexWidget style={{ flex: doneToday, height: 2, backgroundColor: theme.accent, borderRadius: 1 }} />}
            {remainingToday > 0 && <FlexWidget style={{ flex: remainingToday, height: 2 }} />}
          </FlexWidget>

          {/* Body */}
          {activeTasks.length === 0 && completedTasks.length === 0 ? (
            <EmptyState theme={theme} message="Clear. Nothing left." fontStyle={fontStyle} />
          ) : (
            /* Steps are emitted as SIBLINGS of their task, not nested inside it.
               A ListWidget is the only scrollable primitive available and
               collections cannot be nested (each item is rasterized to a bitmap,
               and a nested collection inside one is discarded). Being siblings
               means an open step list scrolls with the main list instead of
               being clipped inside a single oversized row. */
            <ListWidget style={{ flex: 1 }}>
              {activeTasks.flatMap((task) => {
                const isExpanded = expandedTaskId != null && String(task.id) === String(expandedTaskId);
                const steps = Array.isArray(task.subtasks) ? task.subtasks.filter(Boolean) : [];
                const rows = [
                  <TaskRow
                    key={task.id}
                    task={task}
                    theme={theme}
                    fontStyle={fontStyle}
                    listMap={listMap}
                    done={false}
                    compact={compact}
                    tagBudget={tagBudget}
                    expanded={isExpanded}
                  />,
                ];
                if (!isExpanded || steps.length === 0) return rows;

                const shown = steps.slice(0, maxSteps);
                shown.forEach((s, i) => {
                  rows.push(
                    <SubtaskRow
                      key={`${task.id}-s-${s.id || i}`}
                      taskId={task.id}
                      subtask={s}
                      theme={theme}
                      fontStyle={fontStyle}
                    />
                  );
                });
                if (steps.length > shown.length) {
                  rows.push(
                    <MoreStepsRow
                      key={`${task.id}-more`}
                      count={steps.length - shown.length}
                      taskId={task.id}
                      theme={theme}
                      fontStyle={fontStyle}
                    />
                  );
                }
                return rows;
              })}

              {completedTasks.length > 0 && (
                <FlexWidget style={{ marginTop: activeTasks.length > 0 ? 14 : 0, width: 'match_parent' }}>
                  <TextWidget text={`DONE ${completedTasks.length}`} style={{ fontSize: 9, color: theme.muted, fontWeight: '500', letterSpacing: 1.8, marginBottom: 9, ...fontStyle }} />
                  {completedTasks.map((task) => (
                    <TaskRow key={task.id} task={task} theme={theme} fontStyle={fontStyle} listMap={listMap} done compact={compact} tagBudget={tagBudget} />
                  ))}
                </FlexWidget>
              )}
            </ListWidget>
          )}
        </FlexWidget>
      </ChromeWrapper>
    );
  } catch (error) {
    console.error('[Widget] Error:', error);
    return <EmptyState message="Couldn't load tasks" />;
  }
}

/**
 * ChromeWrapper — paints the background per the selected style (solid /
 * translucent / frosted / grain) with rounded corners, and stacks the content
 * on top. Frost adds a faint lighter sheen; grain overlays a subtle noise SVG.
 */
function ChromeWrapper({ ctx, children }) {
  const radius = 24;
  // Overlays derive from the readable palette so a frost/grain wash lightens a
  // dark theme and darkens a light one, instead of always washing white.
  const theme = ctx?.palette || ctx?.theme || { bg: '#000000', text: '#FAFAFA', accent: '#FFFFFF' };
  const bgColor = ctx?.bgColor || '#000000';
  const bgStyle = ctx?.bgStyle || 'solid';

  if (bgStyle === 'solid') {
    return (
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: bgColor, borderRadius: radius }}>
        {children}
      </FlexWidget>
    );
  }

  // Layered styles use OverlapWidget so we can stack base + texture + content.
  return (
    <OverlapWidget style={{ height: 'match_parent', width: 'match_parent', borderRadius: radius, overflow: 'hidden' }}>
      {/* Base tint */}
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: bgColor }} />

      {/* Frost sheen — a faint light wash for a glassy feel */}
      {bgStyle === 'frost' && (
        <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: withAlpha(theme.text, 0.05) }} />
      )}

      {/* Grain texture */}
      {bgStyle === 'grain' && (
        <SvgWidget svg={buildGrainSvg(theme.text)} style={{ height: 'match_parent', width: 'match_parent' }} />
      )}

      {/* Content */}
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {children}
      </FlexWidget>
    </OverlapWidget>
  );
}

/**
 * Build the tag list for a task, in descending order of usefulness.
 *
 * The previous version merged everything into one "9:30 AM · Nov 8 · Daily"
 * caption, which read as a sentence rather than as the task's properties, and
 * dropped the priority flag for anything below High. Each tag is now discrete,
 * and an overdue due-date carries the danger colour instead of tinting the whole
 * line red.
 */
function buildTags(task, theme, listMap, isOverdue, showStepsTag) {
  const hasSubs = Array.isArray(task.subtasks) && task.subtasks.length > 0;
  const doneSubs = hasSubs ? task.subtasks.filter((s) => s && s.is_completed).length : 0;

  return [
    // Overdue is the single most important thing to see, so it is exempt from
    // the size budget when present.
    task.due_date && {
      label: formatDay(task.due_date),
      color: isOverdue ? theme.danger : theme.muted,
      tint: isOverdue ? chipTint(theme, theme.danger) : theme.fill,
      keep: isOverdue,
    },
    task.reminder_time && { label: formatTime(task.reminder_time), color: theme.muted, tint: theme.fill },
    // Skipped when the steps toggle is on screen — that button already shows the
    // same fraction, and printing it twice on one row is just noise.
    showStepsTag && hasSubs && { label: `${doneSubs}/${task.subtasks.length} steps`, color: theme.muted, tint: theme.fill },
    task.repeat_rule && { label: formatRepeat(task.repeat_rule), color: theme.muted, tint: theme.fill },
    task.list_id && listMap[task.list_id] && { label: listMap[task.list_id], color: theme.muted, tint: theme.fill },
    task.notes && { label: 'note', color: theme.muted, tint: theme.fill },
  ];
}

/**
 * A single task row: node marker + title + real tags.
 */
function TaskRow({ task, theme, fontStyle, listMap, done, compact, tagBudget, expanded }) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const isOverdue = !done && task.due_date && new Date(task.due_date) < todayStart;
  const steps = Array.isArray(task.subtasks) ? task.subtasks.filter(Boolean) : [];
  const hasSubs = steps.length > 0;
  const doneSubs = steps.filter((s) => s.is_completed).length;
  // The toggle only renders on open rows, so completed rows keep the steps chip.
  const showStepsToggle = !done && hasSubs;

  const priority = task.priority;
  // The app flags every non-default priority, so the widget does too — the old
  // "urgent/high only" rule silently hid Low from the user entirely.
  const showFlag = !done && hasPriorityFlag(priority);
  const priorityColor = getPriorityColor(priority);
  const nodeSize = compact ? 18 : 20;

  const tags = !done && !compact
    ? pickTags(buildTags(task, theme, listMap, isOverdue, !showStepsToggle), tagBudget)
    : [];

  return (
    <FlexWidget style={{ flexDirection: 'column', paddingVertical: compact ? 5 : 6, width: 'match_parent' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        {/* Node marker — tap toggles completion. Border picks up priority color. */}
        <FlexWidget
          clickAction="CUSTOM_ACTION"
          clickActionData={{ action: 'TOGGLE_TASK', taskId: task.id, currentStatus: done ? 'true' : 'false' }}
          style={{
            width: nodeSize,
            height: nodeSize,
            borderRadius: nodeSize / 2,
            borderWidth: done ? 0 : 1.5,
            borderColor: done ? theme.success : (showFlag ? withAlpha(priorityColor, 0.9) : withAlpha(theme.text, 0.35)),
            backgroundColor: done ? theme.success : '#00000000',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 12,
          }}
        >
          {done && <TextWidget text="✓" style={{ fontSize: 11, color: theme.onSuccess, fontWeight: '500', ...fontStyle }} />}
        </FlexWidget>

        <FlexWidget style={{ flex: 1 }} clickAction="OPEN_APP" clickActionData={{ screen: 'TaskDetail', taskId: task.id }}>
          {/* Title row: priority flag + title + star */}
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
            {showFlag && <PriorityFlag priority={priority} size={compact ? 9 : 10} />}

            <FlexWidget style={{ flex: 1 }}>
              {/* Completed titles get a REAL strikethrough: RemoteViews has no
                  textDecorationLine, so it is drawn as a bar over the glyphs. */}
              <StrikeText
                text={task.title || 'Untitled'}
                color={done ? withAlpha(theme.text, 0.45) : theme.text}
                struck={done}
                strikeColor={withAlpha(theme.text, 0.45)}
                fontSize={14}
                fontWeight="400"
                fontStyle={fontStyle}
                maxLines={done ? 1 : 2}
              />
            </FlexWidget>

            {task.is_important && !done && (
              <TextWidget text=" ★" style={{ fontSize: 10, color: theme.accent, ...fontStyle }} />
            )}
          </FlexWidget>

          {/* Tag chips — hidden on compact sizes, where there is no room */}
          {tags.length > 0 && (
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, width: 'match_parent' }}>
              {tags.map((tg, i) => (
                <Chip key={`${tg.label}-${i}`} label={tg.label} color={tg.color} tint={tg.tint} fontStyle={fontStyle} />
              ))}
            </FlexWidget>
          )}
        </FlexWidget>

        {/* Steps toggle — a labelled pill rather than a bare chevron. It shows
            the progress AND the affordance in one control, so the tap target is
            a readable size instead of a 15px glyph. */}
        {!done && hasSubs && (
          <FlexWidget
            clickAction="CUSTOM_ACTION"
            clickActionData={{
              action: 'TOGGLE_EXPAND_TASK',
              taskId: task.id,
              // The current state travels with the tap so the handler can write
              // the new one without reading storage first.
              expanded: expanded ? 'true' : 'false',
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              height: 26,
              paddingHorizontal: 8,
              borderRadius: 13,
              backgroundColor: expanded ? theme.fill : '#00000000',
              borderWidth: 1,
              borderColor: expanded ? '#00000000' : theme.hairline,
              marginLeft: 6,
            }}
          >
            <TextWidget
              text={`${doneSubs}/${steps.length}`}
              style={{ fontSize: 9.5, color: theme.muted, fontWeight: '400', ...fontStyle }}
            />
            <TextWidget
              text={expanded ? ' ▴' : ' ▾'}
              style={{ fontSize: 9, color: theme.muted, ...fontStyle }}
            />
          </FlexWidget>
        )}
      </FlexWidget>
    </FlexWidget>
  );
}

/**
 * One step (subtask) of an expanded task.
 *
 * The outer FlexWidget deliberately carries NO clickAction. These rows are
 * direct children of the ListWidget, and `CollectionView.buildChildren` strips
 * `clickAction` from each item's root props — putting the tap there would make
 * ticking a step silently do nothing. The inner row carries it instead.
 */
function SubtaskRow({ taskId, subtask, theme, fontStyle }) {
  const done = !!subtask.is_completed;
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', paddingLeft: 32 }}>
      <FlexWidget
        clickAction="CUSTOM_ACTION"
        clickActionData={{ action: 'TOGGLE_SUBTASK', taskId, subId: subtask.id }}
        style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingVertical: 4 }}
      >
        <TextWidget
          text={done ? '✓' : '·'}
          style={{ fontSize: 12, color: done ? theme.success : theme.muted, marginRight: 9, ...fontStyle }}
        />
        <FlexWidget style={{ flex: 1 }}>
          <StrikeText
            text={subtask.title || 'Step'}
            color={done ? withAlpha(theme.text, 0.45) : withAlpha(theme.text, 0.82)}
            struck={done}
            strikeColor={withAlpha(theme.text, 0.45)}
            fontSize={12}
            fontStyle={fontStyle}
            maxLines={1}
          />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

/** "+N more steps" — the overflow beyond what the widget renders. */
function MoreStepsRow({ count, taskId, theme, fontStyle }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', paddingLeft: 32 }}>
      <FlexWidget
        clickAction="OPEN_APP"
        clickActionData={{ screen: 'TaskDetail', taskId }}
        style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingVertical: 4 }}
      >
        <TextWidget
          text={`+${count} more step${count === 1 ? '' : 's'}`}
          style={{ fontSize: 10.5, color: theme.muted, marginLeft: 21, ...fontStyle }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

function EmptyState({ theme, message, fontStyle }) {
  const t = theme || { bg: '#000000', text: '#F5F5F7', muted: '#9A9AA3', accent: '#FFFFFF' };
  return (
    <FlexWidget style={{ flex: 1, height: 'match_parent', width: 'match_parent', justifyContent: 'center', alignItems: 'center', padding: 20 }} clickAction="OPEN_APP">
      <FlexWidget style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: withAlpha(t.text, 0.28), justifyContent: 'center', alignItems: 'center', marginBottom: 11 }}>
        <TextWidget text="✓" style={{ fontSize: 13, color: t.accent, ...(fontStyle || {}) }} />
      </FlexWidget>
      <TextWidget text={message} style={{ fontSize: 12.5, color: t.muted, fontWeight: '400', textAlign: 'center', ...(fontStyle || {}) }} />
    </FlexWidget>
  );
}

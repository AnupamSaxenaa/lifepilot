/**
 * Time-awareness for the Today's Plan widget.
 *
 * Kept as a pure module (no Storage, no RemoteViews) so the rules below can be
 * verified directly — the widget itself can only be checked by eye on a home
 * screen, and the failure modes here are exactly the ones that are easy to get
 * wrong and hard to notice: 12-hour parsing, midnight wrap, and marking
 * something "missed" too eagerly.
 */

const MINUTES_PER_DAY = 1440;

/** How long a row is assumed to occupy when the plan gives no end time. */
export const DEFAULT_BLOCK_MINUTES = 60;

/**
 * Parse the START time of a plan row into minutes since midnight.
 *
 * Aura's own formatter emits "9:30 AM", but the model also produces "09:30",
 * "14:00", "9 AM" and ranges like "9:30 AM - 10:30 AM". Anything unparseable
 * returns null, and callers must treat null as "never missed" — guessing would
 * paint a task red for a time we never actually understood.
 */
export function parseClockTime(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/(\d{1,2})\s*(?::\s*(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3] ? match[3].toLowerCase().replace(/\./g, '') : null;

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (minutes > 59) return null;

  if (meridiem === 'pm') {
    if (hours < 12) hours += 12;
  } else if (meridiem === 'am') {
    if (hours === 12) hours = 0;
  }

  // Without a meridiem this is 24-hour, so anything past 23 is nonsense.
  if (hours > 23) return null;
  return hours * 60 + minutes;
}

/**
 * Split a row's time field into start and (optional) end minutes.
 * Handles "9:30 AM - 10:30 AM", "9:30–10:30", "9:30 to 10:30" and bare times.
 */
export function parseTimeRange(raw) {
  if (typeof raw !== 'string') return { start: null, end: null };
  const parts = raw.split(/\s*(?:-|–|—|to|until)\s*/i).filter(Boolean);
  const start = parseClockTime(parts[0]);
  if (start == null) return { start: null, end: null };

  let end = parts.length > 1 ? parseClockTime(parts[1]) : null;
  if (end != null) {
    // An end before the start means the block runs past midnight.
    if (end <= start) end += MINUTES_PER_DAY;
    // Inherit the start's meridiem when the end omitted it ("9:30 AM - 10:30"),
    // otherwise a 9:30 AM–10:30 block silently becomes 13 hours long.
    else if (end - start > 12 * 60) end = null;
  }
  return { start, end };
}

/** Minutes since midnight for a Date (defaults to now). */
export const minutesOfDay = (date = new Date()) => date.getHours() * 60 + date.getMinutes();

/**
 * Annotate every plan row with its live state.
 *
 * @param {Array} plan       rows shaped {taskId, time, title, completed}
 * @param {object} options
 * @param {Map<string, boolean>} options.doneById  live completion from the task cache
 * @param {number} options.nowMinutes              minutes since midnight
 * @returns {Array} rows with {startMin, endMin, kind, state, struck}
 *
 * States:
 *   done     — a real task that is ticked          → green, struck
 *   missed   — a real task whose window has passed → red, struck
 *   past     — an Aura block whose window passed   → struck, dimmed, no colour
 *   now      — the row covering the current moment → emphasised
 *   upcoming — everything still ahead
 *
 * `kind` is 'task' for rows backed by a real task (tickable) and 'block' for
 * the meals/sleep/focus rows Aura invents, which have nothing to tick.
 */
export function annotatePlan(plan, { doneById = new Map(), nowMinutes = minutesOfDay() } = {}) {
  const rows = (Array.isArray(plan) ? plan : []).filter((item) => item && item.title);

  // First pass: absolute start/end, unrolling the day boundary. A plan that
  // ends with "12:30 AM — Sleep" must not be treated as 00:30 THIS morning,
  // which would mark it past for the entire day.
  let dayOffset = 0;
  let previousStart = -1;
  const parsed = rows.map((item) => {
    const { start, end } = parseTimeRange(item.time);
    if (start == null) return { item, startMin: null, endMin: null };

    if (start < previousStart) dayOffset += MINUTES_PER_DAY;
    previousStart = start;

    const startMin = start + dayOffset;
    return { item, startMin, endMin: end != null ? end + dayOffset : null };
  });

  // Second pass: a row without an explicit end runs until the next row starts,
  // capped at DEFAULT_BLOCK_MINUTES. This grace window is deliberate — a task
  // scheduled for 9:30 should not flip to "missed" at 9:31.
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i];
    if (row.startMin == null || row.endMin != null) continue;
    const nextStart = parsed.slice(i + 1).find((r) => r.startMin != null)?.startMin ?? null;
    const cap = row.startMin + DEFAULT_BLOCK_MINUTES;
    row.endMin = nextStart != null ? Math.min(nextStart, cap) : cap;
  }

  return parsed.map(({ item, startMin, endMin }) => {
    const kind = item.taskId ? 'task' : 'block';
    const done = kind === 'task' ? !!doneById.get(String(item.taskId)) : false;

    // Completion always wins: a task ticked after its window is done, not missed.
    if (done) {
      return { ...item, startMin, endMin, kind, state: 'done', struck: true };
    }

    // Unparseable time: never accuse the user of missing something we couldn't read.
    if (startMin == null) {
      return { ...item, startMin, endMin, kind, state: 'upcoming', struck: false };
    }

    const isPast = nowMinutes >= endMin;
    const isNow = nowMinutes >= startMin && nowMinutes < endMin;

    if (isPast) {
      // A real task that went by unticked is a miss; an Aura block is just over.
      return { ...item, startMin, endMin, kind, state: kind === 'task' ? 'missed' : 'past', struck: true };
    }
    return { ...item, startMin, endMin, kind, state: isNow ? 'now' : 'upcoming', struck: false };
  });
}

/** Index of the first row that has not started yet, or -1. Used for the now-line. */
export function firstUpcomingIndex(rows, nowMinutes = minutesOfDay()) {
  return rows.findIndex((r) => r.startMin != null && r.startMin > nowMinutes);
}

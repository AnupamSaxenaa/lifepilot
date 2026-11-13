// ─── Day Progress ────────────────────────────────────────
// Pure progress maths for the Dashboard aura, kept out of the component so the
// edge cases are testable without rendering.
//
// IMPORTANT: this deliberately does NOT re-derive which tasks "belong to
// today". An earlier version did, using due dates and list membership, and it
// disagreed with the list the Dashboard actually renders — so accounts whose
// tasks carry no due date saw no aura at all.
//
// Instead it takes the screen's own two facts:
//   • openTasks  — exactly the rows the Dashboard is showing (its "YOUR TASKS"
//                  count). Whatever rule that list uses, we inherit it.
//   • allTasks   — the full cache, used only to count what was finished today.
//
// total = still-open + completed-today. That can never disagree with the
// number on screen.
// ─────────────────────────────────────────────────────────

const dayBounds = (now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
};

const asTime = (value) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Was this task completed during today? Requires an actual completion
 * timestamp: counting every completed task ever would keep the aura
 * permanently full.
 */
export const wasCompletedToday = (task, now = new Date()) => {
  if (!task || typeof task !== 'object') return false;
  if (!task.is_completed) return false;
  const { start, end } = dayBounds(now);
  const done = asTime(task.completed_at);
  return done != null && done >= start && done <= end;
};

/**
 * @param {object} input
 * @param {Array}  input.openTasks Rows the Dashboard is displaying.
 * @param {Array}  input.allTasks  Full task cache (for completed-today).
 *
 * Edge cases:
 *  • Nothing to do → hasWork false, ratio 0. An empty day must not look like a
 *    triumphant finished one.
 *  • New tasks added later → denominator grows, ratio DROPS, aura recedes.
 *  • A task counted as open AND completed-today (mid-sync) counts once, as
 *    completed, so the ratio can't exceed 1.
 */
export const getDayProgress = ({ openTasks, allTasks } = {}, now = new Date()) => {
  const open = Array.isArray(openTasks) ? openTasks : [];
  const all = Array.isArray(allTasks) ? allTasks : [];

  const completedIds = new Set();
  all.forEach((task) => {
    if (!wasCompletedToday(task, now)) return;
    const id = task.id != null ? String(task.id) : null;
    if (id != null) completedIds.add(id);
  });

  const openIds = new Set();
  open.forEach((task) => {
    if (!task || typeof task !== 'object') return;
    if (task.is_completed || task.is_archived) return;
    const id = task.id != null ? String(task.id) : null;
    // Already banked as done today — never count the same task twice.
    if (id == null || completedIds.has(id)) return;
    openIds.add(id);
  });

  const completed = completedIds.size;
  const total = completed + openIds.size;
  const ratio = total > 0 ? completed / total : 0;

  return {
    total,
    completed,
    remaining: openIds.size,
    ratio: Math.max(0, Math.min(1, ratio)),
    hasWork: total > 0,
    isComplete: total > 0 && openIds.size === 0,
  };
};

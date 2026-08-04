/**
 * Aura world snapshot
 * ---------------------------------------------------------------------------
 * Aura used to see only the array of tasks the caller happened to pass in, so
 * it couldn't answer anything about lists, backlog, habits or momentum. This
 * builds a COMPLETE but deliberately compact picture of the user's workspace.
 *
 * Two hard rules:
 *   1. Offline-first — reads local cache only (Storage), never Supabase, so it
 *      is safe inside the AI path and works on a plane.
 *   2. Token-budgeted — every section is capped and titles are truncated. A
 *      bigger prompt costs money and *reduces* answer quality once the useful
 *      signal is buried, so this aims for a dense brief, not a data dump.
 */
import { Storage } from '../utils/storage';

// Roughly ~450 tokens. Enough for real situational awareness, small enough to
// leave room for conversation history on every provider we call.
const MAX_CONTEXT_CHARS = 1800;
const MAX_TITLE_CHARS = 46;
const CAPS = {
  overdue: 6,
  today: 8,
  soon: 6,
  backlog: 4,
  lists: 12,
  habits: 5,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const clip = (value, max = MAX_TITLE_CHARS) => {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const timeLabel = (value) => {
  try {
    return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch (_e) {
    return '';
  }
};

const dateLabel = (value) => {
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (_e) {
    return '';
  }
};

/** Priority as a short marker the model can reason about without a legend. */
const priorityTag = (task) => {
  const p = task?.priority;
  if (p === 3 || p === 'urgent') return '!!';
  if (p === 2 || p === 'high') return '!';
  return '';
};

/**
 * Bucket a task list into the shapes a planner actually cares about.
 * Anything completed is excluded except for counting momentum.
 */
const bucketTasks = (tasks) => {
  const today = startOfToday();
  const todayStr = new Date().toDateString();
  const horizon = new Date(today.getTime() + 7 * DAY_MS);

  const open = [];
  let doneToday = 0;
  let doneTotal = 0;

  for (const task of tasks) {
    if (!task) continue;
    if (task.is_completed) {
      doneTotal += 1;
      const at = task.completed_at ? new Date(task.completed_at).toDateString() : null;
      if (at === todayStr) doneToday += 1;
      continue;
    }
    open.push(task);
  }

  const overdue = [];
  const dueToday = [];
  const soon = [];
  const backlog = [];

  for (const task of open) {
    const when = task.reminder_time || task.due_date;
    if (!when) {
      if (task.added_to_today) dueToday.push(task);
      else backlog.push(task);
      continue;
    }
    const at = new Date(when);
    if (at < today) overdue.push(task);
    else if (at.toDateString() === todayStr) dueToday.push(task);
    else if (at <= horizon) soon.push(task);
    else backlog.push(task);
  }

  overdue.sort(byTime);
  dueToday.sort(byTime);
  soon.sort(byTime);

  return { open, overdue, dueToday, soon, backlog, doneToday, doneTotal };
};

const byTime = (a, b) => new Date(a.reminder_time || a.due_date || 0) - new Date(b.reminder_time || b.due_date || 0);

/** Higher wins when deciding what survives a truncated section. */
const weight = (task) => {
  const p = task?.priority;
  let score = 0;
  if (p === 3 || p === 'urgent') score += 3;
  else if (p === 2 || p === 'high') score += 2;
  if (task?.is_important) score += 1;
  return score;
};

/**
 * Choose which items to show when a section is capped.
 *
 * Sorting purely by date meant an urgent task could be pushed out by older
 * trivial chores — the exact opposite of what a planner needs to see. So the
 * SELECTION is by importance, then the OUTPUT is restored to chronological
 * order because that is how a day actually reads.
 */
const pickImportant = (items, cap) => {
  if (items.length <= cap) return items;
  return [...items]
    .sort((a, b) => weight(b) - weight(a) || byTime(a, b))
    .slice(0, cap)
    .sort(byTime);
};

/** Repeating tasks describe the user's routine — high value, low token cost. */
const summarizeHabits = (tasks) => {
  const seen = new Map();
  for (const task of tasks) {
    if (!task?.repeat_rule || task.is_completed) continue;
    const key = `${clip(task.title, 28)}|${task.repeat_rule}`;
    if (!seen.has(key)) seen.set(key, `${clip(task.title, 28)} (${task.repeat_rule})`);
    if (seen.size >= CAPS.habits) break;
  }
  return [...seen.values()];
};

const renderTask = (task, listNames, { showTime = false, showDate = false } = {}) => {
  const bits = [];
  const tag = priorityTag(task);
  if (tag) bits.push(tag);
  bits.push(clip(task.title || 'Untitled'));

  const extras = [];
  if (showTime && task.reminder_time) extras.push(timeLabel(task.reminder_time));
  if (showDate) {
    const when = task.due_date || task.reminder_time;
    if (when) extras.push(dateLabel(when));
  }
  if (task.list_id && listNames[task.list_id]) extras.push(clip(listNames[task.list_id], 18));
  if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
    const done = task.subtasks.filter((s) => s?.is_completed).length;
    extras.push(`${done}/${task.subtasks.length} steps`);
  }
  if (extras.length > 0) bits.push(`(${extras.join(', ')})`);
  return `- ${bits.join(' ')}`;
};

/**
 * Build the snapshot string.
 *
 * @param {string|null} userId
 * @param {Array}  [tasksOverride] Already-loaded tasks (skips a Storage read).
 * @returns {Promise<string>}
 */
export const buildAuraContext = async (userId, tasksOverride) => {
  try {
    const keys = userId
      ? [`tasks_${userId}`, `lists_${userId}`, `gamification_${userId}`]
      : [];
    const batch = keys.length > 0 ? await Storage.getBatch(keys) : {};

    const tasks = Array.isArray(tasksOverride) && tasksOverride.length > 0
      ? tasksOverride
      : (batch[`tasks_${userId}`] || []);
    const lists = batch[`lists_${userId}`] || [];
    const game = batch[`gamification_${userId}`] || null;

    // Cached arrays can contain junk (a null row, a list with no name) after a
    // partial sync. Normalise once here: a single bad entry used to throw and
    // wipe the ENTIRE snapshot, leaving Aura blind instead of slightly wrong.
    const safeLists = (Array.isArray(lists) ? lists : [])
      .filter((list) => list && list.id != null)
      .map((list) => ({ id: list.id, name: clip(list.name || 'Untitled list', 18) }));

    const listNames = {};
    for (const list of safeLists) listNames[list.id] = list.name;

    const b = bucketTasks(Array.isArray(tasks) ? tasks : []);

    // Open count per list so Aura can say "Work has 7 open".
    const perList = new Map();
    for (const task of b.open) {
      const key = task.list_id || '__none';
      perList.set(key, (perList.get(key) || 0) + 1);
    }

    const now = new Date();
    const sections = [];

    sections.push(`NOW: ${now.toDateString()} ${timeLabel(now)}`);

    const stats = [`open ${b.open.length}`, `done today ${b.doneToday}`];
    if (game?.streak != null) stats.push(`streak ${game.streak}`);
    if (game?.level != null) stats.push(`level ${game.level}`);
    sections.push(`STATUS: ${stats.join(' · ')}`);

    if (safeLists.length > 0) {
      const listLine = safeLists
        .slice(0, CAPS.lists)
        .map((l) => `${l.name}:${perList.get(l.id) || 0}`)
        .join(' · ');
      const inboxCount = perList.get('__none') || 0;
      sections.push(`LISTS: Inbox:${inboxCount}${listLine ? ` · ${listLine}` : ''}`);
    }

    if (b.overdue.length > 0) {
      const lines = pickImportant(b.overdue, CAPS.overdue)
        .map((t) => renderTask(t, listNames, { showDate: true }));
      const more = b.overdue.length - lines.length;
      sections.push(`OVERDUE (${b.overdue.length}):\n${lines.join('\n')}${more > 0 ? `\n- +${more} more` : ''}`);
    }

    if (b.dueToday.length > 0) {
      const lines = pickImportant(b.dueToday, CAPS.today)
        .map((t) => renderTask(t, listNames, { showTime: true }));
      const more = b.dueToday.length - lines.length;
      sections.push(`TODAY (${b.dueToday.length}):\n${lines.join('\n')}${more > 0 ? `\n- +${more} more` : ''}`);
    }

    if (b.soon.length > 0) {
      const lines = pickImportant(b.soon, CAPS.soon)
        .map((t) => renderTask(t, listNames, { showDate: true }));
      const more = b.soon.length - lines.length;
      sections.push(`NEXT 7 DAYS (${b.soon.length}):\n${lines.join('\n')}${more > 0 ? `\n- +${more} more` : ''}`);
    }

    if (b.backlog.length > 0) {
      const lines = pickImportant(b.backlog, CAPS.backlog)
        .map((t) => renderTask(t, listNames));
      const more = b.backlog.length - lines.length;
      sections.push(`UNSCHEDULED (${b.backlog.length}):\n${lines.join('\n')}${more > 0 ? `\n- +${more} more` : ''}`);
    }

    const habits = summarizeHabits(b.open);
    if (habits.length > 0) sections.push(`ROUTINES: ${habits.join(' · ')}`);

    let out = sections.join('\n');
    if (out.length > MAX_CONTEXT_CHARS) {
      // Trim from the tail: earlier sections (now/status/overdue/today) are the
      // ones a planner reasons from, so they survive a squeeze.
      out = `${out.slice(0, MAX_CONTEXT_CHARS - 24)}\n…(context trimmed)`;
    }
    return out;
  } catch (error) {
    // Degrade, don't vanish. Returning '' left Aura with zero awareness; at
    // minimum it should still know the date and how much is open.
    console.log('[AuraContext] Failed to build snapshot:', error?.message || error);
    try {
      const open = (Array.isArray(tasksOverride) ? tasksOverride : [])
        .filter((t) => t && !t.is_completed).length;
      return `NOW: ${new Date().toDateString()} ${timeLabel(new Date())}\nSTATUS: open ${open}`;
    } catch (_e) {
      return `NOW: ${new Date().toDateString()}`;
    }
  }
};

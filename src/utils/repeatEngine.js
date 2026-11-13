import { cacheTasks } from '../lib/dataManager';
import { syncToSupabase } from '../lib/syncQueue';
import { Storage } from './storage';

/**
 * Repeat Engine — Resets repeating tasks IN PLACE when they are due again.
 *
 * Model (important):
 *   A recurring task is ONE persistent row. When it becomes due again for a
 *   new period we simply flip it back to uncompleted on the SAME row. We do
 *   NOT spawn new rows and we do NOT delete anything. This is what keeps the
 *   task from duplicating and stops recurring tasks from inflating lifetime
 *   metrics (each recurring task counts as exactly one row, forever).
 *
 * Supported repeat_rule values:
 *   'daily'
 *   'weekdays'
 *   'weekly'
 *   'monthly'
 *   'yearly'
 *   'every N days/weeks/months/years'
 *   'every N weeks on Mon,Wed,Fri'
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Check if a task with the given repeat_rule should be reset today,
 * based on when it was last completed.
 */
const shouldResetToday = (task) => {
  if (!task.repeat_rule) return false;

  const rule = task.repeat_rule.toLowerCase().trim();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const dayName = DAY_NAMES[dayOfWeek];

  // When was the task last processed/created?
  // We use `completed_at` if it was completed, otherwise `last_reset_date`, `updated_at`, or `created_at`.
  const baseTimeStr = task.completed_at || task.last_reset_date || task.updated_at || task.created_at;
  const baseTime = new Date(baseTimeStr);
  const baseDate = new Date(baseTime.getFullYear(), baseTime.getMonth(), baseTime.getDate());

  // If already processed/reset today, skip
  if (baseDate.getTime() >= today.getTime()) return false;

  // ── Daily ──
  if (rule === 'daily') {
    return true;
  }

  // ── Weekdays (Mon–Fri) ──
  if (rule === 'weekdays') {
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }

  // ── Weekly ──
  if (rule === 'weekly') {
    const diffDays = Math.floor((today - baseDate) / (1000 * 60 * 60 * 24));
    return diffDays >= 7;
  }

  // ── Monthly ──
  if (rule === 'monthly') {
    // Reset if we're in a different month than when it was completed
    return (
      today.getMonth() !== baseDate.getMonth() ||
      today.getFullYear() !== baseDate.getFullYear()
    );
  }

  // ── Yearly ──
  if (rule === 'yearly') {
    return today.getFullYear() !== baseDate.getFullYear();
  }

  // ── Custom: "every N unit" or "every N unit on Day1,Day2" ──
  const customMatch = rule.match(/^every\s+(\d+)\s+(days?|weeks?|months?|years?)(.*)$/);
  if (customMatch) {
    const interval = parseInt(customMatch[1], 10);
    const unit = customMatch[2].replace(/s$/, ''); // normalize to singular
    const onDaysPart = customMatch[3].trim();

    // Check if specific days are specified: "on Mon,Wed,Fri"
    const daysMatch = onDaysPart.match(/^on\s+(.+)$/);
    const specificDays = daysMatch
      ? daysMatch[1].split(',').map(d => d.trim().charAt(0).toUpperCase() + d.trim().slice(1).toLowerCase())
      : null;

    const diffMs = today - baseDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    switch (unit) {
      case 'day':
        return diffDays >= interval;

      case 'week': {
        const weeksPassed = diffDays >= interval * 7;
        if (!weeksPassed) return false;
        // If specific days are set, only reset on those days
        if (specificDays) {
          return specificDays.includes(dayName);
        }
        return true;
      }

      case 'month': {
        const monthsDiff =
          (today.getFullYear() - baseDate.getFullYear()) * 12 +
          (today.getMonth() - baseDate.getMonth());
        return monthsDiff >= interval;
      }

      case 'year': {
        const yearsDiff = today.getFullYear() - baseDate.getFullYear();
        return yearsDiff >= interval;
      }

      default:
        return false;
    }
  }

  return false;
};

export const runRepeatEngine = async (userId) => {
  if (!userId) return false;

  // Run at most once per day per device (the reset itself is idempotent, so
  // an extra run is harmless — this is just to avoid needless work).
  const todayStr = new Date().toDateString();
  const lastRunDate = await Storage.get(`repeatEngine_lastRun_${userId}`);
  if (lastRunDate === todayStr) return false;

  try {
    // Offline-first: work off the local cache so we never lose local-only state.
    const tasks = await Storage.get(`tasks_${userId}`) || [];

    if (tasks.length === 0) {
      // Tasks probably not loaded yet — try again on the next pass.
      return false;
    }

    const tasksToReset = tasks.filter(t => shouldResetToday(t));

    if (tasksToReset.length === 0) {
      await Storage.set(`repeatEngine_lastRun_${userId}`, todayStr);
      return false;
    }

    const resetIds = new Set(tasksToReset.map(t => t.id));
    const nowISO = new Date().toISOString();

    // ── Reset each due repeating task IN PLACE (same row) ──
    // No new rows, no deletes, no stripping repeat_rule. This is what prevents
    // duplication and stops recurring tasks from inflating lifetime metrics.
    const updatedTasks = tasks.map(t => {
      if (!resetIds.has(t.id)) return t;

      // Roll the reminder time forward to today, preserving the hour/minute.
      let updatedReminder = t.reminder_time;
      if (t.reminder_time) {
        const oldRem = new Date(t.reminder_time);
        const newRem = new Date();
        newRem.setHours(oldRem.getHours(), oldRem.getMinutes(), 0, 0);
        updatedReminder = newRem.toISOString();
      }

      // Steps belong to the same recurring row, so a new period must start with
      // them unchecked too. Without this the parent flipped back to open while
      // every micro-task stayed ticked from the previous run.
      const updatedSubtasks = Array.isArray(t.subtasks) && t.subtasks.length > 0
        ? t.subtasks.map((subtask) => (
          subtask?.is_completed ? { ...subtask, is_completed: false } : subtask
        ))
        : t.subtasks;

      return {
        ...t,
        is_completed: false,
        completed_at: null,
        xp_awarded: null,           // clear so the next completion grants/deducts cleanly
        last_reset_date: nowISO,    // local-only marker (not synced) for shouldResetToday
        reminder_time: updatedReminder,
        due_date: t.due_date ? nowISO : null,
        subtasks: updatedSubtasks,
      };
    });

    // 1. Persist locally first (optimistic / offline-first).
    await cacheTasks(userId, updatedTasks);

    // 2. Queue the reset to the server through the offline sync queue (never
    //    write to Supabase directly). We only send columns that definitely
    //    exist on the tasks table — `last_reset_date` stays local-only.
    for (const t of tasksToReset) {
      const resetTask = updatedTasks.find(u => u.id === t.id);
      // Only sync real DB columns. `xp_awarded` is a local-only field (the
      // toggle flows never sync it), so we keep it out of the server payload.
      const payload = {
        is_completed: false,
        completed_at: null,
        reminder_time: resetTask ? resetTask.reminder_time : t.reminder_time,
        due_date: resetTask ? resetTask.due_date : t.due_date,
      };
      // Push the cleared steps too, but only when the task actually has any —
      // sending an empty/undefined value would wipe a column needlessly.
      if (Array.isArray(resetTask?.subtasks) && resetTask.subtasks.length > 0) {
        payload.subtasks = resetTask.subtasks;
      }
      syncToSupabase('tasks', 'update', payload, { column: 'id', value: t.id });
    }

    await Storage.set(`repeatEngine_lastRun_${userId}`, todayStr);

    console.log(`[RepeatEngine] Reset ${tasksToReset.length} repeating task(s) in place for today.`);
    return true; // signal the caller to reload/re-render
  } catch (err) {
    console.error('[RepeatEngine] Error:', err);
    return false;
  }
};

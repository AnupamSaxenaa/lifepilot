import { Storage } from './storage';
import { supabase } from '../lib/supabase';

/**
 * Repeat Engine — Resets completed repeating tasks when they are due again.
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
  if (!task.repeat_rule || !task.is_completed) return false;

  const rule = task.repeat_rule.toLowerCase().trim();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const dayName = DAY_NAMES[dayOfWeek];

  // When was the task last marked complete?
  // We use `updated_at` from supabase, or `completed_at` if we track it,
  // or fall back to the last reset date we stored.
  const lastCompletedStr = task.last_reset_date || task.updated_at || task.created_at;
  const lastCompleted = new Date(lastCompletedStr);
  const lastCompletedDate = new Date(lastCompleted.getFullYear(), lastCompleted.getMonth(), lastCompleted.getDate());

  // If already reset today, skip
  if (lastCompletedDate.getTime() >= today.getTime()) return false;

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
    const diffDays = Math.floor((today - lastCompletedDate) / (1000 * 60 * 60 * 24));
    return diffDays >= 7;
  }

  // ── Monthly ──
  if (rule === 'monthly') {
    // Reset if we're in a different month than when it was completed
    return (
      today.getMonth() !== lastCompletedDate.getMonth() ||
      today.getFullYear() !== lastCompletedDate.getFullYear()
    );
  }

  // ── Yearly ──
  if (rule === 'yearly') {
    return today.getFullYear() !== lastCompletedDate.getFullYear();
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

    const diffMs = today - lastCompletedDate;
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
          (today.getFullYear() - lastCompletedDate.getFullYear()) * 12 +
          (today.getMonth() - lastCompletedDate.getMonth());
        return monthsDiff >= interval;
      }

      case 'year': {
        const yearsDiff = today.getFullYear() - lastCompletedDate.getFullYear();
        return yearsDiff >= interval;
      }

      default:
        return false;
    }
  }

  return false;
};

/**
 * Run the repeat engine for a given user.
 * Call this once when the app loads (e.g., in DashboardScreen or TodayScreen).
 * 
 * It will:
 * 1. Load all tasks from cache
 * 2. Find completed tasks with a repeat_rule
 * 3. Check if they should be reset today
 * 4. Reset them (is_completed = false) locally and in Supabase
 * 5. Save the updated cache
 */
export const runRepeatEngine = async (userId) => {
  if (!userId) return;

  // Check if we already ran today
  const todayStr = new Date().toDateString();
  const lastRunDate = await Storage.get(`repeatEngine_lastRun_${userId}`);
  if (lastRunDate === todayStr) return; // Already processed today

  try {
    // Fetch fresh tasks from Supabase
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId);

    if (error || !tasks) return;

    const tasksToReset = tasks.filter(t => shouldResetToday(t));

    if (tasksToReset.length === 0) {
      // Nothing to reset, just mark as run
      await Storage.set(`repeatEngine_lastRun_${userId}`, todayStr);
      return;
    }

    // Reset tasks in Supabase
    const resetIds = tasksToReset.map(t => t.id);
    await supabase
      .from('tasks')
      .update({ is_completed: false, updated_at: new Date().toISOString() })
      .in('id', resetIds);

    // Update local cache
    const updatedTasks = tasks.map(t =>
      resetIds.includes(t.id) ? { ...t, is_completed: false, last_reset_date: todayStr } : t
    );
    await Storage.set(`tasks_${userId}`, updatedTasks);

    // Mark engine as run for today
    await Storage.set(`repeatEngine_lastRun_${userId}`, todayStr);

    console.log(`[RepeatEngine] Reset ${tasksToReset.length} repeating tasks for today.`);
  } catch (err) {
    console.error('[RepeatEngine] Error:', err);
  }
};

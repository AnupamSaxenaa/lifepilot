import { Storage } from './storage';
import { supabase } from '../lib/supabase';
import { cacheTasks } from '../lib/dataManager';

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
  if (!userId) return;

  // Check if we already ran today
  const todayStr = new Date().toDateString();
  const lastRunDate = await Storage.get(`repeatEngine_lastRun_${userId}`);
  if (lastRunDate === todayStr) return; // Already processed today

  try {
    // 🔴 Use local cache instead of fetching from Supabase directly
    // This preserves all offline-first state and local-only fields
    const tasks = await Storage.get(`tasks_${userId}`) || [];

    if (tasks.length === 0) {
      // If tasks are empty, we might not have loaded them yet. Wait until next time.
      return;
    }

    const tasksToReset = tasks.filter(t => shouldResetToday(t));

    if (tasksToReset.length === 0) {
      // Nothing to reset, just mark as run
      await Storage.set(`repeatEngine_lastRun_${userId}`, todayStr);
      return;
    }

    const oldTaskUpdates = [];
    const newTasksToInsert = [];
    const nowISO = new Date().toISOString();

    for (const t of tasksToReset) {
      // Mark the old task as completed (so it doesn't duplicate) and strip its repeat_rule
      oldTaskUpdates.push({
        id: t.id,
        repeat_rule: null,
        is_completed: true,
        completed_at: nowISO,
      });

      let updatedReminder = null;
      if (t.reminder_time) {
        const oldRem = new Date(t.reminder_time);
        const newRem = new Date();
        newRem.setHours(oldRem.getHours(), oldRem.getMinutes(), 0, 0);
        updatedReminder = newRem.toISOString();
      }

      const newTask = {
        ...t,
        is_completed: false,
        completed_at: null,
        created_at: nowISO,
        due_date: t.due_date ? nowISO : null,
        reminder_time: updatedReminder,
        added_to_today: t.added_to_today, // carry over today flag
        repeat_rule: t.repeat_rule, // carry over the repeat tag (daily/weekly/etc)
      };
      
      const generateUUID = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };
      
      newTask.id = generateUUID(); // Assign a valid UUID
      delete newTask.last_reset_date; // Remove just in case t has it, to prevent insert error
      newTasksToInsert.push(newTask);
    }

    // 1. Mark old tasks as completed and clear their repeat_rule
    for (const update of oldTaskUpdates) {
      await supabase
        .from('tasks')
        .update({ repeat_rule: null, is_completed: true, completed_at: nowISO })
        .eq('id', update.id);
    }

    // 2. Insert new tasks
    const { data: insertedTasks, error: insertError } = await supabase
      .from('tasks')
      .insert(newTasksToInsert)
      .select();

    if (insertError) {
      console.error('[RepeatEngine] Insert Error:', insertError);
      return;
    }

    // 3. Update local cache
    const oldIds = oldTaskUpdates.map(u => u.id);
    // 🔴 Read the freshest cache again just in case it was updated while we awaited supabase!
    const freshTasks = await Storage.get(`tasks_${userId}`) || tasks;
    
    const updatedTasks = freshTasks.map(t =>
      oldIds.includes(t.id) ? { ...t, repeat_rule: null, is_completed: true, completed_at: nowISO } : t
    );
    
    if (insertedTasks && insertedTasks.length > 0) {
      updatedTasks.push(...insertedTasks);
    }

    await cacheTasks(userId, updatedTasks);

    // Mark engine as run for today
    await Storage.set(`repeatEngine_lastRun_${userId}`, todayStr);

    console.log(`[RepeatEngine] Spawned ${insertedTasks?.length || 0} new repeating tasks for today.`);
    return insertedTasks?.length > 0;
  } catch (err) {
    console.error('[RepeatEngine] Error:', err);
    return false;
  }
};

import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { Storage } from '../utils/storage';
import { PlannerWidget } from './PlannerWidget';
import { TodayTasksWidget } from './TodayTasksWidget';

/**
 * Every widget this app can render, keyed by the `name` declared in app.json's
 * `react-native-android-widget` plugin config. Adding a widget means adding a
 * line here plus an entry in app.json — nothing else in this file changes.
 */
const WIDGETS = {
  TodayTasksWidget,
  PlannerWidget,
};

/**
 * Re-render whichever widget instance was actually interacted with.
 *
 * This used to be a hand-repeated `if (widgetInfo.widgetName === 'TodayTasksWidget')`
 * block after every mutation, which silently meant a second widget would never
 * redraw after a toggle. Dispatching by name fixes that for all widgets at once.
 */
async function redraw(props) {
  const { widgetInfo, renderWidget } = props;
  const Widget = WIDGETS[widgetInfo?.widgetName];
  if (!Widget) return;
  const rendered = await Widget(props);
  renderWidget(rendered);
}

export async function widgetTaskHandler(props) {
  const { widgetAction, clickAction, clickActionData } = props;

  try {
    if (
      widgetAction === 'WIDGET_ADDED' ||
      widgetAction === 'WIDGET_UPDATE' ||
      widgetAction === 'WIDGET_RESIZED'
    ) {
      await redraw(props);
    } else if (widgetAction === 'WIDGET_CLICK' && clickAction === 'CUSTOM_ACTION') {
      if (clickActionData && clickActionData.action === 'TOGGLE_WIDGET_SETTINGS') {
        const current = await Storage.get('widget_settings_open');
        const newVal = current === 'true' ? 'false' : 'true';
        await Storage.set('widget_settings_open', newVal);
        await redraw(props);
      } else if (clickActionData && clickActionData.action === 'SET_OPACITY') {
        await Storage.set('widget_bg_opacity', clickActionData.value);
        await redraw(props);
      } else if (clickActionData && clickActionData.action === 'TOGGLE_HIDE_COMPLETED') {
        const current = await Storage.get('widget_hide_completed');
        const newVal = current === 'true' ? 'false' : 'true';
        await Storage.set('widget_hide_completed', newVal);
        await redraw(props);
      } else if (clickActionData && clickActionData.action === 'TOGGLE_TASK') {
        const { taskId, currentStatus } = clickActionData;
        const userId = await Storage.get('current_user_id');
        if (userId) {
          // --- STEP 1: INSTANT OPTIMISTIC UPDATE ---
          const statusBool = currentStatus === 'true' || currentStatus === true;
          const newStatus = !statusBool;
          const completedAt = newStatus ? new Date().toISOString() : null;

          // Re-read storage RIGHT NOW to avoid stale closures if tapped rapidly
          const allTasks = await Storage.get(`tasks_${userId}`) || [];
          const updatedTasks = allTasks.map(t =>
            t.id === taskId ? { ...t, is_completed: newStatus, completed_at: completedAt } : t
          );

          // Update local cache, and tell the app a local write happened so it
          // doesn't overwrite us with stale Supabase data while it's open.
          // One multiSet rather than two sequential writes — the user is waiting
          // on this before the widget can redraw.
          await Storage.setBatch([
            [`tasks_${userId}`, updatedTasks],
            ['last_local_write_time', Date.now().toString()],
          ]);

          // --- STEP 2: INSTANT REDRAW ---
          await redraw(props);

          // --- STEP 3: DURABLE ENQUEUE (no inline network) ---
          // Widget click tasks are serialized by Android, so we must NOT block
          // on a Supabase round-trip here or the next tap (e.g. the steps
          // dropdown) stalls behind it. Persist to the sync queue instantly;
          // the app's normal drain triggers (launch/focus/reconnect) push it.
          const { enqueueMutation } = require('../lib/syncQueue');
          await enqueueMutation('tasks', 'update',
            { is_completed: newStatus, completed_at: completedAt },
            { column: 'id', value: taskId }
          );
          // Note: redraw above already updated the tapped instance, so we
          // deliberately skip a second full updateAllWidgets() pass here to
          // keep the headless task short and the widget responsive.
        }
      } else if (clickActionData && clickActionData.action === 'TOGGLE_SUBTASK') {
        // Tick/untick a single step (subtask) directly from the widget.
        const { taskId, subId } = clickActionData;
        const userId = await Storage.get('current_user_id');
        if (userId) {
          const allTasks = await Storage.get(`tasks_${userId}`) || [];
          let nextSubtasks = null;
          const updatedTasks = allTasks.map((t) => {
            if (t.id !== taskId || !Array.isArray(t.subtasks)) return t;
            nextSubtasks = t.subtasks.map((s) =>
              s.id === subId ? { ...s, is_completed: !s.is_completed } : s
            );
            return { ...t, subtasks: nextSubtasks };
          });

          // One multiSet rather than two sequential writes (see TOGGLE_TASK).
          await Storage.setBatch([
            [`tasks_${userId}`, updatedTasks],
            ['last_local_write_time', Date.now().toString()],
          ]);

          await redraw(props);

          if (nextSubtasks) {
            // Durable enqueue only — no inline network (see TOGGLE_TASK note).
            const { enqueueMutation } = require('../lib/syncQueue');
            await enqueueMutation('tasks', 'update', { subtasks: nextSubtasks }, { column: 'id', value: taskId });
          }
          // redraw above already updated this instance; skip a second
          // full updateAllWidgets() pass to keep the widget snappy.
        }
      } else if (clickActionData && clickActionData.action === 'TOGGLE_EXPAND_TASK') {
        // Expand/collapse a task's steps.
        //
        // Only ONE task is open at a time. That is partly a UX call (a widget is
        // short, and several open step lists push everything else off-screen) and
        // partly a latency one: storing a single id means the toggle is a plain
        // write. The previous array required read-modify-write, so every tap paid
        // for an extra AsyncStorage round-trip before anything could redraw.
        const { taskId, expanded } = clickActionData;
        const isExpanded = expanded === 'true' || expanded === true;
        await Storage.set('widget_expanded_task', isExpanded ? '' : String(taskId));

        await redraw(props);
      }
    }
  } catch (err) {
    console.error('[Widgets] widgetTaskHandler Error:', err);
  }
}

export function registerAllWidgets() {
  try {
    if (typeof registerWidgetTaskHandler === 'function') {
      registerWidgetTaskHandler(widgetTaskHandler);
      console.log('[Widgets] WidgetTaskHandler registered successfully');
    } else {
      console.log('[Widgets] Widget API not available');
    }
  } catch (err) {
    console.error('[Widgets] Failed to register handler:', err);
  }
}

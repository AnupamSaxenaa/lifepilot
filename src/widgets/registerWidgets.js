import React from 'react';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { TodayTasksWidget } from './TodayTasksWidget';
import { Storage } from '../utils/storage';

export async function widgetTaskHandler(props) {
  const { widgetInfo, widgetAction, clickAction, clickActionData, renderWidget } = props;
  
  try {
    if (
      widgetAction === 'WIDGET_ADDED' ||
      widgetAction === 'WIDGET_UPDATE' ||
      widgetAction === 'WIDGET_RESIZED'
    ) {
      if (widgetInfo.widgetName === 'TodayTasksWidget') {
        const widget = await TodayTasksWidget(props);
        renderWidget(widget);
      }
    } else if (widgetAction === 'WIDGET_CLICK' && clickAction === 'CUSTOM_ACTION') {
      if (clickActionData && clickActionData.action === 'CYCLE_OPACITY') {
        const currentOpacity = await Storage.get('widget_bg_opacity') || '100';
        let nextOpacity = '100';
        if (currentOpacity === '100') nextOpacity = '75';
        else if (currentOpacity === '75') nextOpacity = '50';
        else if (currentOpacity === '50') nextOpacity = '25';
        else if (currentOpacity === '25') nextOpacity = '0';
        else if (currentOpacity === '0') nextOpacity = '100';
        
        await Storage.set('widget_bg_opacity', nextOpacity);
        
        if (widgetInfo.widgetName === 'TodayTasksWidget') {
          const widget = await TodayTasksWidget(props);
          renderWidget(widget);
        }
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
          
          // Update local cache
          await Storage.set(`tasks_${userId}`, updatedTasks);
          
          // CRITICAL BUG FIX: Tell the app a local write happened so it doesn't overwrite us with stale Supabase data if the app is open
          await Storage.set('last_local_write_time', Date.now().toString());
          
          // --- STEP 2: INSTANT REDRAW ---
          if (widgetInfo.widgetName === 'TodayTasksWidget') {
            const widget = await TodayTasksWidget(props);
            renderWidget(widget);
          }

          // --- STEP 3: BACKGROUND SYNC (Heavy imports delayed) ---
          const { syncToSupabase } = require('../lib/syncQueue');
          await syncToSupabase('tasks', 'update',
            { is_completed: newStatus, completed_at: completedAt },
            { column: 'id', value: taskId }
          );
          
          // Trigger global native widget update in case there are multiple widget instances
          const { updateAllWidgets } = require('../utils/widgetUpdater');
          await updateAllWidgets();
        }
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

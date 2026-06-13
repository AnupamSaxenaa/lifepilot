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
      if (clickActionData && clickActionData.action === 'TOGGLE_TASK') {
        const { taskId, currentStatus } = clickActionData;
        const userId = await Storage.get('current_user_id');
        if (userId) {
          const allTasks = await Storage.get(`tasks_${userId}`) || [];
          
          // 1. OPTIMISTIC UPDATE: Do this instantly without importing Supabase/dataManager
          const statusBool = currentStatus === 'true' || currentStatus === true;
          const newStatus = !statusBool;
          const completedAt = newStatus ? new Date().toISOString() : null;
          const updatedTasks = allTasks.map(t =>
            t.id === taskId ? { ...t, is_completed: newStatus, completed_at: completedAt } : t
          );
          await Storage.set(`tasks_${userId}`, updatedTasks);
          
          // 2. INSTANT REDRAW: Tell Android to render the new widget state immediately
          if (widgetInfo.widgetName === 'TodayTasksWidget') {
            const widget = await TodayTasksWidget(props);
            renderWidget(widget);
          }

          // 3. BACKGROUND SYNC: Dynamically import heavy dependencies ONLY AFTER rendering
          // This saves ~500ms of JS engine blocking time!
          const { toggleTaskCompletion } = require('../lib/dataManager');
          await toggleTaskCompletion(userId, allTasks, taskId, statusBool);
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

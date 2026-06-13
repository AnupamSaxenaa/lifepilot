import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { TodayTasksWidget } from '../widgets/TodayTasksWidget';
import { StatsWidget } from '../widgets/StatsWidget';

/**
 * Update all widgets when tasks/stats change
 * Call this after:
 * - Creating a task
 * - Completing a task
 * - Deleting a task
 * - Updating XP/streak
 */
export async function updateAllWidgets() {
  // Only on Android
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    console.log('[Widgets] Updating all widgets...');

    // Update Today Tasks Widget
    const todayWidget = await TodayTasksWidget({});
    await requestWidgetUpdate({
      widgetName: 'TodayTasksWidget',
      renderWidget: () => todayWidget,
      widgetId: 'all', // Update all instances
    });

    // Update Stats Widget
    const statsWidget = await StatsWidget({});
    await requestWidgetUpdate({
      widgetName: 'StatsWidget',
      renderWidget: () => statsWidget,
      widgetId: 'all',
    });

    console.log('[Widgets] ✅ All widgets updated');
  } catch (error) {
    // Don't crash app if widget update fails
    console.warn('[Widgets] Failed to update widgets:', error);
  }
}

/**
 * Update only Today Tasks Widget
 * Lighter alternative when only tasks changed
 */
export async function updateTodayWidget() {
  if (Platform.OS !== 'android') return;

  try {
    const todayWidget = await TodayTasksWidget({});
    await requestWidgetUpdate({
      widgetName: 'TodayTasksWidget',
      renderWidget: () => todayWidget,
      widgetId: 'all',
    });
  } catch (error) {
    console.warn('[Widgets] Failed to update Today widget:', error);
  }
}

/**
 * Update only Stats Widget
 * Use when XP/streak changes but tasks don't
 */
export async function updateStatsWidget() {
  if (Platform.OS !== 'android') return;

  try {
    const statsWidget = await StatsWidget({});
    await requestWidgetUpdate({
      widgetName: 'StatsWidget',
      renderWidget: () => statsWidget,
      widgetId: 'all',
    });
  } catch (error) {
    console.warn('[Widgets] Failed to update Stats widget:', error);
  }
}

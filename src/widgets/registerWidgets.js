import { registerWidgetConfigProvider } from 'react-native-android-widget';
import { QuickAddWidget } from './QuickAddWidget';
import { StatsWidget } from './StatsWidget';
import { TodayTasksWidget } from './TodayTasksWidget';

/**
 * Register all LifePilot widgets
 * Called on app startup (App.js)
 * 
 * NOTE: Widget registration only works in production APK builds.
 * In development mode (Expo Go/dev client), this will safely skip.
 */
export function registerAllWidgets() {
  try {
    console.log('[Widgets] Registering all widgets...');

    // Check if registerWidgetConfigProvider is available (production builds only)
    if (typeof registerWidgetConfigProvider !== 'function') {
      console.log('[Widgets] ⚠️ Widget API not available (dev mode). Widgets will work in production APK.');
      return;
    }

    // Register Today Tasks Widget
    registerWidgetConfigProvider({
      widgetName: 'TodayTasksWidget',
      widgetComponent: TodayTasksWidget,
      updateInterval: 15 * 60 * 1000, // Update every 15 minutes
      widgetFeatures: {
        clickToUpdate: true, // Allow manual refresh by tapping
        hideOnLockScreen: false, // Show on lock screen
        lockOnPortrait: false, // Allow landscape
      },
    });
    console.log('[Widgets] ✅ TodayTasksWidget registered');

    // Register Quick Add Widget
    registerWidgetConfigProvider({
      widgetName: 'QuickAddWidget',
      widgetComponent: QuickAddWidget,
      updateInterval: 0, // No auto-update needed (static button)
      widgetFeatures: {
        clickToUpdate: false,
        hideOnLockScreen: false,
        lockOnPortrait: false,
      },
    });
    console.log('[Widgets] ✅ QuickAddWidget registered');

    // Register Stats Widget
    registerWidgetConfigProvider({
      widgetName: 'StatsWidget',
      widgetComponent: StatsWidget,
      updateInterval: 30 * 60 * 1000, // Update every 30 minutes
      widgetFeatures: {
        clickToUpdate: true,
        hideOnLockScreen: false,
        lockOnPortrait: false,
      },
    });
    console.log('[Widgets] ✅ StatsWidget registered');

    console.log('[Widgets] All widgets registered successfully!');
  } catch (error) {
    console.error('[Widgets] Failed to register widgets:', error);
  }
}

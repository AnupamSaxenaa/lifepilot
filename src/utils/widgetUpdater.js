import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { PlannerWidget } from '../widgets/PlannerWidget';
import { TodayTasksWidget } from '../widgets/TodayTasksWidget';

/**
 * Push a fresh render to the home-screen widgets. Called after any task/list/
 * theme/settings/plan change so widgets reflect the app within milliseconds
 * while the app is running (the app → widget half of the two-way sync).
 *
 * Widgets are rendered with no explicit size — they use `match_parent` and flex
 * weights throughout, so Android lays them out correctly to whatever bounds
 * each instance actually has.
 *
 * `widgetId: 'all'` is a no-op when a widget isn't on the home screen, so it is
 * safe to push to every widget unconditionally.
 */
const RENDERERS = [
  ['TodayTasksWidget', TodayTasksWidget],
  ['PlannerWidget', PlannerWidget],
];

export async function updateAllWidgets() {
  if (Platform.OS !== 'android') return;
  // Run in parallel: `dataManager` awaits this on every task mutation, so doing
  // the widgets one after another would add each one's render to that hot path.
  // `allSettled` also means one failing widget can't stop the others.
  await Promise.allSettled(
    RENDERERS.map(async ([widgetName, Widget]) => {
      try {
        const el = await Widget({});
        await requestWidgetUpdate({
          widgetName,
          renderWidget: () => el,
          widgetId: 'all', // update every instance on the home screen
        });
      } catch (error) {
        // Never crash the app because a widget refresh failed.
        console.warn(`[Widgets] Failed to update ${widgetName}:`, error?.message || error);
      }
    })
  );
}

/** Back-compat alias — some call sites use this name. */
export const updateTodayWidget = updateAllWidgets;

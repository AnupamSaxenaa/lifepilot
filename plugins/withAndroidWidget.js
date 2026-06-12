const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin to add Android Widget support
 * This modifies AndroidManifest.xml and adds widget files
 */
const withAndroidWidget = (config) => {
  // Step 1: Add widget receiver to AndroidManifest
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    
    // Add widget receiver
    if (!manifest.application[0].receiver) {
      manifest.application[0].receiver = [];
    }

    // Add Today Tasks Widget
    manifest.application[0].receiver.push({
      $: {
        'android:name': '.widget.TodayTasksWidget',
        'android:exported': 'false',
      },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } },
          ],
        },
      ],
      'meta-data': [
        {
          $: {
            'android:name': 'android.appwidget.provider',
            'android:resource': '@xml/today_tasks_widget_info',
          },
        },
      ],
    });

    return config;
  });

  return config;
};

module.exports = withAndroidWidget;

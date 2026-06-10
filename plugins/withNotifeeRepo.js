const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withNotifeeRepo(config) {
  return withProjectBuildGradle(config, async (config) => {
    const buildGradle = config.modResults.contents;
    
    // Check if it already exists
    if (buildGradle.includes('@notifee/react-native/android/libs')) {
      return config;
    }

    const repoString = `maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }`;
    
    // Inject it into allprojects { repositories { ... } }
    const newContents = buildGradle.replace(
      /allprojects\s*{\s*repositories\s*{/,
      `allprojects {\n    repositories {\n        ${repoString}`
    );

    config.modResults.contents = newContents;
    return config;
  });
};

export default ({ config }) => {
  // If we are running a development build via EAS (APP_VARIANT=development)
  if (process.env.APP_VARIANT === 'development') {
    return {
      ...config,
      name: 'LifePilot',
      scheme: [
        'lifepilot',
        'com.anupam.lp',
        'com.googleusercontent.apps.753694130355-8bhkicmdd6qqu9esu09qo5c9dv8ab3vi'
      ],
      ios: {
        ...config.ios,
        bundleIdentifier: 'com.anupam.lp',
      },
      android: {
        ...config.android,
        package: 'com.anupam.lp',
      },
    };
  }

  // Production and Preview default settings (Beta / Production App)
  return {
    ...config,
    name: 'LifePilot',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.anupam.lp',
    },
    android: {
      ...config.android,
      package: 'com.anupam.lp',
    },
  };
};

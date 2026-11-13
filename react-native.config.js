const isPublicStoreBuild = process.env.APP_VARIANT === 'store';

module.exports = isPublicStoreBuild
  ? {
      dependencies: {
        // The public APK removes NFC permissions and alarm features. Excluding
        // the native package also prevents its lifecycle listener from calling
        // NFC APIs when Android pauses LifePilot to show a permission dialog.
        'react-native-nfc-manager': {
          platforms: { android: null, ios: null },
        },
      },
    }
  : {};

// Jest config for LifePilot.
//
// The alarm logic under test (recurrence engine, alarm model) is PURE
// JavaScript with no React Native imports, so we deliberately avoid the
// jest-expo/react-native preset (which is version-sensitive and unnecessary
// here) and just transform ESM with babel via the project's babel config.
// Component/native tests, if ever needed, can use a separate project entry.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(test).js'],
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
  moduleNameMapper: {
    '\\.(wav|mp3|m4a|aac|ogg)$': '<rootDir>/test/fileMock.js',
  },
};

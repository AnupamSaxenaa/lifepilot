// LifePilot ESLint flat config.
//
// Expo's `expo lint` defaults to src/ only. That missed App.js (the actual entry
// point) and all config/plugins/release scripts, while `eslint .` went too far and
// linted a complete .kilo worktree, archived snapshots and Supabase Deno functions
// as if they were React Native. The package script now passes an explicit release
// allowlist; these global ignores are defense-in-depth for editors and accidental
// root scans.
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

const testFiles = [
  '**/*.test.{js,jsx,ts,tsx}',
  'test/**/*.{js,jsx,ts,tsx}',
];

module.exports = defineConfig([
  globalIgnores([
    // Agent/editor state and nested full checkouts.
    '.kilo/**',
    '.kiro/**',
    '.claude/**',
    '.vscode/**',

    // Historical snapshots, generated native trees, caches and outputs.
    'docs/archive/**',
    '.expo/**',
    'android/**',
    'ios/**',
    'dist/**',
    'dist-build-check/**',
    'web-build/**',
    'release/**',
    'coverage/**',

    // Supabase functions run on Deno and use URL imports; Expo's Node resolver
    // cannot lint them correctly. They need `deno lint`, not suppressed Node
    // resolver errors. Generated legal pages are covered by npm run check.
    'supabase/functions/**',
    'supabase/.temp/**',
    'supabase/.migration-hold/**',
  ], 'lifepilot/non-release-inputs'),

  // Keep Expo's complete React/React Native rule set for App.js and src/**.
  expoConfig,

  {
    name: 'lifepilot/node-runtime',
    files: [
      'app.config.js',
      '*.config.js',
      'scripts/**/*.{js,cjs,mjs}',
      'tools/**/*.{js,cjs,mjs}',
      'plugins/**/*.{js,cjs,mjs}',
      'test/**/*.{js,cjs,mjs}',
      ...testFiles,
    ],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    name: 'lifepilot/jest',
    files: testFiles,
    languageOptions: {
      globals: globals.jest,
    },
  },
]);

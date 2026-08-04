// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Jest globals for test files. Flat config ignores `/* eslint-env jest */`
    // comments, so every *.test.js was reporting `describe`/`it`/`expect` as
    // undefined — hundreds of errors that buried real ones.
    files: ["**/*.test.js", "**/*.test.jsx", "test/**/*.js"],
    languageOptions: {
      globals: {
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
  }
]);

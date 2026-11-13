#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Writes the Mindful Lock Kotlin sources from plugins/appBlockerSources.js into
// an existing android/ prebuild, so you can `./gradlew assembleRelease` (or run
// a dev client) after editing the plugin without doing a full `expo prebuild`.
//
//   node scripts/sync-appblocker-native.js
//
// `expo prebuild` runs plugins/withAppBlocker.js which writes the exact same
// content, so the two can never drift.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { kotlinSources, ACCESSIBILITY_SERVICE_CONFIG } = require('../plugins/appBlockerSources');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android');

if (!fs.existsSync(ANDROID_DIR)) {
  console.error('android/ not found — run `npx expo prebuild -p android` first.');
  process.exit(1);
}

// Resolve the Android package name the same way the build does: read it out of
// the generated MainApplication.kt so we can't guess wrong.
const javaRoot = path.join(ANDROID_DIR, 'app/src/main/java');
const findMainApplication = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainApplication(full);
      if (found) return found;
    } else if (entry.name === 'MainApplication.kt') {
      return full;
    }
  }
  return null;
};

const mainApplicationPath = findMainApplication(javaRoot);
if (!mainApplicationPath) {
  console.error('Could not locate MainApplication.kt under android/app/src/main/java.');
  process.exit(1);
}

const packageMatch = fs.readFileSync(mainApplicationPath, 'utf8').match(/package\s+([\w.]+)/);
if (!packageMatch) {
  console.error(`Could not read the package name from ${mainApplicationPath}.`);
  process.exit(1);
}
const packageName = packageMatch[1];
const srcDir = path.dirname(mainApplicationPath);

const written = [];

Object.entries(kotlinSources(packageName)).forEach(([fileName, contents]) => {
  const target = path.join(srcDir, fileName);
  fs.writeFileSync(target, contents);
  written.push(path.relative(ROOT, target));
});

const xmlDir = path.join(ANDROID_DIR, 'app/src/main/res/xml');
fs.mkdirSync(xmlDir, { recursive: true });
const xmlTarget = path.join(xmlDir, 'accessibility_service_config.xml');
fs.writeFileSync(xmlTarget, ACCESSIBILITY_SERVICE_CONFIG);
written.push(path.relative(ROOT, xmlTarget));

console.log(`Synced AppBlocker native sources for package ${packageName}:`);
written.forEach((file) => console.log(`  ${file}`));

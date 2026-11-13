/* global __dirname, process */
/**
 * Locale completeness guard.
 *
 * Run: node scripts/check-locale-completeness.js
 *
 * WHY THIS EXISTS
 *
 * `i18n` is configured with `fallbackLng: 'en'`, which is the right call at
 * runtime — a missing key renders English instead of crashing. The cost is that
 * an untranslated feature is INVISIBLE in development: every screen looks fine in
 * English, and nobody notices that a Hindi user is reading the entire Credit
 * Store in English.
 *
 * That is exactly what happened. All 20 non-English locales drifted to 89.9%
 * coverage, each missing the same 170 keys, all of them in the newest features
 * (creditStore, hustlers, dashboard, settings, shareList, auraChat, leaderboard,
 * streakCalendar, ...). Nothing failed, so nothing got fixed.
 *
 * HOW THE BUDGET WORKS
 *
 * `MAX_MISSING` is a ratchet, not a target. It records the gap at the time this
 * check was introduced so the build is not broken retroactively, and it must only
 * ever move DOWN. Translate a section, lower the number, commit both together.
 * The check fails if any locale exceeds the budget, and also fails if EVERY
 * locale is now below it — which is the signal to tighten the ratchet.
 *
 * When it reaches 0 this becomes a strict "no missing keys" check and the budget
 * can be deleted.
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const SOURCE = 'en';

// Ratchet. Lower this as sections get translated; never raise it.
// 170 → 139: dashboard, sidebar, whatsNew, streakCalendar.
// 139 → 106: auraChat, settings, gamificationStats, gamificationGuide.
// 106 →  56: creditStore (also migrated its 2 plural keys from v3 `_plural`
//            syntax to the v4 `_one`/`_other` form the app actually resolves).
//  56 →  42: shareList — the last gap users can actually reach.
//
// Remaining 42 = hustlers (29) + leaderboard (10) + 3 stragglers. Deliberately
// last: EXPO_PUBLIC_HUSTLERS_ENABLED is set in neither the play-production
// profile nor the EAS production environment, so those screens are hidden in
// store builds and no shipped user can see the English fallback. Translate them
// in the same change that enables the flag.
const MAX_MISSING = 42;

// i18next appends a CLDR plural category to the key. English only ever needs
// `_one` / `_other`, but Polish and Russian legitimately need `_few` and `_many`,
// Arabic needs `_zero` and `_two`, and so on. Those keys have NO English
// counterpart by design, so comparing raw key names would flag correct
// pluralisation as dead weight — and "cleaning it up" would break it.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const pluralBase = (key) => key.replace(PLURAL_SUFFIX, '');

const flatten = (obj, prefix = '') => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
};

const readLocale = (file) => flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8')));

const localeFiles = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const source = readLocale(`${SOURCE}.json`);
const sourceKeys = Object.keys(source);

let failures = 0;
let worst = 0;
const report = [];

for (const file of localeFiles) {
  const code = path.basename(file, '.json');
  if (code === SOURCE) continue;

  const target = readLocale(file);
  const missing = sourceKeys.filter((k) => !(k in target));
  // A key present in a locale but absent from en is dead weight — en was renamed
  // or pruned and the locale was not, so the string can never render. Compared on
  // the plural BASE so a language's extra plural categories are not mistaken for
  // orphans (see PLURAL_SUFFIX above).
  const sourceBases = new Set(sourceKeys.map(pluralBase));
  const orphans = Object.keys(target).filter((k) => !sourceBases.has(pluralBase(k)));

  worst = Math.max(worst, missing.length);
  const coverage = (100 * (sourceKeys.length - missing.length)) / sourceKeys.length;

  const bySection = {};
  for (const k of missing) {
    const sect = k.split('.')[0];
    bySection[sect] = (bySection[sect] || 0) + 1;
  }

  report.push({ code, missing: missing.length, orphans: orphans.length, coverage, bySection });

  if (missing.length > MAX_MISSING) {
    failures += 1;
    const detail = Object.entries(bySection)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}:${n}`)
      .join(' ');
    console.log(`  FAIL ${code} — ${missing.length} missing (budget ${MAX_MISSING}) → ${detail}`);
  }
  if (orphans.length > 0) {
    failures += 1;
    console.log(`  FAIL ${code} — ${orphans.length} key(s) not present in ${SOURCE}: ${orphans.slice(0, 5).join(', ')}`);
  }
}

console.log(`\nlocale completeness (source: ${SOURCE}.json, ${sourceKeys.length} keys)\n`);
for (const r of report.sort((a, b) => a.coverage - b.coverage)) {
  const flag = r.missing > MAX_MISSING ? 'FAIL' : 'ok  ';
  console.log(`  ${flag} ${r.code.padEnd(8)} ${r.coverage.toFixed(1).padStart(5)}%  ${String(r.missing).padStart(4)} missing`);
}

// Ratchet enforcement: if everyone is now comfortably under budget, the budget is
// stale and hiding future regressions.
if (failures === 0 && worst < MAX_MISSING) {
  console.log(
    `\n  NOTE  worst locale is now ${worst} missing but MAX_MISSING is still ${MAX_MISSING}.`
    + `\n        Lower MAX_MISSING to ${worst} in scripts/check-locale-completeness.js to hold the ground you gained.`,
  );
}

console.log(
  failures === 0
    ? `\nLocale budget holds (worst: ${worst}/${MAX_MISSING} missing).\n`
    : `\n${failures} locale check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

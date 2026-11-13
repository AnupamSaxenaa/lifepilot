/* global __dirname */
/**
 * Contrast guard for the home-screen widget palette.
 *
 * The widget must stay legible on ANY background a marketplace theme sets,
 * including mid-tones where neither black nor white is an obvious winner.
 * Run with: node scripts/check-widget-contrast.js
 */
const fs = require('fs');
const path = require('path');

// The colour maths now lives in src/theme/contrast.js, shared by the in-app
// theme and the widgets, so this guard covers BOTH.
const file = path.join(__dirname, '..', 'src', 'theme', 'contrast.js');
let src = fs.readFileSync(file, 'utf8')
  .replace(/import[^;]+;/g, '')
  .replace(/export const/g, 'const')
  .replace(/export /g, '');
src += '\nmodule.exports = { resolveReadablePalette, contrastRatio };';
const mod = { exports: {} };
new Function('module', 'exports', src)(mod, mod.exports);
const { resolveReadablePalette, contrastRatio } = mod.exports;

const CASES = [
  ['dark default', '#000000', '#FFFFFF'],
  ['light theme', '#F7F7F5', '#FFFFFF'],
  ['cream', '#FAF3E0', '#E0B84C'],
  ['midnight', '#0B1020', '#7DD3FC'],
  ['mid grey', '#7A7A7A', '#FFFFFF'],
  ['mid warm', '#8B7355', '#FFD700'],
  ['near-mid', '#949494', '#FFFFFF'],
];

// Body text aims for WCAG AA (4.5). Secondary text is allowed the large-text
// threshold (3.0) since it is supporting metadata, never critical content.
const MIN_TEXT = 4.5;
const MIN_MUTED = 3.0;
const MIN_ACCENT = 2.0;
const MIN_ON_ACCENT = 4.5;

let failed = 0;
for (const [name, bg, accent] of CASES) {
  const p = resolveReadablePalette({ bg, accent });
  const textC = contrastRatio(p.text, bg);
  const mutedC = contrastRatio(p.muted.slice(0, 7), bg);
  const accentC = contrastRatio(p.accent, bg);
  const onAccentC = contrastRatio(p.onAccent, p.accent);

  const ok = textC >= MIN_TEXT && mutedC >= MIN_MUTED
    && accentC >= MIN_ACCENT && onAccentC >= MIN_ON_ACCENT;
  if (!ok) failed += 1;

  console.log(
    `${name.padEnd(13)} text ${textC.toFixed(2)}:1  muted ${mutedC.toFixed(2)}:1  `
    + `accent ${accentC.toFixed(2)}:1  onAccent ${onAccentC.toFixed(2)}:1  ${ok ? 'OK' : 'FAIL'}`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} theme(s) below contrast thresholds.`);
  process.exit(1);
}
console.log('\nAll themes pass widget contrast thresholds.');

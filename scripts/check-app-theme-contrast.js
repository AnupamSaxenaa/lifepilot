/* global __dirname */
/**
 * Contrast guard for the IN-APP theme (not just the widgets).
 *
 * Run: node scripts/check-app-theme-contrast.js
 *
 * A marketplace theme only supplies bg/surface/accent. The app used to keep
 * `text`/`textMuted`/glass colours at their dark-mode values regardless, so
 * equipping a light theme produced near-white text on a near-white background —
 * invisible labels and buttons. This checks the derivation that replaced it, for
 * every background shape a theme can realistically set.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const load = (rel, exports) => {
  const src = fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^\s*export\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, '')
    .replace(/export const/g, 'const')
    .replace(/^export /gm, '');
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${src}\nmodule.exports = { ${exports} };`)(mod, mod.exports);
  return mod.exports;
};

const { resolveReadablePalette, contrastRatio, withAlpha, blend } = load(
  'src/theme/contrast.js',
  'resolveReadablePalette, contrastRatio, withAlpha, blend'
);

// Mirror of ThemeContext.applyPalette's dark-scheme branch. Kept in step by the
// structural assertions at the bottom.
const buildAppPalette = (bg, accent) => {
  const r = resolveReadablePalette({ bg, accent });
  return {
    background: bg,
    text: r.text,
    textMuted: r.muted,
    border: r.hairline,
    glassBackground: r.panel,
    glassSolid: r.panelSolid,
    glassBorder: r.panelBorder,
    primary: r.accent,
    accent: r.accent,
    onAccent: r.onAccent,
    danger: r.danger,
    success: r.success,
  };
};

// Backgrounds a marketplace theme can equip, including awkward mid-tones.
const BACKGROUNDS = [
  ['default dark', '#000000', '#FFFFFF'],
  ['near black', '#0B0B0D', '#FFFFFF'],
  ['paper white', '#FFFFFF', '#000000'],
  ['off white', '#F7F7F5', '#FFFFFF'],
  ['cream', '#FAF3E0', '#E0B84C'],
  ['blush', '#FDF2F8', '#EC4899'],
  ['midnight', '#0B1020', '#7DD3FC'],
  ['slate', '#334155', '#38BDF8'],
  ['mid grey', '#7A7A7A', '#FFFFFF'],
  ['mid warm', '#8B7355', '#FFD700'],
];

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\nin-app palette contrast (AA body text = 4.5, large/UI = 3.0)\n');

for (const [label, bg, accent] of BACKGROUNDS) {
  const p = buildAppPalette(bg, accent);

  const textRatio = contrastRatio(p.text, bg);
  const mutedRatio = contrastRatio(p.textMuted, bg);
  // A filled button: its label is drawn ON the accent, not on the background.
  const onAccentRatio = contrastRatio(p.onAccent, p.accent);
  // Glass panels sit on the background; text is drawn on the composite, so the
  // check uses the colour that actually renders rather than the alpha value.
  const onGlassRatio = contrastRatio(p.text, p.glassSolid);
  const panelVisible = contrastRatio(p.glassSolid, bg);

  console.log(
    `  ${label.padEnd(13)} bg ${bg}  text ${p.text} ${textRatio.toFixed(2)}:1  ` +
    `muted ${mutedRatio.toFixed(2)}:1  onAccent ${onAccentRatio.toFixed(2)}:1  onGlass ${onGlassRatio.toFixed(2)}:1`
  );

  check(`${label}: body text is readable`, textRatio >= 4.5, `${textRatio.toFixed(2)}:1`);
  check(`${label}: muted text is readable`, mutedRatio >= 3, `${mutedRatio.toFixed(2)}:1`);
  // This is the exact "button text invisible on white" failure.
  check(`${label}: filled-button label is readable`, onAccentRatio >= 4.5, `${onAccentRatio.toFixed(2)}:1`);
  check(`${label}: text on a glass panel is readable`, onGlassRatio >= 4.5, `${onGlassRatio.toFixed(2)}:1`);
  // A panel that matches its background is not a panel.
  check(`${label}: the glass panel is visible against the bg`, panelVisible > 1.02, `${panelVisible.toFixed(3)}:1`);
  check(`${label}: accent separates from the background`, contrastRatio(p.accent, bg) >= 3, `${contrastRatio(p.accent, bg).toFixed(2)}:1`);
}

// ── the specific regression: a light theme must not keep dark-mode text ──
console.log('\nregression: light theme must not inherit dark-mode foreground\n');
const DARK_MODE_TEXT = '#F2F2F2';
const DARK_MODE_MUTED = '#8E8E93';
for (const [label, bg] of [['paper white', '#FFFFFF'], ['off white', '#F7F7F5'], ['cream', '#FAF3E0'], ['blush', '#FDF2F8']]) {
  const p = buildAppPalette(bg, '#FFFFFF');
  check(`${label}: text is not the dark-mode value`, p.text !== DARK_MODE_TEXT, p.text);
  check(`${label}: muted is not the dark-mode value`, p.textMuted !== DARK_MODE_MUTED, p.textMuted);
  // Proof the old behaviour really was broken, so this guard is not vacuous.
  check(
    `${label}: the OLD dark-mode text would have failed here`,
    contrastRatio(DARK_MODE_TEXT, bg) < 4.5,
    `${contrastRatio(DARK_MODE_TEXT, bg).toFixed(2)}:1`
  );
}

// ── structural: ThemeContext must actually use the derivation ────
console.log('\nwiring\n');
const themeSrc = fs.readFileSync(path.join(ROOT, 'src/context/ThemeContext.js'), 'utf8');
check('ThemeContext imports the shared derivation', /from '\.\.\/theme\/contrast'/.test(themeSrc));
check('applyPalette sets text from the derivation', /target\.text\s*=\s*readable\.text/.test(themeSrc));
check('applyPalette sets muted from the derivation', /target\.textMuted\s*=\s*readable\.muted/.test(themeSrc));
check('applyPalette recolours glass surfaces', /target\.glassBackground\s*=\s*readable\.panel/.test(themeSrc));
check('the glass wash direction is contrast-aware', /panelTint\s*=\s*contrastRatio\(text,\s*towardText\)\s*>=\s*4\.5\s*\?\s*text\s*:\s*antiText/.test(
  fs.readFileSync(path.join(ROOT, 'src/theme/contrast.js'), 'utf8')
));
check('every setTheme goes through the derivation', /setThemeState\(withReadableForeground\(t\)\)/.test(themeSrc));
check('theme exposes onAccent for filled buttons', /onAccent:\s*readable\.onAccent/.test(themeSrc));

const widgetSrc = fs.readFileSync(path.join(ROOT, 'src/widgets/widgetTheme.js'), 'utf8');
check('widgets re-export the same shared maths', /from '\.\.\/theme\/contrast'/.test(widgetSrc));
check('the maths is not duplicated in widgetTheme', !/const SEMANTIC_RAMPS/.test(widgetSrc));

console.log(failures === 0 ? '\nIn-app theme contrast holds.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

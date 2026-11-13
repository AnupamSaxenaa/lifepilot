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

// ── source scan: no hardcoded label on an accent-filled surface ──────────────
//
// The checks above only prove the palette OFFERS a readable label colour
// (`onAccent`). They passed for months while ~15 components ignored it and
// hardcoded `color: '#FFF'` on top of `backgroundColor: ACCENT` — and since the
// default accent IS #FFFFFF, those buttons rendered white-on-white. This scans
// the actual sources so that can't come back.
console.log('\nsource scan: accent-filled surfaces must not hardcode their label\n');

const SRC_DIRS = ['src/screens', 'src/components'];
const LITERAL_COLOR = /^\s*(?:'|")#[0-9a-fA-F]{3,8}(?:'|")\s*$/;
// Identifiers that resolve to the user-configurable accent at runtime.
const ACCENT_IDENT = /^(?:ACCENT|accent|theme\??\.accent|palette\??\.accent|COLORS\.\w+\.accent|props\.accent)$/;

const walk = (dir) => {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
};

/** Split a `{ ... }` object body into top-level `key: value` pairs. */
const topLevelEntries = (body) => {
  const entries = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      if (c === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      entries.push(body.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(body.slice(start));
  return entries
    .map((e) => {
      const colon = e.indexOf(':');
      if (colon === -1) return null;
      return { key: e.slice(0, colon).trim(), value: e.slice(colon + 1).trim() };
    })
    .filter(Boolean);
};

/** Extract every `StyleSheet.create({...})` object body from a source file. */
const styleSheetBodies = (src) => {
  const bodies = [];
  const marker = 'StyleSheet.create(';
  let idx = src.indexOf(marker);
  while (idx !== -1) {
    const open = src.indexOf('{', idx);
    if (open === -1) break;
    let depth = 0;
    let quote = null;
    let end = -1;
    for (let i = open; i < src.length; i += 1) {
      const c = src[i];
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    bodies.push(src.slice(open + 1, end));
    idx = src.indexOf(marker, end);
  }
  return bodies;
};

// Style-name suffixes that hold the label for a filled surface of the same name.
const LABEL_SUFFIXES = ['Text', 'Txt', 'Label', 'TextActive', 'TxtActive', 'LabelActive'];

let scanFailures = 0;
let scanned = 0;
const offenders = [];

for (const dir of SRC_DIRS) {
  for (const rel of walk(dir)) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!/backgroundColor/.test(src)) continue;
    scanned += 1;

    for (const body of styleSheetBodies(src)) {
      const styles = new Map();
      for (const { key, value } of topLevelEntries(body)) {
        if (!value.startsWith('{')) continue;
        styles.set(key.replace(/^['"]|['"]$/g, ''), value);
      }

      for (const [name, objectBody] of styles) {
        const props = topLevelEntries(objectBody.slice(1, -1));
        const bg = props.find((p) => p.key === 'backgroundColor');
        if (!bg || !ACCENT_IDENT.test(bg.value)) continue;

        // (A) label colour declared right next to the accent fill.
        const ownColor = props.find((p) => p.key === 'color');
        if (ownColor && LITERAL_COLOR.test(ownColor.value)) {
          offenders.push(`${rel} → ${name}.color = ${ownColor.value.trim()} on backgroundColor: ${bg.value}`);
        }

        // (B) the sibling label style for this filled surface.
        for (const suffix of LABEL_SUFFIXES) {
          const labelBody = styles.get(name + suffix);
          if (!labelBody) continue;
          const labelColor = topLevelEntries(labelBody.slice(1, -1)).find((p) => p.key === 'color');
          if (labelColor && LITERAL_COLOR.test(labelColor.value)) {
            offenders.push(`${rel} → ${name}${suffix}.color = ${labelColor.value.trim()} on ${name}.backgroundColor: ${bg.value}`);
          }
        }
      }
    }
  }
}

console.log(`  scanned ${scanned} file(s) that set a backgroundColor`);
if (offenders.length === 0) {
  console.log('  ok   no accent-filled surface hardcodes its label colour');
} else {
  scanFailures = offenders.length;
  for (const o of offenders) console.log(`  FAIL ${o}`);
  console.log('\n  Use the derived label colour instead of a literal:');
  console.log("    const ON_ACCENT = theme.onAccent || '#0B0B0D';   // or readableOn(fill)");
  console.log('    ...makeStyles(ACCENT, ON_ACCENT) → { color: ON_ACCENT }');
  console.log('  The default accent is #FFFFFF, so a hardcoded light label is invisible.');
}
failures += scanFailures;

// Proof the scan is not vacuous: it must flag a synthetic offender.
const probe = `const s = StyleSheet.create({ probeBtn: { backgroundColor: ACCENT }, probeBtnText: { color: '#FFF' } });`;
const probeStyles = new Map(
  styleSheetBodies(probe).flatMap((b) => topLevelEntries(b)
    .filter((e) => e.value.startsWith('{'))
    .map((e) => [e.key, e.value])),
);
const probeCaught = (() => {
  const fill = probeStyles.get('probeBtn');
  const label = probeStyles.get('probeBtnText');
  if (!fill || !label) return false;
  const bg = topLevelEntries(fill.slice(1, -1)).find((p) => p.key === 'backgroundColor');
  const color = topLevelEntries(label.slice(1, -1)).find((p) => p.key === 'color');
  return Boolean(bg && ACCENT_IDENT.test(bg.value) && color && LITERAL_COLOR.test(color.value));
})();
check('the scan detects a synthetic offender (guard is not vacuous)', probeCaught);

console.log(failures === 0 ? '\nIn-app theme contrast holds.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

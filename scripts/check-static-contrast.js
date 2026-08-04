/* global __dirname */
/**
 * Finds hardcoded colour pairs in StyleSheets that render unreadable text.
 *
 * Run: node scripts/check-static-contrast.js
 *
 * The theme derivation fixes colours that FLOW from the equipped theme, but it
 * cannot help a style that hardcodes `backgroundColor: '#FFFFFF'` next to
 * `color: '#FFF'`. Those are the "button text is invisible on white" cases, and
 * they only show up by reading every StyleSheet — which is what this does.
 *
 * Two patterns are checked:
 *   1. One style object declaring both a background and a text colour.
 *   2. The project's `fooBtn` / `fooBtnText` naming convention, where the label
 *      lives in a sibling style.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ── colour maths (shared module, loaded without its imports) ─────
const contrastSrc = fs
  .readFileSync(path.join(ROOT, 'src/theme/contrast.js'), 'utf8')
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/export const/g, 'const')
  .replace(/^export /gm, '');
const cmod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', `${contrastSrc}\nmodule.exports = { contrastRatio };`)(cmod, cmod.exports);
const { contrastRatio } = cmod.exports;

const walkFiles = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) out.push(p);
  }
  return out;
};

/** Only opaque hex colours can be judged; rgba/alpha depends on what is behind. */
const isOpaqueHex = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

/**
 * Pull `name: { ... }` blocks out of a StyleSheet.create call and record the
 * background/text colours each one declares.
 */
function parseStyles(src) {
  const styles = {};
  const createIdx = src.indexOf('StyleSheet.create(');
  if (createIdx === -1) return styles;
  const body = src.slice(createIdx);

  const re = /(\w+)\s*:\s*\{/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[1];
    // Take the balanced object body.
    let depth = 1;
    let i = re.lastIndex;
    while (i < body.length && depth > 0) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}') depth -= 1;
      i += 1;
    }
    const chunk = body.slice(re.lastIndex, i - 1);
    // Skip nested objects (shadowOffset etc.) that have no colours.
    const bg = (chunk.match(/backgroundColor:\s*['"]([^'"]+)['"]/) || [])[1];
    const color = (chunk.match(/(?<!background)(?<!border)(?<!shadow)\bcolor:\s*['"]([^'"]+)['"]/) || [])[1];
    if (bg || color) styles[name] = { bg, color };
  }
  return styles;
}

let failures = 0;
const findings = [];
let pairsChecked = 0;

const AA = 4.5;
// Icon-only / decorative thresholds are lower, but a *label* must hit AA.
const record = (file, label, fg, bg, ratio) => {
  findings.push({ file, label, fg, bg, ratio });
  failures += 1;
};

for (const file of walkFiles(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  const styles = parseStyles(src);
  const rel = path.relative(ROOT, file);

  for (const [name, s] of Object.entries(styles)) {
    // Pattern 1: a single style declaring both.
    if (s.bg && s.color && isOpaqueHex(s.bg) && isOpaqueHex(s.color)) {
      pairsChecked += 1;
      const ratio = contrastRatio(s.color, s.bg);
      if (ratio < AA) record(rel, name, s.color, s.bg, ratio);
    }

    // Pattern 2: `fooBtn` + `fooBtnText` / `fooLabel` / `fooText`.
    if (!s.bg || !isOpaqueHex(s.bg)) continue;
    for (const suffix of ['Text', 'Label', 'BtnText', 'ButtonText']) {
      const partner = styles[`${name}${suffix}`];
      if (!partner || !partner.color || !isOpaqueHex(partner.color)) continue;
      pairsChecked += 1;
      const ratio = contrastRatio(partner.color, s.bg);
      if (ratio < AA) record(rel, `${name} + ${name}${suffix}`, partner.color, s.bg, ratio);
    }
  }
}

console.log(`\nchecked ${pairsChecked} hardcoded background/text pairs\n`);

if (findings.length === 0) {
  console.log('No unreadable hardcoded colour pairs found.\n');
  process.exit(0);
}

// Sort worst first — a 1.x ratio is completely invisible.
findings.sort((a, b) => a.ratio - b.ratio);
for (const f of findings) {
  const severity = f.ratio < 2 ? 'INVISIBLE' : f.ratio < 3 ? 'SEVERE   ' : 'LOW      ';
  console.log(`  ${severity} ${f.ratio.toFixed(2)}:1  ${f.file}\n              ${f.label}: ${f.fg} on ${f.bg}`);
}
console.log(`\n${failures} unreadable pair(s).\n`);
process.exit(1);

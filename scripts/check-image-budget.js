#!/usr/bin/env node
/**
 * Fails if any bundled image is larger than it can ever be displayed.
 *
 * WHY THIS EXISTS
 * Before this guard, `src/assets/stones` alone was 35 MB: 30 stone images at
 * 1024x1024 and up to 1.7 MB each, every one require()d and therefore shipped.
 * They render at 180 dp maximum, so roughly 97% of those bytes could never reach
 * a single pixel. Together with a 5.3 MB GIF drawn inside a 140 dp circle, that
 * was the largest single contributor to a 179 MB APK.
 *
 * The fix was mechanical (downscale + quantise). The hard part is stopping it
 * recurring: dropping a fresh 1024px export into the repo is easy and invisible
 * until someone measures an APK months later. This check makes it fail fast.
 *
 * BUDGETS
 * Derived from actual render sizes, with headroom for a 3.5x display:
 *   stones            render at <=180 dp  -> 640 px is already generous
 *   app icons         must stay 1024 px   -> Android/Expo require the full size
 *   everything else   sized to its use site
 *
 * If a budget genuinely needs raising, change it here with a comment explaining
 * the render size that justifies it — do not silently bump the number.
 *
 * Regenerate offenders with:
 *   sips -Z <maxPx> <file>
 *   pngquant --quality=60-90 --strip --force --output <file> <file>
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Paths that must keep full resolution: these are sources Android/Expo scale
// themselves into per-density resources at build time.
const EXEMPT = new Set([
  'assets/images/icon.png',
  'assets/images/splash-icon.png',
  'assets/images/android-icon-foreground.png',
  'assets/images/android-icon-background.png',
  'assets/images/android-icon-monochrome.png',
]);

const RULES = [
  { dir: 'src/assets/stones', maxKB: 400, maxPx: 640, why: 'rendered at <=180 dp' },
  { dir: 'assets', maxKB: 700, maxPx: 1024, why: 'icons and in-app art' },
  { dir: 'src/assets', maxKB: 400, maxPx: 640, why: 'in-app art' },
];

// Animations carry every frame, so a per-file KB budget tuned for static images
// is the wrong yardstick. finalstop.gif is 72 frames at 420px — sized to exactly
// match its 140 dp render box on a 3x display — and lands at ~916 KB.
// Dimensions are still enforced by the owning rule above.
const ANIMATED_MAX_KB = 1000;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const pixelWidth = (file) => {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', file], { encoding: 'utf8' });
    const m = out.match(/pixelWidth:\s*(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null; // sips cannot read animated GIFs reliably; size check still applies
  }
};

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
};

const failures = [];
let checked = 0;
let totalKB = 0;

for (const rule of RULES) {
  const base = path.join(ROOT, rule.dir);
  for (const file of walk(base)) {
    const rel = path.relative(ROOT, file);

    // Deeper rules win: a file under src/assets/stones is checked by that rule,
    // not by the broader src/assets one.
    const owner = RULES
      .filter((r) => rel.startsWith(r.dir))
      .sort((a, b) => b.dir.length - a.dir.length)[0];
    if (owner !== rule) continue;
    if (EXEMPT.has(rel)) continue;

    checked += 1;
    const kb = Math.round(fs.statSync(file).size / 1024);
    totalKB += kb;

    const isAnimated = path.extname(rel).toLowerCase() === '.gif';
    const maxKB = isAnimated ? Math.max(rule.maxKB, ANIMATED_MAX_KB) : rule.maxKB;

    if (kb > maxKB) {
      failures.push(`${rel} is ${kb} KB, budget ${maxKB} KB (${rule.why})`);
      continue;
    }
    const w = pixelWidth(file);
    if (w && w > rule.maxPx) {
      failures.push(`${rel} is ${w}px wide, budget ${rule.maxPx}px (${rule.why})`);
    }
  }
}

if (failures.length > 0) {
  console.error(`✗ image budget: ${failures.length} file(s) too large\n`);
  failures.forEach((f) => console.error(`   ${f}`));
  console.error('\n  Shrink with:');
  console.error('    sips -Z <maxPx> <file>');
  console.error('    pngquant --quality=60-90 --strip --force --output <file> <file>');
  process.exit(1);
}

console.log(`ok   image budget: ${checked} images, ${(totalKB / 1024).toFixed(1)} MB total`);

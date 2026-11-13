#!/usr/bin/env node
/**
 * Generates the Android notification small icon from the app logo.
 *
 * WHY THIS EXISTS
 * The notification icon was being generated from `android-icon-monochrome.png`,
 * which is a chevron — a leftover from an earlier logo. The actual app mark is a
 * stack of balanced stones, so every LifePilot notification showed a symbol that
 * appears nowhere else in the app.
 *
 * Two separate specs were being conflated:
 *
 *   android-icon-monochrome.png  Android 13 themed APP icon. Sized for the
 *                                adaptive-icon safe zone, so it carries heavy
 *                                padding and is not a notification asset.
 *   notification small icon      Android draws ONLY the alpha channel and floods
 *                                every non-transparent pixel with the accent
 *                                colour. Colour is discarded entirely.
 *
 * That second rule is why the logo cannot be used directly: the source is white
 * stones on an opaque BLACK background, and since black is not transparent,
 * Android would tint the whole square and render a solid coloured block — the
 * classic "grey square notification icon" bug.
 *
 * WHAT THIS DOES
 * Derives alpha from luminance: a white pixel becomes fully opaque, a black pixel
 * becomes fully transparent, and greys land in between. The result is the stone
 * silhouette on transparency, which is exactly what Android wants. Output is
 * forced to white RGB so the shape stays clean if anything ever renders it
 * untinted.
 *
 * Padding is added because Android crops notification icons to a circle on some
 * OEM skins; without a margin the outer stones clip.
 *
 * USAGE
 *   node scripts/make-notification-icon.js
 * then rebuild (the expo-notifications plugin regenerates the drawable densities
 * from the file this writes).
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets/images/android-icon-foreground.png');
const OUTPUT = path.join(ROOT, 'assets/images/notification-icon.png');

// 96px is the xxxhdpi size for a 24dp icon. Expo downscales for lower densities,
// so this is the largest size actually needed.
const SIZE = 96;
// Fraction of the canvas the artwork may occupy, leaving a safe margin for OEM
// circular cropping.
const CONTENT_SCALE = 0.72;

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Luminance below LUM_LOW is treated as background, above LUM_HIGH as solid
// artwork, and the narrow band between the two keeps genuine antialiased edges.
//
// A straight alpha = luminance mapping looked correct at a glance but carried
// every faint imperfection in the source through into the icon — a barely-visible
// vertical line in the logo file became a clear stray stroke down the finished
// notification icon, and the near-black background registered as "artwork" so the
// bounding box matched the entire canvas and centring did nothing.
//
// Hard cutoffs are the right call here regardless: Android floods the icon with a
// single tint colour, so intermediate alpha only ever softens edges — it can never
// carry detail.
const LUM_LOW = 0.34;
const LUM_HIGH = 0.62;

const shapeAlpha = (r, g, b) => {
  const lum = luminance(r, g, b) / 255;
  if (lum <= LUM_LOW) return 0;
  if (lum >= LUM_HIGH) return 1;
  return (lum - LUM_LOW) / (LUM_HIGH - LUM_LOW);
};

const main = () => {
  if (!fs.existsSync(SOURCE)) {
    console.error(`✗ source not found: ${path.relative(ROOT, SOURCE)}`);
    process.exit(1);
  }

  const src = PNG.sync.read(fs.readFileSync(SOURCE));

  // ── Pass 1: find the artwork's bounding box ──
  // The logo sits in the middle of a large black square, so cropping to the
  // actual shape first means the padding below is measured from the stones
  // rather than from the empty canvas.
  let minX = src.width;
  let minY = src.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (src.width * y + x) << 2;
      if (src.data[i + 3] === 0) continue; // already transparent
      // Same cutoff the alpha ramp uses, so the box bounds exactly what will end
      // up visible. Measuring with a lower threshold matched background noise and
      // returned the full canvas.
      if (shapeAlpha(src.data[i], src.data[i + 1], src.data[i + 2]) <= 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) {
    console.error('✗ no non-black pixels found — is the source actually the logo?');
    process.exit(1);
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const side = Math.max(cropW, cropH); // keep the aspect ratio square
  const cropOriginX = minX - (side - cropW) / 2;
  const cropOriginY = minY - (side - cropH) / 2;

  // ── Pass 2: resample into the output canvas, alpha from luminance ──
  const out = new PNG({ width: SIZE, height: SIZE });
  const content = Math.round(SIZE * CONTENT_SCALE);
  const offset = Math.round((SIZE - content) / 2);

  out.data.fill(0); // fully transparent canvas

  for (let y = 0; y < content; y += 1) {
    for (let x = 0; x < content; x += 1) {
      // Nearest-neighbour is adequate: we are downscaling a high-contrast
      // silhouette, and the alpha ramp below softens the edges anyway.
      const sx = Math.min(src.width - 1, Math.max(0, Math.round(cropOriginX + (x / content) * side)));
      const sy = Math.min(src.height - 1, Math.max(0, Math.round(cropOriginY + (y / content) * side)));
      const si = (src.width * sy + sx) << 2;

      const srcAlpha = src.data[si + 3] / 255;
      const alpha = Math.round(shapeAlpha(src.data[si], src.data[si + 1], src.data[si + 2]) * srcAlpha * 255);

      const di = (SIZE * (y + offset) + (x + offset)) << 2;
      out.data[di] = 255;     // force white: Android tints this away anyway, and
      out.data[di + 1] = 255; // white keeps the shape correct if it does not
      out.data[di + 2] = 255;
      out.data[di + 3] = alpha;
    }
  }

  fs.writeFileSync(OUTPUT, PNG.sync.write(out));

  const opaque = (() => {
    let n = 0;
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i] > 8) n += 1;
    return n;
  })();
  const coverage = ((opaque / (SIZE * SIZE)) * 100).toFixed(1);

  console.log(`ok   wrote ${path.relative(ROOT, OUTPUT)}  ${SIZE}x${SIZE}`);
  console.log(`     source artwork bbox ${cropW}x${cropH} at (${minX},${minY})`);
  console.log(`     opaque coverage ${coverage}%  (a solid square would be ~100% — the bug this avoids)`);
};

main();

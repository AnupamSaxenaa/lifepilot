#!/usr/bin/env node
/**
 * Generates supabase/functions/legal/pages.ts from the HTML in web/.
 *
 * WHY THIS EXISTS
 * The legal pages must be reachable at a stable public HTTPS URL, because Google
 * Play requires a privacy policy URL and an account-deletion URL and treats a
 * dead link as grounds for removal. GitHub Pages was the obvious host, but this
 * account's user site has a custom domain (classiqdtc.me) that answers every
 * path with an unrelated app, so project pages cannot be served reliably from
 * there. A Supabase edge function has no DNS or redirect involvement, and this
 * project already serves HTML that way (the `invite` function).
 *
 * Edge functions cannot read repo files at runtime, so the HTML has to be
 * embedded in the deployed module. Embedding by hand would mean two copies that
 * silently diverge; this generates one from the other instead.
 *
 *   npm run legal:build     regenerate after editing web/*.html
 *   npm run check           fails if the generated file is out of date
 *
 * Run with --check to verify without writing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const OUT_FILE = path.join(ROOT, 'supabase', 'functions', 'legal', 'pages.ts');

const SOURCES = [
  { constName: 'INDEX_HTML', file: 'index.html' },
  { constName: 'PRIVACY_HTML', file: 'privacy-policy.html' },
  { constName: 'DELETE_HTML', file: 'delete-account.html' },
];

/**
 * Escape for a TypeScript template literal. Backticks and `${` would otherwise
 * terminate the literal or inject an expression.
 */
const toTemplateLiteral = (html) => html
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const buildOutput = () => {
  const blocks = SOURCES.map(({ constName, file }) => {
    const full = path.join(WEB_DIR, file);
    if (!fs.existsSync(full)) {
      throw new Error(`missing source page: web/${file}`);
    }
    const html = fs.readFileSync(full, 'utf8');
    if (html.trim().length === 0) {
      throw new Error(`empty source page: web/${file}`);
    }
    // Inside the function the pages are served from one origin, so the relative
    // hrefs in web/ need to match the function's routes.
    const routed = html
      .replace(/\.\/privacy-policy\.html/g, './privacy')
      .replace(/\.\/delete-account\.html/g, './delete');

    return `// Generated from web/${file}\nexport const ${constName} = \`${toTemplateLiteral(routed)}\`;\n`;
  });

  return [
    '// ─────────────────────────────────────────────────────────────────────────',
    '// GENERATED FILE — DO NOT EDIT.',
    '// Source: web/*.html   Generator: scripts/build-legal-pages.js',
    '// Regenerate with `npm run legal:build`; `npm run check` fails on drift.',
    '// ─────────────────────────────────────────────────────────────────────────',
    '',
    ...blocks,
  ].join('\n');
};

const main = () => {
  const checkOnly = process.argv.includes('--check');
  let expected;
  try {
    expected = buildOutput();
  } catch (e) {
    console.error(`✗ legal pages: ${e.message}`);
    process.exit(1);
  }

  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;

  if (checkOnly) {
    if (current !== expected) {
      console.error('✗ legal pages: supabase/functions/legal/pages.ts is out of date.');
      console.error('  web/*.html changed without regenerating. Run: npm run legal:build');
      process.exit(1);
    }
    console.log('ok   legal pages in sync with web/');
    return;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, expected, 'utf8');
  const kb = (Buffer.byteLength(expected) / 1024).toFixed(1);
  console.log(`wrote supabase/functions/legal/pages.ts (${kb} kB, ${SOURCES.length} pages)`);
};

main();

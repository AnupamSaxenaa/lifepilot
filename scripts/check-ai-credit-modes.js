/* global __dirname */
/**
 * Keeps the AI proxy's billing table honest.
 *
 * Run: node scripts/check-ai-credit-modes.js
 *
 * Two things can silently break here:
 *   1. A client mode missing from MODE_COST → the proxy answers 400
 *      `unknown_mode` and that AI feature is dead.
 *   2. A background mode gaining a cost → credits drain with no visible cause,
 *      which is exactly the bug this table was rewritten to fix.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const proxySrc = fs.readFileSync(path.join(ROOT, 'supabase/functions/ai-proxy/index.ts'), 'utf8');
const engineSrc = fs.readFileSync(path.join(ROOT, 'src/lib/AIEngine.js'), 'utf8');

// ── parse MODE_COST from the edge function ──────────────────────
const block = proxySrc.match(/const MODE_COST[^{]*\{([\s\S]*?)\n\};/);
if (!block) {
  console.error('FAIL could not find MODE_COST in the edge function');
  process.exit(1);
}
const costs = {};
for (const line of block[1].split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\d+)\s*,/);
  if (m) costs[m[1]] = parseInt(m[2], 10);
}

// ── parse the modes the client actually sends ────────────────────
const clientModes = [...engineSrc.matchAll(/runAI\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]);

// The proxy defaults to "chat" when a client omits the mode.
const DEFAULT_MODE = (proxySrc.match(/payload\.mode\s*\?\?\s*["']([a-z_]+)["']/) || [])[1];

const BILLABLE = ['aura_chat', 'plan'];

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\nMODE_COST:', JSON.stringify(costs));
console.log('client modes:', clientModes.join(', '));
console.log(`default mode: ${DEFAULT_MODE}\n`);

check('MODE_COST was parsed', Object.keys(costs).length > 0);
check('the proxy has a default mode', !!DEFAULT_MODE, DEFAULT_MODE);
check('the default mode is in the table', DEFAULT_MODE in costs, DEFAULT_MODE);

// 1. Every mode the client sends must exist, or that feature 400s.
for (const mode of [...new Set(clientModes)]) {
  check(`client mode "${mode}" exists in MODE_COST`, mode in costs);
}

// 2. Exactly the two user-initiated actions are billable.
const billableFound = Object.entries(costs).filter(([, c]) => c > 0).map(([m]) => m).sort();
check(
  'only aura_chat and plan cost credits',
  JSON.stringify(billableFound) === JSON.stringify([...BILLABLE].sort()),
  billableFound.join(',') || '(none)'
);

check('chatting with Aura costs 1', costs.aura_chat === 1, String(costs.aura_chat));
check('build schedule costs 3', costs.plan === 3, String(costs.plan));

// 3. Everything the app starts on its own must be free.
for (const mode of ['coach', 'nudge', 'block', 'intervention', 'chat']) {
  check(`background mode "${mode}" is free`, costs[mode] === 0, String(costs[mode]));
}

// 4. The zero-cost path must SKIP consume_ai_tokens. Passing p_cost: 0 would be
//    rejected as invalid_cost and break every free feature.
check(
  'consume_ai_tokens is only called when cost > 0',
  /if\s*\(\s*cost\s*>\s*0\s*\)\s*\{[\s\S]{0,400}?consume_ai_tokens/.test(proxySrc)
);
check(
  'a free call is never refunded (that would mint credits)',
  /cost\s*>\s*0\s*\?\s*Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)\s*:\s*null/.test(proxySrc)
);

// 5. Free does not mean unprotected — these guards must still run for every mode.
for (const [label, re] of [
  ['auth is still required', /invalid session/],
  ['rate limiting still applies', /check_ai_rate_limit/],
  ['payload caps still apply', /MAX_TOTAL_CHARS/],
  ['the AI kill-switch still applies', /is_ai_enabled/],
]) {
  check(label, re.test(proxySrc));
}

// 6. Guard the ordering: the rate-limit check must come BEFORE the cost branch,
//    otherwise free modes would skip it along with the credit check.
const rlIdx = proxySrc.indexOf('check_ai_rate_limit');
const costIdx = proxySrc.search(/if\s*\(\s*cost\s*>\s*0\s*\)/);
check('rate limiting runs before the billing branch', rlIdx > -1 && costIdx > rlIdx, `rl@${rlIdx} cost@${costIdx}`);

console.log(failures === 0 ? '\nCredit modes are correct.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

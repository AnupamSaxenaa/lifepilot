/* global __dirname */
/**
 * Aura memory behaviour checks.
 *
 * The whole point of the fact store is that Aura must NOT forget things the
 * model happens to omit on a later turn. These assertions pin that down, plus
 * the size bound that keeps prompt cost predictable.
 *
 * Run: node scripts/check-aura-memory.js
 */
const fs = require('fs');
const path = require('path');

// In-memory stand-in for AsyncStorage.
const store = new Map();
const StorageStub = {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  set: async (k, v) => { store.set(k, v); },
  getBatch: async (keys) => {
    const out = {};
    for (const k of keys) out[k] = store.has(k) ? store.get(k) : null;
    return out;
  },
};

const file = path.join(__dirname, '..', 'src', 'lib', 'auraMemory.js');
// Line-anchored so identifiers containing "import" are left alone.
let src = fs.readFileSync(file, 'utf8')
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/export const/g, 'const')
  .replace(/^export /gm, '');
src += '\nmodule.exports = { loadMemory, mergeMemory, parseMemoryText, renderMemory, clearMemory };';
const mod = { exports: {} };
new Function('module', 'exports', 'Storage', 'console', src)(mod, mod.exports, StorageStub, console);
const { loadMemory, mergeMemory, parseMemoryText, clearMemory } = mod.exports;

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

(async () => {
  const uid = 'user-1';

  console.log('\nparsing');
  check('splits newline facts', parseMemoryText('occupation: engineer\nlunch: 2pm').length === 2);
  check('splits legacy prose blob', parseMemoryText('User is an engineer. Eats at 2pm.').length === 2);
  check('empty input yields nothing', parseMemoryText('').length === 0);

  console.log('\nmerging');
  await mergeMemory(uid, 'occupation: engineer\nlunch: 2pm\ngym: mornings');
  let mem = await loadMemory(uid);
  check('stores all three facts', mem.facts.length === 3, `got ${mem.facts.length}`);

  // The model mentions only ONE fact this turn. The others must survive.
  await mergeMemory(uid, 'planner style: detailed');
  mem = await loadMemory(uid);
  check('omitted facts are retained', mem.facts.length === 4, `got ${mem.facts.length}`);
  check('still remembers occupation', mem.text.includes('engineer'));
  check('still remembers lunch', mem.text.includes('2pm'));
  check('learned new fact', mem.text.includes('detailed'));

  // A correction to an existing key should replace, not duplicate.
  await mergeMemory(uid, 'lunch: 1pm');
  mem = await loadMemory(uid);
  const lunchLines = mem.text.split('\n').filter((l) => l.toLowerCase().includes('lunch'));
  check('correction replaces same key', lunchLines.length === 1, `got ${lunchLines.length} lunch lines`);
  check('correction takes new value', mem.text.includes('1pm') && !mem.text.includes('2pm'));
  check('fact count unchanged by correction', mem.facts.length === 4, `got ${mem.facts.length}`);

  console.log('\nbounding');
  await clearMemory(uid);
  store.delete(`aimemory_facts_${uid}`);
  for (let i = 0; i < 60; i += 1) {
    await mergeMemory(uid, `fact ${i}: value ${i}`);
  }
  mem = await loadMemory(uid);
  check('fact count is capped', mem.facts.length <= 36, `got ${mem.facts.length}`);
  check('rendered memory stays small', mem.text.length <= 1200, `got ${mem.text.length} chars`);
  check('keeps the newest fact', mem.text.includes('fact 59'));

  console.log('\nno-op');
  const before = (await loadMemory(uid)).text;
  const res = await mergeMemory(uid, '');
  check('empty update reports no change', res.changed === false);
  check('empty update preserves memory', (await loadMemory(uid)).text === before);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll Aura memory checks passed.');
})();

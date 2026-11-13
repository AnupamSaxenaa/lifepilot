/* global __dirname */
/**
 * Aura workspace-snapshot checks.
 *
 * Guards the two things that matter: the snapshot must actually contain the
 * user's world (lists, overdue, today, backlog, routines) and it must stay
 * inside its token budget even with a large, messy account.
 *
 * Run: node scripts/check-aura-context.js
 */
const fs = require('fs');
const path = require('path');

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays, hour = 9) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const lists = [
  { id: 'l1', name: 'Work' },
  { id: 'l2', name: 'Personal' },
  { id: 'l3', name: 'Reading' },
];

const tasks = [
  { id: 1, title: 'Ship the release build', due_date: iso(-3), list_id: 'l1', priority: 3 },
  { id: 2, title: 'Reply to recruiter email', due_date: iso(-1), list_id: 'l1' },
  { id: 3, title: 'Standup', reminder_time: iso(0, 10), repeat_rule: 'weekdays', list_id: 'l1' },
  { id: 4, title: 'Gym session', reminder_time: iso(0, 18), repeat_rule: 'every 2 days' },
  { id: 5, title: 'Dentist appointment', due_date: iso(3), list_id: 'l2' },
  { id: 6, title: 'Read chapter 4 of the distributed systems book', list_id: 'l3' },
  { id: 7, title: 'Finished thing', is_completed: true, completed_at: new Date().toISOString() },
  {
    id: 8,
    title: 'Prepare quarterly review deck',
    due_date: iso(0, 15),
    list_id: 'l1',
    subtasks: [{ id: 's1', is_completed: true }, { id: 's2', is_completed: false }],
  },
];

// Bulk filler to prove the caps and the hard budget hold up.
for (let i = 0; i < 200; i += 1) {
  tasks.push({ id: 100 + i, title: `Backlog item number ${i} with a deliberately long title to test truncation`, list_id: 'l2' });
}
for (let i = 0; i < 40; i += 1) {
  tasks.push({ id: 500 + i, title: `Overdue chore ${i}`, due_date: iso(-2 - (i % 5)), list_id: 'l2' });
}

const store = new Map([
  ['tasks_u1', tasks],
  ['lists_u1', lists],
  ['gamification_u1', { streak: 12, level: 7, xp: 3400 }],
]);
const StorageStub = {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  getBatch: async (keys) => {
    const out = {};
    for (const k of keys) out[k] = store.has(k) ? store.get(k) : null;
    return out;
  },
  set: async () => {},
};

const file = path.join(__dirname, '..', 'src', 'lib', 'auraContext.js');
// Strip only real import STATEMENTS (line-anchored). A loose /import[^;]+;/
// also eats the substring inside identifiers like `is_important`.
let src = fs.readFileSync(file, 'utf8')
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/export const/g, 'const')
  .replace(/^export /gm, '');
src += '\nmodule.exports = { buildAuraContext };';
const mod = { exports: {} };
new Function('module', 'exports', 'Storage', 'console', src)(mod, mod.exports, StorageStub, console);
const { buildAuraContext } = mod.exports;

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

(async () => {
  const out = await buildAuraContext('u1');
  console.log('\n--- snapshot ---');
  console.log(out);
  console.log(`--- ${out.length} chars (~${Math.round(out.length / 4)} tokens) ---\n`);

  check('includes current time', out.includes('NOW:'));
  check('includes momentum stats', out.includes('STATUS:') && out.includes('streak 12'));
  check('names every list', out.includes('Work') && out.includes('Personal') && out.includes('Reading'));
  check('reports inbox count', out.includes('Inbox:'));
  check('surfaces overdue section', out.includes('OVERDUE'));
  check('surfaces today section', out.includes('TODAY'));
  check('surfaces upcoming section', out.includes('NEXT 7 DAYS'));
  check('surfaces backlog section', out.includes('UNSCHEDULED'));
  check('surfaces routines', out.includes('ROUTINES') && out.includes('weekdays'));
  check('marks urgent priority', out.includes('!!'));
  check('shows step progress', out.includes('steps'));
  check('excludes completed tasks from lists', !out.includes('Finished thing'));
  check('stays within budget', out.length <= 1800, `${out.length} chars`);
  check('truncates long titles', !out.includes('deliberately long title to test truncation'));

  const empty = await buildAuraContext('nobody');
  check('degrades safely with no data', typeof empty === 'string' && empty.includes('NOW:'));

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll Aura context checks passed.');
})();

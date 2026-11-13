/**
 * Verifies the Today's Plan widget's time rules.
 *
 * Run: node scripts/check-planner-states.js
 *
 * The widget itself can only be judged by eye on a home screen, so the parts
 * that are genuinely easy to get wrong — 12-hour parsing, midnight wrap, and
 * whether a row is "missed" yet — are checked here instead.
 */
const fs = require('fs');
const path = require('path');

// Same loader the other check-* harnesses use: strip the ES module syntax and
// evaluate, so this runs under plain node with no build step.
const file = path.join(__dirname, '..', 'src', 'widgets', 'planRowState.js');
let src = fs
  .readFileSync(file, 'utf8')
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/export const/g, 'const')
  .replace(/^export /gm, '');
src += '\nmodule.exports = { parseClockTime, parseTimeRange, annotatePlan, firstUpcomingIndex, minutesOfDay };';
const mod = { exports: {} };
new Function('module', 'exports', 'console', src)(mod, mod.exports, console);

const { parseClockTime, parseTimeRange, annotatePlan, firstUpcomingIndex } = mod.exports;

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else failures.push(`${label}\n     expected ${e}\n     actual   ${a}`);
}

const M = (h, m = 0) => h * 60 + m;

// ── parseClockTime ──────────────────────────────────────────────
check('12-hour with minutes', parseClockTime('9:30 AM'), M(9, 30));
check('12-hour PM', parseClockTime('2:15 PM'), M(14, 15));
check('noon', parseClockTime('12:00 PM'), M(12));
check('midnight', parseClockTime('12:00 AM'), 0);
check('midnight no minutes', parseClockTime('12 AM'), 0);
check('24-hour', parseClockTime('14:00'), M(14));
check('24-hour early', parseClockTime('07:05'), M(7, 5));
check('no space before meridiem', parseClockTime('9:30AM'), M(9, 30));
check('lowercase meridiem', parseClockTime('9:30 pm'), M(21, 30));
check('dotted meridiem', parseClockTime('9:30 p.m.'), M(21, 30));
check('hour only', parseClockTime('9 AM'), M(9));
check('garbage returns null', parseClockTime('sometime later'), null);
check('empty returns null', parseClockTime(''), null);
check('non-string returns null', parseClockTime(null), null);
check('impossible hour returns null', parseClockTime('25:00'), null);
check('impossible minute returns null', parseClockTime('10:75'), null);

// ── parseTimeRange ──────────────────────────────────────────────
check('bare time has no end', parseTimeRange('9:30 AM'), { start: M(9, 30), end: null });
check('hyphen range', parseTimeRange('9:30 AM - 10:30 AM'), { start: M(9, 30), end: M(10, 30) });
check('en dash range', parseTimeRange('9:30–10:30'), { start: M(9, 30), end: M(10, 30) });
check('"to" range', parseTimeRange('14:00 to 15:30'), { start: M(14), end: M(15, 30) });
check(
  'range crossing midnight extends past 1440',
  parseTimeRange('11:00 PM - 1:00 AM'),
  { start: M(23), end: M(25) }
);
// "9:30 AM - 10:30" would parse the end as 10:30 in 24h, which is still sane.
check('range with bare end', parseTimeRange('9:30 AM - 10:30'), { start: M(9, 30), end: M(10, 30) });
// An end that implies a >12h block is untrustworthy (missing PM), so it is dropped.
check('implausible span drops end', parseTimeRange('9:00 AM - 11:00 PM'), { start: M(9), end: null });
check('unparseable start', parseTimeRange('whenever'), { start: null, end: null });

// ── annotatePlan: core state matrix ─────────────────────────────
const states = (plan, nowMinutes, done = new Map()) =>
  annotatePlan(plan, { doneById: done, nowMinutes }).map((r) => `${r.kind}:${r.state}:${r.struck ? 'cut' : 'plain'}`);

const plan = [
  { taskId: 't1', time: '8:00 AM', title: 'Gym' },
  { taskId: null, time: '9:00 AM', title: 'Breakfast' },
  { taskId: 't2', time: '10:00 AM', title: 'Write report' },
  { taskId: null, time: '1:00 PM', title: 'Lunch' },
  { taskId: 't3', time: '3:00 PM', title: 'Review PRs' },
];

check(
  'before everything: all upcoming',
  states(plan, M(7)),
  ['task:upcoming:plain', 'block:upcoming:plain', 'task:upcoming:plain', 'block:upcoming:plain', 'task:upcoming:plain']
);

check(
  'mid-morning: past task missed, past block just cut, current row is now',
  states(plan, M(10, 30)),
  ['task:missed:cut', 'block:past:cut', 'task:now:plain', 'block:upcoming:plain', 'task:upcoming:plain']
);

check(
  'completed task is green+cut even though its time passed',
  states(plan, M(15, 30), new Map([['t1', true]])),
  ['task:done:cut', 'block:past:cut', 'task:missed:cut', 'block:past:cut', 'task:now:plain']
);

// The boundary itself: a window is over the moment the clock reaches its end.
check(
  'at exactly the window end the task is missed',
  states(plan, M(16), new Map([['t1', true]])),
  ['task:done:cut', 'block:past:cut', 'task:missed:cut', 'block:past:cut', 'task:missed:cut']
);

check(
  'completed task ahead of time is done, not upcoming',
  states(plan, M(7), new Map([['t2', true]])),
  ['task:upcoming:plain', 'block:upcoming:plain', 'task:done:cut', 'block:upcoming:plain', 'task:upcoming:plain']
);

// ── the grace window: a task must not go red the minute after its start ──
const single = [{ taskId: 't1', time: '9:30 AM', title: 'Standup' }];
check('1 minute after start is still "now", not missed', states(single, M(9, 31)), ['task:now:plain']);
check('59 minutes after start is still "now"', states(single, M(10, 29)), ['task:now:plain']);
check('60 minutes after start becomes missed', states(single, M(10, 30)), ['task:missed:cut']);

// A tight schedule shortens the window to the next row's start.
const tight = [
  { taskId: 't1', time: '9:00 AM', title: 'A' },
  { taskId: 't2', time: '9:15 AM', title: 'B' },
];
check('window ends when the next row starts', states(tight, M(9, 15)), ['task:missed:cut', 'task:now:plain']);
check('still inside the short window', states(tight, M(9, 14)), ['task:now:plain', 'task:upcoming:plain']);

// ── midnight wrap ───────────────────────────────────────────────
const withSleep = [
  { taskId: 't1', time: '10:00 PM', title: 'Wind down' },
  { taskId: null, time: '12:30 AM', title: 'Sleep' },
];
check(
  'a post-midnight block is not treated as this morning',
  states(withSleep, M(14)),
  ['task:upcoming:plain', 'block:upcoming:plain']
);
check(
  'at 10:30 PM the wind-down is now and sleep still ahead',
  states(withSleep, M(22, 30)),
  ['task:now:plain', 'block:upcoming:plain']
);

// ── unparseable times must never be marked missed ───────────────
check(
  'unreadable time stays upcoming all day',
  states([{ taskId: 't1', time: 'after work', title: 'Call mum' }], M(23, 59)),
  ['task:upcoming:plain']
);
check(
  'unreadable time on a done task is still done',
  states([{ taskId: 't1', time: 'zzz', title: 'X' }], M(12), new Map([['t1', true]])),
  ['task:done:cut']
);

// ── robustness: malformed input must not throw ───────────────────
const hostile = [
  null,
  undefined,
  {},
  { title: '' },
  { taskId: 't1', title: 'No time at all' },
  { taskId: 't2', time: 12345, title: 'Numeric time' },
  { taskId: 't3', time: '9:00 AM', title: 'Fine' },
];
let hostileRows;
try {
  hostileRows = annotatePlan(hostile, { nowMinutes: M(12) });
  check('malformed rows are dropped, valid ones survive', hostileRows.length, 3);
  check('row with no time is upcoming', hostileRows[0].state, 'upcoming');
  check('numeric time is upcoming', hostileRows[1].state, 'upcoming');
  check('valid past task is missed', hostileRows[2].state, 'missed');
} catch (error) {
  failures.push(`hostile input threw: ${error.message}`);
}

try {
  check('non-array plan yields no rows', annotatePlan(null).length, 0);
  check('undefined plan yields no rows', annotatePlan(undefined).length, 0);
  check('string plan yields no rows', annotatePlan('nope').length, 0);
  check('no options does not throw', Array.isArray(annotatePlan([])), true);
} catch (error) {
  failures.push(`empty input threw: ${error.message}`);
}

// ── now-line placement ──────────────────────────────────────────
const annotated = annotatePlan(plan, { nowMinutes: M(10, 30) });
check('now-line sits before the next future row', firstUpcomingIndex(annotated, M(10, 30)), 3);
check('now-line absent when nothing is left', firstUpcomingIndex(annotated, M(23)), -1);
check('now-line is the first row before the day starts', firstUpcomingIndex(annotated, M(6)), 0);

// ── report ──────────────────────────────────────────────────────
console.log(`\nPlanner state checks: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log('All planner time rules hold.\n');

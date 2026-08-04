/* global __dirname */
/**
 * Counts AsyncStorage round-trips per widget render and per widget tap.
 *
 * Run: node scripts/check-widget-latency.js
 *
 * Why: the widget's perceived speed is dominated by the headless JS task, but
 * every AsyncStorage call is a separate native bridge round-trip on top of that.
 * These counts are the part we control, so they are pinned here — a future edit
 * that reintroduces a sequential read will fail this instead of quietly making
 * every tap slower.
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '..');

let calls = [];
const store = new Map();

const StorageStub = {
  get: async (k) => { calls.push(`get:${k}`); return store.has(k) ? store.get(k) : null; },
  getBatch: async (keys) => {
    calls.push(`getBatch:${keys.length}`);
    const out = {};
    for (const k of keys) out[k] = store.has(k) ? store.get(k) : null;
    return out;
  },
  set: async (k, v) => { calls.push(`set:${k}`); store.set(k, v); },
  setBatch: async (entries) => { calls.push(`setBatch:${entries.length}`); entries.forEach(([k, v]) => store.set(k, v)); },
  remove: async (k) => { calls.push(`remove:${k}`); store.delete(k); },
};

function h(type, props, ...children) {
  const flat = [];
  const push = (c) => {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) c.forEach(push);
    else flat.push(c);
  };
  children.forEach(push);
  if (typeof type === 'function' && !type.__isPrimitive) {
    return type({ ...(props || {}), children: flat.length === 1 ? flat[0] : flat });
  }
  const name = typeof type === 'function' ? type.__widgetName : String(type);
  return { type: name, props: props || {}, children: flat };
}

const primitive = (name) => {
  const fn = () => null;
  fn.__isPrimitive = true;
  fn.__widgetName = name;
  return fn;
};

const stubs = {
  'react-native-android-widget': {
    FlexWidget: primitive('FlexWidget'),
    TextWidget: primitive('TextWidget'),
    ListWidget: primitive('ListWidget'),
    OverlapWidget: primitive('OverlapWidget'),
    SvgWidget: primitive('SvgWidget'),
    registerWidgetTaskHandler: () => {},
  },
  '../utils/storage': { Storage: StorageStub },
  '../lib/syncQueue': { enqueueMutation: async () => { calls.push('enqueue'); } },
};

const cache = {};
function load(relPath) {
  const file = path.resolve(ROOT, relPath);
  if (cache[file]) return cache[file];
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    plugins: [
      ['@babel/plugin-transform-react-jsx', { pragma: '__h' }],
      ['@babel/plugin-transform-modules-commonjs'],
    ],
  });
  const module = { exports: {} };
  cache[file] = module.exports;
  const dir = path.dirname(file);
  const localRequire = (request) => {
    if (stubs[request]) return stubs[request];
    if (request.startsWith('.')) {
      const resolved = path.resolve(dir, request);
      const withExt = fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory() ? resolved : `${resolved}.js`;
      const asStubKey = `../${path.relative(path.join(ROOT, 'src'), withExt).replace(/\\/g, '/')}`;
      if (stubs[asStubKey]) return stubs[asStubKey];
      return load(path.relative(ROOT, withExt));
    }
    return require(request);
  };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__h', 'console', code)(
    module, module.exports, localRequire, h, console
  );
  cache[file] = module.exports;
  return module.exports;
}

const { TodayTasksWidget } = load('src/widgets/TodayTasksWidget.js');
const { widgetTaskHandler } = load('src/widgets/registerWidgets.js');

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const USER = 'u1';
function seed() {
  store.clear();
  store.set('current_user_id', USER);
  store.set('widget_bg_opacity', '90');
  store.set('widget_bg_style', 'solid');
  store.set('widget_list_id', 'today');
  store.set('widget_last_w', 320);
  store.set('widget_last_h', 420);
  store.set(`lists_${USER}`, [{ id: 'l1', name: 'Work' }]);
  store.set(`tasks_${USER}`, [
    {
      id: 1,
      title: 'Task with steps',
      order_index: 0,
      subtasks: [{ id: 's1', title: 'One', is_completed: false }, { id: 's2', title: 'Two', is_completed: false }],
    },
    { id: 2, title: 'Plain task', order_index: 1 },
  ]);
}

(async () => {
  console.log('\nrender cost');
  seed();
  calls = [];
  await TodayTasksWidget({ widgetInfo: { width: 320, height: 420 } });
  const reads = calls.filter((c) => c.startsWith('get'));
  const writes = calls.filter((c) => c.startsWith('set'));
  console.log(`  calls: ${calls.join(', ') || '(none)'}`);
  check('a render costs exactly 2 reads', reads.length === 2, `${reads.length}`);
  check('no per-key sequential get remains', !calls.some((c) => c.startsWith('get:')), calls.filter((c) => c.startsWith('get:')).join(','));
  check('an unchanged size writes nothing', writes.length === 0, writes.join(','));

  // A size change should persist in ONE multiSet, not two writes.
  calls = [];
  await TodayTasksWidget({ widgetInfo: { width: 300, height: 400 } });
  const sizeWrites = calls.filter((c) => c.startsWith('set'));
  check('a size change costs one batched write', sizeWrites.length === 1 && sizeWrites[0] === 'setBatch:2', sizeWrites.join(','));

  console.log('\nexpand/collapse tap cost');
  seed();
  calls = [];
  await widgetTaskHandler({
    widgetInfo: { widgetName: 'TodayTasksWidget', width: 320, height: 420 },
    widgetAction: 'WIDGET_CLICK',
    clickAction: 'CUSTOM_ACTION',
    clickActionData: { action: 'TOGGLE_EXPAND_TASK', taskId: 1, expanded: 'false' },
    renderWidget: () => {},
  });
  console.log(`  calls: ${calls.join(', ')}`);
  const tapReads = calls.filter((c) => c.startsWith('get'));
  const tapWrites = calls.filter((c) => c.startsWith('set'));
  check('toggling needs NO read before writing', !calls.slice(0, calls.indexOf('set:widget_expanded_task')).some((c) => c.startsWith('get')), calls.join(','));
  check('toggling writes once', tapWrites.length === 1, tapWrites.join(','));
  check('the redraw after a tap costs 2 reads', tapReads.length === 2, `${tapReads.length}`);
  check('a whole expand tap is 3 storage round-trips', calls.length === 3, `${calls.length}: ${calls.join(',')}`);
  check('the tapped task is now expanded', store.get('widget_expanded_task') === '1', String(store.get('widget_expanded_task')));

  // Collapsing again must clear it, still without a read.
  calls = [];
  await widgetTaskHandler({
    widgetInfo: { widgetName: 'TodayTasksWidget', width: 320, height: 420 },
    widgetAction: 'WIDGET_CLICK',
    clickAction: 'CUSTOM_ACTION',
    clickActionData: { action: 'TOGGLE_EXPAND_TASK', taskId: 1, expanded: 'true' },
    renderWidget: () => {},
  });
  check('collapsing clears the expanded task', store.get('widget_expanded_task') === '', JSON.stringify(store.get('widget_expanded_task')));
  check('collapsing is also 3 round-trips', calls.length === 3, `${calls.length}`);

  // Opening a second task must replace the first (accordion), not accumulate.
  await widgetTaskHandler({
    widgetInfo: { widgetName: 'TodayTasksWidget', width: 320, height: 420 },
    widgetAction: 'WIDGET_CLICK',
    clickAction: 'CUSTOM_ACTION',
    clickActionData: { action: 'TOGGLE_EXPAND_TASK', taskId: 1, expanded: 'false' },
    renderWidget: () => {},
  });
  await widgetTaskHandler({
    widgetInfo: { widgetName: 'TodayTasksWidget', width: 320, height: 420 },
    widgetAction: 'WIDGET_CLICK',
    clickAction: 'CUSTOM_ACTION',
    clickActionData: { action: 'TOGGLE_EXPAND_TASK', taskId: 2, expanded: 'false' },
    renderWidget: () => {},
  });
  check('only one task stays open at a time', store.get('widget_expanded_task') === '2', String(store.get('widget_expanded_task')));

  console.log('\nstep tick tap cost');
  seed();
  calls = [];
  await widgetTaskHandler({
    widgetInfo: { widgetName: 'TodayTasksWidget', width: 320, height: 420 },
    widgetAction: 'WIDGET_CLICK',
    clickAction: 'CUSTOM_ACTION',
    clickActionData: { action: 'TOGGLE_SUBTASK', taskId: 1, subId: 's1' },
    renderWidget: () => {},
  });
  console.log(`  calls: ${calls.join(', ')}`);
  check('ticking a step still enqueues durably', calls.includes('enqueue'));
  check('the step is ticked locally first', store.get(`tasks_${USER}`)[0].subtasks[0].is_completed === true);
  check('the sync enqueue happens AFTER the redraw', calls.indexOf('enqueue') > calls.lastIndexOf('getBatch:3'), calls.join(','));
  check('the local write is one batched set, not two', calls.filter((c) => c.startsWith('set')).length === 1 && calls.includes('setBatch:2'), calls.filter((c) => c.startsWith('set')).join(','));
  check('a step tick is 5 storage round-trips', calls.filter((c) => c !== 'enqueue').length === 5, `${calls.filter((c) => c !== 'enqueue').length}: ${calls.join(',')}`);

  console.log(failures === 0 ? '\nAll widget latency budgets hold.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nHarness crashed:', e);
  process.exit(1);
});

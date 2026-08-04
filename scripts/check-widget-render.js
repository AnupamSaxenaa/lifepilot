/* global __dirname */
/**
 * Renders the home-screen widgets headlessly and inspects the resulting tree.
 *
 * Run: node scripts/check-widget-render.js
 *
 * Why this exists: a widget can only be judged by eye once it is on a home
 * screen, which needs a full native rebuild. This transpiles the widget files,
 * stubs Storage and the RemoteViews primitives, and asserts on the tree that
 * would have been serialized — so regressions in tags, strikethroughs and state
 * colours are caught without a build.
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '..');

// ── module loader: transpile JSX, stub the native library ────────
const stubs = {};
const cache = {};

function h(type, props, ...children) {
  const flat = [];
  const push = (c) => {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) c.forEach(push);
    else flat.push(c);
  };
  children.forEach(push);
  const name = typeof type === 'function' ? type.__widgetName || type.name : String(type);
  // Function components are invoked so the assertions see the final tree.
  if (typeof type === 'function' && !type.__isPrimitive) {
    return type({ ...(props || {}), children: flat.length === 1 ? flat[0] : flat });
  }
  return { type: name, props: props || {}, children: flat };
}

function primitive(name) {
  const fn = () => null;
  Object.defineProperty(fn, 'name', { value: name });
  fn.__isPrimitive = true;
  fn.__widgetName = name;
  return fn;
}

stubs['react-native-android-widget'] = {
  FlexWidget: primitive('FlexWidget'),
  TextWidget: primitive('TextWidget'),
  ListWidget: primitive('ListWidget'),
  OverlapWidget: primitive('OverlapWidget'),
  SvgWidget: primitive('SvgWidget'),
  ImageWidget: primitive('ImageWidget'),
  IconWidget: primitive('IconWidget'),
};

const store = new Map();
stubs['../utils/storage'] = {
  Storage: {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    getBatch: async (keys) => {
      const out = {};
      for (const k of keys) out[k] = store.has(k) ? store.get(k) : null;
      return out;
    },
    set: async (k, v) => { store.set(k, v); },
    setBatch: async (entries) => { entries.forEach(([k, v]) => store.set(k, v)); },
    remove: async (k) => { store.delete(k); },
  },
};

function load(relPath) {
  const file = path.resolve(ROOT, relPath);
  if (cache[file]) return cache[file];

  const code = fs.readFileSync(file, 'utf8');
  const { code: out } = babel.transformSync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    presets: [],
    plugins: [
      ['@babel/plugin-transform-react-jsx', { pragma: '__h', pragmaFrag: '__frag' }],
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
      const withExt = fs.existsSync(resolved) ? resolved : `${resolved}.js`;
      // Stub keys are written relative to the widgets dir; match on basename too.
      const byName = `../${path.relative(path.join(ROOT, 'src'), withExt).replace(/\\/g, '/')}`;
      if (stubs[byName]) return stubs[byName];
      return load(path.relative(ROOT, withExt));
    }
    return require(request);
  };

  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__h', '__frag', 'console', out)(
    module,
    module.exports,
    localRequire,
    h,
    'Fragment',
    console
  );
  cache[file] = module.exports;
  return module.exports;
}

// storage stub is referenced as '../utils/storage' from src/widgets/*
stubs['../utils/storage'] = stubs['../utils/storage'];

const { TodayTasksWidget } = load('src/widgets/TodayTasksWidget.js');
const { PlannerWidget } = load('src/widgets/PlannerWidget.js');
const { resolveReadablePalette, semanticColor, contrastRatio } = load('src/widgets/widgetTheme.js');

// ── tree helpers ────────────────────────────────────────────────
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  visit(node);
  (node.children || []).forEach((c) => walk(c, visit));
}

const texts = (tree) => {
  const out = [];
  walk(tree, (n) => { if (n.type === 'TextWidget' && n.props.text != null) out.push(String(n.props.text)); });
  return out;
};

const nodesOf = (tree, type) => {
  const out = [];
  walk(tree, (n) => { if (n.type === type) out.push(n); });
  return out;
};

const colorsUsed = (tree) => {
  const out = new Set();
  walk(tree, (n) => {
    const s = n.props && n.props.style;
    if (!s) return;
    if (s.color) out.add(String(s.color).toUpperCase());
    if (s.backgroundColor) out.add(String(s.backgroundColor).toUpperCase());
    if (s.borderColor) out.add(String(s.borderColor).toUpperCase());
  });
  return out;
};

/** Count strikethrough overlays: an OverlapWidget wrapping text + a 1dp bar. */
function strikeCount(tree) {
  let n = 0;
  walk(tree, (node) => {
    if (node.type !== 'OverlapWidget') return;
    const hasText = (node.children || []).some((c) => c && c.type === 'TextWidget');
    let hasBar = false;
    walk(node, (inner) => {
      if (inner === node) return;
      const s = inner.props && inner.props.style;
      if (inner.type === 'FlexWidget' && s && s.height === 1 && s.backgroundColor) hasBar = true;
    });
    if (hasText && hasBar) n += 1;
  });
  return n;
}

/** Titles that are struck through. */
function struckTitles(tree) {
  const out = [];
  walk(tree, (node) => {
    if (node.type !== 'OverlapWidget') return;
    let hasBar = false;
    walk(node, (inner) => {
      if (inner === node) return;
      const s = inner.props && inner.props.style;
      if (inner.type === 'FlexWidget' && s && s.height === 1 && s.backgroundColor) hasBar = true;
    });
    if (!hasBar) return;
    (node.children || []).forEach((c) => {
      if (c && c.type === 'TextWidget' && c.props.text) out.push(String(c.props.text));
    });
  });
  return out;
}

/** Colour of the struck title, so done=green / missed=red can be asserted. */
function struckTitleColors(tree) {
  const out = {};
  walk(tree, (node) => {
    if (node.type !== 'OverlapWidget') return;
    (node.children || []).forEach((c) => {
      if (c && c.type === 'TextWidget' && c.props.text && c.props.style && c.props.style.color) {
        out[String(c.props.text)] = String(c.props.style.color).toUpperCase();
      }
    });
  });
  return out;
}

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── fixtures ────────────────────────────────────────────────────
const USER = 'u1';
const iso = (h, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

function seedTasks() {
  store.set('current_user_id', USER);
  store.set(`lists_${USER}`, [{ id: 'l1', name: 'Work' }, { id: 'l2', name: 'Home' }]);
  store.set(`tasks_${USER}`, [
    { id: 1, title: 'Urgent thing', priority: 3, due_date: daysAgo(2), list_id: 'l1', order_index: 0, is_important: true },
    { id: 2, title: 'High thing', priority: 2, reminder_time: iso(9, 30), repeat_rule: 'daily', order_index: 1 },
    { id: 3, title: 'Normal thing', priority: 1, order_index: 2, notes: 'some notes' },
    { id: 4, title: 'Low thing', priority: 0, order_index: 3 },
    { id: 5, title: 'No priority thing', order_index: 4 },
    {
      id: 6,
      title: 'Task with steps',
      priority: 2,
      order_index: 5,
      subtasks: [{ id: 's1', title: 'Step one', is_completed: true }, { id: 's2', title: 'Step two', is_completed: false }],
    },
    { id: 7, title: 'Finished today', is_completed: true, completed_at: new Date().toISOString(), order_index: 6 },
  ]);
  store.set('widget_list_id', 'today');
  store.set('widget_bg_opacity', '90');
  store.set('widget_bg_style', 'solid');
  store.set('widget_hide_completed', 'false');
  store.set('widget_expanded_task', '6');
}

(async () => {
  console.log('\n=== TODAY TASKS WIDGET ===\n');
  seedTasks();

  const large = await TodayTasksWidget({ widgetInfo: { width: 320, height: 420 } });
  const allText = texts(large).join(' | ');

  check('renders every active task', [1, 2, 3, 4, 5, 6].every((id) => {
    const title = store.get(`tasks_${USER}`).find((t) => t.id === id).title;
    return allText.includes(title);
  }));

  // Priority flags: one per task that has a priority set (ids 1,2,3,4,6 = 5),
  // and NOT for the task with no priority (id 5). Flags are drawn shapes, so
  // they are counted by their colour rather than by text.
  const flagColors = [];
  walk(large, (n) => {
    const s = n.props && n.props.style;
    if (n.type === 'FlexWidget' && s && s.width === 1.5 && s.backgroundColor) flagColors.push(s.backgroundColor);
  });
  check('draws a priority flag for every task that has one', flagColors.length === 5, `found ${flagColors.length}`);
  check('flag colours cover urgent/high/normal/low', ['#FB7185', '#FBBF24', '#60A5FA', '#34D399'].every((c) => flagColors.includes(c)), flagColors.join(','));

  // Tags must appear as discrete chips, not one merged caption.
  // Tags must be discrete chips, not the old "9:30 AM  ·  Nov 8  ·  Daily"
  // caption. (A bare "·" is still used as the bullet for an unfinished step.)
  check('no merged "  ·  " caption remains', !allText.includes('  ·  '), allText);
  check('shows overdue due-date tag', texts(large).some((t) => /^[A-Z][a-z]{2} \d+$/.test(t)));
  check('shows reminder time tag', texts(large).some((t) => /\d{1,2}:\d{2}\s?(AM|PM)/i.test(t)));
  check('shows repeat tag title-cased', allText.includes('Daily'));
  // Step progress is asserted on the toggle button below, not as a chip — the
  // chip was removed to stop the same fraction appearing twice on one row.
  check('shows notes tag', allText.includes('note'));
  check('shows list name tag', allText.includes('Work'));
  check('shows the important star', allText.includes('★'));

  // Real strikethrough, since RemoteViews has no textDecorationLine.
  const struck = struckTitles(large);
  check('completed task title is really struck through', struck.includes('Finished today'), struck.join(','));
  check('completed subtask is struck through', struck.includes('Step one'), struck.join(','));
  check('open tasks are NOT struck through', !struck.includes('Urgent thing'), struck.join(','));

  // Overdue must be the danger colour, and it must be the resolved one.
  const palette = resolveReadablePalette({ bg: '#000000' });
  check('overdue tag uses the resolved danger colour', colorsUsed(large).has(palette.danger.toUpperCase()), palette.danger);

  // Size responsiveness.
  const nano = await TodayTasksWidget({ widgetInfo: { width: 320, height: 110 } });
  check('nano shows the remaining count', texts(nano).includes('LEFT'));
  const small = await TodayTasksWidget({ widgetInfo: { width: 160, height: 200 } });
  check('small drops tag chips to save room', !texts(small).join(' ').includes('1/2 steps'));

  // Tag budget: no row may exceed the budget for its size.
  const chipRows = [];
  walk(large, (n) => {
    if (n.type !== 'FlexWidget') return;
    const s = n.props.style || {};
    if (s.flexDirection !== 'row' || s.marginTop !== 5) return;
    chipRows.push((n.children || []).filter((c) => c && c.type === 'FlexWidget').length);
  });
  check('tag rows respect the large budget of 4', chipRows.every((c) => c <= 4), chipRows.join(','));

  check('no unsupported textDecorationLine is emitted', (() => {
    let bad = false;
    walk(large, (n) => { if (n.props && n.props.style && n.props.style.textDecorationLine) bad = true; });
    return !bad;
  })());

  // ── steps: collapse toggle + scrollable rows ──────────────────
  const findAction = (tree, action) => {
    const out = [];
    walk(tree, (n) => {
      const d = n.props && n.props.clickActionData;
      if (d && d.action === action) out.push(n);
    });
    return out;
  };

  const toggles = findAction(large, 'TOGGLE_EXPAND_TASK');
  check('exactly one steps toggle (only task 6 has steps)', toggles.length === 1, `found ${toggles.length}`);
  check('toggle carries its current state for a read-free write', toggles[0] && toggles[0].props.clickActionData.expanded === 'true', JSON.stringify(toggles[0] && toggles[0].props.clickActionData));
  check('toggle is a readable tap target, not a bare glyph', toggles[0] && toggles[0].props.style.height >= 26, String(toggles[0] && toggles[0].props.style.height));
  check('toggle shows step progress', texts(toggles[0]).join('').includes('1/2'), texts(toggles[0]).join(''));
  check('steps fraction is not also duplicated as a chip', !allText.includes('1/2 steps'), allText);

  // Steps must be SIBLINGS inside the scrollable ListWidget, not nested in the
  // task row — collections cannot nest, so nesting would clip instead of scroll.
  const list = nodesOf(large, 'ListWidget')[0];
  const stepRowsAtTop = (list.children || []).filter((c) => {
    let found = false;
    walk(c, (n) => {
      const d = n.props && n.props.clickActionData;
      if (d && d.action === 'TOGGLE_SUBTASK') found = true;
    });
    return found;
  });
  check('expanded steps are direct children of the scrollable list', stepRowsAtTop.length === 2, `found ${stepRowsAtTop.length}`);
  check('step rows are not nested inside the task row', (() => {
    // The task row is the sibling that owns the toggle; it must contain no steps.
    const taskRow = (list.children || []).find((c) => {
      let found = false;
      walk(c, (n) => {
        const d = n.props && n.props.clickActionData;
        if (d && d.action === 'TOGGLE_EXPAND_TASK') found = true;
      });
      return found;
    });
    let nested = false;
    walk(taskRow, (n) => {
      const d = n.props && n.props.clickActionData;
      if (d && d.action === 'TOGGLE_SUBTASK') nested = true;
    });
    return !nested;
  })());

  // A collection item's ROOT clickAction is stripped by the native layer, so a
  // step row that put its tap there would silently do nothing.
  check('step row root has no clickAction (it would be stripped)', stepRowsAtTop.every((r) => !r.props.clickAction), '');
  check('step row tap lives on an inner element', stepRowsAtTop.every((r) => {
    let inner = false;
    (r.children || []).forEach((c) => walk(c, (n) => {
      const d = n.props && n.props.clickActionData;
      if (d && d.action === 'TOGGLE_SUBTASK') inner = true;
    }));
    return inner;
  }), '');

  check('step titles are rendered', allText.includes('Step one') && allText.includes('Step two'));

  // Collapsed: no step rows at all.
  store.set('widget_expanded_task', '');
  const collapsed = await TodayTasksWidget({ widgetInfo: { width: 320, height: 420 } });
  check('collapsed renders no step rows', findAction(collapsed, 'TOGGLE_SUBTASK').length === 0);
  check('collapsed toggle reports collapsed state', findAction(collapsed, 'TOGGLE_EXPAND_TASK')[0].props.clickActionData.expanded === 'false');
  check('collapsed still shows the steps count on the toggle', texts(collapsed).join(' ').includes('1/2'));

  // Only ONE task open at a time — the accordion that makes the write read-free.
  store.set('widget_expanded_task', '6');

  // Step overflow is capped so an expand tap can't turn into a huge render.
  const many = store.get(`tasks_${USER}`).map((t) => (t.id === 6
    ? { ...t, subtasks: Array.from({ length: 25 }, (_, i) => ({ id: `x${i}`, title: `Step ${i}`, is_completed: false })) }
    : t));
  store.set(`tasks_${USER}`, many);
  const capped = await TodayTasksWidget({ widgetInfo: { width: 320, height: 420 } });
  check('step count is capped at the large bucket limit', findAction(capped, 'TOGGLE_SUBTASK').length === 10, `found ${findAction(capped, 'TOGGLE_SUBTASK').length}`);
  check('overflow is surfaced as "+N more steps"', texts(capped).join(' ').includes('+15 more steps'), texts(capped).join(' '));
  seedTasks();

  // ── Today widget must also survive its 110dp resize floor ──────
  for (const [label, wpx, hpx] of [
    ['110dp floor', 110, 110],
    ['nano strip', 320, 110],
    ['small', 160, 200],
    ['medium', 250, 300],
    ['large', 400, 500],
  ]) {
    const t = await TodayTasksWidget({ widgetInfo: { width: wpx, height: hpx } });
    check(`Today widget renders at ${label} (${wpx}x${hpx})`, texts(t).length > 0);
    // Nothing may exceed the content width via a fixed width + margin.
    let overflow = null;
    walk(t, (n) => {
      const s = (n.props && n.props.style) || {};
      if (typeof s.width === 'number' && s.width > wpx) overflow = s.width;
    });
    check(`Today widget has no element wider than the widget at ${label}`, overflow === null, `${overflow}dp > ${wpx}dp`);
  }

  // Empty + logged-out paths must not throw.
  store.set(`tasks_${USER}`, []);
  const empty = await TodayTasksWidget({ widgetInfo: { width: 320, height: 420 } });
  check('empty state renders', texts(empty).join(' ').includes('Clear'));
  store.delete('current_user_id');
  const anon = await TodayTasksWidget({ widgetInfo: { width: 320, height: 420 } });
  check('logged-out state renders', texts(anon).join(' ').includes('Log in'));

  console.log('\n=== PLANNER WIDGET ===\n');
  store.clear();
  store.set('current_user_id', USER);
  store.set('widget_bg_opacity', '90');
  store.set('widget_bg_style', 'solid');
  store.set(`tasks_${USER}`, [
    { id: 't1', title: 'Gym', is_completed: true },
    { id: 't2', title: 'Write report', is_completed: false },
    { id: 't3', title: 'Review PRs', is_completed: false },
  ]);

  // Freeze the clock at 14:00 so past/now/future are deterministic.
  const RealDate = Date;
  const fixed = new RealDate();
  fixed.setHours(14, 0, 0, 0);
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(fixed);
      return new RealDate(...args);
    }
    static now() { return fixed.getTime(); }
  };

  store.set(`generated_plan_date_${USER}`, new Date().toDateString());
  store.set(`generated_plan_${USER}`, [
    { taskId: 't1', time: '8:00 AM', title: 'Gym', completed: false },
    { taskId: null, time: '9:00 AM', title: 'Breakfast', completed: false },
    { taskId: 't2', time: '10:00 AM', title: 'Write report', completed: false },
    { taskId: null, time: '1:00 PM', title: 'Lunch', completed: false },
    { taskId: 't3', time: '2:30 PM', title: 'Review PRs', completed: false },
    { taskId: null, time: '7:00 PM', title: 'Dinner', completed: false },
  ]);

  const plan = await PlannerWidget({ widgetInfo: { width: 320, height: 420 } });
  const planTexts = texts(plan);
  const planStruck = struckTitles(plan);
  const struckColors = struckTitleColors(plan);
  const p = resolveReadablePalette({ bg: '#000000' });

  check('renders the plan header', planTexts.join(' ').includes("TODAY'S PLAN"));
  check('completed task is struck through', planStruck.includes('Gym'), planStruck.join(','));
  check('completed task is GREEN', struckColors['Gym'] === p.success.toUpperCase(), struckColors['Gym']);
  check('missed task is struck through', planStruck.includes('Write report'), planStruck.join(','));
  check('missed task is RED', struckColors['Write report'] === p.danger.toUpperCase(), struckColors['Write report']);
  check('elapsed Aura block is struck through', planStruck.includes('Breakfast') && planStruck.includes('Lunch'), planStruck.join(','));
  check('elapsed block is NOT red or green', ![p.danger.toUpperCase(), p.success.toUpperCase()].includes(struckColors['Lunch']), struckColors['Lunch']);
  check('future rows are not struck', !planStruck.includes('Dinner'), planStruck.join(','));
  check('current row is not struck', !planStruck.includes('Review PRs'), planStruck.join(','));
  check('missed count is surfaced', planTexts.join(' ').includes('1 missed'), planTexts.join(' '));
  check('progress fraction is surfaced', planTexts.join(' ').includes('1/3'));

  const railCount = (tree) => {
    let rails = 0;
    walk(tree, (n) => {
      const s = n.props && n.props.style;
      if (n.type === 'FlexWidget' && s && s.width === 2 && s.height === 18 && s.backgroundColor === p.accent) rails += 1;
    });
    return rails;
  };

  // At exactly 14:00 the schedule genuinely has a hole: Lunch's window closed at
  // 14:00 and Review PRs does not open until 14:30. Nothing should be marked
  // "now" — inventing a current row there would be a lie.
  check('no now-rail during a gap in the schedule', railCount(plan) === 0, `found ${railCount(plan)}`);

  // Move the clock inside the 2:30 PM row and the rail must appear.
  fixed.setHours(14, 45, 0, 0);
  const planNow = await PlannerWidget({ widgetInfo: { width: 320, height: 420 } });
  check('exactly one now-rail inside a row window', railCount(planNow) === 1, `found ${railCount(planNow)}`);
  check('the current row is not struck', !struckTitles(planNow).includes('Review PRs'));
  fixed.setHours(14, 0, 0, 0);

  // ── resizability: the widget must survive being shrunk to its 110dp floor ──
  const rowWidthBudget = (tree, pad) => {
    // Sum the fixed-width columns of a plan row and make sure they leave room
    // for the title. Without this a narrow widget silently clips its content.
    const list = nodesOf(tree, 'ListWidget')[0];
    const row = (list.children || []).find((c) => c && c.type === 'FlexWidget' && (c.props.style || {}).flexDirection === 'row');
    if (!row) return null;
    let fixed = 0;
    (row.children || []).forEach((c) => {
      const s = (c && c.props && c.props.style) || {};
      if (typeof s.width === 'number') fixed += s.width + (s.marginRight || 0);
    });
    return { fixed, available: pad };
  };

  for (const [label, wpx, hpx, contentW] of [
    ['110dp floor', 110, 110, 110 - 16],
    ['narrow', 200, 260, 200 - 20],
    ['wide', 320, 420, 320 - 32],
  ]) {
    const t = await PlannerWidget({ widgetInfo: { width: wpx, height: hpx } });
    const budget = rowWidthBudget(t, contentW);
    check(
      `plan row fits at ${label} (${wpx}dp)`,
      budget && budget.fixed <= budget.available - 30,
      budget ? `fixed ${budget.fixed}dp of ${budget.available}dp content width` : 'no row found'
    );
    check(`renders without throwing at ${label}`, texts(t).length > 0);
  }

  // Three width bands, each shedding the least useful thing first.
  // tiny (<160dp): no time column at all — there is no room for one.
  const tinyTexts = texts(await PlannerWidget({ widgetInfo: { width: 150, height: 260 } }));
  check('tiny layout drops the time column', !tinyTexts.some((t) => /^\d{1,2}:\d{2}/.test(t)), tinyTexts.slice(0, 6).join('|'));
  check('tiny layout drops the header title', !tinyTexts.join(' ').includes("TODAY'S PLAN"), tinyTexts.slice(0, 4).join('|'));
  check('tiny layout still lists the plan', tinyTexts.join(' ').includes('Gym') && tinyTexts.join(' ').includes('Review PRs'));

  // narrow (160–219dp): keeps the time but strips the meridiem to fit.
  const narrowTexts = texts(await PlannerWidget({ widgetInfo: { width: 200, height: 260 } }));
  check('narrow layout keeps a time column', narrowTexts.includes('8:00'), narrowTexts.slice(0, 8).join('|'));
  check('narrow layout strips AM/PM', !narrowTexts.includes('8:00 AM'), narrowTexts.slice(0, 8).join('|'));
  check('narrow layout keeps the header title', narrowTexts.join(' ').includes("TODAY'S PLAN"));

  // wide: everything.
  const wideTexts = texts(await PlannerWidget({ widgetInfo: { width: 320, height: 420 } }));
  check('wide layout keeps the full time', wideTexts.includes('8:00 AM'), wideTexts.slice(0, 6).join('|'));
  check('wide layout keeps the title', wideTexts.join(' ').includes("TODAY'S PLAN"));

  // Expired plan / no plan paths.
  store.set(`generated_plan_date_${USER}`, 'Mon Jan 01 2024');
  const stale = await PlannerWidget({ widgetInfo: { width: 320, height: 420 } });
  check('stale plan shows the expiry notice', texts(stale).join(' ').includes('expired'));
  store.delete(`generated_plan_${USER}`);
  store.delete(`generated_plan_date_${USER}`);
  const noPlan = await PlannerWidget({ widgetInfo: { width: 320, height: 420 } });
  check('missing plan prompts building one', texts(noPlan).join(' ').includes('No plan yet'));

  global.Date = RealDate;

  console.log('\n=== SEMANTIC COLOUR CONTRAST ===\n');
  // The whole point of the ramps: red/green must stay readable on any theme.
  const backgrounds = ['#000000', '#FFFFFF', '#0B0B0D', '#F5F5F7', '#7A7A7A', '#1E1B4B', '#FDF2F8', '#334155'];
  const hueOf = (hex) => {
    const v = hex.replace('#', '');
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    return { redder: r > g, greener: g > r, b };
  };

  for (const bg of backgrounds) {
    const results = {};
    for (const kind of ['danger', 'success']) {
      const c = semanticColor(kind, bg);
      const ratio = contrastRatio(c, bg);
      results[kind] = { c, ratio };
      // 3:1 is the guaranteed floor; most themes clear AA comfortably.
      check(`${kind} on ${bg} → ${c} (${ratio.toFixed(2)}:1)`, ratio >= 2.95, `${ratio.toFixed(2)}:1`);
    }
    // Colour must never stop telling the two states apart, even on a mid-tone
    // background where neither hue can reach AA.
    check(
      `danger vs success stay distinguishable on ${bg}`,
      hueOf(results.danger.c).redder && hueOf(results.success.c).greener,
      `${results.danger.c} / ${results.success.c}`
    );
  }

  console.log(failures === 0 ? '\nAll widget render checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nHarness crashed:', e);
  process.exit(1);
});

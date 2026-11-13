// Unit tests for the challenge registry (Property 10 — graceful capability
// gating): getAvailable() must never return a challenge whose isAvailable()
// is false.
const { register, get, getAll, getAvailable } = require('./registry');

describe('challenge registry', () => {
  beforeEach(() => {
    // registry is a module-level Map; re-register fresh entries per test.
    register('always', { component: () => null, isAvailable: () => true });
    register('never', { component: () => null, isAvailable: () => false });
    register('throws', { component: () => null, isAvailable: () => { throw new Error('boom'); } });
    register('default', { component: () => null }); // no isAvailable -> defaults true
  });

  test('getAvailable only returns challenges whose isAvailable() is true', () => {
    const available = getAvailable().map((d) => d.id);
    expect(available).toContain('always');
    expect(available).toContain('default');
    expect(available).not.toContain('never');
    expect(available).not.toContain('throws');
  });

  test('a throwing isAvailable() is treated as unavailable, not a crash', () => {
    expect(() => getAvailable()).not.toThrow();
  });

  test('get() returns the full descriptor by id', () => {
    const d = get('always');
    expect(d.id).toBe('always');
    expect(typeof d.component).toBe('function');
  });

  test('getAll() returns every registered descriptor regardless of availability', () => {
    const ids = getAll().map((d) => d.id);
    expect(ids).toContain('never');
  });
});

// Note: the actual challenge components (MathChallenge.js, ShakeChallenge.js,
// etc.) import 'react-native' and are exercised via the app's Metro bundler /
// on-device testing, not this lightweight pure-logic Jest config. The tests
// above cover the registry mechanism itself (Property 10), which every
// challenge — including the RN-rendering ones — relies on identically.
describe('mission sequencing (via alarmController, cross-checked here at the id level)', () => {
  test('a mission is just an ordered list of challenge descriptors the registry can resolve', () => {
    register('step1', { component: () => null, isAvailable: () => true });
    register('step2', { component: () => null, isAvailable: () => true });
    const mission = [{ id: 'step1' }, { id: 'step2' }];
    for (const step of mission) {
      expect(get(step.id)).toBeDefined();
      expect(getAvailable().some((d) => d.id === step.id)).toBe(true);
    }
  });

  test('a mission step referencing an unregistered id is detectable (MissionRunner auto-skips it)', () => {
    const mission = [{ id: 'does-not-exist' }];
    expect(get(mission[0].id)).toBeUndefined();
  });
});

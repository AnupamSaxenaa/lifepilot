/**
 * Guards the login → Dashboard routing bug.
 *
 * ThemeProvider used to render `<ThemeHydrationScreen/>` INSTEAD OF `children`
 * while applying an account's theme for the first time. That unmounted the whole
 * navigator; when hydration finished and it remounted, React Navigation fell
 * back to `initialRouteName` — still the signed-out intro route on a first login
 * — so a successful login landed on the intro cards instead of the Dashboard.
 * It "worked" the second time only because the `theme_applied_<uid>` flag then
 * suppressed the loader.
 *
 * The invariant: children must stay mounted across a login, even while the
 * hydration overlay is visible.
 */
const React = require('react');

jest.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' },
  // nativewind (injected by the babel plugin) reads Appearance at import time.
  Appearance: { getColorScheme: () => 'dark', addChangeListener: () => ({ remove() {} }) },
  Dimensions: { get: () => ({ width: 400, height: 800 }), addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'android', select: (o) => o.android },
  StyleSheet: { create: (s) => s, absoluteFillObject: { position: 'absolute' } },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  ActivityIndicator: 'ActivityIndicator',
}));

jest.mock('nativewind', () => ({ NativeWindStyleSheet: { create: () => {}, setColorScheme: () => {} } }));

jest.mock('../lib/marketplace', () => ({
  getCatalog: jest.fn(async () => []),
  getOwnedCosmetics: jest.fn(async () => []),
}));

jest.mock('../theme/theme', () => ({
  COLORS: {
    dark: { background: '#000', surface: '#111', border: '#222', accent: '#fff' },
    light: { background: '#fff', surface: '#eee', border: '#ddd', accent: '#000' },
  },
}));

// No `theme_applied_<uid>` flag → the loader path, i.e. the buggy scenario.
// Must be `mock`-prefixed to be reachable from a jest.mock factory.
const mockStore = new Map();
jest.mock('../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
    set: jest.fn(async (k, v) => { mockStore.set(k, v); }),
    remove: jest.fn(async (k) => { mockStore.delete(k); }),
  },
}));

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

const { ThemeProvider } = require('./ThemeContext');
const TestRenderer = require('react-test-renderer');

describe('ThemeProvider keeps the app mounted while applying a theme', () => {
  beforeEach(() => { mockStore.clear(); });

  /** A child that records every mount and unmount. */
  const makeProbe = () => {
    const events = [];
    const Probe = () => {
      React.useEffect(() => {
        events.push('mount');
        return () => { events.push('unmount') };
      }, []);
      return React.createElement('Probe', null);
    };
    return { Probe, events };
  };

  it('does not unmount children when the user logs in', async () => {
    const { Probe, events } = makeProbe();

    let tree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(ThemeProvider, { userId: null }, React.createElement(Probe))
      );
    });

    expect(events).toEqual(['mount']);

    // The login: userId flips from null to a real id with no theme_applied flag,
    // which is exactly what used to swap children for the loading screen.
    await TestRenderer.act(async () => {
      tree.update(
        React.createElement(ThemeProvider, { userId: 'user-1' }, React.createElement(Probe))
      );
    });

    // The navigator (Probe) must never have been torn down. A single 'mount'
    // with no 'unmount' is the whole point: navigation state survives.
    expect(events).toEqual(['mount']);
    expect(events).not.toContain('unmount');
  });

  it('still shows the hydration overlay on a first login, on top of the app', async () => {
    const { Probe } = makeProbe();

    let tree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(ThemeProvider, { userId: null }, React.createElement(Probe))
      );
    });
    await TestRenderer.act(async () => {
      tree.update(
        React.createElement(ThemeProvider, { userId: 'user-1' }, React.createElement(Probe))
      );
    });

    const json = JSON.stringify(tree.toJSON());
    // Both present at once: the app underneath AND the overlay above it.
    expect(json).toContain('Probe');
    expect(json).toContain('ActivityIndicator');

    // And the overlay must be absolutely positioned, or it would push the app
    // out of the way instead of covering it.
    const indicators = tree.root.findAllByType('ActivityIndicator');
    expect(indicators.length).toBe(1);
    const overlay = indicators[0].parent;
    expect(overlay.props.style.position).toBe('absolute');
  });

  it('skips the overlay when the account already applied its theme', async () => {
    mockStore.set('theme_applied_user-2', 'true');
    const { Probe } = makeProbe();

    let tree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(ThemeProvider, { userId: null }, React.createElement(Probe))
      );
    });
    await TestRenderer.act(async () => {
      tree.update(
        React.createElement(ThemeProvider, { userId: 'user-2' }, React.createElement(Probe))
      );
    });

    expect(JSON.stringify(tree.toJSON())).not.toContain('ActivityIndicator');
  });

  it('never shows the overlay when the host opts out', async () => {
    const { Probe, events } = makeProbe();

    let tree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(
          ThemeProvider,
          { userId: null, showHydrationScreen: false },
          React.createElement(Probe)
        )
      );
    });
    await TestRenderer.act(async () => {
      tree.update(
        React.createElement(
          ThemeProvider,
          { userId: 'user-3', showHydrationScreen: false },
          React.createElement(Probe)
        )
      );
    });

    expect(JSON.stringify(tree.toJSON())).not.toContain('ActivityIndicator');
    expect(events).toEqual(['mount']);
  });
});

/**
 * LifePilot — Challenge Registry
 * ------------------------------------------------------------------
 * Central catalog of dismiss-mission challenges. Each descriptor has an
 * `isAvailable()` guard so a challenge whose native module/permission isn't
 * present is never offered (Property 10 — graceful capability gating).
 *
 * A challenge component receives: { difficulty, config, onComplete, onAbandon }
 * and must call `onComplete()` when the user has satisfied it.
 */
const registry = new Map();

export const register = (id, descriptor) => {
  registry.set(id, { id, ...descriptor });
};

/** All registered challenges whose availability check passes right now. */
export const getAvailable = () => {
  return Array.from(registry.values()).filter((d) => {
    try {
      return d.isAvailable ? d.isAvailable() : true;
    } catch (_e) {
      return false;
    }
  });
};

/** Re-run native capability checks before showing the mission builder. */
export const getAvailableAsync = async () => {
  const descriptors = Array.from(registry.values());
  const checks = await Promise.all(descriptors.map(async (d) => {
    try {
      if (d.isAvailableAsync) return !!(await d.isAvailableAsync());
      return d.isAvailable ? !!d.isAvailable() : true;
    } catch (_e) {
      return false;
    }
  }));
  return descriptors.filter((_d, index) => checks[index]);
};

export const get = (id) => registry.get(id);

export const getAll = () => Array.from(registry.values());

// ── Built-in, no-native-module challenges (Phase 2) ─────────────────────────
// Components are registered from their own files to avoid a circular import
// (registry <- component <- registry). Each challenge file calls `register()`
// on load; this module is imported once (e.g. from the mission runner) which
// pulls all of them in via `challenges/index.js`.

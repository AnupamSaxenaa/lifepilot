// ─── Pro Entitlement Context ─────────────────────────────────────────────────
// One place that knows whether the signed-in account holds Pro, so gated UI can
// ask without every screen firing its own RPC.
//
// RULES THIS OBEYS (see docs/02-codebase-map/02-architecture.md):
//   • Screens never call Supabase. The RPC goes through `dataManager`.
//   • Cached value paints INSTANTLY, then the server value replaces it. A paying
//     user offline must never be shown a paywall because a network call failed.
//   • The client NEVER grants itself Pro. `is_pro` here is a rendering hint;
//     `profiles.is_pro` is column-level revoked from clients and only the
//     revenuecat-webhook (service_role) can flip it. Anything that actually
//     costs money or compute re-checks server-side.
//
// Refresh happens on: mount, user change, app foreground, and explicitly after a
// purchase completes (the webhook is asynchronous, so `refreshPro` is exposed
// with a short retry for callers that just bought something).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { FREE_PRO_STATUS, fetchProStatus, loadProStatus } from '../lib/dataManager';

const ProContext = createContext({
  ...FREE_PRO_STATUS,
  loading: true,
  refreshPro: async () => FREE_PRO_STATUS,
});

// A purchase is credited by the billing webhook, which lands a moment after Play
// confirms. Poll briefly rather than telling the user it didn't work.
const PURCHASE_POLL_DELAYS_MS = [1500, 3000, 5000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const ProProvider = ({ userId, children }) => {
  // State is STAMPED with the user it belongs to, and the exposed value is
  // derived at render time. That way switching accounts needs no reset (a stale
  // entry simply stops matching), so this effect never calls setState
  // synchronously — which would cascade a re-render on every mount.
  const [entry, setEntry] = useState({ userId: null, status: null });
  const activeUser = useRef(userId);

  const matches = !!userId && entry.userId === userId && !!entry.status;
  const status = matches ? entry.status : FREE_PRO_STATUS;
  // Only "loading" while signed in and nothing has resolved for THIS user yet.
  const loading = !!userId && !matches;

  const adopt = useCallback((forUser, next, { fillOnly = false } = {}) => {
    if (!next || activeUser.current !== forUser) return;
    setEntry((prev) => {
      // The server value must not be clobbered by a cache read that resolved
      // later; `fillOnly` marks the cache path as "only if nothing is set yet".
      if (fillOnly && prev.userId === forUser && prev.status) return prev;
      return { userId: forUser, status: next };
    });
  }, []);

  useEffect(() => {
    activeUser.current = userId;
    if (!userId) return undefined;

    let cancelled = false;
    loadProStatus(userId, (fresh) => {
      if (!cancelled) adopt(userId, fresh);
    })
      .then((cached) => {
        if (!cancelled) adopt(userId, cached, { fillOnly: true });
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [userId, adopt]);

  // A subscription can lapse or be cancelled while the app is backgrounded.
  useEffect(() => {
    if (!userId) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      fetchProStatus(userId).then((fresh) => adopt(userId, fresh)).catch(() => {});
    });
    return () => sub.remove();
  }, [userId, adopt]);

  /**
   * Re-read entitlement now. Pass `{ awaitGrant: true }` straight after a
   * purchase to poll until the webhook has landed, so the UI unlocks without the
   * user having to restart the app.
   */
  const refreshPro = useCallback(async ({ awaitGrant = false } = {}) => {
    if (!userId) return FREE_PRO_STATUS;

    const attempt = async () => {
      const fresh = await fetchProStatus(userId);
      adopt(userId, fresh);
      return fresh;
    };

    let latest = await attempt();
    if (!awaitGrant || latest?.isPro) return latest ?? FREE_PRO_STATUS;

    for (const delay of PURCHASE_POLL_DELAYS_MS) {
      await sleep(delay);
      if (activeUser.current !== userId) break;
      latest = await attempt();
      if (latest?.isPro) break;
    }
    return latest ?? FREE_PRO_STATUS;
  }, [userId, adopt]);

  return (
    <ProContext.Provider value={{ ...status, loading, refreshPro }}>
      {children}
    </ProContext.Provider>
  );
};

/**
 * `const { isPro, planType, loading, refreshPro } = usePro();`
 *
 * `loading` is true only until the cached value is read (milliseconds). Gate on
 * `isPro` directly — treat "not yet known" as free, and let the value flip when
 * the server answers, rather than blocking the screen on a spinner.
 */
export const usePro = () => useContext(ProContext);

/** Shorthand for the common case. */
export const useIsPro = () => useContext(ProContext).isPro;

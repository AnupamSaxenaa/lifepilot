import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Storage } from '../utils/storage';

/**
 * useWidgetTaskSync — the widget → app half of two-way sync.
 *
 * When the home-screen widget toggles a task, it writes the updated task list
 * to `tasks_<uid>` and bumps `last_local_write_time`. This hook makes the app
 * pick that change up seamlessly:
 *
 *   • The instant the app returns to the foreground (e.g. right after the user
 *     tapped a task on the widget), it re-reads the cache and, if the write
 *     stamp changed since this screen last rendered, calls `onExternalChange`
 *     with the fresh cached tasks — so the UI reflects the widget action
 *     within a frame of resuming.
 *   • While the app is already in the foreground, it does a light poll so a
 *     widget tap on a split-screen / floating window also reflects quickly.
 *
 * It never fetches from the network and never overwrites in-flight local edits
 * (it only reacts to a NEWER write stamp than what this screen last saw), so it
 * composes safely with the existing offline-first dataManager flow.
 *
 * @param {string|null} userId
 * @param {(tasks:Array) => void} onExternalChange  called with fresh cached tasks
 * @param {number} [pollMs=1500]  foreground poll interval
 */
export function useWidgetTaskSync(userId, onExternalChange, pollMs = 6000) {
  const lastSeenRef = useRef(0);
  const cbRef = useRef(onExternalChange);

  // Kept current in an effect rather than assigned during render. Mutating a ref
  // while rendering is not safe under concurrent rendering — a render can be
  // abandoned and retried, so the ref could end up holding a callback from a pass
  // that never committed. The purpose is unchanged: the interval below always
  // calls the newest callback without needing to be torn down and recreated.
  useEffect(() => {
    cbRef.current = onExternalChange;
  }, [onExternalChange]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    // `last_widget_write_time` rather than `last_local_write_time`.
    //
    // The app bumps `last_local_write_time` on its own task writes as well, so
    // watching it meant this hook fired on changes the app itself had just made.
    // Five screens mount this hook, so a single in-app toggle woke all of them to
    // re-read the cache and push it back through onExternalChange — wasted work,
    // and a genuine hazard of replacing what the user was editing with a cached
    // copy. Only the widget's headless handler writes this key.
    const STAMP_KEY = 'last_widget_write_time';

    // Seed the baseline so we don't fire on the very first check.
    (async () => {
      const raw = await Storage.get(STAMP_KEY);
      if (!cancelled) lastSeenRef.current = raw ? parseInt(raw, 10) : 0;
    })();

    const check = async () => {
      try {
        const raw = await Storage.get(STAMP_KEY);
        const stamp = raw ? parseInt(raw, 10) : 0;
        if (stamp && stamp > lastSeenRef.current) {
          lastSeenRef.current = stamp;
          const tasks = (await Storage.get(`tasks_${userId}`)) || [];
          if (!cancelled) cbRef.current?.(tasks);
        }
      } catch (_e) {}
    };

    // The overwhelmingly common case is: tap the widget on the home screen, then
    // open the app. That is an AppState transition, and it is handled instantly
    // here — the poll only exists for split-screen and floating-window setups
    // where the app never leaves the foreground.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });

    // Default raised from 1.5s to 6s. At 1.5s, with this hook live on five
    // screens, the app performed a steady four AsyncStorage reads a second purely
    // to notice a widget tap that AppState already reports immediately.
    const interval = setInterval(check, pollMs);

    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(interval);
    };
  }, [userId, pollMs]);
}

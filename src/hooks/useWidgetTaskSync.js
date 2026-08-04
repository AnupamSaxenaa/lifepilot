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
export function useWidgetTaskSync(userId, onExternalChange, pollMs = 1500) {
  const lastSeenRef = useRef(0);
  const cbRef = useRef(onExternalChange);
  cbRef.current = onExternalChange;

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    // Seed the baseline so we don't fire on the very first check.
    (async () => {
      const raw = await Storage.get('last_local_write_time');
      lastSeenRef.current = raw ? parseInt(raw, 10) : 0;
    })();

    const check = async () => {
      try {
        const raw = await Storage.get('last_local_write_time');
        const stamp = raw ? parseInt(raw, 10) : 0;
        if (stamp && stamp > lastSeenRef.current) {
          lastSeenRef.current = stamp;
          const tasks = (await Storage.get(`tasks_${userId}`)) || [];
          if (!cancelled) cbRef.current?.(tasks);
        }
      } catch (_e) {}
    };

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });

    const interval = setInterval(check, pollMs);

    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(interval);
    };
  }, [userId, pollMs]);
}

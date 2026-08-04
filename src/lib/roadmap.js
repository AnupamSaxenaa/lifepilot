/**
 * LifePilot — Roadmap / "What's Coming" client
 * ---------------------------------------------------------------------------
 * Reads the owner-managed `roadmap_items` from Supabase so users can see what
 * to expect in upcoming updates. Offline-first, exactly like the rest of the
 * app: paint from cache instantly, then refresh from the server in the
 * background. The client is READ-ONLY here — items are managed by the owner
 * from the Supabase dashboard (see migration 0010).
 *
 * NEVER call supabase directly from screens for this — go through here so
 * caching / offline handling stays centralized (see AGENTS.md).
 */
import { Storage } from '../utils/storage';
import { supabase } from './supabase';

const CACHE_KEY = 'roadmap_items_v1';

/**
 * Load roadmap items, cache-first then background-refreshed.
 * @param {(items: any[]) => void} [onFresh] called with fresh server items.
 * @returns {Promise<any[]>} the cached items (may be empty on first ever run).
 */
export const loadRoadmap = async (onFresh) => {
  let cached = [];
  try {
    const raw = await Storage.get(CACHE_KEY);
    if (raw) cached = Array.isArray(raw) ? raw : JSON.parse(raw);
  } catch (_e) {
    cached = [];
  }

  const fetchBackground = async () => {
    try {
      const { data, error } = await supabase
        .from('roadmap_items')
        .select('id, title, description, status, emoji, target_version, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        await Storage.set(CACHE_KEY, data);
        if (onFresh) onFresh(data);
      }
    } catch (e) {
      console.log('[Roadmap] Background fetch failed:', e?.message || e);
    }
  };

  fetchBackground();
  return cached;
};

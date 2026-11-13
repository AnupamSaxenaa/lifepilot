// ─── Marketplace / Shards (client) ───────────────────────────
// Thin, SERVER-AUTHORITATIVE wrapper. The client never decides the balance,
// the price, or ownership — it only calls RPCs and caches the results for
// instant display. Every value shown here is confirmed by the server.
//
// Anti-abuse recap (enforced in migration 0004, not here):
//   • shard_balance / shards_lifetime_earned columns are REVOKE'd from clients.
//   • Prices live server-side in marketplace_items.
//   • Ownership rows are inserted ONLY by purchase_cosmetic (SECURITY DEFINER).
//   • claim_stone_shards is idempotent; purchase_cosmetic is atomic.
// ─────────────────────────────────────────────────────────────

import { NativeModules, Platform } from 'react-native';
import { Storage } from '../utils/storage';

const BAL_KEY = (uid) => `shard_balance_${uid}`;
const OWNED_KEY = (uid) => `owned_cosmetics_${uid}`;
const CATALOG_KEY = 'marketplace_catalog_v1';

// Marketplace item id -> native AppIconModule variant key (see AppIconModule.kt).
const APP_ICON_VARIANT = {
  icon_logo2: 'logo2',
};

const getClient = () => require('./supabase').supabase;

/**
 * Pull the authoritative shard balance from the server and cache it.
 * Falls back to the cached value when offline (display-only; spending always
 * re-checks the server).
 */
export const refreshShardBalance = async (userId) => {
  if (!userId) return { balance: 0, lifetime: 0, level: 1 };
  try {
    const supabase = getClient();
    const { data, error } = await supabase.rpc('get_shard_balance');
    if (!error && data) {
      await Storage.set(BAL_KEY(userId), JSON.stringify(data));
      return data;
    }
  } catch (_e) {}
  // Offline fallback: last known cached balance.
  try {
    const cached = await Storage.get(BAL_KEY(userId));
    if (cached) return JSON.parse(cached);
  } catch (_e) {}
  return { balance: 0, lifetime: 0, level: 1 };
};

/**
 * Ask the server to credit any shards owed for the user's current level.
 * Idempotent server-side — safe to call on every app open / level-up.
 * Returns { balance, lifetime, credited }.
 */
export const claimStoneShards = async (userId) => {
  if (!userId) return { balance: 0, lifetime: 0, credited: 0 };
  try {
    const supabase = getClient();
    const { data, error } = await supabase.rpc('claim_stone_shards');
    if (!error && data) {
      await Storage.set(BAL_KEY(userId), JSON.stringify({
        balance: data.balance, lifetime: data.lifetime, level: undefined,
      }));
      return data;
    }
  } catch (_e) {}
  return { balance: 0, lifetime: 0, credited: 0 };
};

/** Fetch the marketplace catalog (server is the source of truth for price). */
export const getCatalog = async () => {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('marketplace_items')
      .select('id, category, name, price, metadata')
      .eq('active', true)
      .order('price', { ascending: true });
    if (!error && Array.isArray(data)) {
      await Storage.set(CATALOG_KEY, JSON.stringify(data));
      return data;
    }
  } catch (_e) {}
  try {
    const cached = await Storage.get(CATALOG_KEY);
    if (cached) return JSON.parse(cached);
  } catch (_e) {}
  return [];
};

/** The user's owned cosmetics (item IDs). Server-authoritative, cached. */
/**
 * What this user may equip: everything they bought, plus the whole catalog while
 * Pro is active.
 *
 * The Pro union is computed SERVER-SIDE by `get_owned_cosmetics()` (migration
 * 0033) rather than client-side against a cached `isPro`, because a cached hint
 * is editable on-device and this list is what authorises equipping a paid item.
 * Pro grants access, not ownership — nothing is written to `user_cosmetics`, so a
 * lapsed subscription cleanly falls back to genuinely purchased items.
 */
export const getOwnedCosmetics = async (userId) => {
  if (!userId) return [];
  try {
    const supabase = getClient();
    const { data, error } = await supabase.rpc('get_owned_cosmetics');
    if (!error && Array.isArray(data)) {
      await Storage.set(OWNED_KEY(userId), JSON.stringify(data));
      return data;
    }
    // Pre-0033 database: fall back to the plain ownership read. Purchased items
    // still work; the Pro catalog unlock just isn't available yet.
    const { data: rows, error: rowErr } = await supabase
      .from('user_cosmetics')
      .select('item_id')
      .eq('user_id', userId);
    if (!rowErr && Array.isArray(rows)) {
      const ids = rows.map((r) => r.item_id);
      await Storage.set(OWNED_KEY(userId), JSON.stringify(ids));
      return ids;
    }
  } catch (_e) {}
  try {
    const cached = await Storage.get(OWNED_KEY(userId));
    if (cached) return JSON.parse(cached);
  } catch (_e) {}
  return [];
};

/**
 * Purchase a cosmetic. The SERVER decides price, checks balance, prevents
 * double-buy, and deducts atomically. Requires connectivity — we never let
 * the client "buy" offline, since that would risk desync/abuse.
 * Returns { success, reason, balance }.
 */
export const purchaseCosmetic = async (userId, itemId) => {
  if (!userId || !itemId) return { success: false, reason: 'bad_request', balance: 0 };
  try {
    const supabase = getClient();
    const { data, error } = await supabase.rpc('purchase_cosmetic', { p_item_id: itemId });
    if (error) return { success: false, reason: 'network', balance: 0 };
    if (data?.success) {
      // Refresh caches so the UI reflects the new balance + ownership.
      await Storage.set(BAL_KEY(userId), JSON.stringify({ balance: data.balance }));
      await getOwnedCosmetics(userId);
    }
    return data ?? { success: false, reason: 'unknown', balance: 0 };
  } catch (_e) {
    return { success: false, reason: 'network', balance: 0 };
  }
};

/**
 * Reconcile the native launcher icon (Android activity-alias) with the DB's
 * `equipped_icon` and current ownership. Called on app startup so that:
 *   - if the equipped icon's ownership was ever revoked, the native icon is
 *     reset to default and the DB field cleared.
 *   - if the native alias state ever drifted from the DB (e.g. after a
 *     reinstall/update where the alias defaults to disabled again), it's
 *     re-applied to match what the user has equipped.
 * No-ops on non-Android or when the native module isn't present (e.g. Expo
 * Go / a build that hasn't picked up the native module yet).
 */
export const reconcileAppIcon = async (userId, profileArg) => {
  if (!userId || Platform.OS !== 'android' || !NativeModules.AppIcon) return;
  try {
    const supabase = getClient();
    let profile = profileArg;
    if (!profile) {
      const { data } = await supabase.from('profiles').select('equipped_icon').eq('id', userId).single();
      profile = data;
    }
    const equippedIcon = profile?.equipped_icon || null;
    const desiredVariant = equippedIcon ? APP_ICON_VARIANT[equippedIcon] : null;

    // If an icon is equipped, confirm ownership is still valid.
    if (equippedIcon) {
      const owned = await getOwnedCosmetics(userId);
      if (!owned.includes(equippedIcon)) {
        // Ownership was revoked — clear the field and fall through to reset the icon.
        await supabase.from('profiles').update({ equipped_icon: null }).eq('id', userId);
        await NativeModules.AppIcon.setAppIcon('default');
        return;
      }
    }

    const current = await NativeModules.AppIcon.getCurrentIcon();
    const target = desiredVariant || 'default';
    if (current !== target) {
      await NativeModules.AppIcon.setAppIcon(target);
    }
  } catch (_e) {
    // Best-effort only — never block app startup on this.
  }
};

/**
 * LifePilot — Purchases (RevenueCat wrapper)
 * ---------------------------------------------------------------------------
 * Thin, crash-safe wrapper around `react-native-purchases` (RevenueCat).
 *
 * Design goals:
 *  • NEVER crash the app if the SDK isn't installed or no API key is set yet
 *    (so the current dev build keeps working before billing is wired).
 *  • Use the Supabase user id as the RevenueCat appUserID, so the billing
 *    webhook can map a purchase back to the correct profile server-side.
 *  • Entitlements ('pro') and token grants are applied SERVER-SIDE by the
 *    revenuecat-webhook edge function — the client never grants itself anything.
 *
 * Setup when ready:
 *  1. npx expo install react-native-purchases
 *  2. Set EXPO_PUBLIC_REVENUECAT_ANDROID_KEY in env
 *  3. Rebuild the dev/production APK (native module).
 */

import { Platform } from 'react-native';

// Product identifiers — MUST match the IDs created in Play Console + RevenueCat.
export const PRODUCTS = {
  PRO_MONTHLY: 'pro_monthly',
  PRO_YEARLY: 'pro_yearly',
  PRO_LIFETIME: 'pro_lifetime',
  TOKENS_50: 'tokens_50',
  TOKENS_150: 'tokens_150',
  TOKENS_500: 'tokens_500',
};

export const ENTITLEMENT_PRO = 'pro';

const RC_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';

let Purchases = null;
let configured = false;

// Lazily load the native SDK; returns null if not installed.
const getSDK = () => {
  if (Purchases !== null) return Purchases;
  try {
    // eslint-disable-next-line global-require
    Purchases = require('react-native-purchases').default;
  } catch (_e) {
    Purchases = false; // sentinel: not installed
  }
  return Purchases || null;
};

export const isBillingAvailable = () => {
  return Platform.OS === 'android' && !!RC_API_KEY && !!getSDK();
};

/**
 * Configure RevenueCat with the logged-in user's id. Safe to call multiple times.
 */
export const initPurchases = async (userId) => {
  const sdk = getSDK();
  if (!sdk || !RC_API_KEY || Platform.OS !== 'android') return false;
  try {
    if (!configured) {
      await sdk.configure({ apiKey: RC_API_KEY, appUserID: userId || undefined });
      configured = true;
    } else if (userId) {
      await sdk.logIn(userId);
    }
    return true;
  } catch (e) {
    console.log('[Purchases] init failed:', e.message);
    return false;
  }
};

/**
 * Returns the current RevenueCat offering (packages to show on the paywall),
 * or null if unavailable.
 */
export const getOfferings = async () => {
  const sdk = getSDK();
  if (!sdk || !RC_API_KEY) return null;
  try {
    const offerings = await sdk.getOfferings();
    return offerings?.current ?? null;
  } catch (e) {
    console.log('[Purchases] getOfferings failed:', e.message);
    return null;
  }
};

/**
 * Purchase a RevenueCat package. Returns { success, customerInfo, userCancelled }.
 * Entitlement/token grants are applied by the server webhook — after a successful
 * purchase the caller should refresh state from the server.
 */
export const purchasePackage = async (pkg) => {
  const sdk = getSDK();
  if (!sdk) return { success: false, error: 'billing_unavailable' };
  try {
    const { customerInfo } = await sdk.purchasePackage(pkg);
    return { success: true, customerInfo };
  } catch (e) {
    if (e?.userCancelled) return { success: false, userCancelled: true };
    console.log('[Purchases] purchase failed:', e.message);
    return { success: false, error: e.message };
  }
};

/**
 * Restore previous purchases (required by stores). Returns customerInfo or null.
 */
export const restorePurchases = async () => {
  const sdk = getSDK();
  if (!sdk) return null;
  try {
    return await sdk.restorePurchases();
  } catch (e) {
    console.log('[Purchases] restore failed:', e.message);
    return null;
  }
};

/**
 * Whether the user currently holds the 'pro' entitlement (client-side hint only;
 * the server is the source of truth for feature gating).
 */
export const checkProEntitlement = async () => {
  const sdk = getSDK();
  if (!sdk) return false;
  try {
    const info = await sdk.getCustomerInfo();
    return !!info?.entitlements?.active?.[ENTITLEMENT_PRO];
  } catch (_e) {
    return false;
  }
};

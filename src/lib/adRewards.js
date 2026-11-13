/**
 * LifePilot — Rewarded ads (AdMob wrapper)
 * ---------------------------------------------------------------------------
 * Thin, crash-safe wrapper around `react-native-google-mobile-ads`.
 *
 * Design goals mirror `purchases.js`:
 *  • NEVER crash if the SDK isn't installed or no ad unit is configured, so the
 *    app keeps working before ads are wired up. Every entry point degrades to
 *    "unavailable" instead of throwing.
 *  • The CLIENT NEVER GRANTS CREDITS. Finishing an ad only tells us to re-read
 *    the balance. Credits are granted by the `ad-reward` edge function after it
 *    verifies AdMob's server-side verification (SSV) signature, and the daily cap
 *    is enforced in `grant_ad_credits`. A client-trusted grant would be forgeable.
 *  • The Supabase user id travels to the callback as SSV `customData`, which is
 *    how the server knows whose account to credit.
 *
 * Setup when ready:
 *  1. npx expo install react-native-google-mobile-ads
 *  2. Add the AdMob app id to app.config.js (react-native-google-mobile-ads
 *     plugin config) — this is native, so it needs a rebuild.
 *  3. Set EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID to your rewarded ad unit id.
 *  4. Point the ad unit's server-side verification at the ad-reward function.
 */

import { Platform } from 'react-native';

const REWARDED_UNIT_ID = process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID || '';

// Devices registered here receive TEST ads from our REAL ad unit. Comma-separated
// hashes from EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS.
const TEST_DEVICE_IDS = (process.env.EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// ── Why we do NOT use Google's sample ad unit ──────────────────────────────
// Server-side verification is configured per ad unit, inside OUR AdMob account.
// Google's sample unit (ca-app-pub-3940256099942544/...) has no knowledge of our
// callback URL, so it NEVER calls the ad-reward function — meaning rewards can
// never be granted and the daily cap never advances. It looks like a broken
// reward when in fact no callback was ever sent.
//
// The policy-safe way to test is the real ad unit plus a registered TEST DEVICE,
// which serves test ads AND fires SSV. Register the device in AdMob (Settings →
// Test devices) and/or list its hash in EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS.
// The hash is printed by the SDK in logcat on the first ad request:
//   "Use RequestConfiguration.Builder.setTestDeviceIds(Arrays.asList("<HASH>"))"

let sdk = null;          // null = not tried yet, false = not installed
let initialised = false;

const getSDK = () => {
  if (sdk !== null) return sdk || null;
  try {
    sdk = require('react-native-google-mobile-ads');
  } catch (_e) {
    sdk = false; // sentinel: not installed
  }
  return sdk || null;
};

// Always our own unit — see the note above on why the sample unit cannot work.
const resolveUnitId = () => REWARDED_UNIT_ID;

/**
 * True when a rewarded ad could actually be shown.
 * Android-only for now, matching where the app ships.
 */
export const isRewardedAdAvailable = () => {
  if (Platform.OS !== 'android') return false;
  if (!getSDK()) return false;
  return !!resolveUnitId();
};

/**
 * Gather EEA/UK advertising consent (Google's UMP SDK).
 *
 * Required before serving ads to users in the EEA or UK: AdMob mandates a
 * Google-certified consent mechanism there, and serving without one risks the
 * account. Outside those regions `canRequestAds` comes back true immediately and
 * no form is shown, so this is cheap for everyone else.
 *
 * `gatherConsent` = requestInfoUpdate + show the form only if it is required.
 * Returns true when ads may be requested.
 *
 * Fails OPEN on error rather than closed. A consent-service outage should not
 * permanently remove a user's ability to earn credits, and the SDK itself still
 * withholds personalised ads when it has no consent signal.
 */
export const ensureAdsConsent = async () => {
  const mod = getSDK();
  if (!mod?.AdsConsent) return true;

  try {
    const info = await mod.AdsConsent.gatherConsent(
      __DEV__ && TEST_DEVICE_IDS.length > 0
        ? { testDeviceIdentifiers: TEST_DEVICE_IDS }
        : {},
    );
    // Older/newer shapes differ; treat a missing flag as permissive.
    if (info && typeof info.canRequestAds === 'boolean') {
      if (!info.canRequestAds) {
        console.log('[Ads] consent withheld — not requesting an ad');
      }
      return info.canRequestAds;
    }
    return true;
  } catch (e) {
    console.log('[Ads] consent gathering failed, continuing:', e?.message);
    return true;
  }
};

/** Initialise the SDK once. Safe to call repeatedly; never throws. */
export const initRewardedAds = async () => {
  const mod = getSDK();
  if (!mod || !isRewardedAdAvailable()) return false;
  if (initialised) return true;
  try {
    // Must be set BEFORE initialize() to take effect on the first request.
    if (__DEV__ || TEST_DEVICE_IDS.length > 0) {
      await mod.default().setRequestConfiguration({
        testDeviceIdentifiers: ['EMULATOR', ...TEST_DEVICE_IDS],
      });
      if (__DEV__ && TEST_DEVICE_IDS.length === 0) {
        console.log(
          '[Ads] No test device registered. This request will serve a REAL ad. '
          + 'Find the hash in logcat ("setTestDeviceIds") and add it to '
          + 'EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS so future requests are test ads.',
        );
      }
    }
    await mod.default().initialize();
    initialised = true;
    return true;
  } catch (e) {
    console.log('[Ads] init failed:', e?.message);
    return false;
  }
};

/**
 * Show a rewarded ad and resolve once it closes.
 *
 * Resolves { earned, reason }:
 *   earned true  → the user completed the ad. AdMob will (or already did) call
 *                  our SSV endpoint; the caller should re-read the balance from
 *                  the server rather than adding credits locally.
 *   earned false → reason is 'unavailable' | 'load_failed' | 'dismissed' | 'error'
 *
 * Never rejects — callers can treat this as a plain result.
 */
export const showRewardedAd = async ({ userId }) => {
  const mod = getSDK();
  if (!mod || !isRewardedAdAvailable()) return { earned: false, reason: 'unavailable' };
  if (!userId) return { earned: false, reason: 'unavailable' };

  // Consent must be resolved BEFORE the first ad request, or an EEA/UK user
  // could be served an ad with no consent signal at all.
  const mayRequestAds = await ensureAdsConsent();
  if (!mayRequestAds) return { earned: false, reason: 'consent_declined' };

  const ready = await initRewardedAds();
  if (!ready) return { earned: false, reason: 'unavailable' };

  const { AdEventType, RewardedAd, RewardedAdEventType } = mod;

  return new Promise((resolve) => {
    let settled = false;
    let earned = false;
    const unsubscribers = [];

    const finish = (result) => {
      if (settled) return;
      settled = true;
      unsubscribers.forEach((off) => { try { off(); } catch (_e) {} });
      resolve(result);
    };

    let rewarded;
    try {
      rewarded = RewardedAd.createForAdRequest(resolveUnitId(), {
        requestNonPersonalizedAdsOnly: true,
        // The SSV callback reads customData to identify the account to credit.
        serverSideVerificationOptions: { customData: String(userId) },
      });
    } catch (e) {
      console.log('[Ads] create failed:', e?.message);
      finish({ earned: false, reason: 'error' });
      return;
    }

    try {
      unsubscribers.push(
        rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
          try {
            rewarded.show();
          } catch (e) {
            console.log('[Ads] show failed:', e?.message);
            finish({ earned: false, reason: 'error' });
          }
        }),
      );

      unsubscribers.push(
        rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          // Only a signal. The grant happens server-side via SSV.
          earned = true;
        }),
      );

      unsubscribers.push(
        rewarded.addAdEventListener(AdEventType.CLOSED, () => {
          finish(earned ? { earned: true } : { earned: false, reason: 'dismissed' });
        }),
      );

      unsubscribers.push(
        rewarded.addAdEventListener(AdEventType.ERROR, (error) => {
          console.log('[Ads] error:', error?.message);
          finish({ earned: false, reason: 'load_failed' });
        }),
      );

      rewarded.load();
    } catch (e) {
      console.log('[Ads] listener wiring failed:', e?.message);
      finish({ earned: false, reason: 'error' });
    }
  });
};

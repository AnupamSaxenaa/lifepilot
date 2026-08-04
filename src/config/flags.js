
/**
 * LifePilot — Feature Flags
 * ---------------------------------------------------------------------------
 * Central on/off switches so you can keep building features without the
 * Play Store / billing setup getting in the way.
 *
 * PLAYSTORE_MODE:
 *   ON  → Monetization UI is live: Paywall banner shows in Settings, the
 *         Paywall screen is reachable, RevenueCat initializes on login.
 *         Use this once your Play Console account + products + RevenueCat
 *         are ready to actually sell.
 *
 *   OFF → All of the above is hidden/skipped. The app behaves like a normal
 *         free app with no purchase UI anywhere. Nothing related to billing
 *         runs, so there is zero dependency on Play Console being ready.
 *         This is the default while you're mid-development.
 *
 * Toggle it with the env var, no code change needed day-to-day:
 *   EXPO_PUBLIC_PLAYSTORE_MODE=true   → ON
 *   EXPO_PUBLIC_PLAYSTORE_MODE=false  → OFF (or just omit it)
 *
 * You can also hardcode DEFAULT_PLAYSTORE_MODE below for a quick local flip.
 */

const parseBooleanFlag = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
};

export const PLAYSTORE_MODE = parseBooleanFlag(
  process.env.EXPO_PUBLIC_PLAYSTORE_MODE,
  false,
);

// Rich alarms are hidden everywhere by default while the feature is unfinished,
// so the Dashboard bell and alarm routes stay out of LP LAB and the public APK.
// Turn them back on for alarm development with:
//   EXPO_PUBLIC_ALARMS_ENABLED=true
export const ALARMS_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_ALARMS_ENABLED,
  false,
);

export const FLAGS = {
  PLAYSTORE_MODE,
  ALARMS_ENABLED,
};

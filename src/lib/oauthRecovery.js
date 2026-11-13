// ─── OAuth redirect recovery ──────────────────────────────────────────────
// Completes a Google sign-in whose in-flight promise did not survive.
//
// THE BUG THIS FIXES
// signInWithGoogle() opens a Chrome Custom Tab and awaits its result, exchanging
// the returned PKCE `?code=` for a session inside that awaited call. That is the
// ONLY place the exchange happened. While the Custom Tab is in the foreground our
// app is backgrounded, and Android is free to kill it — which it readily does on
// memory-constrained devices, especially for a heavy release build.
//
// When that happens the browser still redirects to `lifepilot://?code=...`, but
// the promise waiting for it died with the old process. Android cold-starts the
// app, nothing looks at the incoming URL, no code is exchanged, and startup finds
// no cached session — so the user lands back on the onboarding intro cards having
// apparently done nothing. The same thing happens if the user simply switches
// apps mid-sign-in.
//
// WHY RECOVERY IS POSSIBLE
// supabase-js persists the PKCE code verifier in AsyncStorage before opening the
// browser, so it outlives the process. The authorisation code is therefore still
// redeemable after a restart — it just needs someone to redeem it.
//
// This module is that someone: it inspects the URL the app was opened with (and
// any URL delivered while running) and finishes the exchange.
// ──────────────────────────────────────────────────────────────────────────

import * as Linking from 'expo-linking';
import { supabase } from './supabase';

/**
 * Pull the OAuth parameters out of a redirect URL.
 *
 * Deliberately hand-parsed rather than using `new URL()`: the redirect is a
 * custom scheme (`lifepilot://?code=...`) with an empty host, which URL parsers
 * handle inconsistently, and the parameters may arrive in the query string
 * (PKCE) or the fragment (implicit flow).
 */
const readOAuthParams = (url) => {
  if (typeof url !== 'string' || url.length === 0) return null;

  const pick = (name) => {
    const match = url.match(new RegExp(`[?&#]${name}=([^&#]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  };

  const code = pick('code');
  const error = pick('error');
  const errorDescription = pick('error_description');
  if (!code && !error) return null;

  return { code, error, errorDescription };
};

/**
 * Redeem an authorisation code found in `url`, if there is one.
 *
 * @returns the established session, or null when the URL carries no code or the
 *          exchange fails. Never throws: this runs on the startup path, where an
 *          unhandled rejection would be far worse than an unfinished sign-in.
 */
export const completeOAuthFromUrl = async (url) => {
  const params = readOAuthParams(url);
  if (!params) return null;

  if (params.error) {
    console.log('[OAuthRecovery] provider returned an error:', params.errorDescription || params.error);
    return null;
  }

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      // Expected and harmless when the in-flow handler already redeemed this
      // code — an authorisation code is single-use, so the loser of that race
      // sees "invalid request". Nothing to recover, and a session already exists.
      console.log('[OAuthRecovery] code exchange failed:', error.message);
      return null;
    }
    if (data?.session) {
      console.log('[OAuthRecovery] recovered a session from a redirect the app did not survive');
      return data.session;
    }
    return null;
  } catch (e) {
    console.log('[OAuthRecovery] unexpected exchange failure:', e?.message);
    return null;
  }
};

/**
 * Check the URL the app was cold-started with. Call this before deciding the
 * initial route so a recovered sign-in lands on the dashboard instead of
 * onboarding.
 */
export const completeOAuthFromInitialUrl = async () => {
  try {
    const url = await Linking.getInitialURL();
    return await completeOAuthFromUrl(url);
  } catch {
    return null;
  }
};

/**
 * Handle redirects delivered while the app is already running — the case where
 * the process survived but the awaiting promise did not (for example after the
 * activity was recreated).
 *
 * @returns an unsubscribe function.
 */
export const subscribeOAuthRedirects = (onSession) => {
  const sub = Linking.addEventListener('url', ({ url }) => {
    completeOAuthFromUrl(url).then((session) => {
      if (session) onSession(session);
    });
  });
  return () => {
    try { sub?.remove?.(); } catch { /* already torn down */ }
  };
};

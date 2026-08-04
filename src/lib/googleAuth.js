// ─── Google OAuth (shared, production-safe) ──────────────────
// One implementation used by both Login and Register so they can't drift.
//
// Why this exists: the Supabase client uses the default PKCE flow, where the
// OAuth redirect returns a `?code=...` in the query string that must be
// exchanged via exchangeCodeForSession(). The old code only looked for an
// `access_token` in the URL *hash* (implicit flow), which PKCE never provides —
// so sign-in always failed with "No access token received." This handles the
// PKCE code exchange first, and still falls back to implicit-flow hash tokens
// for safety.
// ─────────────────────────────────────────────────────────────

import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// Ensures the in-app browser closes cleanly after the redirect (Android).
WebBrowser.maybeCompleteAuthSession();

// A single, stable redirect URI. This EXACT value must be added to Supabase →
// Authentication → URL Configuration → Redirect URLs (e.g. "lifepilot://").
export const getGoogleRedirectUri = () => makeRedirectUri({ scheme: 'lifepilot' });

/**
 * Runs the full Google OAuth flow and establishes a Supabase session.
 * Returns the session on success. Throws on error, or returns null if the
 * user cancelled.
 */
export const signInWithGoogle = async () => {
  const redirectTo = getGoogleRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true, // we open the browser ourselves
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Could not start Google sign-in.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return null; // user backed out
  }
  if (result.type !== 'success' || !result.url) {
    throw new Error('Google sign-in did not complete. Please try again.');
  }

  // Parse both the query string (PKCE: ?code=...) and the hash (implicit:
  // #access_token=...). PKCE is the default, so check it first.
  const returned = new URL(result.url);
  const queryParams = returned.searchParams;
  const hashParams = new URLSearchParams(returned.hash ? returned.hash.substring(1) : '');

  const oauthError = queryParams.get('error') || hashParams.get('error');
  if (oauthError) {
    throw new Error(queryParams.get('error_description') || hashParams.get('error_description') || oauthError);
  }

  const code = queryParams.get('code');
  if (code) {
    // PKCE flow — exchange the auth code for a session.
    const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
    return sessionData?.session ?? null;
  }

  // Implicit-flow fallback.
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken) {
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;
    return sessionData?.session ?? null;
  }

  throw new Error('No session returned from Google. Please try again.');
};

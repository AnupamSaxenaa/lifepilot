// ============================================================================
// LifePilot — AdMob Rewarded SSV Callback (Supabase Edge Function)
// ----------------------------------------------------------------------------
// AdMob calls this URL after a user finishes a rewarded ad. This is the ONLY
// place ad credits are granted — the app never grants itself anything.
//
// WHY SERVER-SIDE VERIFICATION IS MANDATORY
//   A client-trusted endpoint ("I watched an ad, give me credits") is forgeable
//   with curl the moment anyone decompiles the APK. AdMob signs each callback
//   with an ECDSA key; we verify that signature against Google's published
//   public keys before crediting anything. An unverified callback is dropped.
//
// The grant itself (daily cap + replay protection) lives in
// `public.grant_ad_credits`, so the cap cannot be bypassed here either.
//
// SETUP
//   1. Deploy WITHOUT jwt verification — AdMob has no Supabase token:
//        supabase functions deploy ad-reward --no-verify-jwt
//   2. supabase secrets set SERVICE_ROLE_KEY=<service_role_key>
//   3. In AdMob → your rewarded ad unit → Server-side verification, set:
//        https://<project-ref>.supabase.co/functions/v1/ad-reward
//   4. In the app, set customData to the Supabase user id before showing the ad.
//
// AdMob appends `signature` and `key_id` as the LAST two query parameters. The
// signed content is the raw query string up to (but excluding) `&signature=`.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const VERIFIER_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

type VerifierKey = { keyId: number; pem?: string; base64?: string };

// Keys rotate rarely, so cache them rather than fetching on every callback.
let keyCache: { fetchedAt: number; keys: VerifierKey[] } | null = null;
const KEY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function getVerifierKeys(): Promise<VerifierKey[]> {
  if (keyCache && Date.now() - keyCache.fetchedAt < KEY_CACHE_TTL_MS) {
    return keyCache.keys;
  }
  const res = await fetch(VERIFIER_KEYS_URL);
  if (!res.ok) throw new Error(`verifier keys ${res.status}`);
  const data = await res.json();
  const keys: VerifierKey[] = data?.keys ?? [];
  if (keys.length === 0) throw new Error("no verifier keys");
  keyCache = { fetchedAt: Date.now(), keys };
  return keys;
}

function base64ToBytes(b64: string): Uint8Array {
  // Accept base64url as well as standard base64.
  const normalised = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return base64ToBytes(body);
}

/**
 * Web Crypto expects a raw r||s ECDSA signature; AdMob sends DER. Convert.
 * DER: 0x30 len 0x02 rLen r 0x02 sLen s
 */
function derToRawSignature(der: Uint8Array): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("bad der: no sequence");
  // Skip the (possibly long-form) sequence length.
  const seqLen = der[offset++];
  if (seqLen & 0x80) offset += seqLen & 0x7f;

  const readInt = (): Uint8Array => {
    if (der[offset++] !== 0x02) throw new Error("bad der: no integer");
    const len = der[offset++];
    let value = der.subarray(offset, offset + len);
    offset += len;
    // Strip DER's leading zero sign byte, then left-pad to 32 bytes.
    while (value.length > 0 && value[0] === 0x00) value = value.subarray(1);
    if (value.length > 32) throw new Error("bad der: integer too long");
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };

  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function verifySignature(
  content: string,
  signatureB64: string,
  keyId: string,
): Promise<boolean> {
  const keys = await getVerifierKeys();
  const match = keys.find((k) => String(k.keyId) === String(keyId));
  if (!match) {
    console.error("[ad-reward] unknown key_id:", keyId);
    return false;
  }

  const spki = match.base64 ? base64ToBytes(match.base64) : pemToBytes(match.pem ?? "");
  const publicKey = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  let raw: Uint8Array;
  try {
    raw = derToRawSignature(base64ToBytes(signatureB64));
  } catch (e) {
    console.error("[ad-reward] signature decode failed:", (e as Error).message);
    return false;
  }

  return await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    raw,
    new TextEncoder().encode(content),
  );
}

Deno.serve(async (req: Request) => {
  // AdMob uses GET.
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const query = url.search.startsWith("?") ? url.search.slice(1) : url.search;

  const signature = url.searchParams.get("signature");
  const keyId = url.searchParams.get("key_id");
  const transactionId = url.searchParams.get("transaction_id");
  // We put the Supabase user id in custom_data when requesting the ad. AdMob's
  // own `user_id` param is a fallback for older integrations.
  const userId = url.searchParams.get("custom_data") || url.searchParams.get("user_id");

  // Only a missing SIGNATURE makes a request malformed. A signed request that
  // carries no user/transaction is AdMob's "verify callback URL" probe, and it
  // must get a 200 or the console reports the endpoint as unverified. We answer
  // it only after the signature checks out, so a probe is never a way in.
  if (!signature || !keyId) {
    return new Response("missing signature", { status: 400 });
  }

  // The signed content is everything before `&signature=`.
  const sigMarker = query.indexOf("&signature=");
  if (sigMarker < 0) {
    return new Response("malformed callback", { status: 400 });
  }
  const content = query.substring(0, sigMarker);

  let verified = false;
  try {
    verified = await verifySignature(content, signature, keyId);
  } catch (e) {
    console.error("[ad-reward] verification error:", (e as Error).message);
    // A key-fetch failure is our problem, not a forgery: 500 so AdMob retries
    // rather than us silently dropping a legitimate reward.
    return new Response("verification unavailable", { status: 500 });
  }

  if (!verified) {
    // Do NOT retry-signal a forged callback.
    console.warn("[ad-reward] signature rejected for transaction:", transactionId);
    return new Response("invalid signature", { status: 403 });
  }

  // Signature is valid. If there is nothing to credit, this was a verification
  // probe (or a malformed reward) — acknowledge without granting.
  if (!transactionId || !userId) {
    console.log("[ad-reward] verified probe: no transaction/user to credit");
    return new Response("ok", { status: 200 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SERVICE_ROLE) {
    console.error("[ad-reward] service role key missing");
    return new Response("misconfigured", { status: 500 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("grant_ad_credits", {
    p_user: userId,
    p_transaction_id: transactionId,
    p_source: url.searchParams.get("ad_network") ?? "admob",
  });

  if (error) {
    console.error("[ad-reward] grant failed:", error.message);
    return new Response("grant failed", { status: 500 });
  }

  // A refused grant (cap reached, replay) is still a correctly handled callback.
  // Returning 200 stops AdMob retrying something that will never succeed.
  console.log("[ad-reward] result:", JSON.stringify(data));
  return new Response("ok", { status: 200 });
});

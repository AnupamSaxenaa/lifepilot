// ============================================================================
// LifePilot — RevenueCat Billing Webhook (Supabase Edge Function)
// ----------------------------------------------------------------------------
// RevenueCat calls this after it VERIFIES a purchase with Google Play. This is
// the ONLY place Pro status / tokens are granted — the client never does it.
//
// Security:
//   • RevenueCat sends a fixed Authorization header (you set it in RevenueCat →
//     Project → Webhooks). We verify it against REVENUECAT_WEBHOOK_SECRET.
//   • We use the Supabase SERVICE ROLE key (bypasses RLS) to call the
//     grant/entitlement RPCs.
//   • Credit grants go through `grant_ai_tokens_once` (migration 0026), which
//     dedupes on the RevenueCat event id. Deliveries are retried, so an
//     incrementing grant MUST be idempotent or a retry pays out twice.
//   • Grant failures return 5xx on purpose: RevenueCat then retries, instead of
//     us swallowing the error after the user has already been charged.
//
// Deploy:
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
//   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<random-long-string> \
//       SERVICE_ROLE_KEY=<service_role_key>
//   Then in RevenueCat, set the webhook URL + Authorization header to the secret.
//
//   The service role key is read from SERVICE_ROLE_KEY or, failing that,
//   SUPABASE_SERVICE_ROLE_KEY — either name works. If neither is set the
//   function returns 500 (so RevenueCat retries and the purchase survives)
//   instead of building a client with an undefined key.
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Product → token allotment, granted on each purchase/renewal event.
//
// SIZING (see migration 0032): the daily free floor is 20/day ≈ 600/month, and it
// is ADDITIVE to purchased credits. So a Pro user gets ~600 free + the allotment
// below. The old 300/month sat BELOW the free tier's 600 — Pro was worth less
// than free. These numbers keep Pro unambiguously ahead.
//
// Marginal inference cost is currently ~0 (every provider in ai-proxy's cascade
// is a free tier), so the constraint on these numbers is perceived value and
// shared free-tier rate limits, not cost of goods.
const SUBSCRIPTION_TOKENS: Record<string, number> = {
  pro_monthly: 500,   // granted each monthly renewal  → ~1100/mo with the free floor
  pro_yearly: 6000,   // granted at each yearly renewal (500 x 12)
  // Not sellable — absent from PRODUCTS in src/lib/purchases.js. Kept here so an
  // unexpected legacy event is credited rather than dropped on the floor.
  pro_lifetime: 6000,
};

const TOKEN_PACKS: Record<string, number> = {
  tokens_50: 50,
  tokens_150: 150,
  tokens_500: 500,
};

const PLAN_TYPE: Record<string, string> = {
  pro_monthly: "monthly",
  pro_yearly: "yearly",
  pro_lifetime: "lifetime",
};

/** How many credits a given product handed out, whichever map it belongs to. */
const grantedAmountFor = (productId?: string): number => {
  if (!productId) return 0;
  return TOKEN_PACKS[productId] ?? SUBSCRIPTION_TOKENS[productId] ?? 0;
};

const refundReason = (event: any): string =>
  String(event?.cancel_reason ?? event?.expiration_reason ?? "unknown");

/**
 * Is this event a refund (money returned), as opposed to a voluntary cancel?
 *
 * RevenueCat overloads CANCELLATION for six different situations and the only
 * discriminator is cancel_reason. CUSTOMER_SUPPORT is the refund case — for the
 * App Store, Google Play, Amazon and web billing alike, and for non-renewing
 * purchases (our token packs) as well as subscriptions. EXPIRATION carries the
 * same reason code when a refund ends the period.
 *
 * A negative `price` is treated as a secondary signal: RevenueCat documents that
 * field as "negative for refunds", so it catches a refund whose reason code is
 * missing or unrecognised rather than silently letting it through.
 */
const isRefund = (event: any): boolean => {
  const type = String(event?.type ?? "");
  if (type !== "CANCELLATION" && type !== "EXPIRATION") return false;

  const reason = refundReason(event).toUpperCase();
  if (reason === "CUSTOMER_SUPPORT") return true;

  const price = typeof event?.price === "number" ? event.price : null;
  return price !== null && price < 0;
};

/** Length-independent constant-time string compare. */
const timingSafeEqual = (a: string, b: string): boolean => {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare a fixed number of bytes either way so the loop count can't leak the
  // secret's length, then fold the length check into the same result.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
};

/**
 * RevenueCat sends whatever you typed into its "Authorization header" field
 * verbatim. Depending on how it was pasted that may or may not carry a `Bearer `
 * prefix, and a mismatch here 401s every delivery silently — so accept the raw
 * secret or the same secret behind `Bearer `. The secret itself must still match
 * exactly; this only tolerates the prefix, it does not weaken the check.
 */
const authorized = (header: string, expected: string): boolean => {
  const received = header.trim();
  const want = expected.trim();
  if (timingSafeEqual(received, want)) return true;
  const bearer = received.replace(/^Bearer\s+/i, "");
  return bearer !== received && timingSafeEqual(bearer, want);
};

serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // 1. Verify the shared secret from RevenueCat.
  const expected = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  if (!expected || !authorized(auth, expected)) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const event = body?.event;
  if (!event) return new Response("no event", { status: 400 });

  const userId: string | undefined = event.app_user_id;
  const productId: string | undefined = event.product_id;
  const type: string = event.type ?? "";

  // ── Sandbox guard ────────────────────────────────────────────────────────
  // Test purchases (Play licence testers, RevenueCat's dashboard TEST event)
  // arrive with environment = SANDBOX. Granting real credits for them means any
  // account on the licence-tester list mints unlimited tokens for free, and it
  // pollutes real balances during QA. Acknowledge with 200 so RevenueCat stops
  // retrying, but change nothing.
  const environment: string = String(event.environment ?? "").toUpperCase();
  const allowSandbox = (Deno.env.get("ALLOW_SANDBOX_PURCHASES") ?? "") === "true";
  if (type === "TEST" || (environment === "SANDBOX" && !allowSandbox)) {
    console.log(`[revenuecat-webhook] ignoring ${type} in ${environment || "unknown"} env`);
    return new Response("sandbox ignored", { status: 200 });
  }

  // TRANSFER moves entitlements between App User IDs and carries
  // transferred_from / transferred_to instead of a single subject, so it is
  // resolved separately from the app_user_id-keyed events below.
  const isTransfer = type === "TRANSFER";
  if (!isTransfer && !userId) return new Response("no app_user_id", { status: 400 });

  // Idempotency key. RevenueCat retries deliveries, and a retry must not grant
  // the same pack twice. `event.id` is stable per event; the composite fallback
  // covers older payload shapes that omit it.
  const eventId: string = String(
    event.id ??
      `${type}:${productId ?? "none"}:${event.event_timestamp_ms ?? event.purchased_at_ms ?? ""}`,
  );

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  // Accept BOTH names. This used to read only SERVICE_ROLE_KEY with a non-null
  // assertion, while ai-proxy uses SUPABASE_SERVICE_ROLE_KEY. If only the
  // conventional name was set, the client was built with `undefined`, every RPC
  // 401'd, and RevenueCat retried forever — the user was charged and never
  // credited. Fail loudly with a 5xx (so RevenueCat keeps retrying and the
  // purchase isn't lost) rather than silently constructing a broken client.
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error(
      "[revenuecat-webhook] misconfigured: missing SUPABASE_URL or service role key " +
        "(set SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY)",
    );
    return new Response("server misconfigured", { status: 500 });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // ── Transfer between App User IDs ────────────────────────────────────
    // A purchase can move to a different account (user reinstalls and signs in
    // with another id, or Play links the receipt elsewhere). RevenueCat sends
    // this only for the DESTINATION user, so without handling it the SOURCE
    // account keeps Pro forever — one purchase entitling two accounts.
    //
    // Credits are deliberately NOT clawed back from the source: they were
    // legitimately granted and may already be spent. Only the entitlement moves.
    if (isTransfer) {
      const from: string[] = Array.isArray(event.transferred_from) ? event.transferred_from : [];
      for (const staleUser of from) {
        if (!staleUser) continue;
        const { error } = await admin.rpc("set_pro_status", {
          p_user: staleUser,
          p_is_pro: false,
          p_plan: "free",
          p_expires: null,
        });
        if (error) {
          console.error("[revenuecat-webhook] transfer downgrade failed:", error.message);
          return new Response("transfer failed", { status: 500 });
        }
      }
      // The destination user's entitlement arrives via its own
      // INITIAL_PURCHASE/RENEWAL event, so nothing to grant here.
      return new Response("ok", { status: 200 });
    }

    // ── Refund / chargeback ──────────────────────────────────────────────
    // MUST be checked before the purchase branches, because a refund arrives as
    // CANCELLATION — the same event family as a voluntary cancel — and the only
    // discriminator is cancel_reason. Getting this wrong is the difference
    // between "user keeps access until expiry" (correct for UNSUBSCRIBE) and
    // "user got their money back and keeps 500 credits forever".
    //
    // Per RevenueCat's docs CANCELLATION also covers NON-RENEWING purchases, so
    // this is the refund path for token packs too.
    if (isRefund(event)) {
      const granted = grantedAmountFor(productId);
      const isSubscription = !!productId && SUBSCRIPTION_TOKENS[productId] !== undefined;

      // Revoke entitlement immediately. A refunded subscription must not keep
      // working until a later EXPIRATION that may never arrive.
      if (isSubscription) {
        const { error: proErr } = await admin.rpc("set_pro_status", {
          p_user: userId,
          p_is_pro: false,
          p_plan: "free",
          p_expires: null,
        });
        if (proErr) {
          console.error("[revenuecat-webhook] refund downgrade failed:", proErr.message);
          return new Response("entitlement failed", { status: 500 });
        }
      }

      if (granted > 0) {
        // Claws back from the paid bucket; anything already spent becomes
        // `credit_debt`, which every future grant settles before crediting.
        // Ledgered on this event's own id, so retries are no-ops.
        const { error } = await admin.rpc("revoke_granted_credits", {
          p_event_id: eventId,
          p_user: userId,
          p_amount: granted,
          p_product: productId ?? null,
          p_reason: `refund_${type.toLowerCase()}_${refundReason(event).toLowerCase()}`,
        });
        if (error) {
          console.error("[revenuecat-webhook] clawback failed:", error.message);
          return new Response("clawback failed", { status: 500 });
        }
      }
      return new Response("ok", { status: 200 });
    }

    // ── Refund reversed (App Store only; Google Play never sends this) ────
    // The money came back to us, so the credits are owed again. Re-granting via
    // grant_ai_tokens_once keys on THIS event's id, so it cannot double-credit.
    if (type === "REFUND_REVERSED") {
      const granted = grantedAmountFor(productId);
      if (granted > 0) {
        const { error } = await admin.rpc("grant_ai_tokens_once", {
          p_event_id: eventId,
          p_user: userId,
          p_amount: granted,
          p_product: productId,
          p_kind: "refund_reversed",
        });
        if (error) {
          console.error("[revenuecat-webhook] refund-reversal grant failed:", error.message);
          return new Response("grant failed", { status: 500 });
        }
      }
      return new Response("ok", { status: 200 });
    }

    // ── Token pack (consumable, non-renewing) ──
    if (productId && TOKEN_PACKS[productId] !== undefined &&
        (type === "NON_RENEWING_PURCHASE" || type === "INITIAL_PURCHASE")) {
      // grant_ai_tokens_once dedupes on event id and credits the spendable
      // `ai_tokens` bucket (live again as of migration 0026).
      const { error } = await admin.rpc("grant_ai_tokens_once", {
        p_event_id: eventId,
        p_user: userId,
        p_amount: TOKEN_PACKS[productId],
        p_product: productId,
        p_kind: "token_pack",
      });
      // Surface failures so RevenueCat retries instead of silently dropping a
      // purchase the user has already been charged for.
      if (error) {
        console.error("[revenuecat-webhook] pack grant failed:", error.message);
        return new Response("grant failed", { status: 500 });
      }
      return new Response("ok", { status: 200 });
    }

    // ── Subscription / lifetime Pro ──
    if (productId && SUBSCRIPTION_TOKENS[productId] !== undefined) {
      const plan = PLAN_TYPE[productId] ?? "monthly";

      if (["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"].includes(type)) {
        const expiresMs = event.expiration_at_ms ?? null;
        const expires = expiresMs && plan !== "lifetime" ? new Date(expiresMs).toISOString() : null;

        // Entitlement state is idempotent by nature — it sets a value rather
        // than incrementing one, so a retry is harmless here.
        const { error: proErr } = await admin.rpc("set_pro_status", {
          p_user: userId,
          p_is_pro: true,
          p_plan: plan,
          p_expires: expires,
        });
        if (proErr) {
          console.error("[revenuecat-webhook] set_pro_status failed:", proErr.message);
          return new Response("entitlement failed", { status: 500 });
        }

        // The token allotment DOES increment, so it must be deduped per event
        // or every retried renewal would hand out another month of credits.
        const { error: grantErr } = await admin.rpc("grant_ai_tokens_once", {
          p_event_id: eventId,
          p_user: userId,
          p_amount: SUBSCRIPTION_TOKENS[productId],
          p_product: productId,
          p_kind: `subscription_${type.toLowerCase()}`,
        });
        if (grantErr) {
          console.error("[revenuecat-webhook] subscription grant failed:", grantErr.message);
          return new Response("grant failed", { status: 500 });
        }
        return new Response("ok", { status: 200 });
      }

      if (["CANCELLATION", "EXPIRATION", "BILLING_ISSUE", "SUBSCRIPTION_PAUSED"].includes(type)) {
        // Only downgrade on hard expiration (cancellation keeps access until expiry).
        if (type === "EXPIRATION") {
          await admin.rpc("set_pro_status", { p_user: userId, p_is_pro: false, p_plan: "free", p_expires: null });
        }
        return new Response("ok", { status: 200 });
      }
    }

    return new Response("ignored", { status: 200 });
  } catch (e) {
    console.error("[revenuecat-webhook] error:", (e as Error).message);
    return new Response("error", { status: 500 });
  }
});

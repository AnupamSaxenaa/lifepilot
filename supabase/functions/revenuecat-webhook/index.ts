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
//
// Deploy:
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
//   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<random-long-string> \
//       SERVICE_ROLE_KEY=<service_role_key>
//   Then in RevenueCat, set the webhook URL + Authorization header to the secret.
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Product → monthly token allotment for subscriptions / one-time bundle otherwise.
const SUBSCRIPTION_TOKENS: Record<string, number> = {
  pro_monthly: 300,   // granted each monthly renewal
  pro_yearly: 3600,   // granted at each yearly renewal (300 x 12)
  pro_lifetime: 2400, // one-time bundle (add a monthly cron later for ongoing)
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

serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // 1. Verify the shared secret from RevenueCat.
  const expected = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  if (!expected || auth !== expected) {
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

  if (!userId) return new Response("no app_user_id", { status: 400 });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // ── Token pack (consumable, non-renewing) ──
    if (productId && TOKEN_PACKS[productId] !== undefined &&
        (type === "NON_RENEWING_PURCHASE" || type === "INITIAL_PURCHASE")) {
      await admin.rpc("grant_ai_tokens", { p_user: userId, p_amount: TOKEN_PACKS[productId] });
      return new Response("ok", { status: 200 });
    }

    // ── Subscription / lifetime Pro ──
    if (productId && SUBSCRIPTION_TOKENS[productId] !== undefined) {
      const plan = PLAN_TYPE[productId] ?? "monthly";

      if (["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"].includes(type)) {
        const expiresMs = event.expiration_at_ms ?? null;
        const expires = expiresMs && plan !== "lifetime" ? new Date(expiresMs).toISOString() : null;

        await admin.rpc("set_pro_status", {
          p_user: userId,
          p_is_pro: true,
          p_plan: plan,
          p_expires: expires,
        });
        // Grant the token allotment for this period.
        await admin.rpc("grant_ai_tokens", { p_user: userId, p_amount: SUBSCRIPTION_TOKENS[productId] });
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

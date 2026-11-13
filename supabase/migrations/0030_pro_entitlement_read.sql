-- ============================================================================
-- 0030 — Pro entitlement: a client-readable, expiry-aware status RPC
-- ============================================================================
-- WHY
--
-- `is_user_pro(uuid)` has existed since 0001 and is correct — it already treats
-- a lapsed `pro_expires_at` as not-Pro, and lifetime as permanent. Two problems
-- kept it from being usable as the app's gate:
--
--   1. NOTHING CALLED IT. Not the app, not any edge function. So the paywall
--      advertised Pro benefits that had no gate behind them, and buying Pro
--      delivered only the token grant from the billing webhook.
--
--   2. It takes a `uuid` and is granted to `authenticated`, so any signed-in
--      user could probe ANY other user's subscription status. That is a needless
--      disclosure: a client only ever needs to ask about itself.
--
-- This migration adds `get_pro_status()` — no arguments, scoped to `auth.uid()`,
-- returning the whole shape the UI needs in one round-trip. `is_user_pro(uuid)`
-- is kept (edge functions running as service_role legitimately need to ask about
-- another user) but is revoked from `authenticated`.
--
-- SECURITY MODEL (unchanged, restated):
--   • profiles.is_pro / plan_type / pro_expires_at already have a column-level
--     `revoke update` from anon+authenticated (0001 lines 60-64). Clients cannot
--     make themselves Pro.
--   • Only `set_pro_status`, service_role-only, flips entitlement, and it is
--     called only by the revenuecat-webhook edge function after RevenueCat has
--     verified the purchase with Google Play.
--   • This function is READ-ONLY (`stable`). It grants nothing.
--
-- The client caches the result, so `is_pro` in the app is a HINT for rendering.
-- Anything that actually costs money or compute must re-check server-side.
--
-- Safe to run more than once.
-- ============================================================================

-- ── 1. Self-scoped, expiry-aware entitlement read ──────────────────────────
create or replace function public.get_pro_status()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_is_pro  boolean;
  v_plan    text;
  v_expires timestamptz;
  v_active  boolean;
begin
  if v_user is null then
    return jsonb_build_object('is_pro', false, 'plan_type', 'free', 'expires_at', null);
  end if;

  select is_pro, plan_type, pro_expires_at
    into v_is_pro, v_plan, v_expires
    from public.profiles
   where id = v_user;

  if not found then
    return jsonb_build_object('is_pro', false, 'plan_type', 'free', 'expires_at', null);
  end if;

  -- Same rule as is_user_pro(): a stored `is_pro = true` is NOT enough. If the
  -- EXPIRATION webhook was never delivered (RevenueCat outage, secret rotated,
  -- function down), the flag would otherwise grant Pro forever. Expiry wins.
  v_active := coalesce(v_is_pro, false)
    and (v_plan = 'lifetime' or v_expires is null or v_expires > now());

  return jsonb_build_object(
    'is_pro',     v_active,
    -- Report 'free' once it has lapsed so the UI can't show a stale plan name
    -- next to a downgraded account.
    'plan_type',  case when v_active then coalesce(v_plan, 'free') else 'free' end,
    'expires_at', v_expires
  );
end;
$$;

revoke all on function public.get_pro_status() from public, anon;
grant execute on function public.get_pro_status() to authenticated;

-- ── 2. Stop clients probing other users' subscriptions ─────────────────────
-- service_role keeps it: edge functions legitimately need to ask "is THIS user
-- Pro" while acting on a webhook or a background job.
revoke all on function public.is_user_pro(uuid) from public, anon, authenticated;
grant execute on function public.is_user_pro(uuid) to service_role;

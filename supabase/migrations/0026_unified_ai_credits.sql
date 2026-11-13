-- ============================================================================
-- 0026 — Unified AI credits: replenishing free floor + persistent paid credits
-- ============================================================================
-- WHY THIS EXISTS
--
-- 0012 replaced the original two-bucket design with a single daily bucket and
-- hard-coded `'purchased', 0` into get_ai_balance(). 0014 kept that shape and
-- added a per-account allowance override. The side effects were:
--
--   1. `profiles.ai_tokens` became dead storage. `grant_ai_tokens()` still
--      wrote to it, but no read path ever looked at it again — so a purchase
--      routed through revenuecat-webhook would take the user's money and
--      deliver nothing spendable.
--
--   2. The daily reset was an ASSIGNMENT (`set daily_free_tokens = v_cap`).
--      Once purchased credits existed, midnight would have destroyed them.
--
-- This migration restores two buckets and defines the replenishment rule as a
-- FLOOR TOP-UP instead of a reset:
--
--   free  = profiles.daily_free_tokens  → replenishing, never exceeds floor
--   paid  = profiles.ai_tokens          → purchased / earned, never auto-reset
--   floor = coalesce(daily_token_allowance, app_config.free_daily_tokens)
--
--   Once per calendar day, if (free + paid) < floor, raise `free` so the total
--   becomes exactly the floor. If (free + paid) >= floor, touch nothing.
--
-- Consequences of that rule, stated plainly:
--   • A user who spends everything is back to `floor` tomorrow.
--   • A user holding purchased credits never loses them at midnight.
--   • The top-up can only ever RAISE a total up to the floor, so it cannot be
--     farmed by sitting just below it, and it can never mint paid credits.
--
-- SPEND ORDER: free first, then paid. Free credits replenish tomorrow and paid
-- credits do not, so spending the perishable bucket first favours the user.
--
-- ── ⚠️ ONE-TIME DATA RESET ──────────────────────────────────────────────────
-- Step 7 zeroes `profiles.ai_tokens`. This is safe ONLY because that column has
-- been ignored by every read path since 0012 and in-app billing has never been
-- live (PLAYSTORE_MODE defaults false, react-native-purchases is not installed,
-- and no Play products exist yet). The values sitting there are artefacts of
-- 0001's backfill — including 1,000,000 on owner accounts — and making the
-- column spendable again without clearing it would hand out credits nobody paid
-- for. If a real purchase has been processed by the time you run this, DELETE
-- STEP 7 FIRST and reconcile by hand.
--
-- Safe to run more than once (aside from the documented step 7 reset).
-- ============================================================================

-- ── 1. A single call may never cost more than this ──────────────────────────
-- 0014 bounded cost by the daily allowance. That coupling breaks once paid
-- credits exist (a small floor would reject a legitimate 3-credit plan), so the
-- guard is now a fixed sanity ceiling, independent of any account's floor.
create or replace function public.max_ai_call_cost()
returns integer
language sql immutable
as $$ select 100 $$;

revoke all on function public.max_ai_call_cost() from public, anon;
grant execute on function public.max_ai_call_cost() to authenticated, service_role;

-- ── 2. Balance (read-only; must not write, so it PROJECTS the top-up) ───────
-- Keeps the existing JSON contract. `total` is what AIAuraOverlay reads, so the
-- key must not be renamed. `daily_free` / `purchased` are now both meaningful
-- again, which is what lets the credit store show a real breakdown.
create or replace function public.get_ai_balance()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_p     public.profiles%rowtype;
  v_floor integer;
  v_free  integer;
  v_paid  integer;
begin
  if v_user is null then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'total', 0, 'floor', 0);
  end if;

  select * into v_p from public.profiles where id = v_user;
  if not found then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'total', 0, 'floor', 0);
  end if;

  v_floor := coalesce(v_p.daily_token_allowance, public.default_daily_tokens());
  v_free  := greatest(0, coalesce(v_p.daily_free_tokens, 0));
  v_paid  := greatest(0, coalesce(v_p.ai_tokens, 0));

  -- Project (do not persist) the top-up the next spend will apply, so the UI
  -- never shows a stale 0 before the first call of the day.
  if v_p.daily_free_date is distinct from current_date and v_free + v_paid < v_floor then
    v_free := v_floor - v_paid;
  end if;

  return jsonb_build_object(
    'daily_free', v_free,
    'purchased',  v_paid,
    'total',      v_free + v_paid,
    'floor',      v_floor
  );
end;
$$;

-- ── 3. Spend (atomic; free bucket first, then paid) ─────────────────────────
-- Returns the bucket split so a failed provider call can be refunded to the
-- exact buckets it was taken from. Without the split, refunding everything to
-- the paid bucket would slowly convert perishable free credits into permanent
-- ones every time a provider failed.
create or replace function public.consume_ai_tokens(p_cost integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_p         public.profiles%rowtype;
  v_floor     integer;
  v_free      integer;
  v_paid      integer;
  v_total     integer;
  v_from_free integer;
  v_from_paid integer;
begin
  if v_user is null then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'unauthenticated',
                              'from_free', 0, 'from_paid', 0);
  end if;

  if p_cost is null or p_cost < 1 or p_cost > public.max_ai_call_cost() then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'invalid_cost',
                              'from_free', 0, 'from_paid', 0);
  end if;

  -- Row lock: two concurrent AI calls must not both pass the balance check.
  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'no_profile',
                              'from_free', 0, 'from_paid', 0);
  end if;

  v_floor := coalesce(v_p.daily_token_allowance, public.default_daily_tokens());
  v_free  := greatest(0, coalesce(v_p.daily_free_tokens, 0));
  v_paid  := greatest(0, coalesce(v_p.ai_tokens, 0));

  -- Once-per-day floor top-up. The date stamp is what makes it once-per-day;
  -- without it a user parked below the floor could refill on every call.
  if v_p.daily_free_date is distinct from current_date then
    if v_free + v_paid < v_floor then
      v_free := v_floor - v_paid;
    end if;
    update public.profiles
       set daily_free_tokens = v_free,
           daily_free_date   = current_date
     where id = v_user;
  end if;

  v_total := v_free + v_paid;
  if v_total < p_cost then
    return jsonb_build_object('allowed', false, 'remaining', v_total, 'reason', 'insufficient_tokens',
                              'from_free', 0, 'from_paid', 0);
  end if;

  v_from_free := least(v_free, p_cost);
  v_from_paid := p_cost - v_from_free;

  update public.profiles
     set daily_free_tokens = v_free - v_from_free,
         ai_tokens         = v_paid - v_from_paid
   where id = v_user;

  return jsonb_build_object(
    'allowed',   true,
    'remaining', v_total - p_cost,
    'reason',    'ok',
    'from_free', v_from_free,
    'from_paid', v_from_paid
  );
end;
$$;

-- ── 4. Refund (service role only) ──────────────────────────────────────────
-- Precise form: restores exactly what was taken, to the buckets it came from.
create or replace function public.refund_ai_tokens(
  p_user      uuid,
  p_from_free integer,
  p_from_paid integer
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_floor integer;
  v_free  integer;
  v_paid  integer;
  v_ff    integer := greatest(0, coalesce(p_from_free, 0));
  v_fp    integer := greatest(0, coalesce(p_from_paid, 0));
begin
  if p_user is null then return; end if;
  if v_ff + v_fp < 1 or v_ff + v_fp > public.max_ai_call_cost() then return; end if;

  select coalesce(daily_token_allowance, public.default_daily_tokens()),
         greatest(0, coalesce(daily_free_tokens, 0)),
         greatest(0, coalesce(ai_tokens, 0))
    into v_floor, v_free, v_paid
    from public.profiles
   where id = p_user
     for update;

  if v_floor is null then return; end if;

  update public.profiles
     set daily_free_tokens = least(v_floor, v_free + v_ff),
         ai_tokens         = v_paid + v_fp
   where id = p_user;
end;
$$;

revoke all on function public.refund_ai_tokens(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.refund_ai_tokens(uuid, integer, integer) to service_role;

-- Legacy 2-arg form. Kept so a deploy where the migration lands before the new
-- ai-proxy still refunds correctly. Credits the free bucket, capped at floor.
create or replace function public.refund_ai_tokens(p_user uuid, p_amount integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_floor integer;
begin
  if p_user is null or p_amount is null or p_amount < 1
     or p_amount > public.max_ai_call_cost() then
    return;
  end if;

  select coalesce(daily_token_allowance, public.default_daily_tokens())
    into v_floor
    from public.profiles
   where id = p_user;

  if v_floor is null then return; end if;

  update public.profiles
     set daily_free_tokens = least(v_floor, greatest(0, coalesce(daily_free_tokens, 0)) + p_amount)
   where id = p_user
     and daily_free_date = current_date;
end;
$$;

revoke all on function public.refund_ai_tokens(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.refund_ai_tokens(uuid, integer) to service_role;

-- ── 5. Idempotent credit grants (billing + future ad rewards) ──────────────
-- RevenueCat retries webhooks. Without a dedupe key, a retried delivery grants
-- the same pack twice. The event id is the natural idempotency key.
create table if not exists public.billing_events (
  event_id   text primary key,
  user_id    uuid,
  product_id text,
  amount     integer     not null default 0,
  kind       text,
  created_at timestamptz not null default now()
);

alter table public.billing_events enable row level security;
-- Deliberately no policies: service_role bypasses RLS, every other role is
-- denied. Purchase history must never be client-readable or client-writable.
revoke all on table public.billing_events from anon, authenticated;

create index if not exists billing_events_user_idx
  on public.billing_events (user_id, created_at desc);

-- Returns true when this call actually granted, false when the event was
-- already processed. The caller can treat false as "success, nothing to do".
create or replace function public.grant_ai_tokens_once(
  p_event_id text,
  p_user     uuid,
  p_amount   integer,
  p_product  text default null,
  p_kind     text default null
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted integer;
begin
  if p_event_id is null or p_event_id = '' or p_user is null
     or p_amount is null or p_amount < 1 or p_amount > 1000000 then
    return false;
  end if;

  insert into public.billing_events (event_id, user_id, product_id, amount, kind)
  values (p_event_id, p_user, p_product, p_amount, p_kind)
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;  -- replay of an event already applied
  end if;

  update public.profiles
     set ai_tokens = greatest(0, coalesce(ai_tokens, 0)) + p_amount
   where id = p_user;

  return true;
end;
$$;

revoke all on function public.grant_ai_tokens_once(text, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_ai_tokens_once(text, uuid, integer, text, text) to service_role;

-- ── 6. Grants for the client-callable pair ─────────────────────────────────
revoke all on function public.consume_ai_tokens(integer) from public, anon;
revoke all on function public.get_ai_balance()           from public, anon;
grant execute on function public.consume_ai_tokens(integer) to authenticated;
grant execute on function public.get_ai_balance()           to authenticated;

-- Column-level writes stay revoked (originally set in 0001). Restated here so
-- this migration is self-contained if 0001 is ever edited.
revoke update (is_pro, pro_expires_at, plan_type, ai_tokens, daily_free_tokens, daily_free_date)
  on public.profiles from anon, authenticated;
revoke update (daily_token_allowance) on public.profiles from anon, authenticated;

-- ── 7. ⚠️ One-time reset of the previously-ignored paid bucket ─────────────
-- See the header note.
--
-- Guarded on `billing_events` being empty, which is the durable proof that no
-- purchase has ever been processed. Without this guard, re-running the migration
-- after going live would wipe credits real customers had paid for.
do $$
declare
  v_purchases integer;
  v_cleared   integer;
begin
  select count(*) into v_purchases from public.billing_events;

  if v_purchases > 0 then
    raise notice '0026: % billing event(s) on record — skipping the ai_tokens reset.', v_purchases;
    return;
  end if;

  update public.profiles
     set ai_tokens = 0
   where coalesce(ai_tokens, 0) <> 0;

  get diagnostics v_cleared = row_count;
  raise notice '0026: cleared stale ai_tokens on % profile(s) (no purchases on record).', v_cleared;
end $$;

-- Re-assert the owner/dev allowance (floor override, not a paid balance).
do $$
declare
  v_matched integer;
begin
  update public.profiles
     set daily_token_allowance = 10000
   where username in ('saxenaanupam2004', 'terminator');

  get diagnostics v_matched = row_count;
  raise notice '0026: owner allowance re-asserted on % profile(s).', v_matched;
end $$;

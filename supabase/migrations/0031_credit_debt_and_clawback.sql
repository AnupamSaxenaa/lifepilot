-- ============================================================================
-- 0031 — Refund clawback: credit debt that future grants must settle first
-- ============================================================================
-- THE EXPLOIT THIS CLOSES
--
-- Before this migration the webhook ignored CANCELLATION entirely and only
-- downgraded Pro on EXPIRATION. Per RevenueCat's docs a refund arrives as
-- CANCELLATION with cancel_reason = CUSTOMER_SUPPORT, and that event covers
-- NON-RENEWING purchases too. So the loop was:
--
--     buy tokens_500 → spend all 500 → request a refund → repeat forever
--
-- Unlimited free AI, funded by us. Same for a refunded subscription: the token
-- allotment stayed and Pro stayed until the (never-arriving) EXPIRATION.
--
-- WHY DEBT IS A SEPARATE NON-NEGATIVE COLUMN, NOT A NEGATIVE ai_tokens
--
-- The obvious implementation — let `ai_tokens` go negative — creates a worse
-- hole than it fixes. The daily floor top-up from 0026/0027 reads:
--
--     if v_free + v_paid < v_floor then v_free := v_floor - v_paid;
--
-- With ai_tokens = -800 and a floor of 20 that assigns v_free := 20 - (-800)
-- = 820. The refunder would be MINTED 820 free credits. Every non-negative
-- check constraint in 0026/0027 also assumes buckets are >= 0.
--
-- So: `credit_debt` is its own column, always >= 0, and it is not spendable.
-- The UI can still render a negative "effective balance" (total - debt) to show
-- the user they are in the hole, without any arithmetic depending on a negative
-- bucket.
--
-- SETTLEMENT ORDER (what "new tokens cope this balance first" means here)
--
-- Debt is settled by EVERY inbound grant, before any of it becomes spendable:
--   • the once-per-day free floor top-up   (consume_ai_tokens)
--   • purchased packs and subscription allotments (grant_ai_tokens_once)
--   • rewarded-ad bonus credits            (grant_ad_credits)
--
-- So a refunder earns nothing — not even their free daily allowance — until the
-- refunded amount is repaid. That is what makes the loop unprofitable rather
-- than merely inconvenient.
--
-- WHAT IS DELIBERATELY *NOT* DEBT-SETTLING
--
-- `refund_ai_tokens` (the internal "the AI call failed, give it back" path) is
-- untouched. Those credits were already the user's and were debited moments
-- earlier; routing them to debt would charge the user for our own failure.
-- Debt is only ever settled by NEW value entering the account.
--
-- IDEMPOTENCY
--
-- Webhook deliveries retry. A clawback applied twice would invent debt, so
-- revocations are ledgered on the RevenueCat event id exactly like grants are.
--
-- Safe to run more than once.
-- ============================================================================

-- ── 1. The debt column ─────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists credit_debt integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_credit_debt_nonneg;
alter table public.profiles
  add constraint profiles_credit_debt_nonneg check (credit_debt >= 0);

-- Clients may never write their own debt (nor clear it).
revoke update (credit_debt) on public.profiles from anon, authenticated;

-- ── 2. Revocation ledger (idempotency for clawbacks) ───────────────────────
create table if not exists public.credit_revocations (
  event_id   text        primary key,
  user_id    uuid        not null,
  product_id text,
  amount     integer     not null,
  reason     text,
  -- How much we could take back from the live balance vs. how much became debt.
  recovered  integer     not null default 0,
  as_debt    integer     not null default 0,
  created_at timestamptz not null default now()
);

alter table public.credit_revocations enable row level security;
-- No policies on purpose: service_role bypasses RLS, every other role denied.
revoke all on table public.credit_revocations from anon, authenticated;

create index if not exists credit_revocations_user_idx
  on public.credit_revocations (user_id, created_at desc);

-- ── 3. Debt settlement helper ──────────────────────────────────────────────
-- Consumes `p_amount` against the user's outstanding debt and returns the
-- REMAINDER that should actually be credited. Caller must already hold the row
-- lock (`select ... for update`) so two concurrent grants cannot both settle the
-- same debt.
create or replace function public.settle_credit_debt(p_user uuid, p_amount integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_debt    integer;
  v_applied integer;
begin
  if p_user is null or p_amount is null or p_amount < 1 then
    return greatest(0, coalesce(p_amount, 0));
  end if;

  select greatest(0, coalesce(credit_debt, 0)) into v_debt
    from public.profiles where id = p_user;

  if v_debt is null or v_debt = 0 then
    return p_amount;
  end if;

  v_applied := least(v_debt, p_amount);

  update public.profiles
     set credit_debt = v_debt - v_applied
   where id = p_user;

  return p_amount - v_applied;
end;
$$;

revoke all on function public.settle_credit_debt(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.settle_credit_debt(uuid, integer) to service_role;

-- ── 4. Clawback (service_role only, called by the billing webhook) ─────────
create or replace function public.revoke_granted_credits(
  p_event_id text,
  p_user     uuid,
  p_amount   integer,
  p_product  text default null,
  p_reason   text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted  integer;
  v_paid      integer;
  v_debt      integer;
  v_recovered integer;
  v_as_debt   integer;
begin
  if p_event_id is null or p_event_id = '' or p_user is null
     or p_amount is null or p_amount < 1 or p_amount > 1000000 then
    return jsonb_build_object('revoked', false, 'reason', 'invalid_request');
  end if;

  -- Ledger first: a retried delivery must not claw back twice.
  insert into public.credit_revocations (event_id, user_id, product_id, amount, reason)
  values (p_event_id, p_user, p_product, p_amount, p_reason)
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('revoked', false, 'reason', 'duplicate_event');
  end if;

  select greatest(0, coalesce(ai_tokens, 0)), greatest(0, coalesce(credit_debt, 0))
    into v_paid, v_debt
    from public.profiles
   where id = p_user
     for update;

  if v_paid is null then
    -- Profile is gone (account deleted). The ledger row stands as the record.
    return jsonb_build_object('revoked', false, 'reason', 'no_profile');
  end if;

  -- Take back from the PAID bucket, which is where the grant landed. We do not
  -- raid the free or bonus buckets: those were never part of the purchase, and
  -- the debt below already captures everything we could not recover.
  v_recovered := least(v_paid, p_amount);
  v_as_debt   := p_amount - v_recovered;

  update public.profiles
     set ai_tokens   = v_paid - v_recovered,
         credit_debt = v_debt + v_as_debt
   where id = p_user;

  update public.credit_revocations
     set recovered = v_recovered,
         as_debt   = v_as_debt
   where event_id = p_event_id;

  return jsonb_build_object(
    'revoked',    true,
    'recovered',  v_recovered,
    'as_debt',    v_as_debt,
    'total_debt', v_debt + v_as_debt
  );
end;
$$;

revoke all on function public.revoke_granted_credits(text, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_granted_credits(text, uuid, integer, text, text)
  to service_role;

-- ── 5. Grants now settle debt before crediting ─────────────────────────────
-- Purchases and subscription allotments.
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
  v_inserted  integer;
  v_paid      integer;
  v_debt      integer;
  v_applied   integer;
  v_creditable integer;
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

  -- Lock the row so a concurrent ad grant or top-up cannot settle the same debt.
  select greatest(0, coalesce(ai_tokens, 0)), greatest(0, coalesce(credit_debt, 0))
    into v_paid, v_debt
    from public.profiles
   where id = p_user
     for update;

  if v_paid is null then
    -- No profile row yet (auth row created, profile trigger not landed). The
    -- ledger row must NOT stay, or the webhook retry would be treated as a
    -- replay and the user would be charged and never credited. Remove it so the
    -- next delivery can apply cleanly, and report failure so RevenueCat retries.
    delete from public.billing_events where event_id = p_event_id;
    return false;
  end if;

  -- Debt first. A user who refunded 500 and then buys 500 nets zero spendable
  -- credits — which is the point.
  v_applied    := least(v_debt, p_amount);
  v_creditable := p_amount - v_applied;

  update public.profiles
     set credit_debt = v_debt - v_applied,
         ai_tokens   = v_paid + v_creditable
   where id = p_user;

  return true;
end;
$$;

revoke all on function public.grant_ai_tokens_once(text, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_ai_tokens_once(text, uuid, integer, text, text)
  to service_role;

-- Rewarded-ad bonus credits.
create or replace function public.grant_ad_credits(
  p_user           uuid,
  p_transaction_id text,
  p_source         text default 'admob'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_per_ad     integer := public.ad_reward_credits();
  v_daily_max  integer := public.ad_reward_daily_max();
  v_earned     integer;
  v_amount     integer;
  v_inserted   integer;
  v_exists     boolean;
  v_debt       integer;
  v_applied    integer;
  v_creditable integer;
begin
  if p_user is null or p_transaction_id is null or p_transaction_id = '' then
    return jsonb_build_object('granted', false, 'reason', 'invalid_request');
  end if;

  select true, greatest(0, coalesce(credit_debt, 0))
    into v_exists, v_debt
    from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('granted', false, 'reason', 'no_profile');
  end if;

  select coalesce(sum(amount), 0) into v_earned
    from public.ad_grants
   where user_id = p_user
     and granted_on = current_date;

  if v_earned >= v_daily_max then
    return jsonb_build_object('granted', false, 'reason', 'daily_cap_reached',
                              'earned_today', v_earned, 'daily_max', v_daily_max);
  end if;

  -- Clamp so a reward can never push the day above the cap.
  v_amount := least(v_per_ad, v_daily_max - v_earned);

  insert into public.ad_grants (transaction_id, user_id, amount, source)
  values (p_transaction_id, p_user, v_amount, coalesce(p_source, 'admob'))
  on conflict (transaction_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('granted', false, 'reason', 'duplicate_transaction',
                              'earned_today', v_earned, 'daily_max', v_daily_max);
  end if;

  -- Debt is settled before the bonus becomes spendable. The ad still counts
  -- against the daily cap either way, so watching ads cannot be used to farm
  -- around a clawback.
  v_applied    := least(v_debt, v_amount);
  v_creditable := v_amount - v_applied;

  update public.profiles
     set credit_debt   = v_debt - v_applied,
         bonus_tokens  = case when bonus_date = current_date
                              then greatest(0, coalesce(bonus_tokens, 0)) + v_creditable
                              else v_creditable end,
         bonus_date    = current_date
   where id = p_user;

  return jsonb_build_object('granted', true, 'amount', v_amount,
                            'applied_to_debt', v_applied,
                            'credited', v_creditable,
                            'earned_today', v_earned + v_amount,
                            'daily_max', v_daily_max);
end;
$$;

revoke all on function public.grant_ad_credits(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_ad_credits(uuid, text, text) to service_role;

-- ── 6. Spend: debt-aware daily top-up ──────────────────────────────────────
-- Only the top-up block changes from 0027. The floor is still computed from
-- free+paid (bonus stays excluded so ads can't shrink tomorrow's grant), but the
-- amount the top-up would add is now consumed by debt first.
create or replace function public.consume_ai_tokens(p_cost integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user       uuid := auth.uid();
  v_p          public.profiles%rowtype;
  v_floor      integer;
  v_free       integer;
  v_paid       integer;
  v_bonus      integer;
  v_debt       integer;
  v_topup      integer;
  v_applied    integer;
  v_total      integer;
  v_left       integer;
  v_from_bonus integer;
  v_from_free  integer;
  v_from_paid  integer;
begin
  if v_user is null then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'unauthenticated',
                              'from_bonus', 0, 'from_free', 0, 'from_paid', 0);
  end if;

  if p_cost is null or p_cost < 1 or p_cost > public.max_ai_call_cost() then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'invalid_cost',
                              'from_bonus', 0, 'from_free', 0, 'from_paid', 0);
  end if;

  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'no_profile',
                              'from_bonus', 0, 'from_free', 0, 'from_paid', 0);
  end if;

  v_floor := coalesce(v_p.daily_token_allowance, public.default_daily_tokens());
  v_free  := greatest(0, coalesce(v_p.daily_free_tokens, 0));
  v_paid  := greatest(0, coalesce(v_p.ai_tokens, 0));
  v_debt  := greatest(0, coalesce(v_p.credit_debt, 0));

  -- Expire a stale bonus bucket before anything else reads it.
  if v_p.bonus_date is distinct from current_date then
    v_bonus := 0;
    update public.profiles
       set bonus_tokens = 0,
           bonus_date   = current_date
     where id = v_user;
  else
    v_bonus := greatest(0, coalesce(v_p.bonus_tokens, 0));
  end if;

  -- Once-per-day floor top-up, debt-aware.
  if v_p.daily_free_date is distinct from current_date then
    v_topup := greatest(0, v_floor - (v_free + v_paid));
    if v_topup > 0 and v_debt > 0 then
      -- The grant is earned, then immediately consumed by the outstanding debt.
      v_applied := least(v_debt, v_topup);
      v_debt    := v_debt - v_applied;
      v_topup   := v_topup - v_applied;
    end if;
    v_free := v_free + v_topup;

    update public.profiles
       set daily_free_tokens = v_free,
           daily_free_date   = current_date,
           credit_debt       = v_debt
     where id = v_user;
  end if;

  v_total := v_bonus + v_free + v_paid;
  if v_total < p_cost then
    return jsonb_build_object('allowed', false, 'remaining', v_total,
                              'reason', case when v_debt > 0 then 'credit_debt'
                                             else 'insufficient_tokens' end,
                              'debt', v_debt,
                              'from_bonus', 0, 'from_free', 0, 'from_paid', 0);
  end if;

  -- Most perishable first.
  v_from_bonus := least(v_bonus, p_cost);
  v_left       := p_cost - v_from_bonus;
  v_from_free  := least(v_free, v_left);
  v_from_paid  := v_left - v_from_free;

  update public.profiles
     set bonus_tokens      = v_bonus - v_from_bonus,
         daily_free_tokens = v_free  - v_from_free,
         ai_tokens         = v_paid  - v_from_paid
   where id = v_user;

  return jsonb_build_object(
    'allowed',    true,
    'remaining',  v_total - p_cost,
    'reason',     'ok',
    'debt',       v_debt,
    'from_bonus', v_from_bonus,
    'from_free',  v_from_free,
    'from_paid',  v_from_paid
  );
end;
$$;

-- ── 7. Balance reports debt, and projects the debt-aware top-up ────────────
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
  v_bonus   integer;
  v_debt    integer;
  v_topup   integer;
  v_applied integer;
begin
  if v_user is null then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'bonus', 0,
                              'debt', 0, 'total', 0, 'floor', 0);
  end if;

  select * into v_p from public.profiles where id = v_user;
  if not found then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'bonus', 0,
                              'debt', 0, 'total', 0, 'floor', 0);
  end if;

  v_floor := coalesce(v_p.daily_token_allowance, public.default_daily_tokens());
  v_free  := greatest(0, coalesce(v_p.daily_free_tokens, 0));
  v_paid  := greatest(0, coalesce(v_p.ai_tokens, 0));
  v_debt  := greatest(0, coalesce(v_p.credit_debt, 0));
  -- Yesterday's bonus is already gone, whether or not the row has been touched.
  v_bonus := case
    when v_p.bonus_date = current_date then greatest(0, coalesce(v_p.bonus_tokens, 0))
    else 0
  end;

  -- Project (never persist) the top-up the next spend will apply, including the
  -- debt it would be swallowed by — so the store never promises credits that
  -- will in fact go straight to settling a refund.
  --
  -- This block is intentionally LINE-FOR-LINE the same arithmetic as the top-up
  -- inside consume_ai_tokens. If the two ever diverge, the store shows a balance
  -- the next spend won't honour.
  if v_p.daily_free_date is distinct from current_date then
    v_topup := greatest(0, v_floor - (v_free + v_paid));
    if v_topup > 0 and v_debt > 0 then
      v_applied := least(v_debt, v_topup);
      v_debt    := v_debt - v_applied;
      v_topup   := v_topup - v_applied;
    end if;
    v_free := v_free + v_topup;
  end if;

  return jsonb_build_object(
    'daily_free', v_free,
    'purchased',  v_paid,
    'bonus',      v_bonus,
    -- Outstanding clawback. Not spendable; every inbound grant settles it first.
    'debt',       v_debt,
    'total',      v_free + v_paid + v_bonus,
    'floor',      v_floor
  );
end;
$$;

-- ── 8. Re-assert client grants ─────────────────────────────────────────────
revoke all on function public.consume_ai_tokens(integer) from public, anon;
revoke all on function public.get_ai_balance()           from public, anon;
grant execute on function public.consume_ai_tokens(integer) to authenticated;
grant execute on function public.get_ai_balance()           to authenticated;

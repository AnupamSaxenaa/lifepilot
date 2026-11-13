-- ============================================================================
-- 0027 — Rewarded-ad credits: a same-day bonus bucket
-- ============================================================================
-- WHY A THIRD BUCKET
--
-- 0026 gave us two buckets: a replenishing free floor and a persistent paid
-- balance. Rewarded-ad credits fit neither, and putting them in the paid bucket
-- creates two bugs:
--
--   1. The floor top-up rule is `if (free + paid) < floor`. Ad credits sitting in
--      `paid` would be counted, so watching 2 ads today would LOWER tomorrow's
--      free grant from 20 to 14. Watching ads must never cost a user credits.
--
--   2. Paid credits never expire, so a user could farm the daily ad cap forever
--      and accumulate a permanent balance identical to a purchase. That
--      undercuts the packs and rewards idling rather than engagement.
--
-- So ad credits get their own bucket that expires at the date roll:
--
--   bonus = profiles.bonus_tokens  → same-day only, from rewarded ads
--   free  = profiles.daily_free_tokens → replenishing floor (0026)
--   paid  = profiles.ai_tokens     → purchased, never expires (0026)
--
-- SPEND ORDER: bonus → free → paid. Strictly most-perishable-first, so a user
-- never loses value they could have spent.
--
-- The reward amount and daily cap live in `app_config`, so tuning them is an
-- UPDATE and not a migration:
--   ad_reward_credits  → credits per completed ad   (default 3)
--   ad_reward_daily_max→ max ad credits per day     (default 6, i.e. 2 ads)
--
-- SECURITY: the client cannot grant itself anything. `grant_ad_credits` is
-- service_role only and is called exclusively by the `ad-reward` edge function
-- after it verifies AdMob's Server-Side Verification signature. The daily cap and
-- the replay check both live here, not in the app.
--
-- Safe to run more than once.
-- ============================================================================

-- ── 1. Bonus bucket columns ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists bonus_tokens integer not null default 0,
  add column if not exists bonus_date   date;

alter table public.profiles
  drop constraint if exists profiles_bonus_tokens_nonneg;
alter table public.profiles
  add constraint profiles_bonus_tokens_nonneg check (bonus_tokens >= 0);

-- Clients may never write their own bonus balance.
revoke update (bonus_tokens, bonus_date) on public.profiles from anon, authenticated;

-- ── 2. Tunable reward config ───────────────────────────────────────────────
insert into public.app_config (key, value) values
  ('ad_reward_credits',   '3'::jsonb),
  ('ad_reward_daily_max', '6'::jsonb)
on conflict (key) do nothing;

create or replace function public.ad_reward_credits()
returns integer
language sql stable security definer set search_path = public
as $$
  select greatest(1, coalesce(
    (select (value #>> '{}')::int from public.app_config where key = 'ad_reward_credits'), 3));
$$;

create or replace function public.ad_reward_daily_max()
returns integer
language sql stable security definer set search_path = public
as $$
  select greatest(0, coalesce(
    (select (value #>> '{}')::int from public.app_config where key = 'ad_reward_daily_max'), 6));
$$;

revoke all on function public.ad_reward_credits()   from public, anon;
revoke all on function public.ad_reward_daily_max() from public, anon;
grant execute on function public.ad_reward_credits()   to authenticated, service_role;
grant execute on function public.ad_reward_daily_max() to authenticated, service_role;

-- ── 3. Ad grant ledger (daily cap + replay protection) ─────────────────────
-- AdMob can retry an SSV callback, and a retry must not pay out twice. AdMob's
-- transaction id is the natural idempotency key.
create table if not exists public.ad_grants (
  transaction_id text        primary key,
  user_id        uuid        not null,
  amount         integer     not null,
  source         text,
  granted_on     date        not null default current_date,
  created_at     timestamptz not null default now()
);

alter table public.ad_grants enable row level security;
-- No policies on purpose: service_role bypasses RLS, all other roles denied.
revoke all on table public.ad_grants from anon, authenticated;

create index if not exists ad_grants_user_day_idx
  on public.ad_grants (user_id, granted_on);

-- ── 4. Balance (now four-part; `total` contract preserved) ──────────────────
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
  v_bonus integer;
begin
  if v_user is null then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'bonus', 0,
                              'total', 0, 'floor', 0);
  end if;

  select * into v_p from public.profiles where id = v_user;
  if not found then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'bonus', 0,
                              'total', 0, 'floor', 0);
  end if;

  v_floor := coalesce(v_p.daily_token_allowance, public.default_daily_tokens());
  v_free  := greatest(0, coalesce(v_p.daily_free_tokens, 0));
  v_paid  := greatest(0, coalesce(v_p.ai_tokens, 0));
  -- Yesterday's bonus is already gone, whether or not the row has been touched.
  v_bonus := case
    when v_p.bonus_date = current_date then greatest(0, coalesce(v_p.bonus_tokens, 0))
    else 0
  end;

  -- Project (never persist) the top-up the next spend will apply.
  if v_p.daily_free_date is distinct from current_date and v_free + v_paid < v_floor then
    v_free := v_floor - v_paid;
  end if;

  return jsonb_build_object(
    'daily_free', v_free,
    'purchased',  v_paid,
    'bonus',      v_bonus,
    'total',      v_free + v_paid + v_bonus,
    'floor',      v_floor
  );
end;
$$;

-- ── 5. Spend: bonus → free → paid ──────────────────────────────────────────
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
  v_paid   := greatest(0, coalesce(v_p.ai_tokens, 0));

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

  -- Once-per-day floor top-up (0026 rule; bonus is deliberately excluded, so
  -- earning ad credits can never reduce the free grant).
  if v_p.daily_free_date is distinct from current_date then
    if v_free + v_paid < v_floor then
      v_free := v_floor - v_paid;
    end if;
    update public.profiles
       set daily_free_tokens = v_free,
           daily_free_date   = current_date
     where id = v_user;
  end if;

  v_total := v_bonus + v_free + v_paid;
  if v_total < p_cost then
    return jsonb_build_object('allowed', false, 'remaining', v_total, 'reason', 'insufficient_tokens',
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
    'from_bonus', v_from_bonus,
    'from_free',  v_from_free,
    'from_paid',  v_from_paid
  );
end;
$$;

-- ── 6. Refund, bucket-accurate across all three buckets ────────────────────
create or replace function public.refund_ai_tokens(
  p_user       uuid,
  p_from_bonus integer,
  p_from_free  integer,
  p_from_paid  integer
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_floor integer;
  v_free  integer;
  v_paid  integer;
  v_bonus integer;
  v_bdate date;
  v_fb    integer := greatest(0, coalesce(p_from_bonus, 0));
  v_ff    integer := greatest(0, coalesce(p_from_free, 0));
  v_fp    integer := greatest(0, coalesce(p_from_paid, 0));
begin
  if p_user is null then return; end if;
  if v_fb + v_ff + v_fp < 1 or v_fb + v_ff + v_fp > public.max_ai_call_cost() then
    return;
  end if;

  select coalesce(daily_token_allowance, public.default_daily_tokens()),
         greatest(0, coalesce(daily_free_tokens, 0)),
         greatest(0, coalesce(ai_tokens, 0)),
         greatest(0, coalesce(bonus_tokens, 0)),
         bonus_date
    into v_floor, v_free, v_paid, v_bonus, v_bdate
    from public.profiles
   where id = p_user
     for update;

  if v_floor is null then return; end if;

  update public.profiles
     set daily_free_tokens = least(v_floor, v_free + v_ff),
         ai_tokens         = v_paid + v_fp,
         -- A bonus refund is only meaningful on the day it was spent; after the
         -- date roll those credits have expired and must not be resurrected.
         bonus_tokens      = case when v_bdate = current_date then v_bonus + v_fb else v_bonus end
   where id = p_user;
end;
$$;

revoke all on function public.refund_ai_tokens(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.refund_ai_tokens(uuid, integer, integer, integer) to service_role;

-- ── 7. Grant ad credits (service_role only) ────────────────────────────────
create or replace function public.grant_ad_credits(
  p_user           uuid,
  p_transaction_id text,
  p_source         text default 'admob'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_per_ad    integer := public.ad_reward_credits();
  v_daily_max integer := public.ad_reward_daily_max();
  v_earned    integer;
  v_amount    integer;
  v_inserted  integer;
  v_exists    boolean;
begin
  if p_user is null or p_transaction_id is null or p_transaction_id = '' then
    return jsonb_build_object('granted', false, 'reason', 'invalid_request');
  end if;

  select true into v_exists from public.profiles where id = p_user for update;
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

  -- Land in the bonus bucket, resetting it first if it is stale.
  update public.profiles
     set bonus_tokens = case when bonus_date = current_date
                             then greatest(0, coalesce(bonus_tokens, 0)) + v_amount
                             else v_amount end,
         bonus_date   = current_date
   where id = p_user;

  return jsonb_build_object('granted', true, 'amount', v_amount,
                            'earned_today', v_earned + v_amount,
                            'daily_max', v_daily_max);
end;
$$;

revoke all on function public.grant_ad_credits(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_ad_credits(uuid, text, text) to service_role;

-- ── 8. Ad availability, for the client to render honestly ──────────────────
-- Read-only. Lets the store show "1 ad left today" without the client ever
-- being the authority on the cap.
create or replace function public.get_ad_reward_status()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_per_ad    integer := public.ad_reward_credits();
  v_daily_max integer := public.ad_reward_daily_max();
  v_earned    integer;
  v_remaining integer;
begin
  if v_user is null then
    return jsonb_build_object('credits_per_ad', v_per_ad, 'daily_max', v_daily_max,
                              'earned_today', 0, 'remaining_today', 0, 'ads_left', 0);
  end if;

  select coalesce(sum(amount), 0) into v_earned
    from public.ad_grants
   where user_id = v_user
     and granted_on = current_date;

  v_remaining := greatest(0, v_daily_max - v_earned);

  return jsonb_build_object(
    'credits_per_ad',  v_per_ad,
    'daily_max',       v_daily_max,
    'earned_today',    v_earned,
    'remaining_today', v_remaining,
    -- ceil(remaining / per_ad): a partial final reward still costs one ad.
    'ads_left',        (v_remaining + v_per_ad - 1) / v_per_ad
  );
end;
$$;

revoke all on function public.get_ad_reward_status() from public, anon;
grant execute on function public.get_ad_reward_status() to authenticated;

-- ── 9. Re-assert client grants ─────────────────────────────────────────────
revoke all on function public.consume_ai_tokens(integer) from public, anon;
revoke all on function public.get_ai_balance()           from public, anon;
grant execute on function public.consume_ai_tokens(integer) to authenticated;
grant execute on function public.get_ai_balance()           to authenticated;

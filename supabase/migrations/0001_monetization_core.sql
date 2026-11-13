-- ============================================================================
-- LifePilot — Monetization & Secure AI Token Core
-- ----------------------------------------------------------------------------
-- Model:
--   • AI is a pure CONSUMABLE token economy for EVERYONE (no unlimited AI).
--   • Two buckets:
--       daily_free_tokens  → resets to N every day (the free tier)
--       ai_tokens          → PURCHASED / granted; persistent, never auto-reset
--   • Every AI call spends from the daily free bucket first, then purchased.
--   • When both are empty, the user must buy a token pack.
--   • is_pro governs NON-AI perks (Mindful Lock unlimited, widgets, themes) and
--     may grant a monthly token top-up — but Pro still consumes tokens for AI.
--
--   Clients CANNOT modify token/entitlement columns (column-level REVOKE).
--   All mutations go through SECURITY DEFINER RPCs / the service role.
--
-- Apply with:  supabase db push   (or paste into the Supabase SQL editor)
-- ============================================================================

-- ── 1. Entitlement / token columns on profiles ─────────────────────────────
alter table public.profiles
  add column if not exists is_pro             boolean     not null default false,
  add column if not exists pro_expires_at     timestamptz,
  add column if not exists plan_type          text        not null default 'free',
  add column if not exists ai_tokens          integer     not null default 0,   -- purchased/granted (persistent)
  add column if not exists daily_free_tokens  integer     not null default 0,   -- resets daily
  add column if not exists daily_free_date    date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_plan_type_check') then
    alter table public.profiles
      add constraint profiles_plan_type_check
      check (plan_type in ('free', 'monthly', 'yearly', 'lifetime'));
  end if;
end $$;

-- Non-negative guards
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_ai_tokens_nonneg') then
    alter table public.profiles add constraint profiles_ai_tokens_nonneg check (ai_tokens >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_daily_free_nonneg') then
    alter table public.profiles add constraint profiles_daily_free_nonneg check (daily_free_tokens >= 0);
  end if;
end $$;

-- ── 2. Tunable config (no code deploy needed to change the free allotment) ──
create table if not exists public.app_config (
  key   text primary key,
  value jsonb not null
);

insert into public.app_config (key, value) values
  ('free_daily_tokens', '10'::jsonb)
on conflict (key) do nothing;

-- ── 3. Lock down sensitive columns ──────────────────────────────────────────
revoke update (is_pro, pro_expires_at, plan_type, ai_tokens, daily_free_tokens, daily_free_date)
  on public.profiles from authenticated;
revoke update (is_pro, pro_expires_at, plan_type, ai_tokens, daily_free_tokens, daily_free_date)
  on public.profiles from anon;

-- ── 4. Non-AI Pro status helper (respects expiry) ──────────────────────────
create or replace function public.is_user_pro(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select is_pro
       and (plan_type = 'lifetime' or pro_expires_at is null or pro_expires_at > now())
     from public.profiles where id = p_user),
    false);
$$;

-- ── 5. Read-only effective AI balance (applies daily reset in-memory) ───────
-- Returns { daily_free: int, purchased: int, total: int }
create or replace function public.get_ai_balance()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_p    public.profiles%rowtype;
  v_free integer;
  v_daily integer;
begin
  if v_user is null then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'total', 0);
  end if;
  select * into v_p from public.profiles where id = v_user;
  if not found then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'total', 0);
  end if;

  select coalesce((value)::text::integer, 10) into v_free from public.app_config where key = 'free_daily_tokens';
  v_free := coalesce(v_free, 10);

  if v_p.daily_free_date is null or v_p.daily_free_date < current_date then
    v_daily := v_free;               -- would reset today on next spend
  else
    v_daily := coalesce(v_p.daily_free_tokens, 0);
  end if;

  return jsonb_build_object(
    'daily_free', v_daily,
    'purchased', coalesce(v_p.ai_tokens, 0),
    'total', v_daily + coalesce(v_p.ai_tokens, 0)
  );
end;
$$;

-- ── 6. Atomic token consumption (spends daily-free first, then purchased) ───
-- Returns { allowed: bool, remaining: int, reason: text }
create or replace function public.consume_ai_tokens(p_cost integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_p     public.profiles%rowtype;
  v_free  integer;
  v_from_free integer;
  v_from_paid integer;
  v_total integer;
begin
  if v_user is null then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'unauthenticated');
  end if;
  if p_cost is null or p_cost < 1 then p_cost := 1; end if;

  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'no_profile');
  end if;

  select coalesce((value)::text::integer, 10) into v_free from public.app_config where key = 'free_daily_tokens';
  v_free := coalesce(v_free, 10);

  -- Daily free reset (does NOT touch purchased ai_tokens)
  if v_p.daily_free_date is null or v_p.daily_free_date < current_date then
    update public.profiles
      set daily_free_tokens = v_free, daily_free_date = current_date
      where id = v_user
      returning * into v_p;
  end if;

  v_total := coalesce(v_p.daily_free_tokens, 0) + coalesce(v_p.ai_tokens, 0);

  if v_total < p_cost then
    return jsonb_build_object('allowed', false, 'remaining', v_total, 'reason', 'insufficient_tokens');
  end if;

  -- Spend daily-free first, remainder from purchased
  v_from_free := least(coalesce(v_p.daily_free_tokens, 0), p_cost);
  v_from_paid := p_cost - v_from_free;

  update public.profiles
    set daily_free_tokens = daily_free_tokens - v_from_free,
        ai_tokens         = ai_tokens - v_from_paid
    where id = v_user
    returning * into v_p;

  return jsonb_build_object(
    'allowed', true,
    'remaining', coalesce(v_p.daily_free_tokens, 0) + coalesce(v_p.ai_tokens, 0),
    'reason', 'ok');
end;
$$;

-- Refund purchased tokens when the AI provider fully fails after a spend.
-- (Refunds go to the purchased bucket to keep it simple and fair.)
create or replace function public.refund_ai_tokens(p_amount integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_amount is null or p_amount <= 0 then return; end if;
  update public.profiles set ai_tokens = ai_tokens + p_amount where id = v_user;
end;
$$;

-- Grant purchased tokens (service_role only — called by the billing webhook).
create or replace function public.grant_ai_tokens(p_user uuid, p_amount integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null or p_amount is null or p_amount <= 0 then return; end if;
  update public.profiles set ai_tokens = ai_tokens + p_amount where id = p_user;
end;
$$;

-- Set Pro entitlement (service_role only — called by the billing webhook).
create or replace function public.set_pro_status(p_user uuid, p_is_pro boolean, p_plan text, p_expires timestamptz)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null then return; end if;
  update public.profiles
     set is_pro = coalesce(p_is_pro, false),
         plan_type = coalesce(p_plan, 'free'),
         pro_expires_at = p_expires
   where id = p_user;
end;
$$;

-- ── 7. Grants ────────────────────────────────────────────────────────────────
revoke all on function public.consume_ai_tokens(integer) from public, anon;
revoke all on function public.refund_ai_tokens(integer)  from public, anon;
revoke all on function public.get_ai_balance()           from public, anon;
grant execute on function public.consume_ai_tokens(integer) to authenticated;
grant execute on function public.refund_ai_tokens(integer)  to authenticated;
grant execute on function public.get_ai_balance()           to authenticated;
grant execute on function public.is_user_pro(uuid)          to authenticated;

-- Service-role-only functions: revoke from everyone else.
revoke all on function public.grant_ai_tokens(uuid, integer) from public, anon, authenticated;
revoke all on function public.set_pro_status(uuid, boolean, text, timestamptz) from public, anon, authenticated;

-- ── 8. Seed existing users ───────────────────────────────────────────────────
-- Give every existing user a one-time starter grant of purchased tokens so the
-- rollout isn't jarring. New free users rely on the daily free bucket.
update public.profiles
   set ai_tokens = greatest(coalesce(ai_tokens, 0), 30)
 where ai_tokens is null or ai_tokens = 0;

-- Owner/test accounts: large purchased balance (still consumed — never a bypass)
-- plus lifetime Pro for the non-AI perks.
update public.profiles
   set is_pro = true,
       plan_type = 'lifetime',
       ai_tokens = greatest(coalesce(ai_tokens, 0), 1000000)
 where username in ('terminator', 'saxenaanupam2004');

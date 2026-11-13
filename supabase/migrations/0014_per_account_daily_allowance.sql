-- ============================================================================
-- 0014 — Per-account daily AI allowance
-- ============================================================================
-- 0012 hard-coded a 20/day cap for every account. This keeps 20 as the default
-- for everyone but allows a per-account override, so the owner/dev account can
-- run at 10000/day without loosening anybody else's limit.
--
-- Design notes:
--   • The override is a COLUMN, not a username baked into the functions, so
--     changing it later is data, not a migration.
--   • Clients cannot write it: UPDATE on the column is revoked from anon and
--     authenticated, and every credit function is SECURITY DEFINER. A tampered
--     client therefore cannot raise its own allowance.
--   • Reset, spend, and refund all read the SAME effective cap, so no path can
--     drift above it.
--
-- Safe to run more than once.
-- ============================================================================

alter table public.profiles
  add column if not exists daily_token_allowance integer;

alter table public.profiles
  drop constraint if exists profiles_daily_allowance_sane;
alter table public.profiles
  add constraint profiles_daily_allowance_sane
  check (daily_token_allowance is null or (daily_token_allowance between 1 and 100000));

-- Only the backend may set an allowance.
revoke update (daily_token_allowance) on public.profiles from anon, authenticated;

-- The global default, still driven by app_config ('free_daily_tokens' = 20).
create or replace function public.default_daily_tokens()
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce((select (value #>> '{}')::int from public.app_config where key = 'free_daily_tokens'), 20);
$$;

revoke all on function public.default_daily_tokens() from public, anon;
grant execute on function public.default_daily_tokens() to authenticated, service_role;

-- ── Balance ────────────────────────────────────────────────────────────────
create or replace function public.get_ai_balance()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_p public.profiles%rowtype;
  v_cap integer;
  v_daily integer;
begin
  if v_user is null then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'total', 0);
  end if;

  select * into v_p from public.profiles where id = v_user;
  if not found then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'total', 0);
  end if;

  v_cap := coalesce(v_p.daily_token_allowance, public.default_daily_tokens());

  if v_p.daily_free_date is distinct from current_date then
    v_daily := v_cap;
  else
    v_daily := least(v_cap, greatest(0, coalesce(v_p.daily_free_tokens, 0)));
  end if;

  return jsonb_build_object(
    'daily_free', v_daily,
    'purchased', 0,
    'total', v_daily
  );
end;
$$;

-- ── Spend ──────────────────────────────────────────────────────────────────
create or replace function public.consume_ai_tokens(p_cost integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_p public.profiles%rowtype;
  v_cap integer;
  v_remaining integer;
begin
  if v_user is null then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'unauthenticated');
  end if;

  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'no_profile');
  end if;

  v_cap := coalesce(v_p.daily_token_allowance, public.default_daily_tokens());

  -- A single call may never cost more than one day's allowance.
  if p_cost is null or p_cost < 1 or p_cost > v_cap then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'invalid_cost');
  end if;

  if v_p.daily_free_date is distinct from current_date then
    update public.profiles
    set daily_free_tokens = v_cap,
        daily_free_date = current_date
    where id = v_user
    returning * into v_p;
  end if;

  v_remaining := least(v_cap, greatest(0, coalesce(v_p.daily_free_tokens, 0)));

  if v_remaining < p_cost then
    return jsonb_build_object(
      'allowed', false,
      'remaining', v_remaining,
      'reason', 'insufficient_tokens'
    );
  end if;

  update public.profiles
  set daily_free_tokens = v_remaining - p_cost
  where id = v_user
  returning daily_free_tokens into v_remaining;

  return jsonb_build_object('allowed', true, 'remaining', v_remaining, 'reason', 'ok');
end;
$$;

-- ── Refund (service role only, unchanged contract) ─────────────────────────
create or replace function public.refund_ai_tokens(p_user uuid, p_amount integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_cap integer;
begin
  if p_user is null or p_amount is null or p_amount < 1 then
    return;
  end if;

  select coalesce(daily_token_allowance, public.default_daily_tokens())
  into v_cap
  from public.profiles
  where id = p_user;

  if v_cap is null or p_amount > v_cap then
    return;
  end if;

  update public.profiles
  set daily_free_tokens = least(v_cap, greatest(0, daily_free_tokens) + p_amount)
  where id = p_user
    and daily_free_date = current_date;
end;
$$;

revoke all on function public.refund_ai_tokens(uuid, integer) from public, anon, authenticated;
grant execute on function public.refund_ai_tokens(uuid, integer) to service_role;

revoke all on function public.consume_ai_tokens(integer) from public, anon;
revoke all on function public.get_ai_balance() from public, anon;
grant execute on function public.consume_ai_tokens(integer) to authenticated;
grant execute on function public.get_ai_balance() to authenticated;

-- ── Grant the owner/dev account its higher allowance ───────────────────────
do $$
declare
  v_matched integer;
begin
  update public.profiles
  set daily_token_allowance = 10000,
      daily_free_tokens = 10000,
      daily_free_date = current_date
  where username = 'saxenaanupam2004';

  get diagnostics v_matched = row_count;

  if v_matched = 0 then
    raise warning 'No profile with username saxenaanupam2004 — no allowance granted. Check the exact username.';
  else
    raise notice 'Granted 10000/day allowance to % profile(s) for username saxenaanupam2004.', v_matched;
  end if;
end $$;

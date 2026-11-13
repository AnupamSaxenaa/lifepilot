-- ============================================================================
-- LifePilot — AI Abuse Guardrails (rate limiting + global kill switch)
-- ----------------------------------------------------------------------------
-- Protects the shared provider API keys (Groq/Gemini/Mistral/Cohere) from
-- being hammered by a single account — token balance alone doesn't stop a
-- script from firing hundreds of requests/minute, even from a dev account
-- with a large purchased balance (like the owner account with 1M+ tokens).
--
-- Adds:
--   • Per-user sliding rate limit (requests/minute + requests/day), enforced
--     server-side via a SECURITY DEFINER RPC — cannot be bypassed by the
--     client since the limits are hardcoded in the function, not passed in.
--   • A global `ai_enabled` kill switch in app_config you can flip to `false`
--     via the SQL editor to instantly stop ALL AI calls app-wide, no deploy
--     needed, if something ever goes wrong.
--
-- Apply this AFTER 0001 and 0002 (same as those, paste into SQL editor).
-- ============================================================================

-- ── Rate-limit counters on profiles ─────────────────────────────────────────
alter table public.profiles
  add column if not exists ai_rl_minute_count integer     not null default 0,
  add column if not exists ai_rl_minute_start  timestamptz,
  add column if not exists ai_rl_day_count     integer     not null default 0,
  add column if not exists ai_rl_day_start     timestamptz;

-- ── Global AI kill switch ───────────────────────────────────────────────────
insert into public.app_config (key, value) values
  ('ai_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- ── Rate limit check + increment (atomic, hardcoded limits) ────────────────
-- Limits are intentionally NOT parameters — a client calling this RPC
-- directly cannot loosen them. 20/minute and 300/day are generous ceilings
-- for legitimate use but block runaway scripts/bots.
create or replace function public.check_ai_rate_limit()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user         uuid := auth.uid();
  v_p            public.profiles%rowtype;
  v_minute_limit integer := 20;
  v_day_limit    integer := 300;
  v_now          timestamptz := now();
  v_minute_count integer;
  v_minute_start timestamptz;
  v_day_count    integer;
  v_day_start    timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'no_profile');
  end if;

  v_minute_count := coalesce(v_p.ai_rl_minute_count, 0);
  v_minute_start := v_p.ai_rl_minute_start;
  v_day_count    := coalesce(v_p.ai_rl_day_count, 0);
  v_day_start    := v_p.ai_rl_day_start;

  if v_minute_start is null or v_minute_start < v_now - interval '1 minute' then
    v_minute_count := 0;
    v_minute_start := v_now;
  end if;

  if v_day_start is null or v_day_start < v_now - interval '1 day' then
    v_day_count := 0;
    v_day_start := v_now;
  end if;

  if v_minute_count >= v_minute_limit then
    update public.profiles
       set ai_rl_minute_count = v_minute_count, ai_rl_minute_start = v_minute_start,
           ai_rl_day_count = v_day_count, ai_rl_day_start = v_day_start
     where id = v_user;
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited_minute');
  end if;

  if v_day_count >= v_day_limit then
    update public.profiles
       set ai_rl_minute_count = v_minute_count, ai_rl_minute_start = v_minute_start,
           ai_rl_day_count = v_day_count, ai_rl_day_start = v_day_start
     where id = v_user;
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited_day');
  end if;

  update public.profiles
     set ai_rl_minute_count = v_minute_count + 1, ai_rl_minute_start = v_minute_start,
         ai_rl_day_count = v_day_count + 1, ai_rl_day_start = v_day_start
   where id = v_user;

  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.check_ai_rate_limit() from public, anon;
grant execute on function public.check_ai_rate_limit() to authenticated;

-- ── Global kill switch reader (bypasses RLS on app_config) ─────────────────
create or replace function public.is_ai_enabled()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select (value)::text::boolean from public.app_config where key = 'ai_enabled'),
    true);
$$;

revoke all on function public.is_ai_enabled() from public, anon;
grant execute on function public.is_ai_enabled() to authenticated;

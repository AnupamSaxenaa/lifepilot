-- LifePilot: hard 20-credit daily AI cap for every account.
-- Persistent ai_tokens remain for schema compatibility but are ignored.

insert into public.app_config (key, value)
values ('free_daily_tokens', '20'::jsonb)
on conflict (key) do update set value = excluded.value;

create or replace function public.get_ai_balance()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_p public.profiles%rowtype;
  v_daily integer;
begin
  if v_user is null then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'total', 0);
  end if;

  select * into v_p from public.profiles where id = v_user;
  if not found then
    return jsonb_build_object('daily_free', 0, 'purchased', 0, 'total', 0);
  end if;

  if v_p.daily_free_date is distinct from current_date then
    v_daily := 20;
  else
    v_daily := least(20, greatest(0, coalesce(v_p.daily_free_tokens, 0)));
  end if;

  return jsonb_build_object(
    'daily_free', v_daily,
    'purchased', 0,
    'total', v_daily
  );
end;
$$;

create or replace function public.consume_ai_tokens(p_cost integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_p public.profiles%rowtype;
  v_remaining integer;
begin
  if v_user is null then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'unauthenticated');
  end if;
  if p_cost is null or p_cost < 1 or p_cost > 20 then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'invalid_cost');
  end if;

  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'no_profile');
  end if;

  if v_p.daily_free_date is distinct from current_date then
    update public.profiles
       set daily_free_tokens = 20,
           daily_free_date = current_date
     where id = v_user
     returning * into v_p;
  end if;

  v_remaining := least(20, greatest(0, coalesce(v_p.daily_free_tokens, 0)));
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

-- Disable the legacy client-callable amount refund. Leaving the signature in
-- place makes rollout safe if the edge function and migration deploy moments
-- apart, but no API role can execute it.
create or replace function public.refund_ai_tokens(p_amount integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  return;
end;
$$;

revoke all on function public.refund_ai_tokens(integer)
  from public, anon, authenticated, service_role;

-- Only the trusted AI proxy may refund the authenticated user's failed call.
-- Refunds return to today's expiring bucket and can never exceed 20.
create or replace function public.refund_ai_tokens(p_user uuid, p_amount integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null or p_amount is null or p_amount < 1 or p_amount > 20 then
    return;
  end if;

  update public.profiles
     set daily_free_tokens = least(20, greatest(0, daily_free_tokens) + p_amount)
   where id = p_user
     and daily_free_date = current_date;
end;
$$;

revoke all on function public.refund_ai_tokens(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.refund_ai_tokens(uuid, integer) to service_role;

revoke all on function public.consume_ai_tokens(integer) from public, anon;
revoke all on function public.get_ai_balance() from public, anon;
grant execute on function public.consume_ai_tokens(integer) to authenticated;
grant execute on function public.get_ai_balance() to authenticated;

-- Start every existing account on the same capped bucket at rollout. This is a
-- one-time fresh allotment; subsequent resets happen on the database date.
update public.profiles
   set daily_free_tokens = 20,
       daily_free_date = current_date;
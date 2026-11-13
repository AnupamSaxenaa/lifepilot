-- ============================================================================
-- 0032 — The daily free floor is ADDITIVE to purchased credits
-- ============================================================================
-- THE BUG THIS FIXES: Pro was worth LESS than free.
--
-- 0026/0027 topped up against the combined balance:
--
--     if (free + paid) < floor then free := floor - paid;
--
-- So any user holding purchased credits above the floor got NO daily grant at
-- all. Run the numbers with the shipped allotment of 300/month and a floor of 20:
--
--     free user : 20/day, topped up every day          = ~600 credits/month
--     Pro user  : 300 once, top-up never fires         =  300 credits/month
--
-- Paying ₹49 bought HALF of what doing nothing bought. Yearly was the same shape
-- (3600/yr vs a free user's ~7300/yr). That is a refund wave and a 1-star review
-- wave, and it is arithmetic, not opinion.
--
-- THE FIX: the floor tops up the FREE bucket only.
--
--     if free < floor then free := floor;
--
-- Purchased credits become purely additive — which is what "purchased credits
-- never expire and are never reset" already promised users, and what everyone
-- assumes anyway. Pro is now unambiguously ahead:
--
--     free user : ~600/month
--     Pro user  : ~600/month free + the monthly allotment on top
--
-- WHY THIS DOES NOT MINT CREDITS
--
-- `free` is still clamped AT the floor, never above it, and only once per
-- calendar day. The original combined comparison existed to stop the floor being
-- "stacked on top of" a paid balance — but there was never a reason to punish a
-- paying user for holding credits they bought. There is no path here that grants
-- more than `floor` per day, and the debt settlement from 0031 still consumes the
-- grant before it becomes spendable.
--
-- Spend order is unchanged (bonus → free → paid), which matters: the perishable
-- daily grant is always spent before the purchased balance, so a Pro user's paid
-- credits keep accumulating rather than draining first.
--
-- Safe to run more than once. Requires 0031 (credit_debt).
-- ============================================================================

-- ── 1. Spend + top-up ──────────────────────────────────────────────────────
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

  -- Once-per-day floor top-up. Compares the FREE bucket only (0032), so a
  -- purchased balance no longer suppresses the daily grant. Debt-aware (0031).
  if v_p.daily_free_date is distinct from current_date then
    v_topup := greatest(0, v_floor - v_free);
    if v_topup > 0 and v_debt > 0 then
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

  -- Most perishable first. Keeps a paying user's purchased balance intact for as
  -- long as possible instead of draining what they paid for.
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

-- ── 2. Balance projection must use the same arithmetic ─────────────────────
create or replace function public.get_ai_balance()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_p       public.profiles%rowtype;
  v_floor   integer;
  v_free    integer;
  v_paid    integer;
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
  v_bonus := case
    when v_p.bonus_date = current_date then greatest(0, coalesce(v_p.bonus_tokens, 0))
    else 0
  end;

  -- LINE-FOR-LINE the same top-up as consume_ai_tokens above. If these diverge,
  -- the store shows a balance the next spend will not honour.
  if v_p.daily_free_date is distinct from current_date then
    v_topup := greatest(0, v_floor - v_free);
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
    'debt',       v_debt,
    'total',      v_free + v_paid + v_bonus,
    'floor',      v_floor
  );
end;
$$;

-- ── 3. Re-assert client grants ─────────────────────────────────────────────
revoke all on function public.consume_ai_tokens(integer) from public, anon;
revoke all on function public.get_ai_balance()           from public, anon;
grant execute on function public.consume_ai_tokens(integer) to authenticated;
grant execute on function public.get_ai_balance()           to authenticated;

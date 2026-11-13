-- ============================================================================
-- 0033 — Pro unlocks the whole cosmetics catalog
-- ============================================================================
-- WHY THIS IS SERVER-SIDE
--
-- Ownership was already server-authoritative on purpose: `ThemeContext` validates
-- every equipped cosmetic against `user_cosmetics` before applying it, so a
-- tampered `equipped_*` value can never unlock a paid item for free.
--
-- The lazy way to give Pro the full catalog would be a client-side
-- `owns = ownedSet.has(id) || isPro`. That moves the decision into the app, where
-- `isPro` is a cached hint — which would hand the entire catalog to anyone who
-- edited their local cache. So the union happens HERE, where `is_user_pro()` reads
-- the `profiles.is_pro` column that only the billing webhook (service_role) can
-- write.
--
-- WHAT THIS DOES NOT DO
--
-- It does not insert rows into `user_cosmetics`. Pro grants ACCESS, not ownership:
-- when a subscription lapses, the catalog simply stops being returned and the
-- user falls back to what they actually bought. Materialising ownership would
-- make the grant permanent and unrevocable — a lapsed subscriber would keep every
-- theme forever.
--
-- Items the user genuinely purchased stay theirs regardless of Pro status.
--
-- Safe to run more than once. Requires 0001 (is_user_pro).
-- ============================================================================

create or replace function public.get_owned_cosmetics()
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_owned text[];
begin
  if v_user is null then
    return array[]::text[];
  end if;

  -- Everything actually purchased.
  select coalesce(array_agg(distinct item_id), array[]::text[])
    into v_owned
    from public.user_cosmetics
   where user_id = v_user;

  -- Pro adds ACCESS to the rest of the catalog for as long as it is active.
  -- is_user_pro() is expiry-aware, so a lapsed subscription stops granting it.
  if public.is_user_pro(v_user) then
    select coalesce(array_agg(distinct id), array[]::text[])
      into v_owned
      from (
        select id from public.marketplace_items
        union
        select unnest(v_owned)
      ) as merged(id);
  end if;

  return v_owned;
end;
$$;

revoke all on function public.get_owned_cosmetics() from public, anon;
grant execute on function public.get_owned_cosmetics() to authenticated;

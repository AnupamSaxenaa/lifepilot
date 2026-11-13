-- ============================================================================
-- LifePilot — XP Integrity (server-side XP mutation + anti-inflation guard)
-- ----------------------------------------------------------------------------
-- Shards are derived from profiles.xp, so XP is the root of the cosmetic
-- economy. Previously the client could write profiles.xp directly (via the
-- profile upsert), which meant a tampered client could mint unlimited Shards.
--
-- This migration:
--   • REVOKEs direct client UPDATE of xp / level.
--   • Adds add_xp(delta) — a SECURITY DEFINER RPC that applies XP changes
--     server-side with a sane per-call clamp, recomputes level from XP, and
--     is the ONLY way the client can move XP now.
--
-- NOTE: this is a cosmetic-economy hardening, not anti-cheat perfection — a
-- user can still call add_xp legitimately as fast as they complete tasks. The
-- per-call clamp just blocks absurd single-shot inflation (e.g. +1e9). Combined
-- with the marketplace being cosmetic-only, this is proportionate.
--
-- Data safety: additive only. Apply AFTER 0001–0004.
--
-- ⚠️ STAGED ROLLOUT: the REVOKE below is intentionally NOT run yet. The
-- currently-shipped clients still write profiles.xp directly; revoking now
-- would break XP sync for everyone until they update. Flip the revoke ONLY
-- after a forced app update ships the add_xp-based client (you already have a
-- ForceUpdate mechanism). Until then, add_xp exists as the preferred path and
-- the client is migrated to use it.
-- ============================================================================

-- >>> DO NOT UNCOMMENT until all clients are on the add_xp-based build <<<
-- revoke update (xp, level) on public.profiles from authenticated, anon;

-- Server-side XP mutation. Positive to award, negative to deduct (e.g. streak
-- freeze / un-completing a task). Clamps each call to a reasonable range so a
-- tampered client can't jump straight to max level to mint Shards.
create or replace function public.add_xp(p_delta integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_p     public.profiles%rowtype;
  v_delta integer;
  v_new   bigint;
  v_level integer;
begin
  if v_user is null then
    return jsonb_build_object('xp', 0, 'level', 1);
  end if;

  -- Per-call clamp: a single task can't reasonably grant more than this.
  v_delta := greatest(-5000, least(5000, coalesce(p_delta, 0)));

  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('xp', 0, 'level', 1);
  end if;

  v_new := greatest(0, coalesce(v_p.xp, 0) + v_delta);
  v_level := public.level_from_xp(v_new);

  update public.profiles
     set xp = v_new, level = v_level
   where id = v_user;

  return jsonb_build_object('xp', v_new, 'level', v_level);
end;
$$;

revoke all on function public.add_xp(integer) from public, anon;
grant execute on function public.add_xp(integer) to authenticated;

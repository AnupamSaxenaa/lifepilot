-- ═══════════════════════════════════════════════════════════════════════════
-- 0020 — record completed tasks in the daily rollup, and fix the focus trigger
--
-- Two problems this repairs:
--
-- 1. `user_daily_stats.tasks_completed` was never written by anything. 0017
--    created the column and the leaderboard read it, but only focus_seconds had
--    a writer — so the board always showed "0 tasks".
--
-- 2. `bump_daily_focus_rollup` used a SCHEMA-QUALIFIED reference in its
--    ON CONFLICT DO UPDATE clause:
--        set focus_seconds = public.user_daily_stats.focus_seconds + new.seconds
--    Postgres does not allow qualifying the conflict target that way. The first
--    session of a day inserts cleanly (no conflict, so the clause never runs),
--    but the SECOND session of the same day would raise
--        invalid reference to FROM-clause entry for table "user_daily_stats"
--    and fail the whole insert. A latent bug that only appears on day two.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.bump_daily_focus_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'focus' then
    return new;
  end if;

  insert into public.user_daily_stats (user_id, local_day, focus_seconds)
  values (new.user_id, new.local_day, new.seconds)
  on conflict (user_id, local_day) do update
    -- Unqualified target reference + EXCLUDED, which is the only valid form.
    set focus_seconds = user_daily_stats.focus_seconds + excluded.focus_seconds,
        updated_at = now();

  return new;
end;
$$;

-- The client owns the local calendar day (the server only knows UTC), so the
-- day is passed in rather than derived from now(). Called through SyncQueue, so
-- an offline completion replays later. Delta is +1 on complete, -1 on undo.
create or replace function public.bump_daily_tasks(
  p_local_day date,
  p_delta integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_delta integer := greatest(least(coalesce(p_delta, 1), 50), -50);
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_local_day is null
     or p_local_day > (current_date + 1)
     or p_local_day < (current_date - 7) then
    raise exception 'invalid_local_day';
  end if;

  insert into public.user_daily_stats (user_id, local_day, tasks_completed)
  values (v_user, p_local_day, greatest(v_delta, 0))
  on conflict (user_id, local_day) do update
    -- Never let an undo drive the counter negative.
    set tasks_completed = greatest(user_daily_stats.tasks_completed + v_delta, 0),
        updated_at = now();
end;
$$;

revoke all on function public.bump_daily_tasks(date, integer) from public;
grant execute on function public.bump_daily_tasks(date, integer) to authenticated;

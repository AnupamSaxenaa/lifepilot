-- ═══════════════════════════════════════════════════════════════════════════
-- 0021 — presence + custom status for the Hustlers list
--
-- Presence is DERIVED from a last-seen heartbeat rather than stored as a state
-- machine. A stored "online" flag is wrong the moment an app is killed, loses
-- network, or crashes — the user stays "online" forever. A timestamp cannot lie:
-- the client interprets freshness, so a dead app decays to offline on its own.
--
-- Thresholds (client-side, src/utils/presence.js):
--   < 2 min   online
--   < 10 min  idle
--   < 45 min  away
--   older     offline
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- Cheap, idempotent heartbeat. Only ever touches the caller's own row.
create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid();
end;
$$;

revoke all on function public.touch_presence() from public;
grant execute on function public.touch_presence() to authenticated;

-- Let a user set their own status text ("deep work", "in class", "grinding").
-- Length-capped server-side so a long string cannot break the row layout.
create or replace function public.set_hustle_status(p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  update public.profiles
     set hustle_status = nullif(btrim(left(coalesce(p_status, ''), 60)), '')
   where id = auth.uid();
end;
$$;

revoke all on function public.set_hustle_status(text) from public;
grant execute on function public.set_hustle_status(text) to authenticated;

-- PostgreSQL cannot CREATE OR REPLACE a function when its RETURNS TABLE
-- columns change. 0017 already created this no-argument RPC without
-- last_seen_at, so drop only that exact signature before recreating it below.
drop function if exists public.get_hustler_directory();

-- Directory now carries presence, status, and the streak/level/hustle figures
-- the redesigned row displays. Still friendship-gated: it only ever returns
-- users with an ACCEPTED friendship to the caller.
create or replace function public.get_hustler_directory()
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  hustle_status text,
  level integer,
  streak integer,
  focus_seconds_today integer,
  focus_seconds_month integer,
  focus_seconds_year integer,
  tasks_completed_today integer,
  friends_since timestamptz,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  friends as (
    select case when f.requester_id = me.uid then f.addressee_id else f.requester_id end as fid,
           f.responded_at
      from public.friendships f, me
     where f.status = 'accepted'
       and me.uid in (f.requester_id, f.addressee_id)
  )
  select p.id,
         p.username,
         p.display_name,
         p.avatar_url,
         p.hustle_status,
         coalesce(p.level, 1),
         coalesce(p.streak, 0),
         coalesce((select s.focus_seconds from public.user_daily_stats s
                    where s.user_id = fr.fid and s.local_day = current_date), 0),
         coalesce((select sum(s.focus_seconds)::int from public.user_daily_stats s
                    where s.user_id = fr.fid
                      and s.local_day >= date_trunc('month', current_date)::date), 0),
         coalesce((select sum(s.focus_seconds)::int from public.user_daily_stats s
                    where s.user_id = fr.fid
                      and s.local_day >= date_trunc('year', current_date)::date), 0),
         coalesce((select s.tasks_completed from public.user_daily_stats s
                    where s.user_id = fr.fid and s.local_day = current_date), 0),
         fr.responded_at,
         p.last_seen_at
    from friends fr
    join public.profiles p on p.id = fr.fid;
$$;

revoke all on function public.get_hustler_directory() from public;
grant execute on function public.get_hustler_directory() to authenticated;

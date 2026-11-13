-- ═══════════════════════════════════════════════════════════════════════════
-- 0019 — live leaderboard
--
-- Snapshots (0017) are refreshed on a cron and can be up to an hour stale. This
-- adds an on-demand ranking computed straight from user_daily_stats, so the
-- board is current the moment a session lands — no waiting for cron.
--
-- On "every millisecond": that is not achievable, and not desirable. Ranking
-- thousands of users is an aggregate over a date range; running it per
-- millisecond would hammer the database for changes no human can perceive. What
-- this gives instead is ranking computed AT READ TIME (always fresh) plus a
-- Realtime signal so clients re-read only when the data actually changes.
--
-- Cost control: the aggregate reads a single index-ordered range per period and
-- is capped by p_limit, so it stays cheap even as the user base grows. Snapshots
-- remain useful as a historical archive and cheap fallback.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists user_daily_stats_day_idx
  on public.user_daily_stats (local_day desc)
  where focus_seconds > 0;

create or replace function public.live_leaderboard(
  p_period text default 'daily',
  p_limit integer default 50
)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  focus_seconds integer,
  tasks_completed integer,
  rank integer,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if p_period = 'monthly' then
    v_from := date_trunc('month', current_date)::date;
  elsif p_period = 'yearly' then
    v_from := date_trunc('year', current_date)::date;
  elsif p_period = 'daily' then
    v_from := current_date;
  else
    raise exception 'unknown_period';
  end if;

  return query
  with totals as (
    select s.user_id,
           sum(s.focus_seconds)::int  as focus_seconds,
           sum(s.tasks_completed)::int as tasks_completed
      from public.user_daily_stats s
      join public.profiles p on p.id = s.user_id
     where s.local_day >= v_from
       -- Privacy is enforced here, not in the client: opting out removes you
       -- from the ranking entirely, as does ghost mode.
       and p.leaderboard_opted_in = true
       and p.ghost_mode = false
     group by s.user_id
    having sum(s.focus_seconds) > 0
  ),
  ranked as (
    select t.*, rank() over (order by t.focus_seconds desc)::int as rank
      from totals t
  )
  select r.user_id,
         p.username,
         p.display_name,
         p.avatar_url,
         r.focus_seconds,
         r.tasks_completed,
         r.rank,
         (r.user_id = auth.uid()) as is_me
    from ranked r
    join public.profiles p on p.id = r.user_id
   order by r.rank asc
   limit v_limit;
end;
$$;

revoke all on function public.live_leaderboard(text, integer) from public;
grant execute on function public.live_leaderboard(text, integer) to authenticated;

-- Your own standing, even when outside the top N — so the board can always
-- show "you are #438" without fetching every row above you.
create or replace function public.my_leaderboard_rank(p_period text default 'daily')
returns table (rank integer, focus_seconds integer, total_ranked integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date;
begin
  if p_period = 'monthly' then
    v_from := date_trunc('month', current_date)::date;
  elsif p_period = 'yearly' then
    v_from := date_trunc('year', current_date)::date;
  else
    v_from := current_date;
  end if;

  return query
  with totals as (
    select s.user_id, sum(s.focus_seconds)::int as focus_seconds
      from public.user_daily_stats s
      join public.profiles p on p.id = s.user_id
     where s.local_day >= v_from
       and p.leaderboard_opted_in = true
       and p.ghost_mode = false
     group by s.user_id
    having sum(s.focus_seconds) > 0
  ),
  ranked as (
    select t.*, rank() over (order by t.focus_seconds desc)::int as rnk from totals t
  )
  select r.rnk, r.focus_seconds, (select count(*)::int from ranked)
    from ranked r
   where r.user_id = auth.uid();
end;
$$;

revoke all on function public.my_leaderboard_rank(text) from public;
grant execute on function public.my_leaderboard_rank(text) to authenticated;

-- Let clients react to changes instead of polling on a timer.
alter publication supabase_realtime add table public.user_daily_stats;

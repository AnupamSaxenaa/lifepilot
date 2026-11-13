-- ═══════════════════════════════════════════════════════════════════════════
-- 0017 — Hustlers: friendships, focus sessions, rollups, leaderboards
--
-- NOT DEPLOYED. Review, then apply deliberately. Do NOT run a blanket
-- `supabase db push`: 0011_alarm_system.sql and 0015_grant_allowance_aarush.sql
-- must remain unapplied.
--
-- Design notes:
--  • focus_sessions is the source of truth for "hours hustled". It did not
--    exist before; Focus Mode kept work time in component state only.
--  • Leaderboards read PRECOMPUTED snapshots with a stored rank. Aggregating
--    raw sessions per request does not survive growth.
--  • Friend stats are exposed ONLY through an RPC that verifies an accepted
--    friendship server-side, mirroring get_space_member_directory.
--  • Global ranking is OPT-IN (leaderboard_opted_in) with a separate Ghost mode
--    so a user can appear to friends while hidden from strangers.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Focus sessions ─────────────────────────────────────────────────────────
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  seconds integer not null,
  kind text not null default 'focus',
  task_id bigint,
  local_day date not null,
  client_session_id text not null,
  created_at timestamptz not null default now(),
  constraint focus_sessions_kind_check check (kind in ('focus', 'break')),
  -- Anti-cheat gate #1: a single sitting is bounded.
  constraint focus_sessions_seconds_check check (seconds between 60 and 14400),
  constraint focus_sessions_order_check check (ended_at >= started_at),
  -- Idempotency: an offline replay of the same session is a no-op.
  constraint focus_sessions_client_unique unique (user_id, client_session_id)
);

create index if not exists focus_sessions_user_day_idx
  on public.focus_sessions (user_id, local_day desc);

alter table public.focus_sessions enable row level security;

drop policy if exists "focus_sessions_select_own" on public.focus_sessions;
create policy "focus_sessions_select_own" on public.focus_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "focus_sessions_insert_own" on public.focus_sessions;
create policy "focus_sessions_insert_own" on public.focus_sessions
  for insert with check (auth.uid() = user_id);

-- Sessions are immutable once written: no update/delete policy on purpose, so
-- totals cannot be rewritten after the fact.

-- ── Anti-cheat: enforce the 16h/day ceiling and reject overlaps ────────────
create or replace function public.enforce_focus_session_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  day_total integer;
  overlapping integer;
begin
  select coalesce(sum(seconds), 0) into day_total
    from public.focus_sessions
   where user_id = new.user_id and local_day = new.local_day and kind = 'focus';

  if new.kind = 'focus' and day_total + new.seconds > 57600 then
    raise exception 'focus_day_limit_exceeded';
  end if;

  select count(*) into overlapping
    from public.focus_sessions
   where user_id = new.user_id
     and tstzrange(started_at, ended_at) && tstzrange(new.started_at, new.ended_at);

  if overlapping > 0 then
    raise exception 'focus_session_overlap';
  end if;

  return new;
end;
$$;

drop trigger if exists focus_sessions_limits on public.focus_sessions;
create trigger focus_sessions_limits
  before insert on public.focus_sessions
  for each row execute function public.enforce_focus_session_limits();

-- ── Daily rollups ──────────────────────────────────────────────────────────
create table if not exists public.user_daily_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_day date not null,
  focus_seconds integer not null default 0,
  tasks_completed integer not null default 0,
  xp_earned integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, local_day)
);

alter table public.user_daily_stats enable row level security;

drop policy if exists "user_daily_stats_select_own" on public.user_daily_stats;
create policy "user_daily_stats_select_own" on public.user_daily_stats
  for select using (auth.uid() = user_id);

-- Keep the rollup in step with inserts, so leaderboards never scan raw rows.
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
    set focus_seconds = public.user_daily_stats.focus_seconds + new.seconds,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists focus_sessions_rollup on public.focus_sessions;
create trigger focus_sessions_rollup
  after insert on public.focus_sessions
  for each row execute function public.bump_daily_focus_rollup();

-- ── Social preferences ─────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists leaderboard_opted_in boolean not null default false,
  add column if not exists ghost_mode boolean not null default false,
  add column if not exists hustle_status text;

-- ── Friendships ────────────────────────────────────────────────────────────
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_status_check check (status in ('pending', 'accepted', 'blocked')),
  constraint friendships_no_self check (requester_id <> addressee_id)
);

-- One row per PAIR regardless of direction. Without this, both users sending a
-- request creates two rows and the UI shows a pending request to an existing
-- friend — the classic bug in every friends system.
create unique index if not exists friendships_pair_unique
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);
create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);

alter table public.friendships enable row level security;

drop policy if exists "friendships_select_involved" on public.friendships;
create policy "friendships_select_involved" on public.friendships
  for select using (auth.uid() in (requester_id, addressee_id));

drop policy if exists "friendships_insert_as_requester" on public.friendships;
create policy "friendships_insert_as_requester" on public.friendships
  for insert with check (auth.uid() = requester_id and status = 'pending');

-- Only the addressee may accept; either side may block.
drop policy if exists "friendships_update_involved" on public.friendships;
create policy "friendships_update_involved" on public.friendships
  for update using (auth.uid() in (requester_id, addressee_id));

drop policy if exists "friendships_delete_involved" on public.friendships;
create policy "friendships_delete_involved" on public.friendships
  for delete using (auth.uid() in (requester_id, addressee_id));

create or replace function public.are_hustlers(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and ((f.requester_id = a and f.addressee_id = b)
         or (f.requester_id = b and f.addressee_id = a))
  );
$$;

-- ── Friend directory: the ONLY way stats cross between users ───────────────
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
  friends_since timestamptz
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
         fr.responded_at
    from friends fr
    join public.profiles p on p.id = fr.fid;
$$;

revoke all on function public.get_hustler_directory() from public;
grant execute on function public.get_hustler_directory() to authenticated;

-- ── Leaderboard snapshots ──────────────────────────────────────────────────
create table if not exists public.leaderboard_snapshots (
  period text not null,
  period_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  focus_seconds integer not null default 0,
  tasks_completed integer not null default 0,
  rank integer not null,
  refreshed_at timestamptz not null default now(),
  constraint leaderboard_period_check check (period in ('daily', 'monthly', 'yearly')),
  primary key (period, period_key, user_id)
);

-- The read path: filter by period + key, already ordered by stored rank.
create index if not exists leaderboard_rank_idx
  on public.leaderboard_snapshots (period, period_key, rank);

alter table public.leaderboard_snapshots enable row level security;

-- Public board, but only rows for users who opted in and are not ghosting.
drop policy if exists "leaderboard_select_opted_in" on public.leaderboard_snapshots;
create policy "leaderboard_select_opted_in" on public.leaderboard_snapshots
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p
       where p.id = public.leaderboard_snapshots.user_id
         and p.leaderboard_opted_in = true
         and p.ghost_mode = false
    )
  );

-- Rebuild one period. Intended for pg_cron: 'daily' hourly, others nightly.
create or replace function public.refresh_leaderboard(p_period text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_from date;
begin
  if p_period = 'daily' then
    v_key := to_char(current_date, 'YYYY-MM-DD');
    v_from := current_date;
  elsif p_period = 'monthly' then
    v_key := to_char(current_date, 'YYYY-MM');
    v_from := date_trunc('month', current_date)::date;
  elsif p_period = 'yearly' then
    v_key := to_char(current_date, 'YYYY');
    v_from := date_trunc('year', current_date)::date;
  else
    raise exception 'unknown_period';
  end if;

  delete from public.leaderboard_snapshots
   where period = p_period and period_key = v_key;

  insert into public.leaderboard_snapshots (period, period_key, user_id, focus_seconds, tasks_completed, rank)
  select p_period,
         v_key,
         s.user_id,
         sum(s.focus_seconds)::int,
         sum(s.tasks_completed)::int,
         rank() over (order by sum(s.focus_seconds) desc)
    from public.user_daily_stats s
    join public.profiles p on p.id = s.user_id
   where s.local_day >= v_from
     and p.leaderboard_opted_in = true
     and p.ghost_mode = false
   group by s.user_id
  having sum(s.focus_seconds) > 0;
end;
$$;

revoke all on function public.refresh_leaderboard(text) from public;

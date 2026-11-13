-- 0023 — immediate, multi-device-safe Hustlers presence
-- Apply deliberately after 0021 and 0022. Safe to rerun.

create table if not exists public.presence_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (user_id, session_id)
);

create index if not exists presence_sessions_active_idx
  on public.presence_sessions (user_id, last_seen_at desc)
  where ended_at is null;

alter table public.presence_sessions enable row level security;

-- Realtime may expose a row only to its owner or an accepted friend.
drop policy if exists "presence_sessions_select_visible" on public.presence_sessions;
create policy "presence_sessions_select_visible" on public.presence_sessions
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
        from public.friendships f
       where f.status = 'accepted'
         and (
           (f.requester_id = auth.uid() and f.addressee_id = presence_sessions.user_id)
           or (f.addressee_id = auth.uid() and f.requester_id = presence_sessions.user_id)
         )
    )
  );

revoke all on table public.presence_sessions from anon;
revoke insert, update, delete on table public.presence_sessions from authenticated;
grant select on table public.presence_sessions to authenticated;

create or replace function public.begin_presence(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_session_id is null then return; end if;
  insert into public.presence_sessions (user_id, session_id, last_seen_at, ended_at)
  values (auth.uid(), p_session_id, now(), null)
  on conflict (user_id, session_id) do update
    set last_seen_at = excluded.last_seen_at, ended_at = null;
end;
$$;


create or replace function public.heartbeat_presence(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_session_id is null then return; end if;
  update public.presence_sessions
     set last_seen_at = now()
   where user_id = auth.uid()
     and session_id = p_session_id
     and ended_at is null;
end;
$$;

create or replace function public.end_presence(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_session_id is null then return; end if;
  update public.presence_sessions
     set ended_at = now()
   where user_id = auth.uid()
     and session_id = p_session_id
     and ended_at is null;
end;
$$;

revoke all on function public.begin_presence(uuid) from public;
revoke all on function public.heartbeat_presence(uuid) from public;
revoke all on function public.end_presence(uuid) from public;
grant execute on function public.begin_presence(uuid) to authenticated;
grant execute on function public.heartbeat_presence(uuid) to authenticated;
grant execute on function public.end_presence(uuid) to authenticated;

-- Realtime is only an accelerator; the existing 15s/20s polling remains.
do $realtime$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'presence_sessions'
  ) then
    alter publication supabase_realtime add table public.presence_sessions;
  end if;
end
$realtime$;

-- Preserve 0021's exact return signature. New clients use session aggregation;
-- users with no session rows still use profiles.last_seen_at from older clients.
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
         case
           when exists (
             select 1 from public.presence_sessions ps_any where ps_any.user_id = p.id
           ) then (
             select max(ps.last_seen_at)
               from public.presence_sessions ps
              where ps.user_id = p.id and ps.ended_at is null
           )
           else p.last_seen_at
         end
    from friends fr
    join public.profiles p on p.id = fr.fid;
$$;

revoke all on function public.get_hustler_directory() from public;
grant execute on function public.get_hustler_directory() to authenticated;
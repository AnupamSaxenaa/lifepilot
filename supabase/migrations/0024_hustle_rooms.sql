-- 0024 — private, offline-safe Hustle Rooms
-- Apply deliberately after 0017, 0022, and 0023. Safe to rerun.
-- Realtime is only an accelerator; clients must retain cache-first polling.

create table if not exists public.hustle_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  duration_seconds integer not null check (duration_seconds between 60 and 14400),
  chat_enabled boolean not null default false,
  status text not null default 'active' check (status in ('active', 'ended')),
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint hustle_rooms_end_state_check check (
    (status = 'active' and ended_at is null and ended_by is null)
    or (status = 'ended' and ended_at is not null and ended_by is not null)
  )
);

create table if not exists public.hustle_room_members (
  room_id uuid not null references public.hustle_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  timer_status text not null default 'not_started'
    check (timer_status in ('not_started', 'running', 'paused', 'done')),
  task_label text check (task_label is null or char_length(btrim(task_label)) between 1 and 120),
  elapsed_seconds integer not null default 0 check (elapsed_seconds between 0 and 14400),
  anchor_started_at timestamptz,
  joined_at timestamptz not null default clock_timestamp(),
  left_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (room_id, user_id),
  constraint hustle_room_members_anchor_check check (
    (timer_status = 'running' and anchor_started_at is not null)
    or (timer_status <> 'running' and anchor_started_at is null)
  )
);

create table if not exists public.hustle_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hustle_rooms(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  client_mutation_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (author_id, client_mutation_id)
);

create table if not exists public.hustle_room_mutation_receipts (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  client_mutation_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, operation, client_mutation_id)
);

create index if not exists hustle_rooms_owner_status_idx
  on public.hustle_rooms(owner_id, status, created_at desc);
create index if not exists hustle_room_members_user_active_idx
  on public.hustle_room_members(user_id, joined_at desc) where left_at is null;
create index if not exists hustle_room_members_room_active_idx
  on public.hustle_room_members(room_id, joined_at) where left_at is null;
create index if not exists hustle_room_messages_room_created_idx
  on public.hustle_room_messages(room_id, created_at desc, id);
create index if not exists hustle_room_receipts_created_idx
  on public.hustle_room_mutation_receipts(created_at);

alter table public.hustle_rooms enable row level security;
alter table public.hustle_room_members enable row level security;
alter table public.hustle_room_messages enable row level security;
alter table public.hustle_room_mutation_receipts enable row level security;

revoke all on table public.hustle_rooms, public.hustle_room_members,
  public.hustle_room_messages, public.hustle_room_mutation_receipts from public, anon;
revoke insert, update, delete, truncate, references, trigger on table
  public.hustle_rooms, public.hustle_room_members,
  public.hustle_room_messages, public.hustle_room_mutation_receipts from authenticated;
grant select on table public.hustle_rooms, public.hustle_room_members,
  public.hustle_room_messages to authenticated;

-- This SECURITY DEFINER predicate bypasses member-table RLS, preventing the
-- self-referential policy recursion that an inline membership subquery causes.
create or replace function public.hustle_room_is_active_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.hustle_rooms r
      join public.hustle_room_members m on m.room_id = r.id
     where r.id = p_room_id
       and r.status = 'active'
       and m.user_id = auth.uid()
       and m.left_at is null
  )
$$;

drop policy if exists "hustle_rooms_active_member_read" on public.hustle_rooms;
drop policy if exists "hustle_room_members_active_member_read" on public.hustle_room_members;
drop policy if exists "hustle_room_messages_active_member_read" on public.hustle_room_messages;

create policy "hustle_rooms_active_member_read" on public.hustle_rooms
  for select to authenticated
  using (public.hustle_room_is_active_member(id));

create policy "hustle_room_members_active_member_read" on public.hustle_room_members
  for select to authenticated
  using (public.hustle_room_is_active_member(room_id));

create policy "hustle_room_messages_active_member_read" on public.hustle_room_messages
  for select to authenticated
  using (public.hustle_room_is_active_member(room_id));

create or replace function public.hustle_room_require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  return v_user;
end;
$$;

create or replace function public.hustle_room_receipt(
  p_operation text,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_response jsonb;
begin
  if p_client_mutation_id is null then
    raise exception using errcode = '22004', message = 'client_mutation_id is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_user::text || ':' || p_operation || ':' || p_client_mutation_id::text, 0
  ));
  select r.response into v_response
    from public.hustle_room_mutation_receipts r
   where r.actor_id = v_user
     and r.operation = p_operation
     and r.client_mutation_id = p_client_mutation_id;
  return v_response;
end;
$$;

create or replace function public.hustle_room_store_receipt(
  p_operation text,
  p_client_mutation_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_response jsonb;
begin
  insert into public.hustle_room_mutation_receipts(
    actor_id, operation, client_mutation_id, response
  ) values (v_user, p_operation, p_client_mutation_id, p_response)
  on conflict (actor_id, operation, client_mutation_id) do nothing;

  select r.response into v_response
    from public.hustle_room_mutation_receipts r
   where r.actor_id = v_user
     and r.operation = p_operation
     and r.client_mutation_id = p_client_mutation_id;
  return v_response;
end;
$$;

create or replace function public.get_hustle_room_snapshot(
  p_room_id uuid,
  p_message_limit integer default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if not public.hustle_room_is_active_member(p_room_id) then
    raise exception using errcode = '42501', message = 'room not found or access denied';
  end if;

  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', r.id,
      'owner_id', r.owner_id,
      'name', r.name,
      'duration_seconds', r.duration_seconds,
      'chat_enabled', r.chat_enabled,
      'status', r.status,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'ended_at', r.ended_at,
      'ended_by', r.ended_by
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'room_id', m.room_id,
        'user_id', m.user_id,
        'role', m.role,
        'timer_status', case
          when m.timer_status = 'running' and e.elapsed_seconds >= r.duration_seconds then 'done'
          else m.timer_status
        end,
        'task_label', m.task_label,
        'elapsed_seconds', e.elapsed_seconds,
        'anchor_started_at', case
          when m.timer_status = 'running' and e.elapsed_seconds < r.duration_seconds
            then m.anchor_started_at
          else null
        end,
        'joined_at', m.joined_at,
        'updated_at', m.updated_at,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'avatar_seed', p.avatar_seed
      ) order by (m.role = 'owner') desc, m.joined_at, m.user_id)
        from public.hustle_room_members m
        left join public.profiles p on p.id = m.user_id
        cross join lateral (
          select least(r.duration_seconds, m.elapsed_seconds + case
            when m.timer_status = 'running' then greatest(0,
              floor(extract(epoch from (v_now - m.anchor_started_at)))::integer)
            else 0
          end) as elapsed_seconds
        ) e
       where m.room_id = r.id and m.left_at is null
    ), '[]'::jsonb),
    'messages', case when r.chat_enabled then coalesce((
      select jsonb_agg(q.message order by q.created_at, q.id)
        from (
          select msg.created_at, msg.id, jsonb_build_object(
            'id', msg.id,
            'room_id', msg.room_id,
            'author_id', msg.author_id,
            'body', msg.body,
            'client_mutation_id', msg.client_mutation_id,
            'created_at', msg.created_at,
            'username', mp.username,
            'display_name', mp.display_name,
            'avatar_url', mp.avatar_url,
            'avatar_seed', mp.avatar_seed
          ) as message
            from public.hustle_room_messages msg
            left join public.profiles mp on mp.id = msg.author_id
           where msg.room_id = r.id
           order by msg.created_at desc, msg.id desc
           limit greatest(0, least(coalesce(p_message_limit, 100), 200))
        ) q
    ), '[]'::jsonb) else '[]'::jsonb end,
    'server_now', v_now
  ) into v_result
    from public.hustle_rooms r
   where r.id = p_room_id and r.status = 'active';

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'active room not found';
  end if;
  return v_result;
end;
$$;

create or replace function public.get_my_hustle_rooms()
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_now timestamptz := clock_timestamp();
  v_rooms jsonb;
begin
  select coalesce(jsonb_agg(q.room order by q.created_at desc, q.id), '[]'::jsonb)
    into v_rooms
    from (
      select r.created_at, r.id, jsonb_build_object(
        'id', r.id,
        'owner_id', r.owner_id,
        'name', r.name,
        'duration_seconds', r.duration_seconds,
        'chat_enabled', r.chat_enabled,
        'status', r.status,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'member_count', (
          select count(*) from public.hustle_room_members cm
           where cm.room_id = r.id and cm.left_at is null
        ),
        'my_member', jsonb_build_object(
          'room_id', m.room_id,
          'user_id', m.user_id,
          'role', m.role,
          'timer_status', case
            when m.timer_status = 'running' and e.elapsed_seconds >= r.duration_seconds then 'done'
            else m.timer_status
          end,
          'task_label', m.task_label,
          'elapsed_seconds', e.elapsed_seconds,
          'anchor_started_at', case
            when m.timer_status = 'running' and e.elapsed_seconds < r.duration_seconds
              then m.anchor_started_at
            else null
          end,
          'joined_at', m.joined_at,
          'updated_at', m.updated_at
        )
      ) as room
        from public.hustle_rooms r
        join public.hustle_room_members m
          on m.room_id = r.id and m.user_id = v_user and m.left_at is null
        cross join lateral (
          select least(r.duration_seconds, m.elapsed_seconds + case
            when m.timer_status = 'running' then greatest(0,
              floor(extract(epoch from (v_now - m.anchor_started_at)))::integer)
            else 0
          end) as elapsed_seconds
        ) e
       where r.status = 'active'
    ) q;

  return jsonb_build_object('rooms', v_rooms, 'server_now', v_now);
end;
$$;

create or replace function public.create_hustle_room(
  p_name text,
  p_duration_seconds integer,
  p_chat_enabled boolean,
  p_friend_ids uuid[],
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_prior jsonb;
  v_room public.hustle_rooms%rowtype;
  v_count integer;
  v_distinct_count integer;
  v_friend_count integer;
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('create_hustle_room', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;

  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then
    raise exception using errcode = '22023', message = 'room name must be 1 to 60 characters';
  end if;
  if p_duration_seconds is null or p_duration_seconds not between 60 and 14400 then
    raise exception using errcode = '22023', message = 'duration_seconds must be 60 to 14400';
  end if;
  if p_chat_enabled is null then
    raise exception using errcode = '22004', message = 'chat_enabled is required';
  end if;

  select count(*)::integer, count(distinct x.friend_id)::integer
    into v_count, v_distinct_count
    from unnest(coalesce(p_friend_ids, array[]::uuid[])) as x(friend_id);
  if v_count not between 1 and 19 then
    raise exception using errcode = '22023', message = 'select 1 to 19 accepted friends';
  end if;
  if v_distinct_count <> v_count
     or array_position(p_friend_ids, null::uuid) is not null
     or v_user = any(p_friend_ids) then
    raise exception using errcode = '22023', message = 'friend_ids must be unique, non-null, and exclude the owner';
  end if;

  -- Lock accepted friendship rows so none can be blocked while this room is
  -- being created. Validation is deliberately server-side and directional.
  perform f.id
    from public.friendships f
   where f.status = 'accepted'
     and ((f.requester_id = v_user and f.addressee_id = any(p_friend_ids))
       or (f.addressee_id = v_user and f.requester_id = any(p_friend_ids)))
   for share;

  select count(*)::integer into v_friend_count
    from public.friendships f
   where f.status = 'accepted'
     and ((f.requester_id = v_user and f.addressee_id = any(p_friend_ids))
       or (f.addressee_id = v_user and f.requester_id = any(p_friend_ids)));
  if v_friend_count <> v_count then
    raise exception using errcode = '42501', message = 'every invited user must be an accepted friend';
  end if;

  insert into public.hustle_rooms(owner_id, name, duration_seconds, chat_enabled)
  values (v_user, btrim(p_name), p_duration_seconds, p_chat_enabled)
  returning * into v_room;

  insert into public.hustle_room_members(room_id, user_id, role)
  values (v_room.id, v_user, 'owner');
  insert into public.hustle_room_members(room_id, user_id, role)
  select v_room.id, x.friend_id, 'member'
    from unnest(p_friend_ids) as x(friend_id);

  v_response := public.get_hustle_room_snapshot(v_room.id, 100);
  return public.hustle_room_store_receipt(
    'create_hustle_room', p_client_mutation_id, v_response
  );
end;
$$;

create or replace function public.update_hustle_room_progress(
  p_room_id uuid,
  p_timer_status text,
  p_task_label text,
  p_elapsed_seconds integer,
  p_elapsed_captured_at timestamptz,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_prior jsonb;
  v_room public.hustle_rooms%rowtype;
  v_member public.hustle_room_members%rowtype;
  v_now timestamptz := clock_timestamp();
  v_current_elapsed integer;
  v_reported_elapsed integer;
  v_elapsed integer;
  v_status text;
  v_label text;
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('update_hustle_room_progress', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;
  if p_timer_status is null or p_timer_status not in ('not_started', 'running', 'paused', 'done') then
    raise exception using errcode = '22023', message = 'invalid timer_status';
  end if;
  if p_elapsed_seconds is null or p_elapsed_seconds < 0 then
    raise exception using errcode = '22023', message = 'elapsed_seconds must be non-negative';
  end if;
  if p_task_label is not null and char_length(btrim(p_task_label)) > 120 then
    raise exception using errcode = '22023', message = 'task_label must be at most 120 characters';
  end if;

  select * into v_room from public.hustle_rooms
   where id = p_room_id for update;
  if not found or v_room.status <> 'active' then
    raise exception using errcode = '42501', message = 'room is no longer active';
  end if;

  select * into v_member from public.hustle_room_members
   where room_id = p_room_id and user_id = v_user for update;
  if not found or v_member.left_at is not null then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;

  v_current_elapsed := least(v_room.duration_seconds, v_member.elapsed_seconds + case
    when v_member.timer_status = 'running' then greatest(0,
      floor(extract(epoch from (v_now - v_member.anchor_started_at)))::integer)
    else 0
  end);
  -- A queued running transition may arrive well after the user pressed Start.
  -- Advance the captured elapsed value by that delivery delay so reconnecting
  -- never discards valid offline focus time. Paused/done payloads already carry
  -- their final elapsed value and therefore do not accrue delivery time.
  v_reported_elapsed := least(v_room.duration_seconds,
    p_elapsed_seconds + case
      when p_timer_status = 'running' and p_elapsed_captured_at is not null
        then greatest(0,
          floor(extract(epoch from (v_now - p_elapsed_captured_at)))::integer)
      else 0
    end);
  -- Never regress elapsed time on delayed/offline delivery, and never exceed
  -- the room duration even if a client reports an arbitrarily large value.
  v_elapsed := least(v_room.duration_seconds,
    greatest(v_current_elapsed, v_reported_elapsed));
  v_label := nullif(btrim(p_task_label), '');

  if v_member.timer_status = 'done' then
    v_status := 'done';
  elsif v_elapsed >= v_room.duration_seconds then
    v_status := 'done';
    v_elapsed := v_room.duration_seconds;
  elsif p_timer_status = 'not_started' then
    if v_member.timer_status <> 'not_started' or v_elapsed <> 0 then
      raise exception using errcode = '22023', message = 'timer cannot return to not_started';
    end if;
    v_status := 'not_started';
  elsif p_timer_status = 'paused' and v_member.timer_status = 'not_started' then
    raise exception using errcode = '22023', message = 'timer must start before pausing';
  else
    v_status := p_timer_status;
  end if;

  update public.hustle_room_members
     set timer_status = v_status,
         task_label = v_label,
         elapsed_seconds = v_elapsed,
         anchor_started_at = case when v_status = 'running' then v_now else null end,
         updated_at = v_now
   where room_id = p_room_id and user_id = v_user
   returning * into v_member;

  v_response := jsonb_build_object(
    'room_id', v_room.id,
    'member', jsonb_build_object(
      'room_id', v_member.room_id,
      'user_id', v_member.user_id,
      'role', v_member.role,
      'timer_status', v_member.timer_status,
      'task_label', v_member.task_label,
      'elapsed_seconds', v_member.elapsed_seconds,
      'anchor_started_at', v_member.anchor_started_at,
      'joined_at', v_member.joined_at,
      'updated_at', v_member.updated_at
    ),
    'server_now', v_now
  );
  return public.hustle_room_store_receipt(
    'update_hustle_room_progress', p_client_mutation_id, v_response
  );
end;
$$;

create or replace function public.leave_hustle_room(
  p_room_id uuid,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_prior jsonb;
  v_room public.hustle_rooms%rowtype;
  v_member public.hustle_room_members%rowtype;
  v_now timestamptz := clock_timestamp();
  v_elapsed integer;
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('leave_hustle_room', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;

  select * into v_room from public.hustle_rooms
   where id = p_room_id for update;
  if not found or v_room.status <> 'active' then
    raise exception using errcode = 'P0002', message = 'active room not found';
  end if;

  select * into v_member from public.hustle_room_members
   where room_id = p_room_id and user_id = v_user for update;
  if not found or v_member.left_at is not null then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;
  if v_room.owner_id = v_user or v_member.role = 'owner' then
    raise exception using errcode = '42501', message = 'owner must end an active room and cannot leave it';
  end if;

  v_elapsed := least(v_room.duration_seconds, v_member.elapsed_seconds + case
    when v_member.timer_status = 'running' then greatest(0,
      floor(extract(epoch from (v_now - v_member.anchor_started_at)))::integer)
    else 0
  end);

  update public.hustle_room_members
     set timer_status = case
           when v_elapsed >= v_room.duration_seconds then 'done'
           when timer_status = 'running' then 'paused'
           else timer_status
         end,
         elapsed_seconds = v_elapsed,
         anchor_started_at = null,
         left_at = v_now,
         updated_at = v_now
   where room_id = p_room_id and user_id = v_user
   returning * into v_member;

  v_response := jsonb_build_object(
    'room_id', p_room_id,
    'member', jsonb_build_object(
      'room_id', v_member.room_id,
      'user_id', v_member.user_id,
      'role', v_member.role,
      'timer_status', v_member.timer_status,
      'task_label', v_member.task_label,
      'elapsed_seconds', v_member.elapsed_seconds,
      'anchor_started_at', v_member.anchor_started_at,
      'joined_at', v_member.joined_at,
      'left_at', v_member.left_at,
      'updated_at', v_member.updated_at
    ),
    'server_now', v_now
  );
  return public.hustle_room_store_receipt(
    'leave_hustle_room', p_client_mutation_id, v_response
  );
end;
$$;

create or replace function public.end_hustle_room(
  p_room_id uuid,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_prior jsonb;
  v_room public.hustle_rooms%rowtype;
  v_now timestamptz := clock_timestamp();
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('end_hustle_room', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;

  select * into v_room from public.hustle_rooms
   where id = p_room_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'room not found';
  end if;
  if v_room.owner_id <> v_user then
    raise exception using errcode = '42501', message = 'only the room owner may end it';
  end if;
  if v_room.status <> 'active' then
    raise exception using errcode = '22023', message = 'room is already ended';
  end if;

  update public.hustle_room_members m
     set elapsed_seconds = least(v_room.duration_seconds, m.elapsed_seconds + case
           when m.timer_status = 'running' then greatest(0,
             floor(extract(epoch from (v_now - m.anchor_started_at)))::integer)
           else 0
         end),
         timer_status = case
           when least(v_room.duration_seconds, m.elapsed_seconds + case
             when m.timer_status = 'running' then greatest(0,
               floor(extract(epoch from (v_now - m.anchor_started_at)))::integer)
             else 0
           end) >= v_room.duration_seconds then 'done'
           when m.timer_status = 'running' then 'paused'
           else m.timer_status
         end,
         anchor_started_at = null,
         left_at = coalesce(m.left_at, v_now),
         updated_at = v_now
   where m.room_id = p_room_id and m.left_at is null;

  update public.hustle_rooms
     set status = 'ended', ended_at = v_now, ended_by = v_user, updated_at = v_now
   where id = p_room_id
   returning * into v_room;

  v_response := jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'owner_id', v_room.owner_id,
      'name', v_room.name,
      'duration_seconds', v_room.duration_seconds,
      'chat_enabled', v_room.chat_enabled,
      'status', v_room.status,
      'created_at', v_room.created_at,
      'updated_at', v_room.updated_at,
      'ended_at', v_room.ended_at,
      'ended_by', v_room.ended_by
    ),
    'server_now', v_now
  );
  return public.hustle_room_store_receipt(
    'end_hustle_room', p_client_mutation_id, v_response
  );
end;
$$;

create or replace function public.send_hustle_room_message(
  p_room_id uuid,
  p_body text,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_prior jsonb;
  v_room public.hustle_rooms%rowtype;
  v_message public.hustle_room_messages%rowtype;
  v_profile public.profiles%rowtype;
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('send_hustle_room_message', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'message must be 1 to 2000 characters';
  end if;

  select * into v_room from public.hustle_rooms
   where id = p_room_id for share;
  if not found or v_room.status <> 'active' then
    raise exception using errcode = '42501', message = 'room is no longer active';
  end if;
  if not v_room.chat_enabled then
    raise exception using errcode = '42501', message = 'chat is disabled for this room';
  end if;
  perform 1 from public.hustle_room_members m
   where m.room_id = p_room_id and m.user_id = v_user and m.left_at is null
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;

  insert into public.hustle_room_messages(
    room_id, author_id, body, client_mutation_id
  ) values (p_room_id, v_user, btrim(p_body), p_client_mutation_id)
  returning * into v_message;
  select * into v_profile from public.profiles where id = v_user;

  v_response := jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_message.id,
      'room_id', v_message.room_id,
      'author_id', v_message.author_id,
      'body', v_message.body,
      'client_mutation_id', v_message.client_mutation_id,
      'created_at', v_message.created_at,
      'username', v_profile.username,
      'display_name', v_profile.display_name,
      'avatar_url', v_profile.avatar_url,
      'avatar_seed', v_profile.avatar_seed
    ),
    'server_now', v_message.created_at
  );
  return public.hustle_room_store_receipt(
    'send_hustle_room_message', p_client_mutation_id, v_response
  );
end;
$$;

-- Remove PostgreSQL's default PUBLIC execution and expose only the seven client
-- RPCs plus the narrow boolean predicate required by RLS evaluation.
revoke all on function public.hustle_room_is_active_member(uuid)
  from public, anon, authenticated;
revoke all on function public.hustle_room_require_user()
  from public, anon, authenticated;
revoke all on function public.hustle_room_receipt(text, uuid)
  from public, anon, authenticated;
revoke all on function public.hustle_room_store_receipt(text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_hustle_room(text, integer, boolean, uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_hustle_rooms()
  from public, anon, authenticated;
revoke all on function public.get_hustle_room_snapshot(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.update_hustle_room_progress(uuid, text, text, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.leave_hustle_room(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.end_hustle_room(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.send_hustle_room_message(uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.hustle_room_is_active_member(uuid)
  to authenticated;
grant execute on function public.create_hustle_room(text, integer, boolean, uuid[], uuid)
  to authenticated;
grant execute on function public.get_my_hustle_rooms()
  to authenticated;
grant execute on function public.get_hustle_room_snapshot(uuid, integer)
  to authenticated;
grant execute on function public.update_hustle_room_progress(uuid, text, text, integer, timestamptz, uuid)
  to authenticated;
grant execute on function public.leave_hustle_room(uuid, uuid)
  to authenticated;
grant execute on function public.end_hustle_room(uuid, uuid)
  to authenticated;
grant execute on function public.send_hustle_room_message(uuid, text, uuid)
  to authenticated;

-- Idempotently add all live room tables. Realtime accelerates snapshots; polling
-- remains the required fallback when publication or sockets are unavailable.
do $realtime$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'hustle_rooms'
  ) then
    alter publication supabase_realtime add table public.hustle_rooms;
  end if;

  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'hustle_room_members'
  ) then
    alter publication supabase_realtime add table public.hustle_room_members;
  end if;

  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'hustle_room_messages'
  ) then
    alter publication supabase_realtime add table public.hustle_room_messages;
  end if;
end;
$realtime$;
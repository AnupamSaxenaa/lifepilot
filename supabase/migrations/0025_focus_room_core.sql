-- 0025 — private, offline-safe focus-room queues, breaks, and callbacks
-- Apply after deployed 0024_hustle_rooms.sql. Additive and safe to rerun.

create table if not exists public.hustle_room_queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hustle_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  note text check (note is null or char_length(note) <= 4000),
  list_id text,
  is_starred boolean not null default false,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes between 1 and 1440),
  order_index integer not null check (order_index >= 0),
  status text not null default 'queued' check (status in ('queued', 'focusing', 'completed', 'skipped')),
  focus_seconds integer not null default 0 check (focus_seconds between 0 and 57600),
  focus_anchor_at timestamptz,
  completed_at timestamptz,
  xp_earned integer not null default 0 check (xp_earned >= 0),
  share_title boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint hustle_room_queue_focus_anchor_check check (
    (status = 'focusing' and focus_anchor_at is not null)
    or (status <> 'focusing' and focus_anchor_at is null)
  ),
  constraint hustle_room_queue_completed_at_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create table if not exists public.hustle_room_breaks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hustle_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint hustle_room_break_end_check check (
    (ended_at is null and duration_seconds is null)
    or (ended_at is not null and duration_seconds is not null and ended_at >= started_at)
  )
);

create table if not exists public.hustle_room_callbacks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hustle_rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint hustle_room_callbacks_not_self_check check (sender_id <> recipient_id)
);

alter table public.hustle_room_members
  add column if not exists presence_status text not null default 'online'
    check (presence_status in ('online', 'focusing', 'on_break', 'away')),
  add column if not exists tasks_completed_session integer not null default 0
    check (tasks_completed_session >= 0),
  add column if not exists focus_seconds_total bigint not null default 0
    check (focus_seconds_total >= 0),
  add column if not exists break_seconds_total bigint not null default 0
    check (break_seconds_total >= 0),
  add column if not exists show_task_titles boolean not null default false,
  add column if not exists callback_policy text not null default 'everyone'
    check (callback_policy in ('everyone', 'room', 'nobody')),
  add column if not exists active_queue_item_id uuid;

create unique index if not exists hustle_room_queue_task_once_idx
  on public.hustle_room_queue_items(room_id, user_id, task_id)
  where task_id is not null and status <> 'completed';
create unique index if not exists hustle_room_queue_one_focusing_idx
  on public.hustle_room_queue_items(room_id, user_id)
  where status = 'focusing';
create index if not exists hustle_room_queue_owner_order_idx
  on public.hustle_room_queue_items(room_id, user_id, order_index, created_at, id);
create unique index if not exists hustle_room_break_one_active_idx
  on public.hustle_room_breaks(room_id, user_id)
  where ended_at is null;
create index if not exists hustle_room_break_owner_started_idx
  on public.hustle_room_breaks(room_id, user_id, started_at desc);
create index if not exists hustle_room_callbacks_recipient_unread_idx
  on public.hustle_room_callbacks(recipient_id, room_id, created_at desc)
  where read_at is null;
create index if not exists hustle_room_callbacks_rate_idx
  on public.hustle_room_callbacks(room_id, sender_id, recipient_id, created_at desc);

do $active_queue_fk$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.hustle_room_members'::regclass
       and conname = 'hustle_room_members_active_queue_item_fk'
  ) then
    alter table public.hustle_room_members
      add constraint hustle_room_members_active_queue_item_fk
      foreign key (active_queue_item_id)
      references public.hustle_room_queue_items(id)
      on delete set null;
  end if;
end;
$active_queue_fk$;

alter table public.hustle_room_queue_items enable row level security;
alter table public.hustle_room_breaks enable row level security;
alter table public.hustle_room_callbacks enable row level security;

revoke all on table public.hustle_room_queue_items,
  public.hustle_room_breaks, public.hustle_room_callbacks
  from public, anon, authenticated;
grant select on table public.hustle_room_queue_items,
  public.hustle_room_breaks, public.hustle_room_callbacks to authenticated;

-- 0024 granted whole-row member reads, including the legacy task_label. Focus
-- Room privacy requires that title to be available only through the guarded
-- snapshot RPC, so retain Realtime-safe metadata columns but remove task_label.
revoke select on table public.hustle_room_members from authenticated;
grant select (
  room_id, user_id, role, timer_status, elapsed_seconds, anchor_started_at,
  joined_at, left_at, updated_at, presence_status, tasks_completed_session,
  focus_seconds_total, break_seconds_total, show_task_titles, callback_policy,
  active_queue_item_id
) on public.hustle_room_members to authenticated;

-- Owner-only policies intentionally avoid membership-table subqueries, so they
-- cannot recurse through hustle_room_members' existing active-member policy.
drop policy if exists "hustle_room_queue_owner_read" on public.hustle_room_queue_items;
create policy "hustle_room_queue_owner_read" on public.hustle_room_queue_items
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "hustle_room_breaks_owner_read" on public.hustle_room_breaks;
create policy "hustle_room_breaks_owner_read" on public.hustle_room_breaks
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "hustle_room_callbacks_party_read" on public.hustle_room_callbacks;
create policy "hustle_room_callbacks_party_read" on public.hustle_room_callbacks
  for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Replace 0024's snapshot projection so a private legacy task_label cannot be
-- observed by another member. The caller always retains access to their own.
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
        'task_label', case
          when m.user_id = v_user or m.show_task_titles then m.task_label
          else null
        end,
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

create or replace function public.get_hustle_room_focus_state(p_room_id uuid)
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
  if p_room_id is null then
    raise exception using errcode = '22023', message = 'room_id is required';
  end if;
  if not public.hustle_room_is_active_member(p_room_id) then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;

  with member_rows as (
    select m.room_id,
           m.user_id,
           m.role,
           case
             when ls.last_seen_at >= v_now - interval '2 minutes'
               and m.presence_status in ('focusing', 'on_break')
               then m.presence_status
             when ls.last_seen_at >= v_now - interval '2 minutes' then 'online'
             when ls.last_seen_at >= v_now - interval '45 minutes' then 'away'
             else 'offline'
           end as presence_status,
           m.tasks_completed_session,
           m.focus_seconds_total + case
             when m.presence_status = 'focusing' and qi.status = 'focusing'
               then greatest(0, least(57600 - qi.focus_seconds,
                 floor(extract(epoch from (v_now - qi.focus_anchor_at)))::integer))
             else 0
           end as effective_focus_seconds,
           m.break_seconds_total + case
             when br.id is not null
               then greatest(0, floor(extract(epoch from (v_now - br.started_at)))::integer)
             else 0
           end as effective_break_seconds,
           m.show_task_titles,
           m.callback_policy,
           qi.id as current_item_id,
           qi.status as current_item_status,
           case
             when m.user_id = v_user
               or (m.show_task_titles and coalesce(qi.share_title, false))
             then qi.title
             else null
           end as current_task_title,
           p.username,
           p.display_name,
           p.avatar_url,
           p.avatar_seed,
           ls.last_seen_at,
           m.joined_at,
           m.updated_at
      from public.hustle_room_members m
      left join public.profiles p on p.id = m.user_id
      left join lateral (
        select case
          when exists (
            select 1 from public.presence_sessions ps_any
             where ps_any.user_id = m.user_id
          ) then (
            select max(ps.last_seen_at)
              from public.presence_sessions ps
             where ps.user_id = m.user_id and ps.ended_at is null
          )
          else p.last_seen_at
        end as last_seen_at
      ) ls on true
      left join lateral (
        select q.*
          from public.hustle_room_queue_items q
         where q.room_id = m.room_id
           and q.user_id = m.user_id
           and (q.id = m.active_queue_item_id or q.status = 'focusing')
         order by (q.id = m.active_queue_item_id) desc, q.updated_at desc, q.id
         limit 1
      ) qi on true
      left join lateral (
        select b.id, b.started_at
          from public.hustle_room_breaks b
         where b.room_id = m.room_id
           and b.user_id = m.user_id
           and b.ended_at is null
         order by b.started_at desc
         limit 1
      ) br on true
     where m.room_id = p_room_id and m.left_at is null
  )
  select jsonb_build_object(
    'room_id', r.id,
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'room_id', q.room_id,
        'user_id', q.user_id,
        'task_id', q.task_id,
        'title', q.title,
        'note', q.note,
        'list_id', q.list_id,
        'is_starred', q.is_starred,
        'estimated_minutes', q.estimated_minutes,
        'order_index', q.order_index,
        'status', q.status,
        'focus_seconds', q.focus_seconds,
        'focus_anchor_at', q.focus_anchor_at,
        'completed_at', q.completed_at,
        'xp_earned', q.xp_earned,
        'share_title', q.share_title,
        'created_at', q.created_at,
        'updated_at', q.updated_at
      ) order by q.order_index, q.created_at, q.id)
        from public.hustle_room_queue_items q
       where q.room_id = r.id and q.user_id = v_user
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'room_id', mr.room_id,
        'user_id', mr.user_id,
        'role', mr.role,
        'presence_status', mr.presence_status,
        'tasks_completed_session', mr.tasks_completed_session,
        'focus_seconds_total', mr.effective_focus_seconds,
        'break_seconds_total', mr.effective_break_seconds,
        'show_task_titles', mr.show_task_titles,
        'callback_policy', mr.callback_policy,
        'current_queue_item_id', mr.current_item_id,
        'current_queue_item_status', mr.current_item_status,
        'current_task_title', mr.current_task_title,
        'username', mr.username,
        'display_name', mr.display_name,
        'avatar_url', mr.avatar_url,
        'avatar_seed', mr.avatar_seed,
        'last_seen_at', mr.last_seen_at,
        'joined_at', mr.joined_at,
        'updated_at', mr.updated_at
      ) order by (mr.role = 'owner') desc, mr.joined_at, mr.user_id)
        from member_rows mr
    ), '[]'::jsonb),
    'aggregate', jsonb_build_object(
      'active_members', (select count(*) from member_rows),
      'tasks_completed_session', coalesce((select sum(mr.tasks_completed_session) from member_rows mr), 0),
      'focus_seconds_total', coalesce((select sum(mr.effective_focus_seconds) from member_rows mr), 0),
      'break_seconds_total', coalesce((select sum(mr.effective_break_seconds) from member_rows mr), 0),
      'members_focusing', (select count(*) from member_rows mr where mr.presence_status = 'focusing'),
      'members_on_break', (select count(*) from member_rows mr where mr.presence_status = 'on_break')
    ),
    'unread_callback_count', (
      select count(*) from public.hustle_room_callbacks c
       where c.room_id = r.id and c.recipient_id = v_user and c.read_at is null
    ),
    'server_now', v_now
  ) into v_result
    from public.hustle_rooms r
   where r.id = p_room_id and r.status = 'active';

  if v_result is null then
    raise exception using errcode = '42501', message = 'room is no longer active';
  end if;
  return v_result;
end;
$$;


create or replace function public.replace_hustle_room_queue(
  p_room_id uuid,
  p_items jsonb,
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
  v_response jsonb;
  v_item jsonb;
  v_ordinality integer;
  v_id uuid;
  v_task_id text;
  v_status text;
  v_focus_seconds integer;
  v_existing public.hustle_room_queue_items%rowtype;
  v_seen_ids uuid[] := array[]::uuid[];
  v_seen_task_ids text[] := array[]::text[];
  v_effective_ids uuid[] := array[]::uuid[];
  v_effective_focus integer[] := array[]::integer[];
  v_effective_status text[] := array[]::text[];
  v_focusing_count integer := 0;
  v_focus_total_delta bigint := 0;
  v_active_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  v_prior := public.hustle_room_receipt('replace_hustle_room_queue', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;

  if p_room_id is null then
    raise exception using errcode = '22023', message = 'room_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'items must be a JSON array';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception using errcode = '22023', message = 'queue may contain at most 100 items';
  end if;

  perform 1 from public.hustle_rooms r
   where r.id = p_room_id and r.status = 'active' for share;
  if not found then
    raise exception using errcode = '42501', message = 'room is no longer active';
  end if;
  -- Every queue writer locks the member row first. Taking this lock before
  -- validation makes validation and replacement one serialized operation.
  perform 1 from public.hustle_room_members m
   where m.room_id = p_room_id and m.user_id = v_user and m.left_at is null
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;

  -- Validate every value before changing any rows. The payload is deliberately
  -- closed: server-owned fields cannot be smuggled through an offline replay.
  for v_item, v_ordinality in
    select x.value, x.ordinality::integer
      from jsonb_array_elements(p_items) with ordinality as x(value, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'each queue item must be an object';
    end if;
    if exists (
      select 1
        from jsonb_object_keys(v_item) as k(key)
       where not (k.key = any(array[
         'id', 'task_id', 'title', 'note', 'list_id', 'is_starred',
         'estimated_minutes', 'order_index', 'status', 'focus_seconds', 'share_title'
       ]::text[]))
    ) then
      raise exception using errcode = '22023', message = 'queue item contains an unknown field';
    end if;
    if not (v_item ? 'title') or jsonb_typeof(v_item->'title') <> 'string'
       or char_length(btrim(v_item->>'title')) not between 1 and 300 then
      raise exception using errcode = '22023', message = 'title must be a 1 to 300 character string';
    end if;
    if v_item ? 'id' and jsonb_typeof(v_item->'id') <> 'null' then
      if jsonb_typeof(v_item->'id') <> 'string'
         or (v_item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'id must be a UUID string or null';
      end if;
      v_id := (v_item->>'id')::uuid;
    else
      v_id := null;
    end if;
    if v_id is not null then
      if array_position(v_seen_ids, v_id) is not null then
        raise exception using errcode = '22023', message = 'queue item ids must be unique';
      end if;
      if exists (
        select 1 from public.hustle_room_queue_items q
         where q.id = v_id
           and (q.room_id <> p_room_id or q.user_id <> v_user or q.status = 'completed')
      ) then
        raise exception using errcode = '42501', message = 'queue item id is not replaceable by this user';
      end if;
      v_seen_ids := array_append(v_seen_ids, v_id);
    end if;

    if v_item ? 'task_id' and jsonb_typeof(v_item->'task_id') <> 'null' then
      if jsonb_typeof(v_item->'task_id') <> 'string' then
        raise exception using errcode = '22023', message = 'task_id must be a string or null';
      end if;
      v_task_id := v_item->>'task_id';
      if v_task_id = any(v_seen_task_ids) then
        raise exception using errcode = '22023', message = 'non-null task_ids must be unique';
      end if;
      v_seen_task_ids := array_append(v_seen_task_ids, v_task_id);
    end if;
    if v_item ? 'note' and jsonb_typeof(v_item->'note') <> 'null'
       and (jsonb_typeof(v_item->'note') <> 'string' or char_length(v_item->>'note') > 4000) then
      raise exception using errcode = '22023', message = 'note must be a string of at most 4000 characters or null';
    end if;
    if v_item ? 'list_id' and jsonb_typeof(v_item->'list_id') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'list_id must be a string or null';
    end if;
    if v_item ? 'is_starred' and jsonb_typeof(v_item->'is_starred') <> 'boolean' then
      raise exception using errcode = '22023', message = 'is_starred must be boolean';
    end if;
    if v_item ? 'share_title' and jsonb_typeof(v_item->'share_title') <> 'boolean' then
      raise exception using errcode = '22023', message = 'share_title must be boolean';
    end if;
    if v_item ? 'estimated_minutes' and jsonb_typeof(v_item->'estimated_minutes') <> 'null'
       and (jsonb_typeof(v_item->'estimated_minutes') <> 'number'
         or (v_item->>'estimated_minutes') !~ '^[0-9]+$'
         or (v_item->>'estimated_minutes')::numeric not between 1 and 1440) then
      raise exception using errcode = '22023', message = 'estimated_minutes must be an integer from 1 to 1440 or null';
    end if;
    if v_item ? 'order_index'
       and (jsonb_typeof(v_item->'order_index') <> 'number'
         or (v_item->>'order_index') !~ '^[0-9]+$'
         or (v_item->>'order_index')::numeric <> v_ordinality - 1) then
      raise exception using errcode = '22023', message = 'order_index must match the zero-based array position';
    end if;
    v_status := coalesce(v_item->>'status', 'queued');
    if v_status not in ('queued', 'focusing', 'skipped') then
      raise exception using errcode = '22023', message = 'replacement status must be queued, focusing, or skipped';
    end if;
    if v_status = 'focusing' then
      v_focusing_count := v_focusing_count + 1;
      if v_focusing_count > 1 then
        raise exception using errcode = '22023', message = 'only one queue item may be focusing';
      end if;
    end if;
    if v_item ? 'focus_seconds' then
      if jsonb_typeof(v_item->'focus_seconds') <> 'number'
         or (v_item->>'focus_seconds') !~ '^[0-9]+$'
         or (v_item->>'focus_seconds')::numeric not between 0 and 57600 then
        raise exception using errcode = '22023', message = 'focus_seconds must be an integer from 0 to 57600';
      end if;
    end if;
  end loop;

  -- Build canonical ids and monotonic focus values while old rows are still
  -- locked by the member-level serialization contract. Persisted member totals
  -- receive exactly each positive delta, including focus on genuinely new rows.
  -- A stable task_id canonicalizes an omitted/rotated client id across retries.
  v_focusing_count := 0;
  for v_item, v_ordinality in
    select x.value, x.ordinality::integer
      from jsonb_array_elements(p_items) with ordinality as x(value, ordinality)
  loop
    v_id := case
      when v_item ? 'id' and jsonb_typeof(v_item->'id') <> 'null'
        then (v_item->>'id')::uuid
      else gen_random_uuid()
    end;
    v_task_id := case when jsonb_typeof(v_item->'task_id') = 'null'
      then null else v_item->>'task_id' end;
    v_focus_seconds := coalesce((v_item->>'focus_seconds')::integer, 0);
    v_status := coalesce(v_item->>'status', 'queued');
    select * into v_existing
      from public.hustle_room_queue_items q
     where q.room_id = p_room_id and q.user_id = v_user
       and (
         q.id = v_id
         or (v_task_id is not null and q.task_id = v_task_id and q.status <> 'completed')
       )
     order by (q.id = v_id) desc
     limit 1;
    if found then
      v_id := v_existing.id;
      v_focus_seconds := greatest(v_focus_seconds,
        v_existing.focus_seconds + case
          when v_existing.status = 'focusing' and exists (
            select 1 from public.hustle_room_members m
             where m.room_id = p_room_id and m.user_id = v_user
               and m.presence_status = 'focusing'
          ) then greatest(0, least(57600 - v_existing.focus_seconds,
            floor(extract(epoch from (v_now - v_existing.focus_anchor_at)))::integer))
          else 0
        end
      );
      v_focus_total_delta := v_focus_total_delta
        + (v_focus_seconds - v_existing.focus_seconds);
    else
      v_focus_total_delta := v_focus_total_delta + v_focus_seconds;
    end if;
    if array_position(v_effective_ids, v_id) is not null then
      raise exception using errcode = '22023', message = 'queue items resolve to the same existing row';
    end if;
    if v_status = 'focusing' then
      v_focusing_count := v_focusing_count + 1;
      if v_focusing_count > 1 then
        raise exception using errcode = '22023', message = 'only one effective queue item may be focusing';
      end if;
    end if;
    v_effective_ids := array_append(v_effective_ids, v_id);
    v_effective_focus := array_append(v_effective_focus, v_focus_seconds);
    v_effective_status := array_append(v_effective_status, v_status);
  end loop;

  -- If the replacement removes the live item, settle its unpersisted tail too.
  select v_focus_total_delta + coalesce(sum(greatest(0,
           least(57600 - q.focus_seconds,
             floor(extract(epoch from (v_now - q.focus_anchor_at)))::integer))), 0)
    into v_focus_total_delta
    from public.hustle_room_queue_items q
    join public.hustle_room_members m
      on m.room_id = q.room_id and m.user_id = q.user_id
   where q.room_id = p_room_id and q.user_id = v_user
     and q.status = 'focusing' and m.presence_status = 'focusing'
     and q.id <> all(v_effective_ids);

  update public.hustle_room_members
     set focus_seconds_total = focus_seconds_total + v_focus_total_delta,
         active_queue_item_id = null,
         presence_status = case
           when exists (
             select 1 from public.hustle_room_breaks b
              where b.room_id = p_room_id and b.user_id = v_user and b.ended_at is null
           ) then 'on_break'
           else 'online'
         end,
         updated_at = v_now
   where room_id = p_room_id and user_id = v_user;

  delete from public.hustle_room_queue_items
   where room_id = p_room_id and user_id = v_user and status <> 'completed';

  for v_item, v_ordinality in
    select x.value, x.ordinality::integer
      from jsonb_array_elements(p_items) with ordinality as x(value, ordinality)
  loop
    v_id := v_effective_ids[v_ordinality];
    v_status := v_effective_status[v_ordinality];
    v_focus_seconds := v_effective_focus[v_ordinality];

    insert into public.hustle_room_queue_items(
      id, room_id, user_id, task_id, title, note, list_id, is_starred,
      estimated_minutes, order_index, status, focus_seconds,
      focus_anchor_at, share_title, created_at, updated_at
    ) values (
      v_id, p_room_id, v_user,
      case when jsonb_typeof(v_item->'task_id') = 'null' then null else v_item->>'task_id' end,
      btrim(v_item->>'title'),
      case when jsonb_typeof(v_item->'note') = 'null' then null else v_item->>'note' end,
      case when jsonb_typeof(v_item->'list_id') = 'null' then null else v_item->>'list_id' end,
      coalesce((v_item->>'is_starred')::boolean, false),
      case when jsonb_typeof(v_item->'estimated_minutes') = 'null' then null
           else (v_item->>'estimated_minutes')::integer end,
      v_ordinality - 1,
      v_status,
      v_focus_seconds,
      case when v_status = 'focusing' then v_now else null end,
      coalesce((v_item->>'share_title')::boolean, false),
      v_now,
      v_now
    );
    if v_status = 'focusing' then v_active_id := v_id; end if;
  end loop;

  if v_active_id is not null then
    update public.hustle_room_members
       set active_queue_item_id = v_active_id,
           presence_status = case
             when exists (
               select 1 from public.hustle_room_breaks b
                where b.room_id = p_room_id and b.user_id = v_user and b.ended_at is null
             ) then 'on_break'
             else 'focusing'
           end,
           updated_at = v_now
     where room_id = p_room_id and user_id = v_user;
  end if;

  v_response := public.get_hustle_room_focus_state(p_room_id);
  return public.hustle_room_store_receipt(
    'replace_hustle_room_queue', p_client_mutation_id, v_response
  );
end;
$$;


-- Remove the pre-XP development overload if this draft migration was tested
-- before p_xp_earned became canonical. This migration has not shipped yet.
drop function if exists public.update_hustle_room_queue_item(
  uuid, uuid, text, integer, boolean, uuid
);

create or replace function public.update_hustle_room_queue_item(
  p_room_id uuid,
  p_item_id uuid,
  p_status text,
  p_focus_seconds integer,
  p_xp_earned integer,
  p_share_title boolean,
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
  v_item public.hustle_room_queue_items%rowtype;
  v_member public.hustle_room_members%rowtype;
  v_now timestamptz := clock_timestamp();
  v_live_focus integer;
  v_new_focus integer;
  v_focus_delta integer;
  v_completed_increment integer := 0;
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('update_hustle_room_queue_item', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;

  if p_room_id is null or p_item_id is null then
    raise exception using errcode = '22023', message = 'room_id and item_id are required';
  end if;
  if p_status is null or p_status not in ('queued', 'focusing', 'completed', 'skipped') then
    raise exception using errcode = '22023', message = 'invalid queue status';
  end if;
  if p_focus_seconds is null or p_focus_seconds not between 0 and 57600 then
    raise exception using errcode = '22023', message = 'focus_seconds must be from 0 to 57600';
  end if;
  if p_xp_earned is null or p_xp_earned not between 0 and 500 then
    raise exception using errcode = '22023', message = 'xp_earned must be from 0 to 500';
  end if;
  if p_share_title is null then
    raise exception using errcode = '22023', message = 'share_title is required';
  end if;

  perform 1 from public.hustle_rooms r
   where r.id = p_room_id and r.status = 'active' for share;
  if not found then
    raise exception using errcode = '42501', message = 'room is no longer active';
  end if;

  select * into v_member
    from public.hustle_room_members m
   where m.room_id = p_room_id and m.user_id = v_user and m.left_at is null
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;

  select * into v_item
    from public.hustle_room_queue_items q
   where q.id = p_item_id and q.room_id = p_room_id and q.user_id = v_user
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'queue item not found or not owned by caller';
  end if;

  if v_item.status = 'completed' and p_status <> 'completed' then
    raise exception using errcode = '22023', message = 'completed queue items are final';
  end if;

  if p_status = 'focusing' and exists (
    select 1 from public.hustle_room_queue_items other
     where other.room_id = p_room_id and other.user_id = v_user
       and other.status = 'focusing' and other.id <> p_item_id
  ) then
    raise exception using errcode = '22023', message = 'another queue item is already focusing';
  end if;

  v_live_focus := v_item.focus_seconds + case
    when v_item.status = 'focusing' and v_member.presence_status = 'focusing'
      then greatest(0, least(57600 - v_item.focus_seconds,
        floor(extract(epoch from (v_now - v_item.focus_anchor_at)))::integer))
    else 0
  end;
  -- Delayed offline writes are accepted but can never reduce server progress.
  v_new_focus := least(57600, greatest(v_item.focus_seconds, v_live_focus, p_focus_seconds));
  v_focus_delta := v_new_focus - v_item.focus_seconds;
  if v_item.status <> 'completed' and p_status = 'completed' then
    v_completed_increment := 1;
  end if;

  update public.hustle_room_queue_items
     set status = p_status,
         focus_seconds = v_new_focus,
         focus_anchor_at = case when p_status = 'focusing' then v_now else null end,
         completed_at = case
           when p_status = 'completed' then coalesce(v_item.completed_at, v_now)
           else null
         end,
         xp_earned = case
           when p_status = 'completed' then greatest(v_item.xp_earned, p_xp_earned)
           else v_item.xp_earned
         end,
         share_title = p_share_title,
         updated_at = v_now
   where id = p_item_id
   returning * into v_item;

  update public.hustle_room_members m
     set focus_seconds_total = m.focus_seconds_total + v_focus_delta,
         tasks_completed_session = m.tasks_completed_session + v_completed_increment,
         active_queue_item_id = case
           when p_status = 'focusing' then p_item_id
           when m.active_queue_item_id = p_item_id then null
           else m.active_queue_item_id
         end,
         presence_status = case
           when exists (
             select 1 from public.hustle_room_breaks b
              where b.room_id = p_room_id and b.user_id = v_user and b.ended_at is null
           ) then 'on_break'
           when p_status = 'focusing' then 'focusing'
           when m.active_queue_item_id = p_item_id then 'online'
           else m.presence_status
         end,
         updated_at = v_now
   where m.room_id = p_room_id and m.user_id = v_user
   returning * into v_member;

  v_response := jsonb_build_object(
    'item', jsonb_build_object(
      'id', v_item.id,
      'room_id', v_item.room_id,
      'user_id', v_item.user_id,
      'task_id', v_item.task_id,
      'title', v_item.title,
      'note', v_item.note,
      'list_id', v_item.list_id,
      'is_starred', v_item.is_starred,
      'estimated_minutes', v_item.estimated_minutes,
      'order_index', v_item.order_index,
      'status', v_item.status,
      'focus_seconds', v_item.focus_seconds,
      'focus_anchor_at', v_item.focus_anchor_at,
      'completed_at', v_item.completed_at,
      'xp_earned', v_item.xp_earned,
      'share_title', v_item.share_title,
      'created_at', v_item.created_at,
      'updated_at', v_item.updated_at
    ),
    'member', jsonb_build_object(
      'room_id', v_member.room_id,
      'user_id', v_member.user_id,
      'presence_status', v_member.presence_status,
      'tasks_completed_session', v_member.tasks_completed_session,
      'focus_seconds_total', v_member.focus_seconds_total,
      'break_seconds_total', v_member.break_seconds_total,
      'active_queue_item_id', v_member.active_queue_item_id,
      'updated_at', v_member.updated_at
    ),
    'server_now', v_now
  );
  return public.hustle_room_store_receipt(
    'update_hustle_room_queue_item', p_client_mutation_id, v_response
  );
end;
$$;


create or replace function public.set_hustle_room_break(
  p_room_id uuid,
  p_is_breaking boolean,
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
  v_member public.hustle_room_members%rowtype;
  v_item public.hustle_room_queue_items%rowtype;
  v_break public.hustle_room_breaks%rowtype;
  v_now timestamptz := clock_timestamp();
  v_new_focus integer;
  v_focus_delta integer := 0;
  v_duration integer := 0;
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('set_hustle_room_break', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;

  if p_room_id is null or p_is_breaking is null then
    raise exception using errcode = '22023', message = 'room_id and is_breaking are required';
  end if;
  perform 1 from public.hustle_rooms r
   where r.id = p_room_id and r.status = 'active' for share;
  if not found then
    raise exception using errcode = '42501', message = 'room is no longer active';
  end if;
  select * into v_member
    from public.hustle_room_members m
   where m.room_id = p_room_id and m.user_id = v_user and m.left_at is null
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;

  select * into v_break
    from public.hustle_room_breaks b
   where b.room_id = p_room_id and b.user_id = v_user and b.ended_at is null
   order by b.started_at desc
   limit 1
   for update;

  if p_is_breaking then
    if not found then
      select * into v_item
        from public.hustle_room_queue_items q
       where q.room_id = p_room_id and q.user_id = v_user
         and q.status = 'focusing'
       order by (q.id = v_member.active_queue_item_id) desc, q.updated_at desc
       limit 1
       for update;
      if found then
        v_new_focus := v_item.focus_seconds + case
          when v_member.presence_status = 'focusing' then greatest(0,
            least(57600 - v_item.focus_seconds,
              floor(extract(epoch from (v_now - v_item.focus_anchor_at)))::integer))
          else 0
        end;
        v_focus_delta := v_new_focus - v_item.focus_seconds;
        update public.hustle_room_queue_items
           set focus_seconds = v_new_focus,
               focus_anchor_at = v_now,
               updated_at = v_now
         where id = v_item.id;
      end if;

      insert into public.hustle_room_breaks(room_id, user_id, started_at, created_at, updated_at)
      values (p_room_id, v_user, v_now, v_now, v_now)
      returning * into v_break;

      update public.hustle_room_members
         set focus_seconds_total = focus_seconds_total + v_focus_delta,
             presence_status = 'on_break',
             updated_at = v_now
       where room_id = p_room_id and user_id = v_user
       returning * into v_member;
    else
      update public.hustle_room_members
         set presence_status = 'on_break', updated_at = v_now
       where room_id = p_room_id and user_id = v_user
       returning * into v_member;
    end if;
  else
    if found then
      v_duration := least(2147483647::numeric,
        greatest(0, floor(extract(epoch from (v_now - v_break.started_at)))))::integer;
      update public.hustle_room_breaks
         set ended_at = v_now,
             duration_seconds = v_duration,
             updated_at = v_now
       where id = v_break.id
       returning * into v_break;

      update public.hustle_room_queue_items q
         set focus_anchor_at = v_now,
             updated_at = v_now
       where q.room_id = p_room_id and q.user_id = v_user
         and q.status = 'focusing';

      update public.hustle_room_members m
         set break_seconds_total = m.break_seconds_total + v_duration,
             presence_status = case
               when exists (
                 select 1 from public.hustle_room_queue_items q
                  where q.room_id = p_room_id and q.user_id = v_user
                    and q.status = 'focusing'
               ) then 'focusing'
               else 'online'
             end,
             updated_at = v_now
       where m.room_id = p_room_id and m.user_id = v_user
       returning * into v_member;
    end if;
  end if;

  v_response := jsonb_build_object(
    'room_id', p_room_id,
    'is_breaking', p_is_breaking,
    'break', case when v_break.id is null then null else jsonb_build_object(
      'id', v_break.id,
      'room_id', v_break.room_id,
      'user_id', v_break.user_id,
      'started_at', v_break.started_at,
      'ended_at', v_break.ended_at,
      'duration_seconds', v_break.duration_seconds,
      'created_at', v_break.created_at,
      'updated_at', v_break.updated_at
    ) end,
    'member', jsonb_build_object(
      'room_id', v_member.room_id,
      'user_id', v_member.user_id,
      'presence_status', v_member.presence_status,
      'focus_seconds_total', v_member.focus_seconds_total,
      'break_seconds_total', v_member.break_seconds_total,
      'active_queue_item_id', v_member.active_queue_item_id,
      'updated_at', v_member.updated_at
    ),
    'server_now', v_now
  );
  return public.hustle_room_store_receipt(
    'set_hustle_room_break', p_client_mutation_id, v_response
  );
end;
$$;

create or replace function public.update_hustle_room_privacy(
  p_room_id uuid,
  p_show_titles boolean,
  p_callback_policy text,
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
  v_member public.hustle_room_members%rowtype;
  v_now timestamptz := clock_timestamp();
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('update_hustle_room_privacy', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;
  if p_room_id is null or p_show_titles is null
     or p_callback_policy is null
     or p_callback_policy not in ('everyone', 'room', 'nobody') then
    raise exception using errcode = '22023', message = 'invalid privacy settings';
  end if;

  perform 1 from public.hustle_rooms r
   where r.id = p_room_id and r.status = 'active' for share;
  if not found then
    raise exception using errcode = '42501', message = 'room is no longer active';
  end if;
  update public.hustle_room_members
     set show_task_titles = p_show_titles,
         callback_policy = p_callback_policy,
         updated_at = v_now
   where room_id = p_room_id and user_id = v_user and left_at is null
   returning * into v_member;
  if not found then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;

  v_response := jsonb_build_object(
    'room_id', p_room_id,
    'user_id', v_user,
    'show_task_titles', v_member.show_task_titles,
    'callback_policy', v_member.callback_policy,
    'updated_at', v_member.updated_at,
    'server_now', v_now
  );
  return public.hustle_room_store_receipt(
    'update_hustle_room_privacy', p_client_mutation_id, v_response
  );
end;
$$;


create or replace function public.send_hustle_room_callback(
  p_room_id uuid,
  p_recipient_id uuid,
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
  v_recipient public.hustle_room_members%rowtype;
  v_callback public.hustle_room_callbacks%rowtype;
  v_now timestamptz := clock_timestamp();
  v_is_online boolean;
  v_response jsonb;
begin
  v_prior := public.hustle_room_receipt('send_hustle_room_callback', p_client_mutation_id);
  if v_prior is not null then return v_prior; end if;

  if p_room_id is null or p_recipient_id is null then
    raise exception using errcode = '22023', message = 'room_id and recipient_id are required';
  end if;
  if p_recipient_id = v_user then
    raise exception using errcode = '22023', message = 'cannot send a callback to yourself';
  end if;

  perform 1 from public.hustle_rooms r
   where r.id = p_room_id and r.status = 'active' for share;
  if not found then
    raise exception using errcode = '42501', message = 'room is no longer active';
  end if;
  -- Lock both participant rows in UUID order so reciprocal callback attempts
  -- cannot acquire sender/recipient locks in opposite order.
  perform m.user_id
    from public.hustle_room_members m
   where m.room_id = p_room_id
     and m.user_id = any(array[v_user, p_recipient_id]::uuid[])
   order by m.user_id
   for update;
  if not exists (
    select 1 from public.hustle_room_members m
     where m.room_id = p_room_id and m.user_id = v_user and m.left_at is null
  ) then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;
  select * into v_recipient
    from public.hustle_room_members m
   where m.room_id = p_room_id and m.user_id = p_recipient_id and m.left_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'recipient must be an active room member';
  end if;
  if v_recipient.callback_policy = 'nobody' then
    raise exception using errcode = '42501', message = 'recipient does not allow callbacks';
  end if;
  -- "room" permits active co-members; "everyone" also permits this narrower
  -- room-scoped operation. Both still require the recipient to be away/offline.
  v_is_online := exists (
    select 1 from public.presence_sessions ps
     where ps.user_id = p_recipient_id
       and ps.ended_at is null
       and ps.last_seen_at >= v_now - interval '2 minutes'
  );
  if v_recipient.presence_status <> 'away' and v_is_online then
    raise exception using errcode = '42501', message = 'callbacks are only available for away or offline recipients';
  end if;

  -- The mutation receipt serializes retries; this second lock serializes
  -- distinct mutations racing against the same ten-minute rate-limit bucket.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'hustle-room-callback:' || p_room_id::text || ':' || v_user::text || ':' || p_recipient_id::text,
    0
  ));
  if exists (
    select 1 from public.hustle_room_callbacks c
     where c.room_id = p_room_id
       and c.sender_id = v_user
       and c.recipient_id = p_recipient_id
       and c.created_at > v_now - interval '10 minutes'
  ) then
    raise exception using errcode = '22023', message = 'only one callback may be sent to this recipient every 10 minutes';
  end if;

  insert into public.hustle_room_callbacks(room_id, sender_id, recipient_id, created_at)
  values (p_room_id, v_user, p_recipient_id, v_now)
  returning * into v_callback;

  v_response := jsonb_build_object(
    'callback', jsonb_build_object(
      'id', v_callback.id,
      'room_id', v_callback.room_id,
      'sender_id', v_callback.sender_id,
      'recipient_id', v_callback.recipient_id,
      'read_at', v_callback.read_at,
      'created_at', v_callback.created_at
    ),
    'server_now', v_now
  );
  return public.hustle_room_store_receipt(
    'send_hustle_room_callback', p_client_mutation_id, v_response
  );
end;
$$;

create or replace function public.mark_hustle_room_callbacks_read(p_room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := public.hustle_room_require_user();
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_room_id is null then
    raise exception using errcode = '22023', message = 'room_id is required';
  end if;
  if not public.hustle_room_is_active_member(p_room_id) then
    raise exception using errcode = '42501', message = 'active room membership required';
  end if;

  update public.hustle_room_callbacks
     set read_at = v_now
   where room_id = p_room_id and recipient_id = v_user and read_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object(
    'room_id', p_room_id,
    'marked_read', v_count,
    'server_now', v_now
  );
end;
$$;

-- Remove default PUBLIC execution and expose only client-facing RPCs. Existing
-- 0024 function definitions and privileges are intentionally untouched.
revoke all on function public.get_hustle_room_focus_state(uuid)
  from public, anon, authenticated;
revoke all on function public.replace_hustle_room_queue(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.update_hustle_room_queue_item(uuid, uuid, text, integer, integer, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.set_hustle_room_break(uuid, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.update_hustle_room_privacy(uuid, boolean, text, uuid)
  from public, anon, authenticated;
revoke all on function public.send_hustle_room_callback(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_hustle_room_callbacks_read(uuid)
  from public, anon, authenticated;

grant execute on function public.get_hustle_room_focus_state(uuid)
  to authenticated;
grant execute on function public.replace_hustle_room_queue(uuid, jsonb, uuid)
  to authenticated;
grant execute on function public.update_hustle_room_queue_item(uuid, uuid, text, integer, integer, boolean, uuid)
  to authenticated;
grant execute on function public.set_hustle_room_break(uuid, boolean, uuid)
  to authenticated;
grant execute on function public.update_hustle_room_privacy(uuid, boolean, text, uuid)
  to authenticated;
grant execute on function public.send_hustle_room_callback(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.mark_hustle_room_callbacks_read(uuid)
  to authenticated;

-- Realtime remains an accelerator. Queue rows are owner-filtered by RLS,
-- callbacks are party-filtered, and member rows retain 0024's recursion-safe
-- active-member policy.
do $realtime$
declare
  v_table text;
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    foreach v_table in array array[
      'hustle_room_queue_items',
      'hustle_room_callbacks',
      'hustle_room_members'
    ] loop
      if not exists (
        select 1 from pg_catalog.pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = v_table
      ) then
        execute pg_catalog.format(
          'alter publication supabase_realtime add table public.%I', v_table
        );
      end if;
    end loop;
  end if;
end;
$realtime$;
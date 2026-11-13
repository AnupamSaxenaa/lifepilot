-- ============================================================================
-- 0016 — Collaboration core (standalone, additive, production review required)
-- ============================================================================
-- IMPORTANT DEPLOYMENT NOTE:
--   Review this migration, its grants, RLS composition, and Realtime load in a
--   staging project before production. Migration 0011 must remain HELD BACK;
--   this file intentionally has no dependency on unapplied 0011 or 0015.
--
-- Live-schema assumptions supplied for this migration:
--   tasks.id, lists.id, profiles.id are uuid; tasks.list_id -> lists.id;
--   lists.order_index exists; tasks.updated_at does not yet exist.
--
-- Shared list/task writes are RPC-only. Existing owner policies are not dropped:
-- restrictive policies below compose with them and preserve direct personal-row
-- writes while rejecting direct writes once a row belongs to a space.
-- ============================================================================

-- Collaboration columns are additive. Nullable ownership/assignment columns
-- keep every existing personal list and task behavior unchanged.
create schema if not exists extensions;

-- pgcrypto is deliberately kept outside the RPC search_path. If an earlier
-- environment installed it elsewhere, move the relocatable extension so every
-- cryptographic call below can remain explicitly schema-qualified.
do $pgcrypto$
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pgcrypto'
  ) then
    create extension pgcrypto with schema extensions;
  elsif not exists (
    select 1
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname = 'extensions'
  ) then
    alter extension pgcrypto set schema extensions;
  end if;
end $pgcrypto$;

alter table public.lists
  add column if not exists space_id uuid,
  add column if not exists created_by uuid,
  add column if not exists icon text,
  add column if not exists collaboration_version bigint not null default 1,
  add column if not exists updated_at timestamptz;

alter table public.tasks
  add column if not exists space_id uuid,
  add column if not exists assigned_to uuid,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists collaboration_version bigint not null default 1,
  add column if not exists updated_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists notes text,
  add column if not exists subtasks jsonb not null default '[]'::jsonb;

-- Preserve compatibility with old personal rows while attributing rows where
-- the existing owner is known. These columns intentionally remain nullable.
update public.lists l set created_by = l.user_id
where l.created_by is null and l.user_id is not null
  and exists(select 1 from public.profiles p where p.id=l.user_id);
update public.tasks t set created_by = t.user_id
where t.created_by is null and t.user_id is not null
  and exists(select 1 from public.profiles p where p.id=t.user_id);

create table if not exists public.spaces (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid not null references public.profiles(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.spaces
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  version bigint not null default 1 check (version > 0),
  joined_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (space_id, user_id)
);

create table if not exists public.space_invites (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  invitee_email text,
  invited_user_id uuid references public.profiles(id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  token_hash bytea not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  check (invitee_email is not null or invited_user_id is not null)
);

create table if not exists public.task_comments (
  id uuid primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

-- Mentions are server-derived from comment text. Persisting the resolved member
-- IDs lets edits notify only newly mentioned people and prevents spoofed handles.
create table if not exists public.task_comment_mentions (
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (comment_id, user_id)
);

create table if not exists public.space_activity (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.inbox_notifications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  activity_id bigint references public.space_activity(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.collaboration_mutation_receipts (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null,
  client_mutation_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, operation, client_mutation_id)
);

create table if not exists public.task_xp_award_receipts (
  task_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  award_kind text not null default 'first_completion',
  xp_amount integer not null check (xp_amount between 0 and 5000),
  client_mutation_id uuid not null,
  awarded_at timestamptz not null default clock_timestamp(),
  primary key (task_id, award_kind)
);

create table if not exists public.collaboration_tombstones (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('task', 'comment', 'list')),
  entity_id uuid not null,
  deleted_by uuid references public.profiles(id) on delete set null,
  last_version bigint not null,
  snapshot jsonb not null default '{}'::jsonb,
  deleted_at timestamptz not null default clock_timestamp(),
  unique (space_id, entity_type, entity_id)
);

-- Guard named foreign keys so staging replays and partially pre-provisioned schemas
-- do not fail. Existing rows are compatible because new columns start NULL.
do $constraints$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.lists'::regclass and conname='lists_space_id_fkey') then
    alter table public.lists add constraint lists_space_id_fkey foreign key (space_id)
      references public.spaces(id) on delete set null;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.lists'::regclass and conname='lists_created_by_fkey') then
    alter table public.lists add constraint lists_created_by_fkey foreign key (created_by)
      references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_space_id_fkey') then
    alter table public.tasks add constraint tasks_space_id_fkey foreign key (space_id)
      references public.spaces(id) on delete set null;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_assigned_to_fkey') then
    alter table public.tasks add constraint tasks_assigned_to_fkey foreign key (assigned_to)
      references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_created_by_fkey') then
    alter table public.tasks add constraint tasks_created_by_fkey foreign key (created_by)
      references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_updated_by_fkey') then
    alter table public.tasks add constraint tasks_updated_by_fkey foreign key (updated_by)
      references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_deleted_by_fkey') then
    alter table public.tasks add constraint tasks_deleted_by_fkey foreign key (deleted_by)
      references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.spaces'::regclass and conname='spaces_archived_by_fkey') then
    alter table public.spaces add constraint spaces_archived_by_fkey foreign key (archived_by)
      references public.profiles(id) on delete set null;
  end if;
end $constraints$;

-- Query and sync indexes.
create index if not exists space_members_user_idx on public.space_members(user_id, space_id);
create index if not exists space_members_space_role_idx on public.space_members(space_id, role);
create index if not exists space_invites_space_status_idx on public.space_invites(space_id, status, expires_at);
create index if not exists space_invites_user_idx on public.space_invites(invited_user_id, status);
create index if not exists space_invites_email_idx on public.space_invites(lower(invitee_email), status);
create index if not exists profiles_username_lower_idx on public.profiles(lower(username)) where username is not null;
create index if not exists lists_space_order_idx on public.lists(space_id, order_index) where space_id is not null;
create index if not exists lists_created_by_idx on public.lists(created_by) where created_by is not null;
create index if not exists tasks_space_updated_idx on public.tasks(space_id, updated_at, id) where space_id is not null and deleted_at is null;
create index if not exists tasks_space_list_idx on public.tasks(space_id, list_id) where space_id is not null and deleted_at is null;
create index if not exists tasks_space_deleted_idx on public.tasks(space_id, deleted_at, id) where space_id is not null and deleted_at is not null;
create index if not exists tasks_assigned_idx on public.tasks(assigned_to, space_id) where assigned_to is not null and deleted_at is null;
create index if not exists tasks_created_by_idx on public.tasks(created_by) where created_by is not null;
create index if not exists spaces_archived_idx on public.spaces(archived_at, id) where archived_at is not null;
create index if not exists task_comments_task_created_idx on public.task_comments(task_id, created_at, id);
create index if not exists task_comment_mentions_user_idx on public.task_comment_mentions(user_id, created_at desc);
create index if not exists task_comment_mentions_space_idx on public.task_comment_mentions(space_id, comment_id);
create index if not exists space_activity_space_created_idx on public.space_activity(space_id, created_at, id);
create index if not exists inbox_notifications_unread_idx on public.inbox_notifications(user_id, created_at desc) where read_at is null;
create index if not exists mutation_receipts_created_idx on public.collaboration_mutation_receipts(created_at);
create unique index if not exists task_xp_award_once_idx on public.task_xp_award_receipts(task_id, award_kind);
create index if not exists tombstones_space_deleted_idx on public.collaboration_tombstones(space_id, deleted_at, id);

-- RLS is enabled explicitly even if legacy task/list setup already enabled it.
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.space_invites enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_comment_mentions enable row level security;
alter table public.space_activity enable row level security;
alter table public.inbox_notifications enable row level security;
alter table public.collaboration_mutation_receipts enable row level security;
alter table public.task_xp_award_receipts enable row level security;
alter table public.collaboration_tombstones enable row level security;
alter table public.lists enable row level security;
alter table public.tasks enable row level security;

-- New-table clients only receive RLS-filtered reads. All writes use RPCs.
revoke all on public.spaces, public.space_members, public.space_invites,
  public.task_comments, public.task_comment_mentions, public.space_activity,
  public.inbox_notifications, public.collaboration_mutation_receipts,
  public.task_xp_award_receipts, public.collaboration_tombstones from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.spaces,
  public.space_members, public.space_invites, public.task_comments,
  public.task_comment_mentions, public.space_activity, public.inbox_notifications,
  public.collaboration_mutation_receipts, public.task_xp_award_receipts,
  public.collaboration_tombstones from authenticated;
grant select on public.spaces, public.space_members, public.task_comments,
  public.task_comment_mentions, public.space_activity, public.inbox_notifications to authenticated;

-- Policies are dropped by name before recreation so a staging replay after a
-- partially applied migration cannot fail on duplicate policy names.
drop policy if exists "collab_members_read_self" on public.space_members;
drop policy if exists "collab_spaces_member_read" on public.spaces;
drop policy if exists "collab_lists_member_read" on public.lists;
drop policy if exists "collab_lists_shared_read_guard" on public.lists;
drop policy if exists "collab_tasks_member_read" on public.tasks;
drop policy if exists "collab_tasks_shared_read_guard" on public.tasks;
drop policy if exists "collab_comments_member_read" on public.task_comments;
drop policy if exists "collab_comment_mentions_member_read" on public.task_comment_mentions;
drop policy if exists "collab_activity_member_read" on public.space_activity;
drop policy if exists "collab_notifications_read_self" on public.inbox_notifications;
drop policy if exists "collab_lists_personal_insert_guard" on public.lists;
drop policy if exists "collab_lists_personal_update_guard" on public.lists;
drop policy if exists "collab_lists_personal_delete_guard" on public.lists;
drop policy if exists "collab_tasks_personal_insert_guard" on public.tasks;
drop policy if exists "collab_tasks_personal_update_guard" on public.tasks;
drop policy if exists "collab_tasks_personal_delete_guard" on public.tasks;

-- No policy below calls a membership helper: predicates are inline and avoid
-- policy/helper recursion. space_members only exposes the caller's own row.
create policy "collab_members_read_self" on public.space_members
  for select to authenticated using (user_id = (select auth.uid()));

create policy "collab_spaces_member_read" on public.spaces
  for select to authenticated using (
    exists (select 1 from public.space_members m
      where m.space_id = spaces.id and m.user_id = (select auth.uid()))
  );

create policy "collab_lists_member_read" on public.lists
  for select to authenticated using (
    space_id is not null and exists (select 1 from public.space_members m
      where m.space_id = lists.space_id and m.user_id = (select auth.uid()))
  );

-- Legacy owner SELECT policies are permissive and OR-composed. Once a list is
-- shared, this restrictive policy requires active membership even for its
-- original personal owner.
create policy "collab_lists_shared_read_guard" on public.lists as restrictive
  for select to authenticated using (
    space_id is null or exists (select 1 from public.space_members m
      where m.space_id = lists.space_id and m.user_id = (select auth.uid()))
  );

create policy "collab_tasks_member_read" on public.tasks
  for select to authenticated using (
    space_id is not null and deleted_at is null and exists (select 1 from public.space_members m
      where m.space_id = tasks.space_id and m.user_id = (select auth.uid()))
  );

-- Permissive legacy owner policies are OR-composed. This restrictive guard is
-- therefore required to ensure shared rows are visible only to current members
-- and that no direct SELECT policy can surface a retained soft-deleted task.
create policy "collab_tasks_shared_read_guard" on public.tasks as restrictive
  for select to authenticated using (
    space_id is null or (
      deleted_at is null and exists (select 1 from public.space_members m
        where m.space_id = tasks.space_id and m.user_id = (select auth.uid()))
    )
  );

create policy "collab_comments_member_read" on public.task_comments
  for select to authenticated using (
    exists (select 1 from public.space_members m
      where m.space_id = task_comments.space_id and m.user_id = (select auth.uid()))
  );

create policy "collab_comment_mentions_member_read" on public.task_comment_mentions
  for select to authenticated using (
    exists (select 1 from public.space_members m
      where m.space_id = task_comment_mentions.space_id and m.user_id = (select auth.uid()))
  );

create policy "collab_activity_member_read" on public.space_activity
  for select to authenticated using (
    exists (select 1 from public.space_members m
      where m.space_id = space_activity.space_id and m.user_id = (select auth.uid()))
  );

create policy "collab_notifications_read_self" on public.inbox_notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- Restrictive direct-write guards compose with unknown legacy owner policies.
-- SECURITY DEFINER RPCs bypass RLS; clients cannot directly create/link/mutate
-- shared rows even if an older permissive owner policy still exists.
create policy "collab_lists_personal_insert_guard" on public.lists as restrictive
  for insert to authenticated with check (space_id is null and user_id = (select auth.uid()));
create policy "collab_lists_personal_update_guard" on public.lists as restrictive
  for update to authenticated using (space_id is null)
  with check (space_id is null and user_id = (select auth.uid()));
create policy "collab_lists_personal_delete_guard" on public.lists as restrictive
  for delete to authenticated using (space_id is null and user_id = (select auth.uid()));
create policy "collab_tasks_personal_insert_guard" on public.tasks as restrictive
  for insert to authenticated with check (space_id is null and assigned_to is null and user_id = (select auth.uid()));
create policy "collab_tasks_personal_update_guard" on public.tasks as restrictive
  for update to authenticated using (space_id is null)
  with check (space_id is null and assigned_to is null and user_id = (select auth.uid()));
create policy "collab_tasks_personal_delete_guard" on public.tasks as restrictive
  for delete to authenticated using (space_id is null and user_id = (select auth.uid()));

-- Internal authorization/idempotency/event helpers. They always derive the
-- caller from auth.uid(); no caller-controlled user id is accepted.
create or replace function public.collab_require_user()
returns uuid language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception using errcode = '28000', message = 'authentication required'; end if;
  return v_user;
end $$;

create or replace function public.collab_role(p_space_id uuid)
returns text language sql stable security definer
set search_path = pg_catalog, public as $$
  select m.role from public.space_members m
  join public.spaces s on s.id=m.space_id and s.archived_at is null
  where m.space_id = p_space_id and m.user_id = auth.uid()
$$;

create or replace function public.collab_receipt(p_operation text, p_mutation_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public as $$
declare v_user uuid := public.collab_require_user(); v_result jsonb;
begin
  if p_mutation_id is null then
    raise exception using errcode = '22004', message = 'client_mutation_id is required';
  end if;
  -- Serializes concurrent retries before any side effects are performed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_user::text || ':' || p_operation || ':' || p_mutation_id::text, 0));
  select r.response into v_result from public.collaboration_mutation_receipts r
  where r.actor_id = v_user and r.operation = p_operation
    and r.client_mutation_id = p_mutation_id;
  return v_result;
end $$;

create or replace function public.collab_store_receipt(
  p_operation text, p_mutation_id uuid, p_response jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_user uuid := public.collab_require_user(); v_result jsonb;
begin
  if p_mutation_id is null then
    raise exception using errcode = '22004', message = 'client_mutation_id is required';
  end if;
  insert into public.collaboration_mutation_receipts(actor_id, operation, client_mutation_id, response)
  values (v_user, p_operation, p_mutation_id, p_response)
  on conflict (actor_id, operation, client_mutation_id) do nothing;
  select response into v_result from public.collaboration_mutation_receipts
  where actor_id = v_user and operation = p_operation and client_mutation_id = p_mutation_id;
  return v_result;
end $$;

create or replace function public.collab_emit(
  p_space_id uuid, p_event_type text, p_entity_type text,
  p_entity_id uuid, p_payload jsonb default '{}'::jsonb,
  p_notify boolean default true)
returns bigint language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_actor uuid := public.collab_require_user(); v_activity bigint;
begin
  insert into public.space_activity(space_id, actor_id, event_type, entity_type, entity_id, payload)
  values (p_space_id, v_actor, p_event_type, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb))
  returning id into v_activity;
  if p_notify then
    insert into public.inbox_notifications(user_id, space_id, activity_id, kind, payload)
    select m.user_id, p_space_id, v_activity, p_event_type,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id)
    from public.space_members m
    where m.space_id = p_space_id and m.user_id <> v_actor;
  end if;
  return v_activity;
end $$;

revoke all on function public.collab_require_user() from public, anon, authenticated;
revoke all on function public.collab_role(uuid) from public, anon, authenticated;
revoke all on function public.collab_receipt(text, uuid) from public, anon, authenticated;
revoke all on function public.collab_store_receipt(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.collab_emit(uuid, text, text, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.collab_require_user(), public.collab_role(uuid),
  public.collab_receipt(text, uuid), public.collab_store_receipt(text, uuid, jsonb),
  public.collab_emit(uuid, text, text, uuid, jsonb, boolean) to service_role;

create or replace function public.create_space(p_name text, p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_user uuid := public.collab_require_user(); v_prior jsonb; v_space public.spaces%rowtype; v_result jsonb;
begin
  v_prior := public.collab_receipt('create_space', p_client_mutation_id);
  if v_prior is not null then return v_prior || jsonb_build_object('replayed', true); end if;
  if p_client_mutation_id is null then raise exception using errcode='22004', message='client_mutation_id is required'; end if;
  insert into public.spaces(name, created_by) values (btrim(p_name), v_user) returning * into v_space;
  insert into public.space_members(space_id, user_id, role) values (v_space.id, v_user, 'owner');
  perform public.collab_emit(v_space.id, 'space.created', 'space', v_space.id, jsonb_build_object('name', v_space.name), false);
  v_result := jsonb_build_object('space_id', v_space.id, 'version', v_space.version, 'name', v_space.name);
  return public.collab_store_receipt('create_space', p_client_mutation_id, v_result);
end $$;

create or replace function public.link_list_to_space(
  p_list_id uuid, p_space_id uuid, p_expected_version bigint, p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_user uuid := public.collab_require_user(); v_prior jsonb; v_list public.lists%rowtype; v_result jsonb;
begin
  v_prior := public.collab_receipt('link_list_to_space', p_client_mutation_id);
  if v_prior is not null then return v_prior || jsonb_build_object('replayed', true); end if;
  select * into v_list from public.lists where id = p_list_id for update;
  if not found then raise exception using errcode='P0002', message='list not found'; end if;
  if v_list.user_id <> v_user then raise exception using errcode='42501', message='only the personal list owner may link it'; end if;
  if v_list.space_id is not null then raise exception using errcode='23505', message='list is already linked'; end if;
  if coalesce(public.collab_role(p_space_id),'') not in ('owner','editor') then raise exception using errcode='42501', message='editor role required'; end if;
  if v_list.collaboration_version is distinct from p_expected_version then raise exception using errcode='40001', message='list version conflict'; end if;
  update public.lists set space_id=p_space_id, created_by=coalesce(created_by,v_user),
    collaboration_version=collaboration_version+1, updated_at=clock_timestamp()
    where id=p_list_id returning * into v_list;
  update public.tasks set space_id=p_space_id, created_by=coalesce(created_by,user_id),
    updated_by=v_user, collaboration_version=collaboration_version+1,
    updated_at=clock_timestamp() where list_id=p_list_id and deleted_at is null;
  perform public.collab_emit(p_space_id, 'list.linked', 'list', p_list_id, jsonb_build_object('version',v_list.collaboration_version), true);
  v_result := jsonb_build_object('list_id',p_list_id,'space_id',p_space_id,'version',v_list.collaboration_version);
  return public.collab_store_receipt('link_list_to_space',p_client_mutation_id,v_result);
end $$;

-- Versioned shared-list creation/rename/reorder/icon mutation. Clients generate
-- list UUIDs locally so offline queue retries can use the same idempotency key.
create or replace function public.mutate_shared_list(
  p_space_id uuid,p_list_id uuid,p_patch jsonb,
  p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_user uuid:=public.collab_require_user(); v_prior jsonb; v_list public.lists%rowtype;
  v_is_create boolean:=false; v_bad_key text; v_result jsonb;
begin
  v_prior:=public.collab_receipt('mutate_shared_list',p_client_mutation_id);
  if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  if coalesce(public.collab_role(p_space_id),'') not in ('owner','editor') then
    raise exception using errcode='42501',message='editor role required';
  end if;
  if p_list_id is null or p_client_mutation_id is null then
    raise exception using errcode='22004',message='list_id and client_mutation_id are required';
  end if;
  if jsonb_typeof(coalesce(p_patch,'{}'::jsonb))<>'object' then
    raise exception using errcode='22023',message='patch must be an object';
  end if;
  select key into v_bad_key from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) key
   where key not in ('name','order_index','icon') limit 1;
  if v_bad_key is not null then
    raise exception using errcode='22023',message='patch field is not allowed: '||v_bad_key;
  end if;

  select * into v_list from public.lists where id=p_list_id for update;
  v_is_create:=not found;
  if v_is_create then
    if p_expected_version is distinct from 0 then
      raise exception using errcode='40001',message='new list expected version must be zero';
    end if;
    if nullif(btrim(p_patch->>'name'),'') is null then
      raise exception using errcode='23514',message='name is required';
    end if;
    insert into public.lists(id,user_id,name,order_index,icon,space_id,created_by,collaboration_version,updated_at)
    values(p_list_id,v_user,btrim(p_patch->>'name'),(p_patch->>'order_index')::integer,
      nullif(btrim(p_patch->>'icon'),''),p_space_id,v_user,1,clock_timestamp())
    returning * into v_list;
  else
    if v_list.space_id is distinct from p_space_id then
      raise exception using errcode='42501',message='list belongs to another space';
    end if;
    if v_list.collaboration_version is distinct from p_expected_version then
      raise exception using errcode='40001',message='list version conflict';
    end if;
    update public.lists set
      name=case when p_patch?'name' then btrim(p_patch->>'name') else name end,
      order_index=case when p_patch?'order_index' then (p_patch->>'order_index')::integer else order_index end,
      icon=case when p_patch?'icon' then nullif(btrim(p_patch->>'icon'),'') else icon end,
      collaboration_version=collaboration_version+1,updated_at=clock_timestamp()
    where id=p_list_id returning * into v_list;
    if nullif(btrim(v_list.name),'') is null then
      raise exception using errcode='23514',message='name cannot be empty';
    end if;
  end if;

  perform public.collab_emit(p_space_id,
    case when v_is_create then 'list.created' else 'list.updated' end,
    'list',v_list.id,jsonb_build_object('version',v_list.collaboration_version,'patch',p_patch),true);
  v_result:=jsonb_build_object('list',to_jsonb(v_list),'created',v_is_create);
  return public.collab_store_receipt('mutate_shared_list',p_client_mutation_id,v_result);
end $$;

-- The trailing username argument extends the existing RPC without exposing a
-- profile search endpoint. Drop only the prior overload on migration replay.
drop function if exists public.create_space_invite(uuid,text,timestamptz,uuid,text,uuid);
create or replace function public.create_space_invite(
  p_space_id uuid, p_role text, p_expires_at timestamptz, p_client_mutation_id uuid,
  p_invitee_email text default null, p_invited_user_id uuid default null,
  p_invitee_username text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_user uuid := public.collab_require_user(); v_prior jsonb; v_raw text; v_hash bytea;
  v_username_target uuid; v_username_matches bigint; v_target_user uuid;
  v_invite public.space_invites%rowtype;
  v_activity bigint; v_result jsonb;
begin
  v_prior := public.collab_receipt('create_space_invite',p_client_mutation_id);
  -- The raw secret is absent from receipts, activity, and storage. It is only
  -- returned on the first successful call; retries deliberately return NULL.
  if v_prior is not null then return v_prior || jsonb_build_object('token',null,'replayed',true); end if;
  if coalesce(public.collab_role(p_space_id),'') <> 'owner' then raise exception using errcode='42501', message='owner role required'; end if;
  if p_role not in ('editor','viewer') then raise exception using errcode='22023', message='invalid invite role'; end if;
  if p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '30 days' then
    raise exception using errcode='22023', message='expiry must be within 30 days';
  end if;

  if nullif(btrim(p_invitee_username),'') is not null then
    select count(*), (array_agg(p.id order by p.id))[1]
      into v_username_matches,v_username_target
    from public.profiles p
    where lower(p.username)=lower(btrim(p_invitee_username));
    if v_username_matches<>1 then
      raise exception using errcode='P0002',message='invite target not found or not unique';
    end if;
    if p_invited_user_id is not null and p_invited_user_id<>v_username_target then
      raise exception using errcode='22023',message='invite targets do not match';
    end if;
  end if;
  v_target_user:=coalesce(p_invited_user_id,v_username_target);
  if nullif(btrim(p_invitee_email),'') is null and v_target_user is null then
    raise exception using errcode='22004', message='invite target required';
  end if;

  v_raw := pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
  v_hash := extensions.digest(pg_catalog.convert_to(v_raw,'UTF8'),'sha256');
  insert into public.space_invites(space_id,created_by,invitee_email,invited_user_id,role,token_hash,expires_at)
  values(p_space_id,v_user,lower(nullif(btrim(p_invitee_email),'')),v_target_user,p_role,v_hash,p_expires_at)
  returning * into v_invite;
  v_activity := public.collab_emit(p_space_id,'invite.created','invite',v_invite.id,jsonb_build_object('role',p_role,'expires_at',p_expires_at),false);
  if v_target_user is not null then
    insert into public.inbox_notifications(user_id,space_id,activity_id,kind,payload)
    values(v_target_user,p_space_id,v_activity,'invite.created',jsonb_build_object('invite_id',v_invite.id,'role',p_role,'expires_at',p_expires_at));
  end if;
  v_result := jsonb_build_object('invite_id',v_invite.id,'space_id',p_space_id,'role',p_role,'expires_at',p_expires_at);
  perform public.collab_store_receipt('create_space_invite',p_client_mutation_id,v_result);
  return v_result || jsonb_build_object('token',v_raw,'replayed',false);
end $$;

create or replace function public.accept_space_invite(
  p_token text, p_expected_version bigint, p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_user uuid := public.collab_require_user(); v_prior jsonb; v_invite public.space_invites%rowtype; v_email text; v_result jsonb;
begin
  v_prior := public.collab_receipt('accept_space_invite',p_client_mutation_id);
  if v_prior is not null then return v_prior || jsonb_build_object('replayed',true); end if;
  select i.* into v_invite from public.space_invites i
   where i.token_hash=extensions.digest(pg_catalog.convert_to(p_token,'UTF8'),'sha256')
     and exists(select 1 from public.spaces s where s.id=i.space_id and s.archived_at is null)
   for update of i;
  if not found then raise exception using errcode='22023', message='invalid invite'; end if;
  if v_invite.version is distinct from p_expected_version then raise exception using errcode='40001', message='invite version conflict'; end if;
  if v_invite.status <> 'pending' then raise exception using errcode='22023', message='invite is not pending'; end if;
  if v_invite.expires_at <= clock_timestamp() then
    update public.space_invites set status='expired',version=version+1 where id=v_invite.id;
    raise exception using errcode='22023', message='invite expired';
  end if;
  v_email := lower(coalesce(auth.jwt()->>'email',''));
  if v_invite.invited_user_id is not null and v_invite.invited_user_id <> v_user then raise exception using errcode='42501', message='invite belongs to another user'; end if;
  if v_invite.invitee_email is not null and lower(v_invite.invitee_email) <> v_email then raise exception using errcode='42501', message='invite email does not match'; end if;
  if exists(select 1 from public.space_members where space_id=v_invite.space_id and user_id=v_user) then
    raise exception using errcode='23505', message='user is already a space member';
  end if;
  insert into public.space_members(space_id,user_id,role) values(v_invite.space_id,v_user,v_invite.role);
  update public.space_invites set status='accepted',accepted_by=v_user,accepted_at=clock_timestamp(),version=version+1 where id=v_invite.id;
  perform public.collab_emit(v_invite.space_id,'member.joined','member',v_user,jsonb_build_object('role',v_invite.role),true);
  v_result:=jsonb_build_object('space_id',v_invite.space_id,'user_id',v_user,'role',v_invite.role);
  return public.collab_store_receipt('accept_space_invite',p_client_mutation_id,v_result);
end $$;

create or replace function public.revoke_space_invite(
  p_invite_id uuid,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_prior jsonb; v_i public.space_invites%rowtype; v_activity bigint; v_result jsonb;
begin
  perform public.collab_require_user();
  v_prior:=public.collab_receipt('revoke_space_invite',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  select * into v_i from public.space_invites where id=p_invite_id for update;
  if not found then raise exception using errcode='P0002',message='invite not found'; end if;
  if coalesce(public.collab_role(v_i.space_id),'')<>'owner' then raise exception using errcode='42501',message='owner role required'; end if;
  if v_i.version is distinct from p_expected_version then raise exception using errcode='40001',message='invite version conflict'; end if;
  if v_i.status<>'pending' then raise exception using errcode='22023',message='only pending invites can be revoked'; end if;
  update public.space_invites set status='revoked',revoked_at=clock_timestamp(),version=version+1 where id=p_invite_id returning * into v_i;
  v_activity:=public.collab_emit(v_i.space_id,'invite.revoked','invite',v_i.id,'{}'::jsonb,false);
  if v_i.invited_user_id is not null then
    insert into public.inbox_notifications(user_id,space_id,activity_id,kind,payload)
    values(v_i.invited_user_id,v_i.space_id,v_activity,'invite.revoked',jsonb_build_object('invite_id',v_i.id));
  end if;
  v_result:=jsonb_build_object('invite_id',v_i.id,'status',v_i.status,'version',v_i.version);
  return public.collab_store_receipt('revoke_space_invite',p_client_mutation_id,v_result);
end $$;

create or replace function public.change_space_member_role(
  p_space_id uuid,p_member_id uuid,p_role text,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_actor uuid:=public.collab_require_user(); v_prior jsonb; v_m public.space_members%rowtype; v_result jsonb;
begin
  v_prior:=public.collab_receipt('change_space_member_role',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  if coalesce(public.collab_role(p_space_id),'')<>'owner' then raise exception using errcode='42501',message='owner role required'; end if;
  if p_role not in ('editor','viewer') then raise exception using errcode='22023',message='use transfer_space_ownership for owner role'; end if;
  select * into v_m from public.space_members where space_id=p_space_id and user_id=p_member_id for update;
  if not found then raise exception using errcode='P0002',message='member not found'; end if;
  if v_m.version is distinct from p_expected_version then raise exception using errcode='40001',message='member version conflict'; end if;
  if v_m.role='owner' then raise exception using errcode='42501',message='owner role can only change through ownership transfer'; end if;
  update public.space_members set role=p_role,version=version+1,updated_at=clock_timestamp()
   where space_id=p_space_id and user_id=p_member_id returning * into v_m;
  perform public.collab_emit(p_space_id,'member.role_changed','member',p_member_id,jsonb_build_object('role',p_role),true);
  v_result:=jsonb_build_object('space_id',p_space_id,'user_id',p_member_id,'role',p_role,'version',v_m.version);
  return public.collab_store_receipt('change_space_member_role',p_client_mutation_id,v_result);
end $$;

create or replace function public.remove_space_member(
  p_space_id uuid,p_member_id uuid,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_actor uuid:=public.collab_require_user(); v_prior jsonb; v_m public.space_members%rowtype; v_result jsonb;
begin
  v_prior:=public.collab_receipt('remove_space_member',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  if coalesce(public.collab_role(p_space_id),'')<>'owner' then raise exception using errcode='42501',message='owner role required'; end if;
  if p_member_id=v_actor then raise exception using errcode='22023',message='use leave_space to remove yourself'; end if;
  select * into v_m from public.space_members where space_id=p_space_id and user_id=p_member_id for update;
  if not found then raise exception using errcode='P0002',message='member not found'; end if;
  if v_m.version is distinct from p_expected_version then raise exception using errcode='40001',message='member version conflict'; end if;
  if v_m.role='owner' then raise exception using errcode='42501',message='transfer ownership before removal'; end if;
  update public.tasks set assigned_to=null,updated_by=v_actor,
    collaboration_version=collaboration_version+1,updated_at=clock_timestamp()
   where space_id=p_space_id and assigned_to=p_member_id and deleted_at is null;
  delete from public.space_members where space_id=p_space_id and user_id=p_member_id;
  perform public.collab_emit(p_space_id,'member.removed','member',p_member_id,'{}'::jsonb,true);
  v_result:=jsonb_build_object('space_id',p_space_id,'user_id',p_member_id,'removed',true);
  return public.collab_store_receipt('remove_space_member',p_client_mutation_id,v_result);
end $$;

create or replace function public.leave_space(
  p_space_id uuid,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_user uuid:=public.collab_require_user(); v_prior jsonb; v_m public.space_members%rowtype; v_owners integer; v_result jsonb;
begin
  v_prior:=public.collab_receipt('leave_space',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  perform 1 from public.spaces where id=p_space_id for update;
  select * into v_m from public.space_members where space_id=p_space_id and user_id=v_user for update;
  if not found then raise exception using errcode='P0002',message='membership not found'; end if;
  if v_m.version is distinct from p_expected_version then raise exception using errcode='40001',message='member version conflict'; end if;
  if v_m.role='owner' then
    select count(*) into v_owners from public.space_members where space_id=p_space_id and role='owner';
    if v_owners<=1 then raise exception using errcode='23514',message='final owner cannot leave'; end if;
  end if;
  update public.tasks set assigned_to=null,updated_by=v_user,
    collaboration_version=collaboration_version+1,updated_at=clock_timestamp()
   where space_id=p_space_id and assigned_to=v_user and deleted_at is null;
  delete from public.space_members where space_id=p_space_id and user_id=v_user;
  perform public.collab_emit(p_space_id,'member.left','member',v_user,'{}'::jsonb,true);
  v_result:=jsonb_build_object('space_id',p_space_id,'left',true);
  return public.collab_store_receipt('leave_space',p_client_mutation_id,v_result);
end $$;

create or replace function public.transfer_space_ownership(
  p_space_id uuid,p_new_owner_id uuid,p_expected_space_version bigint,p_expected_member_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_user uuid:=public.collab_require_user(); v_prior jsonb; v_s public.spaces%rowtype; v_target public.space_members%rowtype; v_result jsonb;
begin
  v_prior:=public.collab_receipt('transfer_space_ownership',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  select * into v_s from public.spaces where id=p_space_id for update;
  if not found then raise exception using errcode='P0002',message='space not found'; end if;
  if v_s.version is distinct from p_expected_space_version then raise exception using errcode='40001',message='space version conflict'; end if;
  if coalesce(public.collab_role(p_space_id),'')<>'owner' then raise exception using errcode='42501',message='owner role required'; end if;
  if p_new_owner_id=v_user then raise exception using errcode='22023',message='new owner must be another member'; end if;
  select * into v_target from public.space_members where space_id=p_space_id and user_id=p_new_owner_id for update;
  if not found then raise exception using errcode='P0002',message='new owner is not a member'; end if;
  if v_target.version is distinct from p_expected_member_version then raise exception using errcode='40001',message='member version conflict'; end if;
  update public.space_members set role='editor',version=version+1,updated_at=clock_timestamp() where space_id=p_space_id and user_id=v_user;
  update public.space_members set role='owner',version=version+1,updated_at=clock_timestamp() where space_id=p_space_id and user_id=p_new_owner_id;
  update public.spaces set version=version+1,updated_at=clock_timestamp() where id=p_space_id returning * into v_s;
  perform public.collab_emit(p_space_id,'ownership.transferred','member',p_new_owner_id,jsonb_build_object('previous_owner',v_user),true);
  v_result:=jsonb_build_object('space_id',p_space_id,'owner_id',p_new_owner_id,'version',v_s.version);
  return public.collab_store_receipt('transfer_space_ownership',p_client_mutation_id,v_result);
end $$;

-- Online-only administrative mutation: clients must not enqueue this RPC for
-- offline replay because it verifies the final-owner invariant at execution.
create or replace function public.archive_space(
  p_space_id uuid,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_user uuid:=public.collab_require_user(); v_prior jsonb; v_s public.spaces%rowtype;
  v_owner_count integer; v_result jsonb;
begin
  v_prior:=public.collab_receipt('archive_space',p_client_mutation_id);
  if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  select * into v_s from public.spaces where id=p_space_id for update;
  if not found then raise exception using errcode='P0002',message='space not found'; end if;
  if v_s.version is distinct from p_expected_version then
    raise exception using errcode='40001',message='space version conflict';
  end if;
  if v_s.archived_at is not null then
    raise exception using errcode='22023',message='space is already archived';
  end if;
  if not exists(select 1 from public.space_members
    where space_id=p_space_id and user_id=v_user and role='owner') then
    raise exception using errcode='42501',message='owner role required';
  end if;
  select count(*) into v_owner_count from public.space_members
   where space_id=p_space_id and role='owner';
  if v_owner_count<>1 then
    raise exception using errcode='23514',message='archive requires the final sole owner';
  end if;
  update public.spaces set archived_at=clock_timestamp(),archived_by=v_user,
    version=version+1,updated_at=clock_timestamp()
   where id=p_space_id returning * into v_s;
  perform public.collab_emit(p_space_id,'space.archived','space',p_space_id,
    jsonb_build_object('version',v_s.version,'archived_at',v_s.archived_at),true);
  v_result:=jsonb_build_object('space_id',p_space_id,'archived',true,
    'archived_at',v_s.archived_at,'archived_by',v_user,'version',v_s.version);
  return public.collab_store_receipt('archive_space',p_client_mutation_id,v_result);
end $$;

create or replace function public.mutate_shared_task(
  p_space_id uuid,p_task_id uuid,p_list_id uuid,p_patch jsonb,
  p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_user uuid:=public.collab_require_user(); v_prior jsonb; v_task public.tasks%rowtype;
  v_old_completed boolean:=false; v_is_create boolean:=false; v_target_list uuid;
  v_assignee uuid; v_xp_recipient uuid; v_bad_key text; v_xp_inserted integer; v_result jsonb;
  v_subtasks jsonb:='[]'::jsonb;
begin
  v_prior:=public.collab_receipt('mutate_shared_task',p_client_mutation_id);
  if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  if coalesce(public.collab_role(p_space_id),'') not in ('owner','editor') then raise exception using errcode='42501',message='editor role required'; end if;
  if p_task_id is null or p_client_mutation_id is null then raise exception using errcode='22004',message='task_id and client_mutation_id are required'; end if;
  if jsonb_typeof(coalesce(p_patch,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='patch must be an object'; end if;
  if coalesce(p_patch,'{}'::jsonb)='{}'::jsonb then raise exception using errcode='22023',message='patch must contain at least one field'; end if;
  select key into v_bad_key from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) key
   where key not in ('title','is_completed','completed_at','is_important','due_date','reminder_time','repeat_rule','quadrant','priority','added_to_today','order_index','list_id','assigned_to','notes','subtasks') limit 1;
  if v_bad_key is not null then raise exception using errcode='22023',message='patch field is not allowed: '||v_bad_key; end if;
  if p_patch?'notes' and char_length(coalesce(p_patch->>'notes',''))>20000 then
    raise exception using errcode='23514',message='notes exceed 20000 characters';
  end if;
  if p_patch?'subtasks' then
    if jsonb_typeof(p_patch->'subtasks')<>'array' then
      raise exception using errcode='22023',message='subtasks must be an array';
    end if;
    if jsonb_array_length(p_patch->'subtasks')>200 then
      raise exception using errcode='23514',message='subtasks exceed 200 items';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_patch->'subtasks') item
      where jsonb_typeof(item)<>'object'
        or nullif(btrim(item->>'id'),'') is null
        or nullif(btrim(item->>'title'),'') is null
        or char_length(item->>'title')>500
        or (item?'is_completed' and jsonb_typeof(item->'is_completed')<>'boolean')
    ) then
      raise exception using errcode='22023',message='each subtask requires an id, title, and optional boolean is_completed';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',btrim(item->>'id'),
      'title',btrim(item->>'title'),
      'is_completed',coalesce((item->>'is_completed')::boolean,false)
    ) order by ordinal),'[]'::jsonb)
    into v_subtasks
    from jsonb_array_elements(p_patch->'subtasks') with ordinality as entries(item,ordinal);
  end if;

  select * into v_task from public.tasks where id=p_task_id for update;
  v_is_create:=not found;
  if v_is_create then
    if p_expected_version is distinct from 0 then raise exception using errcode='40001',message='new task expected version must be zero'; end if;
    v_target_list:=coalesce((p_patch->>'list_id')::uuid,p_list_id);
  else
    if v_task.space_id<>p_space_id then raise exception using errcode='42501',message='task belongs to another space'; end if;
    if v_task.deleted_at is not null then raise exception using errcode='55000',message='deleted tasks cannot be mutated'; end if;
    if v_task.collaboration_version is distinct from p_expected_version then raise exception using errcode='40001',message='task version conflict'; end if;
    v_old_completed:=coalesce(v_task.is_completed,false);
    v_target_list:=case when p_patch?'list_id' then (p_patch->>'list_id')::uuid else v_task.list_id end;
  end if;
  if v_target_list is null or not exists(select 1 from public.lists where id=v_target_list and space_id=p_space_id) then
    raise exception using errcode='23503',message='target list is not in this space';
  end if;
  v_assignee:=case when p_patch?'assigned_to' then (p_patch->>'assigned_to')::uuid else case when v_is_create then null else v_task.assigned_to end end;
  if v_assignee is not null and not exists(select 1 from public.space_members where space_id=p_space_id and user_id=v_assignee) then
    raise exception using errcode='23503',message='assignee is not an active space member';
  end if;

  if v_is_create then
    if nullif(btrim(p_patch->>'title'),'') is null then raise exception using errcode='23514',message='title is required'; end if;
    insert into public.tasks(
      id,user_id,title,is_completed,completed_at,is_important,due_date,reminder_time,
      repeat_rule,quadrant,priority,list_id,added_to_today,order_index,notes,subtasks,
      space_id,assigned_to,created_by,updated_by,collaboration_version,updated_at)
    values(
      p_task_id,v_user,btrim(p_patch->>'title'),coalesce((p_patch->>'is_completed')::boolean,false),
      case when coalesce((p_patch->>'is_completed')::boolean,false)
        then coalesce((p_patch->>'completed_at')::timestamptz,clock_timestamp()) else null end,
      coalesce((p_patch->>'is_important')::boolean,false),
      (p_patch->>'due_date')::timestamptz,(p_patch->>'reminder_time')::timestamptz,
      p_patch->>'repeat_rule',p_patch->>'quadrant',coalesce((p_patch->>'priority')::integer,1),
      v_target_list,coalesce((p_patch->>'added_to_today')::boolean,false),(p_patch->>'order_index')::integer,
      nullif(p_patch->>'notes',''),case when p_patch?'subtasks' then v_subtasks else '[]'::jsonb end,
      p_space_id,v_assignee,v_user,v_user,1,clock_timestamp()) returning * into v_task;
  else
    update public.tasks set
      title=case when p_patch?'title' then btrim(p_patch->>'title') else title end,
      is_completed=case when p_patch?'is_completed' then (p_patch->>'is_completed')::boolean else is_completed end,
      completed_at=case
        when p_patch?'is_completed' then case
          when (p_patch->>'is_completed')::boolean
            then coalesce((p_patch->>'completed_at')::timestamptz,completed_at,clock_timestamp())
          else null end
        when p_patch?'completed_at' then (p_patch->>'completed_at')::timestamptz
        else completed_at end,
      is_important=case when p_patch?'is_important' then (p_patch->>'is_important')::boolean else is_important end,
      due_date=case when p_patch?'due_date' then (p_patch->>'due_date')::timestamptz else due_date end,
      reminder_time=case when p_patch?'reminder_time' then (p_patch->>'reminder_time')::timestamptz else reminder_time end,
      repeat_rule=case when p_patch?'repeat_rule' then p_patch->>'repeat_rule' else repeat_rule end,
      quadrant=case when p_patch?'quadrant' then p_patch->>'quadrant' else quadrant end,
      priority=case when p_patch?'priority' then (p_patch->>'priority')::integer else priority end,
      added_to_today=case when p_patch?'added_to_today' then (p_patch->>'added_to_today')::boolean else added_to_today end,
      order_index=case when p_patch?'order_index' then (p_patch->>'order_index')::integer else order_index end,
      notes=case when p_patch?'notes' then nullif(p_patch->>'notes','') else notes end,
      subtasks=case when p_patch?'subtasks' then v_subtasks else subtasks end,
      list_id=v_target_list,assigned_to=v_assignee,updated_by=v_user,
      collaboration_version=collaboration_version+1,updated_at=clock_timestamp()
    where id=p_task_id and deleted_at is null returning * into v_task;
    if not found then raise exception using errcode='55000',message='deleted tasks cannot be mutated'; end if;
    if nullif(btrim(v_task.title),'') is null then raise exception using errcode='23514',message='title cannot be empty'; end if;
  end if;

  -- First-completion XP belongs to the assignee when one is present, otherwise
  -- to the completing actor. The receipt makes this server-side award once-only
  -- across retries and later uncomplete/recomplete cycles.
  if coalesce(v_task.is_completed,false) and not v_old_completed then
    v_xp_recipient:=coalesce(v_task.assigned_to,v_user);
    insert into public.task_xp_award_receipts(task_id,user_id,xp_amount,client_mutation_id)
      values(v_task.id,v_xp_recipient,10,p_client_mutation_id) on conflict do nothing;
    get diagnostics v_xp_inserted=row_count;
    if v_xp_inserted=1 then
      update public.profiles set
        xp=greatest(0,coalesce(xp,0)+10),
        level=public.level_from_xp(greatest(0,coalesce(xp,0)+10))
      where id=v_xp_recipient;
      if not found then
        raise exception using errcode='23503',message='XP recipient profile not found';
      end if;
    end if;
  end if;
  perform public.collab_emit(p_space_id,case when v_is_create then 'task.created' else 'task.updated' end,'task',v_task.id,
    jsonb_build_object('version',v_task.collaboration_version,'patch',p_patch),true);
  v_result:=jsonb_build_object('task',to_jsonb(v_task),'created',v_is_create);
  return public.collab_store_receipt('mutate_shared_task',p_client_mutation_id,v_result);
end $$;

create or replace function public.delete_shared_task(
  p_task_id uuid,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_user uuid:=public.collab_require_user(); v_prior jsonb; v_task public.tasks%rowtype; v_result jsonb;
begin
  v_prior:=public.collab_receipt('delete_shared_task',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found or v_task.space_id is null then raise exception using errcode='P0002',message='shared task not found'; end if;
  if v_task.deleted_at is not null then raise exception using errcode='55000',message='shared task is already deleted'; end if;
  if coalesce(public.collab_role(v_task.space_id),'') not in ('owner','editor') then raise exception using errcode='42501',message='editor role required'; end if;
  if v_task.collaboration_version is distinct from p_expected_version then raise exception using errcode='40001',message='task version conflict'; end if;
  update public.tasks set deleted_at=clock_timestamp(),deleted_by=v_user,updated_by=v_user,
    collaboration_version=collaboration_version+1,updated_at=clock_timestamp()
   where id=p_task_id and deleted_at is null returning * into v_task;
  if not found then raise exception using errcode='55000',message='shared task is already deleted'; end if;
  insert into public.collaboration_tombstones(space_id,entity_type,entity_id,deleted_by,last_version,snapshot,deleted_at)
    values(v_task.space_id,'task',v_task.id,v_user,v_task.collaboration_version,to_jsonb(v_task),v_task.deleted_at)
    on conflict(space_id,entity_type,entity_id) do update set deleted_by=excluded.deleted_by,
      last_version=excluded.last_version,snapshot=excluded.snapshot,deleted_at=excluded.deleted_at;
  perform public.collab_emit(v_task.space_id,'task.deleted','task',v_task.id,
    jsonb_build_object('version',v_task.collaboration_version,'deleted_at',v_task.deleted_at),true);
  v_result:=jsonb_build_object('task_id',v_task.id,'deleted',true,
    'deleted_at',v_task.deleted_at,'last_version',v_task.collaboration_version);
  return public.collab_store_receipt('delete_shared_task',p_client_mutation_id,v_result);
end $$;

-- Extract @username handles, require every handle to resolve to exactly one
-- active member of the comment's space, and return the authoritative user IDs.
create or replace function public.collab_comment_mention_ids(p_space_id uuid,p_body text)
returns uuid[] language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare v_handles text[]:='{}'::text[]; v_users uuid[]:='{}'::uuid[];
begin
  select coalesce(array_agg(distinct lower((m.captures)[2])),'{}'::text[])
  into v_handles
  from pg_catalog.regexp_matches(
    coalesce(p_body,''),
    '(^|[^[:alnum:]_])@([[:alnum:]_.-]{3,32})',
    'g'
  ) as m(captures);
  if cardinality(v_handles)=0 then return v_users; end if;

  select coalesce(array_agg(distinct p.id),'{}'::uuid[])
  into v_users
  from public.profiles p
  join public.space_members sm on sm.user_id=p.id and sm.space_id=p_space_id
  where lower(p.username)=any(v_handles);

  if cardinality(v_users)<>cardinality(v_handles) then
    raise exception using errcode='23503',message='mentions must reference active space member usernames';
  end if;
  return v_users;
end $$;

revoke all on function public.collab_comment_mention_ids(uuid,text) from public,anon,authenticated;
grant execute on function public.collab_comment_mention_ids(uuid,text) to service_role;

create or replace function public.add_task_comment(
  p_comment_id uuid,p_task_id uuid,p_body text,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_user uuid:=public.collab_require_user(); v_prior jsonb; v_task public.tasks%rowtype;
  v_c public.task_comments%rowtype; v_mentions uuid[]:='{}'::uuid[];
  v_activity bigint; v_payload jsonb; v_result jsonb;
begin
  v_prior:=public.collab_receipt('add_task_comment',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  select * into v_task from public.tasks where id=p_task_id and space_id is not null and deleted_at is null for share;
  if not found then raise exception using errcode='P0002',message='shared task not found'; end if;
  if coalesce(public.collab_role(v_task.space_id),'') not in ('owner','editor') then raise exception using errcode='42501',message='editor role required to comment'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 4000 then raise exception using errcode='23514',message='comment must contain 1 to 4000 characters'; end if;
  v_mentions:=public.collab_comment_mention_ids(v_task.space_id,p_body);

  insert into public.task_comments(id,space_id,task_id,author_id,body)
   values(p_comment_id,v_task.space_id,p_task_id,v_user,btrim(p_body)) returning * into v_c;
  insert into public.task_comment_mentions(comment_id,space_id,user_id)
    select v_c.id,v_c.space_id,mentioned_user from unnest(v_mentions) mentioned_user;

  v_payload:=jsonb_build_object(
    'task_id',p_task_id,'comment_id',v_c.id,'body',left(v_c.body,240),
    'entity_type','comment','entity_id',v_c.id);
  v_activity:=public.collab_emit(v_task.space_id,'comment.created','comment',v_c.id,v_payload,false);
  insert into public.inbox_notifications(user_id,space_id,activity_id,kind,payload)
    select m.user_id,v_task.space_id,v_activity,'comment.created',v_payload
    from public.space_members m
    where m.space_id=v_task.space_id and m.user_id<>v_user
      and not (m.user_id=any(v_mentions));
  insert into public.inbox_notifications(user_id,space_id,activity_id,kind,payload)
    select mentioned_user,v_task.space_id,v_activity,'comment.mentioned',
      v_payload||jsonb_build_object('mentioned',true)
    from unnest(v_mentions) mentioned_user where mentioned_user<>v_user;

  v_result:=jsonb_build_object('comment',to_jsonb(v_c),'mentioned_user_ids',to_jsonb(v_mentions));
  return public.collab_store_receipt('add_task_comment',p_client_mutation_id,v_result);
end $$;

create or replace function public.edit_task_comment(
  p_comment_id uuid,p_body text,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_user uuid:=public.collab_require_user(); v_prior jsonb; v_c public.task_comments%rowtype;
  v_old_mentions uuid[]:='{}'::uuid[]; v_mentions uuid[]:='{}'::uuid[]; v_new_mentions uuid[]:='{}'::uuid[];
  v_activity bigint; v_payload jsonb; v_result jsonb;
begin
  v_prior:=public.collab_receipt('edit_task_comment',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  select * into v_c from public.task_comments where id=p_comment_id for update;
  if not found then raise exception using errcode='P0002',message='comment not found'; end if;
  if v_c.author_id<>v_user then raise exception using errcode='42501',message='only the author may edit a comment'; end if;
  if coalesce(public.collab_role(v_c.space_id),'') not in ('owner','editor') then raise exception using errcode='42501',message='editor role required to edit comments'; end if;
  if v_c.version is distinct from p_expected_version then raise exception using errcode='40001',message='comment version conflict'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 4000 then raise exception using errcode='23514',message='comment must contain 1 to 4000 characters'; end if;

  select coalesce(array_agg(user_id),'{}'::uuid[]) into v_old_mentions
    from public.task_comment_mentions where comment_id=p_comment_id;
  v_mentions:=public.collab_comment_mention_ids(v_c.space_id,p_body);
  select coalesce(array_agg(candidate),'{}'::uuid[]) into v_new_mentions
    from unnest(v_mentions) candidate where not (candidate=any(v_old_mentions));

  update public.task_comments set body=btrim(p_body),version=version+1,updated_at=clock_timestamp()
    where id=p_comment_id returning * into v_c;
  delete from public.task_comment_mentions where comment_id=p_comment_id;
  insert into public.task_comment_mentions(comment_id,space_id,user_id)
    select v_c.id,v_c.space_id,mentioned_user from unnest(v_mentions) mentioned_user;

  v_payload:=jsonb_build_object(
    'task_id',v_c.task_id,'comment_id',v_c.id,'body',left(v_c.body,240),
    'version',v_c.version,'entity_type','comment','entity_id',v_c.id);
  v_activity:=public.collab_emit(v_c.space_id,'comment.updated','comment',v_c.id,v_payload,false);
  insert into public.inbox_notifications(user_id,space_id,activity_id,kind,payload)
    select m.user_id,v_c.space_id,v_activity,'comment.updated',v_payload
    from public.space_members m
    where m.space_id=v_c.space_id and m.user_id<>v_user
      and not (m.user_id=any(v_new_mentions));
  insert into public.inbox_notifications(user_id,space_id,activity_id,kind,payload)
    select mentioned_user,v_c.space_id,v_activity,'comment.mentioned',
      v_payload||jsonb_build_object('mentioned',true)
    from unnest(v_new_mentions) mentioned_user where mentioned_user<>v_user;

  v_result:=jsonb_build_object('comment',to_jsonb(v_c),'mentioned_user_ids',to_jsonb(v_mentions));
  return public.collab_store_receipt('edit_task_comment',p_client_mutation_id,v_result);
end $$;

create or replace function public.delete_task_comment(
  p_comment_id uuid,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_user uuid:=public.collab_require_user(); v_prior jsonb; v_c public.task_comments%rowtype; v_result jsonb; v_role text;
begin
  v_prior:=public.collab_receipt('delete_task_comment',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  select * into v_c from public.task_comments where id=p_comment_id for update;
  if not found then raise exception using errcode='P0002',message='comment not found'; end if;
  v_role:=coalesce(public.collab_role(v_c.space_id),'');
  if v_role not in ('owner','editor') then raise exception using errcode='42501',message='editor role required to delete comments'; end if;
  if v_c.author_id<>v_user and v_role<>'owner' then raise exception using errcode='42501',message='author or owner required'; end if;
  if v_c.version is distinct from p_expected_version then raise exception using errcode='40001',message='comment version conflict'; end if;
  insert into public.collaboration_tombstones(space_id,entity_type,entity_id,deleted_by,last_version,snapshot)
   values(v_c.space_id,'comment',v_c.id,v_user,v_c.version,to_jsonb(v_c))
   on conflict(space_id,entity_type,entity_id) do update set deleted_by=excluded.deleted_by,last_version=excluded.last_version,snapshot=excluded.snapshot,deleted_at=clock_timestamp();
  delete from public.task_comments where id=p_comment_id;
  perform public.collab_emit(v_c.space_id,'comment.deleted','comment',v_c.id,jsonb_build_object('task_id',v_c.task_id,'version',v_c.version),true);
  v_result:=jsonb_build_object('comment_id',v_c.id,'deleted',true,'last_version',v_c.version);
  return public.collab_store_receipt('delete_task_comment',p_client_mutation_id,v_result);
end $$;

create or replace function public.mark_notification_read(
  p_notification_id uuid,p_expected_version bigint,p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_user uuid:=public.collab_require_user(); v_prior jsonb; v_n public.inbox_notifications%rowtype; v_result jsonb;
begin
  v_prior:=public.collab_receipt('mark_notification_read',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  select * into v_n from public.inbox_notifications where id=p_notification_id and user_id=v_user for update;
  if not found then raise exception using errcode='P0002',message='notification not found'; end if;
  if v_n.version is distinct from p_expected_version then raise exception using errcode='40001',message='notification version conflict'; end if;
  update public.inbox_notifications set read_at=coalesce(read_at,clock_timestamp()),version=version+1 where id=p_notification_id returning * into v_n;
  v_result:=jsonb_build_object('notification_id',v_n.id,'read_at',v_n.read_at,'version',v_n.version);
  return public.collab_store_receipt('mark_notification_read',p_client_mutation_id,v_result);
end $$;

create or replace function public.mark_all_notifications_read(p_client_mutation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_user uuid:=public.collab_require_user(); v_prior jsonb; v_count integer; v_result jsonb;
begin
  v_prior:=public.collab_receipt('mark_all_notifications_read',p_client_mutation_id); if v_prior is not null then return v_prior||jsonb_build_object('replayed',true); end if;
  perform 1 from public.inbox_notifications where user_id=v_user and read_at is null for update;
  update public.inbox_notifications set read_at=clock_timestamp(),version=version+1 where user_id=v_user and read_at is null;
  get diagnostics v_count=row_count;
  v_result:=jsonb_build_object('marked_read',v_count);
  return public.collab_store_receipt('mark_all_notifications_read',p_client_mutation_id,v_result);
end $$;

-- Owner-only invite metadata reader. The projection is deliberately explicit:
-- token_hash and the one-time raw invite token can never enter this result.
create or replace function public.get_space_invites(p_space_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  perform public.collab_require_user();
  if coalesce(public.collab_role(p_space_id),'')<>'owner' then
    raise exception using errcode='42501',message='owner role required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'space_id',i.space_id,'created_by',i.created_by,
    'invitee_email',i.invitee_email,'invited_user_id',i.invited_user_id,
    'role',i.role,'status',i.status,'expires_at',i.expires_at,
    'version',i.version,'created_at',i.created_at,
    'username',p.username,'display_name',p.display_name
  ) order by i.created_at desc,i.id),'[]'::jsonb)
  into v_result
  from public.space_invites i
  left join public.profiles p on p.id=i.invited_user_id
  where i.space_id=p_space_id and i.status='pending';
  return v_result;
end $$;

create or replace function public.get_space_member_directory(p_space_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  perform public.collab_require_user();
  if not exists(select 1 from public.space_members
    where space_id=p_space_id and user_id=auth.uid()) then
    raise exception using errcode='42501',message='space membership required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'space_id',m.space_id,'user_id',m.user_id,'role',m.role,'version',m.version,'joined_at',m.joined_at,
    'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url
  ) order by case m.role when 'owner' then 1 when 'editor' then 2 else 3 end,lower(coalesce(p.display_name,p.username,'')),m.user_id),'[]'::jsonb)
  into v_result from public.space_members m join public.profiles p on p.id=m.user_id where m.space_id=p_space_id;
  return v_result;
end $$;

create or replace function public.get_space_task_changes(
  p_space_id uuid,p_since timestamptz default 'epoch',p_limit integer default 500)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare v_tasks jsonb; v_deleted jsonb; v_server_time timestamptz:=clock_timestamp(); v_limit integer:=least(greatest(coalesce(p_limit,500),1),1000);
begin
  perform public.collab_require_user();
  if not exists(select 1 from public.space_members
    where space_id=p_space_id and user_id=auth.uid()) then
    raise exception using errcode='42501',message='space membership required';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at,x.id),'[]'::jsonb) into v_tasks
  from (select t.* from public.tasks t where t.space_id=p_space_id and t.deleted_at is null
    and coalesce(t.updated_at,t.created_at)>=coalesce(p_since,'epoch'::timestamptz)
    order by coalesce(t.updated_at,t.created_at),t.id limit v_limit) x;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.deleted_at,d.id),'[]'::jsonb) into v_deleted
  from (select d.* from public.collaboration_tombstones d where d.space_id=p_space_id and d.entity_type='task'
    and d.deleted_at>=coalesce(p_since,'epoch'::timestamptz) order by d.deleted_at,d.id limit v_limit) d;
  return jsonb_build_object('space_id',p_space_id,'server_time',v_server_time,'tasks',v_tasks,'tombstones',v_deleted);
end $$;

-- Expose only the public RPC surface to authenticated clients.
revoke all on function public.create_space(text,uuid) from public,anon;
revoke all on function public.link_list_to_space(uuid,uuid,bigint,uuid) from public,anon;
revoke all on function public.mutate_shared_list(uuid,uuid,jsonb,bigint,uuid) from public,anon;
revoke all on function public.create_space_invite(uuid,text,timestamptz,uuid,text,uuid,text) from public,anon;
revoke all on function public.accept_space_invite(text,bigint,uuid) from public,anon;
revoke all on function public.revoke_space_invite(uuid,bigint,uuid) from public,anon;
revoke all on function public.change_space_member_role(uuid,uuid,text,bigint,uuid) from public,anon;
revoke all on function public.remove_space_member(uuid,uuid,bigint,uuid) from public,anon;
revoke all on function public.leave_space(uuid,bigint,uuid) from public,anon;
revoke all on function public.transfer_space_ownership(uuid,uuid,bigint,bigint,uuid) from public,anon;
revoke all on function public.archive_space(uuid,bigint,uuid) from public,anon;
revoke all on function public.mutate_shared_task(uuid,uuid,uuid,jsonb,bigint,uuid) from public,anon;
revoke all on function public.delete_shared_task(uuid,bigint,uuid) from public,anon;
revoke all on function public.add_task_comment(uuid,uuid,text,uuid) from public,anon;
revoke all on function public.edit_task_comment(uuid,text,bigint,uuid) from public,anon;
revoke all on function public.delete_task_comment(uuid,bigint,uuid) from public,anon;
revoke all on function public.mark_notification_read(uuid,bigint,uuid) from public,anon;
revoke all on function public.mark_all_notifications_read(uuid) from public,anon;
revoke all on function public.get_space_invites(uuid) from public,anon,authenticated;
revoke all on function public.get_space_member_directory(uuid) from public,anon;
revoke all on function public.get_space_task_changes(uuid,timestamptz,integer) from public,anon;

grant execute on function public.create_space(text,uuid),
 public.link_list_to_space(uuid,uuid,bigint,uuid),
 public.mutate_shared_list(uuid,uuid,jsonb,bigint,uuid),
 public.create_space_invite(uuid,text,timestamptz,uuid,text,uuid,text),
 public.accept_space_invite(text,bigint,uuid),
 public.revoke_space_invite(uuid,bigint,uuid),
 public.change_space_member_role(uuid,uuid,text,bigint,uuid),
 public.remove_space_member(uuid,uuid,bigint,uuid),
 public.leave_space(uuid,bigint,uuid),
 public.transfer_space_ownership(uuid,uuid,bigint,bigint,uuid),
 public.archive_space(uuid,bigint,uuid),
 public.mutate_shared_task(uuid,uuid,uuid,jsonb,bigint,uuid),
 public.delete_shared_task(uuid,bigint,uuid),
 public.add_task_comment(uuid,uuid,text,uuid),
 public.edit_task_comment(uuid,text,bigint,uuid),
 public.delete_task_comment(uuid,bigint,uuid),
 public.mark_notification_read(uuid,bigint,uuid),
 public.mark_all_notifications_read(uuid),
 public.get_space_invites(uuid),
 public.get_space_member_directory(uuid),
 public.get_space_task_changes(uuid,timestamptz,integer) to authenticated;

-- Realtime registration is guarded for projects where the publication is
-- absent or a table is already present. No deployment is performed here.
do $realtime$
declare v_table text;
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['spaces','space_members','task_comments','space_activity','inbox_notifications','collaboration_tombstones','lists','tasks'] loop
      if to_regclass('public.'||v_table) is not null and not exists(
        select 1 from pg_catalog.pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  else
    raise notice 'supabase_realtime publication is absent; collaboration tables were not added';
  end if;
end $realtime$;

comment on table public.spaces is 'Collaboration spaces. Archiving is an online-only final-owner RPC. Review 0016 in staging before production; keep unapplied 0011 held back.';
comment on column public.spaces.archived_at is 'Server timestamp set by archive_space; archived spaces are retained for member history.';
comment on column public.lists.created_by is 'Nullable creator attribution; legacy rows are backfilled from user_id when available.';
comment on column public.tasks.deleted_at is 'Soft-delete timestamp. Deleted shared tasks remain as retained tombstone source rows and cannot be mutated.';
comment on column public.tasks.deleted_by is 'Nullable actor that soft-deleted the task; guarded profile reference uses ON DELETE SET NULL.';
comment on table public.task_comments is 'Comments remain retained and readable with history when a shared task is soft-deleted; task deletion does not cascade because the task row remains.';
comment on table public.collaboration_mutation_receipts is 'Retry-idempotency receipts keyed by authenticated actor, operation, and UUID client mutation ID.';
comment on column public.space_invites.token_hash is 'SHA-256 digest of a 256-bit invite secret. Raw token is returned by create_space_invite once and is never stored, logged, or included in activity/receipts.';
comment on table public.collaboration_tombstones is 'Deletion feed for offline reconciliation. Tombstones and soft-deleted tasks are retained until a separately reviewed cleanup policy establishes a safe sync horizon.';

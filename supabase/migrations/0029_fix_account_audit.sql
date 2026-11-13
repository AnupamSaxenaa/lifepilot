-- ============================================================================
-- 0029 — Make the account-deletion audit resilient to unapplied migrations
-- ============================================================================
-- 0028's `audit_account_residue` hard-coded a UNION over every user table found
-- in the migration history. That fails outright with
--
--   ERROR 42P01: relation "public.alarm_history" does not exist
--
-- because `0011_alarm_system.sql` is deliberately never applied (see
-- docs/04-operations/02-backend-and-database.md), so `alarm_history` was only
-- ever a declaration. A single missing table made the whole audit unusable.
--
-- This version resolves each table with `to_regclass` first and reports absent
-- ones instead of aborting. That also makes it self-documenting: running it tells
-- you which tables this database actually has.
--
-- `public.delete_account` is NOT affected and is unchanged — it never referenced
-- alarm_history, relying on the auth.users cascade instead.
--
-- The return type changes, so the old function must be dropped rather than
-- replaced. Safe to run more than once.
-- ============================================================================

drop function if exists public.audit_account_residue(uuid);

create or replace function public.audit_account_residue(p_user uuid)
returns table (table_name text, row_count bigint, note text)
language plpgsql security definer set search_path = public
as $$
declare
  -- {table, where-clause}. The clause may reference $1 more than once, which is
  -- why this is a predicate rather than a bare column name.
  v_targets text[][] := array[
    ['auth.users',                       'id = $1'],
    ['public.profiles',                  'id = $1'],
    ['public.tasks',                     'user_id = $1'],
    ['public.lists',                     'user_id = $1'],
    ['public.alarms',                    'user_id = $1'],
    ['public.alarm_history',             'user_id = $1'],
    ['public.mindful_profiles',          'user_id = $1'],
    ['public.mindful_apps',              'user_id = $1'],
    ['public.focus_sessions',            'user_id = $1'],
    ['public.user_daily_stats',          'user_id = $1'],
    ['public.friendships',               'requester_id = $1 or addressee_id = $1'],
    ['public.presence_sessions',         'user_id = $1'],
    ['public.leaderboard_snapshots',     'user_id = $1'],
    ['public.feedback',                  'user_id = $1'],
    ['public.user_cosmetics',            'user_id = $1'],
    ['public.spaces',                    'created_by = $1'],
    ['public.space_members',             'user_id = $1'],
    ['public.space_invites',             'created_by = $1 or invited_user_id = $1'],
    ['public.task_comments',             'author_id = $1'],
    ['public.task_comment_mentions',     'user_id = $1'],
    ['public.inbox_notifications',       'user_id = $1'],
    ['public.collaboration_mutation_receipts', 'actor_id = $1'],
    ['public.task_xp_award_receipts',    'user_id = $1'],
    ['public.hustle_rooms',              'owner_id = $1'],
    ['public.hustle_room_members',       'user_id = $1'],
    ['public.hustle_room_messages',      'author_id = $1'],
    ['public.hustle_room_queue_items',   'user_id = $1'],
    ['public.hustle_room_breaks',        'user_id = $1'],
    ['public.hustle_room_callbacks',     'sender_id = $1 or recipient_id = $1'],
    ['public.hustle_room_mutation_receipts', 'actor_id = $1'],
    ['public.ad_grants',                 'user_id = $1'],
    ['public.billing_events',            'user_id = $1']
  ];
  v_table  text;
  v_clause text;
  v_count  bigint;
  i        integer;
begin
  if p_user is null then
    return;
  end if;

  for i in 1 .. array_length(v_targets, 1) loop
    v_table  := v_targets[i][1];
    v_clause := v_targets[i][2];

    -- Skip tables this database does not have (e.g. alarm_history while 0011
    -- remains unapplied) rather than failing the entire audit.
    if to_regclass(v_table) is null then
      return query select v_table, 0::bigint, 'table absent'::text;
      continue;
    end if;

    execute format('select count(*) from %s where %s', v_table, v_clause)
       into v_count
      using p_user;

    return query select
      v_table,
      v_count,
      case when v_count = 0 then 'clean' else 'RESIDUE' end::text;
  end loop;
end;
$$;

revoke all on function public.audit_account_residue(uuid) from public, anon, authenticated;
grant execute on function public.audit_account_residue(uuid) to service_role;

-- Convenience: audit by username, so callers do not have to look up a UUID and
-- cannot accidentally pass a username where a uuid is expected.
create or replace function public.audit_account_residue_by_username(p_username text)
returns table (table_name text, row_count bigint, note text)
language sql security definer set search_path = public
as $$
  select * from public.audit_account_residue(
    (select id from public.profiles where username = p_username)
  );
$$;

revoke all on function public.audit_account_residue_by_username(text)
  from public, anon, authenticated;
grant execute on function public.audit_account_residue_by_username(text) to service_role;

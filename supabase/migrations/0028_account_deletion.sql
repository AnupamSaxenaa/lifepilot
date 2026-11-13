-- ============================================================================
-- 0028 — Complete account deletion
-- ============================================================================
-- WHAT WAS WRONG
--
-- `deleteUserAccountData` in src/lib/dataManager.js deleted `tasks` and the
-- `profiles` row, plus three avatar blobs. It NEVER deleted the `auth.users`
-- row, so a user who "deleted" their account could sign straight back in, and
-- roughly thirty other tables kept their data. Google Play's User Data policy
-- treats that as a violation for any app offering account creation.
--
-- It would also have thrown outright for any user who had created a Space,
-- because `spaces.created_by` is ON DELETE RESTRICT (0016).
--
-- THE APPROACH
--
-- Most user tables already CASCADE from `auth.users` or `public.profiles`, so
-- the single most effective action is deleting the `auth.users` row — that alone
-- clears mindful_profiles, mindful_apps, focus_sessions, user_daily_stats,
-- friendships, presence_sessions, leaderboard_snapshots, hustle_rooms and all
-- their children, feedback, user_cosmetics, alarm_history, space_members,
-- space_invites, task_comments, task_comment_mentions, inbox_notifications,
-- and both mutation-receipt tables.
--
-- This function handles what CASCADE cannot:
--
--   1. RESTRICT on spaces.created_by — must be resolved first or the delete
--      fails. Ownership transfers to the longest-standing remaining member; a
--      space with no other members is deleted.
--   2. tasks/lists have NO declared FK on user_id (verified across all 27
--      migrations), so personal rows must be deleted explicitly.
--   3. billing_events and ad_grants have no FK at all.
--   4. collaboration_tombstones.snapshot holds a full copy of deleted task
--      content and only SET NULLs deleted_by.
--
-- THIRD-PARTY DATA, DELIBERATE CHOICES
--
--   • Shared content stays. A task or list with a space_id belongs to that
--     space's members, so it is UNLINKED (user_id set null) rather than deleted.
--     Erasing it would destroy other people's data.
--   • Tombstones are kept but their snapshot is emptied. Deleting the row would
--     let an already-deleted task reappear on another member's device on next
--     sync; emptying the snapshot removes the personal content and preserves
--     sync integrity.
--   • Hustle rooms owned by the user ARE deleted by cascade, taking other
--     members' messages and queue items in that room with them. Rooms are
--     short-lived focus sessions rather than durable shared workspaces, so this
--     is accepted rather than worked around. If rooms ever become long-lived,
--     revisit with the same transfer approach used for spaces.
--   • billing_events is ANONYMISED, not deleted. Purchase records are financial
--     history; nulling user_id removes the personal link while keeping revenue
--     accounting intact. Nothing in the row identifies a person afterwards.
--
-- STORAGE is not reachable from SQL. The `delete-account` edge function removes
-- objects under avatar/<uid>/ and feedback-attachments/<uid>/ before calling
-- this function.
--
-- SECURITY: service_role only. Callers cannot pass someone else's id, because
-- the edge function derives the id from the caller's verified JWT and never
-- from the request body.
--
-- Safe to run more than once (defining the function; the function itself is
-- naturally one-shot per user).
-- ============================================================================

create or replace function public.delete_account(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_space            record;
  v_heir             uuid;
  v_spaces_transferred integer := 0;
  v_spaces_deleted   integer := 0;
  v_tasks_deleted    integer := 0;
  v_tasks_unlinked   integer := 0;
  v_lists_deleted    integer := 0;
  v_lists_unlinked   integer := 0;
  v_alarms_deleted   integer := 0;
  v_ads_deleted      integer := 0;
  v_billing_anon     integer := 0;
  v_tombstones_wiped integer := 0;
  v_auth_deleted     integer := 0;
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user');
  end if;

  -- ── 1. Spaces created by this user (RESTRICT must be cleared first) ──────
  for v_space in
    select id from public.spaces where created_by = p_user
  loop
    -- Longest-standing remaining member inherits the space.
    select sm.user_id into v_heir
      from public.space_members sm
     where sm.space_id = v_space.id
       and sm.user_id <> p_user
     order by sm.joined_at asc
     limit 1;

    if v_heir is null then
      -- Nobody else is in it: deleting cascades this space's own children.
      delete from public.spaces where id = v_space.id;
      v_spaces_deleted := v_spaces_deleted + 1;
    else
      update public.spaces
         set created_by = v_heir,
             updated_at = clock_timestamp(),
             version = version + 1
       where id = v_space.id;

      -- The heir must actually hold owner rights, or the space becomes
      -- unmanageable: no one could invite, archive or transfer it again.
      update public.space_members
         set role = 'owner',
             updated_at = clock_timestamp(),
             version = version + 1
       where space_id = v_space.id
         and user_id = v_heir;

      v_spaces_transferred := v_spaces_transferred + 1;
    end if;
  end loop;

  -- ── 2. Personal tasks and lists (no FK on user_id — must be explicit) ────
  -- Private rows are removed; rows belonging to a Space are unlinked so the
  -- remaining members keep their content.
  delete from public.tasks
   where user_id = p_user
     and space_id is null;
  get diagnostics v_tasks_deleted = row_count;

  update public.tasks
     set user_id = null
   where user_id = p_user
     and space_id is not null;
  get diagnostics v_tasks_unlinked = row_count;

  delete from public.lists
   where user_id = p_user
     and space_id is null;
  get diagnostics v_lists_deleted = row_count;

  update public.lists
     set user_id = null
   where user_id = p_user
     and space_id is not null;
  get diagnostics v_lists_unlinked = row_count;

  -- ── 3. Alarms ────────────────────────────────────────────────────────────
  -- 0011 declares an ON DELETE CASCADE FK, but the table pre-dates migration
  -- tracking so `create table if not exists` was a no-op and the live FK is
  -- unverified. Deleting explicitly is correct either way.
  delete from public.alarms where user_id = p_user;
  get diagnostics v_alarms_deleted = row_count;

  -- ── 4. Tables with no FK to the user ────────────────────────────────────
  delete from public.ad_grants where user_id = p_user;
  get diagnostics v_ads_deleted = row_count;

  update public.billing_events
     set user_id = null
   where user_id = p_user;
  get diagnostics v_billing_anon = row_count;

  -- ── 5. Strip personal content from retained tombstones ──────────────────
  update public.collaboration_tombstones
     set snapshot = '{}'::jsonb
   where deleted_by = p_user
     and snapshot <> '{}'::jsonb;
  get diagnostics v_tombstones_wiped = row_count;

  -- ── 6. The authentication account itself ────────────────────────────────
  -- This is the step the old client-side code was missing, and the reason a
  -- "deleted" user could still sign in. Everything with a CASCADE to
  -- auth.users or profiles goes with it.
  delete from auth.users where id = p_user;
  get diagnostics v_auth_deleted = row_count;

  return jsonb_build_object(
    'ok', v_auth_deleted > 0,
    'auth_user_deleted',  v_auth_deleted,
    'spaces_transferred', v_spaces_transferred,
    'spaces_deleted',     v_spaces_deleted,
    'tasks_deleted',      v_tasks_deleted,
    'tasks_unlinked',     v_tasks_unlinked,
    'lists_deleted',      v_lists_deleted,
    'lists_unlinked',     v_lists_unlinked,
    'alarms_deleted',     v_alarms_deleted,
    'ad_grants_deleted',  v_ads_deleted,
    'billing_anonymised', v_billing_anon,
    'tombstones_wiped',   v_tombstones_wiped
  );
end;
$$;

-- Nobody but the trusted edge function may run this.
revoke all on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;

-- ── Verification helper ────────────────────────────────────────────────────
-- Returns any table that still holds rows for a user id. Used after a deletion
-- to PROVE nothing was missed, rather than assuming. service_role only, since
-- it can probe arbitrary accounts.
create or replace function public.audit_account_residue(p_user uuid)
returns table (table_name text, row_count bigint)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select 'auth.users',        count(*) from auth.users where id = p_user
  union all
  select 'profiles',          count(*) from public.profiles where id = p_user
  union all
  select 'tasks',             count(*) from public.tasks where user_id = p_user
  union all
  select 'lists',             count(*) from public.lists where user_id = p_user
  union all
  select 'alarms',            count(*) from public.alarms where user_id = p_user
  union all
  select 'alarm_history',     count(*) from public.alarm_history where user_id = p_user
  union all
  select 'mindful_profiles',  count(*) from public.mindful_profiles where user_id = p_user
  union all
  select 'mindful_apps',      count(*) from public.mindful_apps where user_id = p_user
  union all
  select 'focus_sessions',    count(*) from public.focus_sessions where user_id = p_user
  union all
  select 'user_daily_stats',  count(*) from public.user_daily_stats where user_id = p_user
  union all
  select 'friendships',       count(*) from public.friendships
    where requester_id = p_user or addressee_id = p_user
  union all
  select 'presence_sessions', count(*) from public.presence_sessions where user_id = p_user
  union all
  select 'leaderboard_snapshots', count(*) from public.leaderboard_snapshots where user_id = p_user
  union all
  select 'feedback',          count(*) from public.feedback where user_id = p_user
  union all
  select 'user_cosmetics',    count(*) from public.user_cosmetics where user_id = p_user
  union all
  select 'spaces_created',    count(*) from public.spaces where created_by = p_user
  union all
  select 'space_members',     count(*) from public.space_members where user_id = p_user
  union all
  select 'task_comments',     count(*) from public.task_comments where author_id = p_user
  union all
  select 'inbox_notifications', count(*) from public.inbox_notifications where user_id = p_user
  union all
  select 'hustle_rooms_owned', count(*) from public.hustle_rooms where owner_id = p_user
  union all
  select 'hustle_room_members', count(*) from public.hustle_room_members where user_id = p_user
  union all
  select 'hustle_room_messages', count(*) from public.hustle_room_messages where author_id = p_user
  union all
  select 'hustle_room_queue_items', count(*) from public.hustle_room_queue_items where user_id = p_user
  union all
  select 'ad_grants',         count(*) from public.ad_grants where user_id = p_user
  union all
  select 'billing_events',    count(*) from public.billing_events where user_id = p_user;
end;
$$;

revoke all on function public.audit_account_residue(uuid) from public, anon, authenticated;
grant execute on function public.audit_account_residue(uuid) to service_role;

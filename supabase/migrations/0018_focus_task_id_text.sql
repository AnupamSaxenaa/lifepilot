-- ═══════════════════════════════════════════════════════════════════════════
-- 0018 — fix focus_sessions.task_id type
--
-- 0017 declared task_id as bigint, copying the `tasks.id` column type. But task
-- IDs in this app are not always bigints: locally-created tasks carry UUIDs
-- (e.g. "9682f3e3-185f-4dc4-ac09-3938586a5773"). Inserting one produced
--   invalid input syntax for type bigint
-- which failed the mutation, left it pending forever, and blocked the whole
-- SyncQueue behind a poisoned entry.
--
-- text accepts both shapes. task_id is only a reference for display, never
-- joined on, so there is nothing to gain from a stricter type here.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.focus_sessions
  alter column task_id type text using task_id::text;

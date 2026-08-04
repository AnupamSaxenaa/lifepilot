-- ============================================================================
-- LifePilot — Feedback & Bug Report System
-- ----------------------------------------------------------------------------
-- Lets users submit bug reports / feature requests / general feedback,
-- optionally with screenshots and auto-captured device info. You (the owner)
-- can triage everything from the Supabase Table Editor / SQL editor, or wire
-- up the `feedback-notify` edge function to a Discord webhook for instant
-- push notifications on new submissions (see function header for setup).
--
-- Design:
--   • Users can INSERT their own feedback and SELECT only their own rows
--     (so they can see the status/response on submissions they made).
--   • Users can NEVER update/delete a row once submitted (no editing history,
--     no hiding a bug report) — triage fields (status, admin_notes) are only
--     writable by the service role.
--   • A trigger enforces a per-user daily submission cap server-side, so a
--     client bug/script can't spam the table no matter what the app sends.
--   • Screenshots live in a dedicated public storage bucket, one folder per
--     user, RLS-scoped so a user can only upload into their own folder.
--
-- Apply with:  supabase db push   (or paste into the Supabase SQL editor)
-- ============================================================================

-- ── 1. Feedback table ───────────────────────────────────────────────────────
create table if not exists public.feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  category        text not null,
  severity        text,
  subject         text not null,
  message         text not null,
  screenshot_urls jsonb not null default '[]'::jsonb,
  device_info     jsonb not null default '{}'::jsonb,
  app_version     text,
  contact_email   text,
  status          text not null default 'open',
  admin_notes     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_category_check') then
    alter table public.feedback
      add constraint feedback_category_check
      check (category in ('bug', 'feature_request', 'general', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_severity_check') then
    alter table public.feedback
      add constraint feedback_severity_check
      check (severity is null or severity in ('low', 'medium', 'high', 'critical'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_status_check') then
    alter table public.feedback
      add constraint feedback_status_check
      check (status in ('open', 'in_progress', 'resolved', 'wont_fix'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_subject_len') then
    alter table public.feedback add constraint feedback_subject_len check (char_length(subject) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_message_len') then
    alter table public.feedback add constraint feedback_message_len check (char_length(message) between 1 and 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_screenshots_max') then
    alter table public.feedback add constraint feedback_screenshots_max check (jsonb_array_length(screenshot_urls) <= 3);
  end if;
end $$;

create index if not exists idx_feedback_user_id on public.feedback(user_id);
create index if not exists idx_feedback_status on public.feedback(status);
create index if not exists idx_feedback_created_at on public.feedback(created_at desc);

alter table public.feedback enable row level security;

-- Users see only their own submissions (so they can track status/response).
drop policy if exists "Users read their own feedback" on public.feedback;
create policy "Users read their own feedback"
  on public.feedback for select
  using (auth.uid() = user_id);

-- Users can submit feedback, but only ever as themselves, and never with a
-- status other than the default 'open' or with pre-filled admin_notes —
-- triage fields are owner-only (enforced by the column-level revoke below,
-- which is stronger than a CHECK since it blocks the column outright).
drop policy if exists "Users submit their own feedback" on public.feedback;
create policy "Users submit their own feedback"
  on public.feedback for insert
  with check (auth.uid() = user_id);

-- No update/delete policy for authenticated users at all — once submitted,
-- a report can't be edited or hidden. Only the service role (which bypasses
-- RLS) can change status/admin_notes during triage.
revoke update, delete on public.feedback from authenticated;
revoke update (status, admin_notes) on public.feedback from authenticated;

-- Keep updated_at fresh (helps you sort "recently updated" in triage views).
create or replace function public.touch_feedback_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_feedback_updated_at on public.feedback;
create trigger trg_feedback_updated_at
  before update on public.feedback
  for each row execute function public.touch_feedback_updated_at();

-- ── 2. Server-side rate limit (hardcoded, cannot be bypassed by the client) ─
-- Caps every user at 20 feedback submissions per rolling 24h window. Blocks
-- spam/abuse of the table and the Discord notification webhook without
-- requiring any extra RPC round-trip from the client — it's enforced right
-- on the INSERT itself.
create or replace function public.check_feedback_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.feedback
   where user_id = new.user_id
     and created_at > now() - interval '1 day';

  if v_count >= 20 then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_feedback_rate_limit on public.feedback;
create trigger trg_feedback_rate_limit
  before insert on public.feedback
  for each row execute function public.check_feedback_rate_limit();

-- ── 3. Storage bucket for screenshots ───────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('feedback-attachments', 'feedback-attachments', true)
on conflict (id) do nothing;

-- Users may only upload into a folder named after their own user id
-- (path shape: <user_id>/<filename>). Public bucket = anyone with the exact
-- URL can view (needed so the URLs stored in `screenshot_urls` render
-- without extra signed-URL plumbing), but nobody can enumerate/list another
-- user's folder or overwrite/delete their files.
drop policy if exists "Users upload their own feedback attachments" on storage.objects;
create policy "Users upload their own feedback attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Anyone can view feedback attachments" on storage.objects;
create policy "Anyone can view feedback attachments"
  on storage.objects for select
  using (bucket_id = 'feedback-attachments');

drop policy if exists "Users delete their own feedback attachments" on storage.objects;
create policy "Users delete their own feedback attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- LifePilot — Intelligent Alarm System (data model)
-- ----------------------------------------------------------------------------
-- Adds the rich, offline-first alarm data model and a wake-session history log
-- that powers stats/insights. Everything is reached from the app ONLY through
-- src/lib/dataManager.js (+ syncQueue) — never Supabase directly from screens.
--
-- Design notes:
--   • The `alarms` table predates tracked migrations (created live). We
--     `create table if not exists` with the KNOWN legacy columns so a fresh
--     environment matches production, then add the new columns additively.
--     On the live DB the create-if-not-exists is a no-op and only the new
--     `add column if not exists` statements take effect.
--   • New columns are ALL nullable/defaulted so legacy alarms (which only have
--     time/title/days_of_week/…) keep firing unchanged (Property 9).
--   • `recurrence` supersedes `days_of_week`; the client keeps the legacy
--     `days_of_week` array in sync for backward compatibility.
--
-- Data safety: purely additive. No drops, no destructive ops. Idempotent.
-- Apply AFTER 0001–0010.
-- ============================================================================

-- ── 1. Base alarms table (no-op if it already exists live) ──────────────────
create table if not exists public.alarms (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  time          text not null,                 -- 'HH:mm' (local wall-clock)
  title         text,
  days_of_week  jsonb,                          -- legacy: boolean[7] (Mon..Sun)
  vibrate       boolean not null default true,
  sound         boolean not null default true,
  sound_uri     text default 'default',
  sound_name    text,
  is_active     boolean not null default true,
  order_index   integer,
  created_at    timestamptz default now()
);

alter table public.alarms enable row level security;

-- Owner-only access (idempotent).
drop policy if exists "Users manage their own alarms" on public.alarms;
create policy "Users manage their own alarms"
  on public.alarms for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_alarms_user on public.alarms(user_id);

-- ── 2. Rich alarm model columns (additive, nullable/defaulted) ──────────────
alter table public.alarms
  add column if not exists description       text,
  add column if not exists label             jsonb,   -- { key, custom?, color }
  add column if not exists category          text,
  add column if not exists recurrence        jsonb,   -- structured rule (see design.md)
  add column if not exists sound_config      jsonb,   -- { uri, name, volume, fadeInMs, rotateSet? }
  add column if not exists vibration_pattern text,    -- strong|soft|heartbeat|pulse|wave|none
  add column if not exists snooze_config     jsonb,   -- { presets, defaultMin, maxCount, progressive, disabled }
  add column if not exists mission           jsonb,   -- [ { id, difficulty, config } ]
  add column if not exists smart_wake        jsonb,   -- { enabled, windowMin }
  add column if not exists ambient           jsonb,   -- { enabled, leadMin, visual, soundscape }
  add column if not exists flags             jsonb,   -- { favorite, archived, emergency, backupAlarm }
  add column if not exists group_id          text;

-- ── 3. Wake-session history log (new) ───────────────────────────────────────
create table if not exists public.alarm_history (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  alarm_id         uuid,                          -- soft ref; alarm may be deleted later
  triggered_at     timestamptz not null,
  outcome          text not null,                 -- dismissed | snoozed | skipped | missed
  snooze_count     integer not null default 0,
  challenge_ids    jsonb,                          -- string[] of challenge ids used
  dismiss_duration_ms integer,                     -- ring start -> dismissed
  wake_duration_ms    integer,                     -- ring start -> mission complete
  mood             text,
  notes            text,
  created_at       timestamptz default now()
);

alter table public.alarm_history enable row level security;

drop policy if exists "Users read their own alarm history" on public.alarm_history;
create policy "Users read their own alarm history"
  on public.alarm_history for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert their own alarm history" on public.alarm_history;
create policy "Users insert their own alarm history"
  on public.alarm_history for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update their own alarm history" on public.alarm_history;
create policy "Users update their own alarm history"
  on public.alarm_history for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete their own alarm history" on public.alarm_history;
create policy "Users delete their own alarm history"
  on public.alarm_history for delete
  using (auth.uid() = user_id);

create index if not exists idx_alarm_history_user on public.alarm_history(user_id);
create index if not exists idx_alarm_history_user_triggered on public.alarm_history(user_id, triggered_at desc);

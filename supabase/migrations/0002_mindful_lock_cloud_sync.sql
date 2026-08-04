-- ============================================================================
-- LifePilot — Mindful Lock Cloud Sync
-- ----------------------------------------------------------------------------
-- Previously, Mindful Lock profile settings (goal, persona, blocking mode,
-- schedules) and the locked-apps list lived ONLY in local AsyncStorage.
-- A reinstall, cleared app data, or new device would silently wipe all of it.
--
-- This migration adds the two missing tables so this data follows the exact
-- same offline-first pattern as tasks/lists: cache-first reads, optimistic
-- local writes, background sync via the existing syncQueue, RLS-protected.
-- ============================================================================

-- ── mindful_profiles: one row per user (settings + schedules) ──────────────
create table if not exists public.mindful_profiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  goal                text,
  coach_persona       text default 'gentle',
  blocking_mode       text default 'cbt',
  streak              integer default 0,
  best_streak         integer default 0,
  total_time_saved    integer default 0,
  distraction_score   integer default 50,
  danger_windows      jsonb default '[]'::jsonb,
  last_reflection     timestamptz,
  last_streak_date    date,
  onboarding_complete boolean default false,
  schedules           jsonb default '[]'::jsonb,
  updated_at          timestamptz default now()
);

alter table public.mindful_profiles enable row level security;

drop policy if exists "Users manage their own mindful profile" on public.mindful_profiles;
create policy "Users manage their own mindful profile"
  on public.mindful_profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at fresh on every write (helps with last-write-wins conflict resolution)
create or replace function public.touch_mindful_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mindful_profiles_updated_at on public.mindful_profiles;
create trigger trg_mindful_profiles_updated_at
  before update on public.mindful_profiles
  for each row execute function public.touch_mindful_profiles_updated_at();

-- ── mindful_apps: the user's list of locked/tracked distraction apps ───────
create table if not exists public.mindful_apps (
  id                    uuid primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  name                  text not null,
  package_name          text default '',
  icon                  text default '📱',
  bundle                text,
  lock_mode             text default 'allowance',
  daily_budget_minutes  integer default 60,
  schedule              jsonb,
  taper_config          jsonb,
  temp_allowance_minutes integer default 0,
  temp_allowance_date   date,
  unblock_until         bigint default 0,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table public.mindful_apps enable row level security;

drop policy if exists "Users manage their own mindful apps" on public.mindful_apps;
create policy "Users manage their own mindful apps"
  on public.mindful_apps
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_mindful_apps_user_id on public.mindful_apps(user_id);

drop trigger if exists trg_mindful_apps_updated_at on public.mindful_apps;
create trigger trg_mindful_apps_updated_at
  before update on public.mindful_apps
  for each row execute function public.touch_mindful_profiles_updated_at();

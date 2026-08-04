-- ============================================================================
-- LifePilot — Roadmap / "What's Coming" system
-- ----------------------------------------------------------------------------
-- Lets you (the owner) tell users what to expect in upcoming updates, editable
-- anytime from the Supabase Table Editor / SQL — NO app rebuild or OTA needed.
-- The app reads the active items and caches them offline-first.
--
-- Design:
--   • Everyone (even signed-out) can READ active items — it's public marketing.
--   • Clients can NEVER write — rows are managed only by the owner via the
--     dashboard / service role. No insert/update/delete policy is granted.
--   • `status` groups items (planned / in_progress / next). `sort_order` lets
--     you control ordering; lower shows first.
--
-- Data safety: purely additive. Idempotent. Apply AFTER 0009.
-- ============================================================================

create table if not exists public.roadmap_items (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  status         text not null default 'planned',   -- 'next' | 'in_progress' | 'planned'
  emoji          text,                               -- optional leading glyph, e.g. '✨'
  target_version text,                               -- optional, e.g. 'v1.1'
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'roadmap_status_check') then
    alter table public.roadmap_items
      add constraint roadmap_status_check
      check (status in ('next', 'in_progress', 'planned'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'roadmap_title_len') then
    alter table public.roadmap_items
      add constraint roadmap_title_len check (char_length(title) between 1 and 120);
  end if;
end $$;

create index if not exists idx_roadmap_active_sort
  on public.roadmap_items(is_active, sort_order);

alter table public.roadmap_items enable row level security;

-- Public read of active items only (marketing content — safe to expose).
drop policy if exists "Anyone can read active roadmap items" on public.roadmap_items;
create policy "Anyone can read active roadmap items"
  on public.roadmap_items for select
  using (is_active = true);

-- No write policies at all → only the service role (Supabase dashboard) can
-- add/edit/remove roadmap items. Clients can never tamper with them.
revoke insert, update, delete on public.roadmap_items from authenticated, anon;

-- Keep updated_at fresh on edits.
create or replace function public.touch_roadmap_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_roadmap_updated_at on public.roadmap_items;
create trigger trg_roadmap_updated_at
  before update on public.roadmap_items
  for each row execute function public.touch_roadmap_updated_at();

-- ── Seed a few starter items (edit/delete these anytime in the dashboard) ───
insert into public.roadmap_items (title, description, status, emoji, target_version, sort_order)
values
  ('Smarter AI planning', 'Aura will break big goals into daily steps and adapt as your week changes.', 'next', '🧠', 'v1.1', 10),
  ('Home-screen widget themes', 'More widget looks that match your equipped theme and accent.', 'in_progress', '🎨', 'v1.1', 20),
  ('Focus insights', 'Weekly breakdown of your focus sessions and completed tasks.', 'planned', '📊', null, 30)
on conflict do nothing;

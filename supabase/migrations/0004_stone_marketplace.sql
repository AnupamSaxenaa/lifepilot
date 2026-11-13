-- ============================================================================
-- LifePilot — Stone Shards & Cosmetics Marketplace (server-authoritative)
-- ----------------------------------------------------------------------------
-- Model:
--   • Leveling up (driven by XP) "unearths" stones. Each unlocked stone is
--     worth a fixed number of SHARDS (a soft, spendable currency).
--   • Shards are DERIVED SERVER-SIDE from profiles.xp using the exact same
--     level curve the app uses — the client never tells us its balance.
--   • Shards buy COSMETICS ONLY (themes, accents, fonts, frames, icons).
--     They never grant AI tokens, never bypass Pro. Cosmetic economy only.
--
-- Anti-abuse:
--   • shard_balance / shards_lifetime_earned columns are REVOKE'd from clients
--     (no direct UPDATE) — only SECURITY DEFINER RPCs can change them.
--   • Prices live in the marketplace_items table server-side; the client
--     cannot set or discount a price.
--   • Ownership rows are inserted ONLY by the purchase RPC (clients have no
--     INSERT policy), so nobody can grant themselves a free cosmetic.
--   • Claiming is idempotent (high-water mark) — re-running never double-credits.
--   • Purchases are atomic (row lock) — no race/double-spend.
--
-- Data safety: purely additive. No drops, no destructive ops. Idempotent.
-- Apply AFTER 0001–0003.
-- ============================================================================

-- ── 1. Shard columns on profiles ────────────────────────────────────────────
alter table public.profiles
  add column if not exists shard_balance         integer not null default 0,
  add column if not exists shards_lifetime_earned integer not null default 0,
  -- Equipped cosmetics (cosmetic-only; app validates ownership before applying).
  add column if not exists equipped_theme  text,
  add column if not exists equipped_accent text,
  add column if not exists equipped_font   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_shard_balance_nonneg') then
    alter table public.profiles add constraint profiles_shard_balance_nonneg check (shard_balance >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_shards_lifetime_nonneg') then
    alter table public.profiles add constraint profiles_shards_lifetime_nonneg check (shards_lifetime_earned >= 0);
  end if;
end $$;

-- Clients cannot self-edit shard/economy columns.
revoke update (shard_balance, shards_lifetime_earned) on public.profiles from authenticated, anon;

-- ── 2. Marketplace catalog (server-side prices) ─────────────────────────────
create table if not exists public.marketplace_items (
  id          text primary key,
  category    text not null,           -- theme | accent | font | frame | icon | pedestal
  name        text not null,
  price       integer not null check (price >= 0),
  metadata    jsonb default '{}'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz default now()
);

alter table public.marketplace_items enable row level security;

-- Everyone authenticated can READ the catalog; nobody can write it via the API.
drop policy if exists "Anyone can read active marketplace items" on public.marketplace_items;
create policy "Anyone can read active marketplace items"
  on public.marketplace_items for select
  using (true);

-- ── 3. Ownership ledger ─────────────────────────────────────────────────────
create table if not exists public.user_cosmetics (
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_id     text not null references public.marketplace_items(id),
  acquired_at timestamptz default now(),
  primary key (user_id, item_id)
);

alter table public.user_cosmetics enable row level security;

-- Users can READ their own ownership. NO insert/update/delete policy → the
-- only way a row appears is via the SECURITY DEFINER purchase RPC below.
drop policy if exists "Users read their own cosmetics" on public.user_cosmetics;
create policy "Users read their own cosmetics"
  on public.user_cosmetics for select
  using (auth.uid() = user_id);

create index if not exists idx_user_cosmetics_user on public.user_cosmetics(user_id);

-- ── 4. Level + cumulative-shards helpers (mirror the app's XP curve) ────────
-- App formula: level increments while xp >= 50 * level * (level + 3).
create or replace function public.level_from_xp(p_xp bigint)
returns integer
language plpgsql immutable set search_path = public
as $$
declare v_level integer := 1;
begin
  if p_xp is null or p_xp < 0 then return 1; end if;
  while p_xp >= 50 * v_level * (v_level + 3) loop
    v_level := v_level + 1;
    if v_level > 1000 then exit; end if; -- safety guard
  end loop;
  return v_level;
end;
$$;

-- Cumulative shards unlocked by reaching a given level (stones 1..30).
create or replace function public.cumulative_stone_shards(p_level integer)
returns integer
language sql immutable set search_path = public
as $$
  select case
    when p_level <= 0  then 0
    when p_level = 1   then 10
    when p_level = 2   then 25
    when p_level = 3   then 45
    when p_level = 4   then 70
    when p_level = 5   then 105
    when p_level = 6   then 155
    when p_level = 7   then 215
    when p_level = 8   then 290
    when p_level = 9   then 380
    when p_level = 10  then 500
    when p_level = 11  then 650
    when p_level = 12  then 830
    when p_level = 13  then 1040
    when p_level = 14  then 1290
    when p_level = 15  then 1610
    when p_level = 16  then 2010
    when p_level = 17  then 2490
    when p_level = 18  then 3050
    when p_level = 19  then 3710
    when p_level = 20  then 4560
    when p_level = 21  then 5560
    when p_level = 22  then 6760
    when p_level = 23  then 8210
    when p_level = 24  then 9960
    when p_level = 25  then 12160
    when p_level = 26  then 14960
    when p_level = 27  then 18460
    when p_level = 28  then 22960
    when p_level = 29  then 28960
    else 38960  -- level >= 30 (all stones)
  end;
$$;

-- ── 5. Read balance (also reports current level + lifetime) ─────────────────
create or replace function public.get_shard_balance()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_p     public.profiles%rowtype;
  v_level integer;
begin
  if v_user is null then
    return jsonb_build_object('balance', 0, 'lifetime', 0, 'level', 1);
  end if;
  select * into v_p from public.profiles where id = v_user;
  if not found then
    return jsonb_build_object('balance', 0, 'lifetime', 0, 'level', 1);
  end if;
  v_level := public.level_from_xp(coalesce(v_p.xp, 0));
  return jsonb_build_object(
    'balance', coalesce(v_p.shard_balance, 0),
    'lifetime', coalesce(v_p.shards_lifetime_earned, 0),
    'level', v_level
  );
end;
$$;

-- ── 6. Claim shards owed for the user's current (XP-derived) level ──────────
-- Idempotent: credits only the delta between shards owed at the current level
-- and what has already been credited (shards_lifetime_earned high-water mark).
-- Re-running never double-credits; spending never lowers the high-water mark.
create or replace function public.claim_stone_shards()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_p     public.profiles%rowtype;
  v_level integer;
  v_owed  integer;
  v_delta integer;
begin
  if v_user is null then
    return jsonb_build_object('balance', 0, 'lifetime', 0, 'credited', 0);
  end if;

  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('balance', 0, 'lifetime', 0, 'credited', 0);
  end if;

  v_level := public.level_from_xp(coalesce(v_p.xp, 0));
  v_owed  := public.cumulative_stone_shards(v_level);
  v_delta := v_owed - coalesce(v_p.shards_lifetime_earned, 0);

  if v_delta <= 0 then
    return jsonb_build_object(
      'balance', coalesce(v_p.shard_balance, 0),
      'lifetime', coalesce(v_p.shards_lifetime_earned, 0),
      'credited', 0
    );
  end if;

  update public.profiles
     set shard_balance          = shard_balance + v_delta,
         shards_lifetime_earned = v_owed
   where id = v_user
   returning * into v_p;

  return jsonb_build_object(
    'balance', v_p.shard_balance,
    'lifetime', v_p.shards_lifetime_earned,
    'credited', v_delta
  );
end;
$$;

-- ── 7. Purchase a cosmetic (atomic, server-priced, no double-buy) ───────────
-- Returns { success, reason, balance }
create or replace function public.purchase_cosmetic(p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_item  public.marketplace_items%rowtype;
  v_p     public.profiles%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('success', false, 'reason', 'unauthenticated', 'balance', 0);
  end if;

  select * into v_item from public.marketplace_items where id = p_item_id and active = true;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'item_not_found', 'balance', 0);
  end if;

  -- Lock the profile row so balance checks/deductions can't race.
  select * into v_p from public.profiles where id = v_user for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'no_profile', 'balance', 0);
  end if;

  -- Already owned? Treat as success (idempotent), don't charge again.
  if exists (select 1 from public.user_cosmetics where user_id = v_user and item_id = p_item_id) then
    return jsonb_build_object('success', true, 'reason', 'already_owned', 'balance', coalesce(v_p.shard_balance, 0));
  end if;

  if coalesce(v_p.shard_balance, 0) < v_item.price then
    return jsonb_build_object('success', false, 'reason', 'insufficient_shards', 'balance', coalesce(v_p.shard_balance, 0));
  end if;

  update public.profiles
     set shard_balance = shard_balance - v_item.price
   where id = v_user
   returning * into v_p;

  insert into public.user_cosmetics (user_id, item_id) values (v_user, p_item_id)
  on conflict (user_id, item_id) do nothing;

  return jsonb_build_object('success', true, 'reason', 'ok', 'balance', v_p.shard_balance);
end;
$$;

-- ── 8. Grants ────────────────────────────────────────────────────────────────
revoke all on function public.get_shard_balance()          from public, anon;
revoke all on function public.claim_stone_shards()         from public, anon;
revoke all on function public.purchase_cosmetic(text)      from public, anon;
grant execute on function public.get_shard_balance()       to authenticated;
grant execute on function public.claim_stone_shards()      to authenticated;
grant execute on function public.purchase_cosmetic(text)   to authenticated;

-- ── 9. Seed the marketplace catalog ─────────────────────────────────────────
insert into public.marketplace_items (id, category, name, price, metadata) values
  -- Accent colors
  ('accent_emerald', 'accent', 'Emerald Accent', 120, '{"color":"#34D399"}'::jsonb),
  ('accent_cobalt',  'accent', 'Cobalt Accent',  120, '{"color":"#60A5FA"}'::jsonb),
  ('accent_gold',    'accent', 'Gold Accent',    180, '{"color":"#FBBF24"}'::jsonb),
  ('accent_crimson', 'accent', 'Crimson Accent', 180, '{"color":"#F87171"}'::jsonb),
  ('accent_rose',    'accent', 'Rose Accent',    200, '{"color":"#FB7185"}'::jsonb),
  -- Themes / palettes
  ('theme_midnight', 'theme', 'Midnight',        350, '{"bg":"#050510","surface":"#0B0B1A","accent":"#6366F1"}'::jsonb),
  ('theme_sepia',    'theme', 'Sepia Focus',     400, '{"bg":"#1A1410","surface":"#241B12","accent":"#D97706"}'::jsonb),
  ('theme_nord',     'theme', 'Nord',            500, '{"bg":"#2E3440","surface":"#3B4252","accent":"#88C0D0"}'::jsonb),
  ('theme_rose',     'theme', 'Rose Quartz',     650, '{"bg":"#1A0F14","surface":"#241017","accent":"#F472B6"}'::jsonb),
  -- Fonts
  ('font_rounded',   'font', 'Rounded',          150, '{"family":"System-Rounded"}'::jsonb),
  ('font_serif',     'font', 'Serif',            250, '{"family":"serif"}'::jsonb),
  ('font_mono',      'font', 'Monospace',        250, '{"family":"monospace"}'::jsonb),
  ('font_condensed', 'font', 'Condensed',        400, '{"family":"sans-serif-condensed"}'::jsonb),
  -- Avatar frames
  ('frame_glow',     'frame', 'Glow Ring',       300, '{}'::jsonb),
  ('frame_stone',    'frame', 'Stone-Encrusted', 600, '{}'::jsonb),
  -- App icons
  ('icon_noir',      'icon', 'Noir Icon',        500, '{}'::jsonb),
  ('icon_gold',      'icon', 'Gilded Icon',      1000, '{}'::jsonb),
  -- Showcase pedestal
  ('pedestal_basic', 'pedestal', 'Display Pedestal', 800, '{}'::jsonb)
on conflict (id) do nothing;

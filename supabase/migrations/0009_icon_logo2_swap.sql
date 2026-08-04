-- ============================================================================
-- LifePilot — Replace Noir/Gold app icons with the real logo icon
-- ----------------------------------------------------------------------------
-- The Noir/Gold launcher icon cosmetics are being retired in favor of a
-- single "Logo" icon using the app's actual logo artwork. This migration:
--   1. Adds the new `icon_logo2` marketplace item.
--   2. Migrates any existing ownership of icon_noir/icon_gold to icon_logo2
--      (so paying users aren't left with nothing — cosmetic goodwill).
--   3. Repoints any profile currently equipped to icon_noir/icon_gold onto
--      icon_logo2, so nobody's launcher icon silently breaks.
--   4. Deactivates icon_noir/icon_gold (active = false) rather than deleting
--      them — user_cosmetics rows reference marketplace_items.id by FK, so a
--      hard delete would fail/cascade-orphan for anyone who owns them.
--      `getCatalog()` only selects `active = true`, so they disappear from
--      the UI immediately without breaking referential integrity.
--
-- Data safety: purely additive/reconciling. No drops. Idempotent (safe to
-- re-run). Apply AFTER 0008.
-- ============================================================================

-- ── 1. Add the new catalog item ─────────────────────────────────────────────
insert into public.marketplace_items (id, category, name, price, metadata)
values ('icon_logo2', 'icon', 'Logo Icon', 750, '{}'::jsonb)
on conflict (id) do update set active = true;

-- ── 2. Migrate ownership: anyone who owned noir/gold now owns logo2 too ─────
insert into public.user_cosmetics (user_id, item_id)
select distinct user_id, 'icon_logo2'
from public.user_cosmetics
where item_id in ('icon_noir', 'icon_gold')
on conflict (user_id, item_id) do nothing;

-- ── 3. Repoint anyone equipped to the retired variants ──────────────────────
update public.profiles
set equipped_icon = 'icon_logo2'
where equipped_icon in ('icon_noir', 'icon_gold');

-- ── 4. Retire the old catalog entries (kept for FK integrity, hidden from UI) ─
update public.marketplace_items
set active = false
where id in ('icon_noir', 'icon_gold');

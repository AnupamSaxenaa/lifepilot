-- ============================================================================
-- LifePilot — Marketplace: equip support for frames and app icons
-- ----------------------------------------------------------------------------
-- Migration 0004 added equipped_theme/accent/font but frames and app icons
-- (pedestal has no "equip" state — it's a passive unlock) had no equip column.
-- This makes Avatar Frames and App Icons fully equippable, same pattern as
-- the existing cosmetics: client validates ownership before ever applying.
--
-- Data safety: additive only, no drops. Apply AFTER 0004/0005.
-- ============================================================================

alter table public.profiles
  add column if not exists equipped_frame text,
  add column if not exists equipped_icon  text;

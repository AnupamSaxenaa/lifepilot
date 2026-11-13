-- ============================================================================
-- LifePilot — Preferred Language column
-- ----------------------------------------------------------------------------
-- Stores the user's chosen app language (one of the 20 supported locale
-- codes, e.g. 'en', 'es', 'zh-Hans') so it can be restored on any device they
-- log into, not just the one where they picked it. The client is still the
-- source of truth for IMMEDIATE display (AsyncStorage + i18next), this column
-- is purely for cross-device continuity.
--
-- Data safety: purely additive. No drops, no destructive ops. Idempotent.
-- ============================================================================

alter table public.profiles
  add column if not exists preferred_language text;

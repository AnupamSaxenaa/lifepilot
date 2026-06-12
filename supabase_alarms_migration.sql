-- Run this in Supabase SQL Editor to add sound and customization columns to the alarms table
-- These columns are needed for custom sound selection on the Alarms screen.

ALTER TABLE alarms ADD COLUMN IF NOT EXISTS sound_name TEXT DEFAULT 'Default Radar';
ALTER TABLE alarms ADD COLUMN IF NOT EXISTS sound_uri TEXT DEFAULT 'default';

-- Run this in Supabase SQL Editor to apply database changes for Phase 1 and fix registration features

-- 1. Add an order_index column to tasks to save custom arrangement
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;

-- 2. Add a completed_at column to tasks to track completion time and handle task lifecycle
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NULL;

-- 3. Add a subtasks JSONB column to store checklist steps
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS subtasks JSONB DEFAULT '[]'::jsonb;

-- 4. Add a notes TEXT column to store task details and descriptions
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL;

-- 5. Create a secure RPC function to check if an email already exists (for real-time registration check)
CREATE OR REPLACE FUNCTION public.check_email_exists(email_to_check TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  exists_bool BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE LOWER(email) = LOWER(email_to_check)
  ) INTO exists_bool;
  RETURN exists_bool;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Add starred_order_index column to tasks to save custom arrangement independently for the Starred screen
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS starred_order_index INTEGER DEFAULT 0;

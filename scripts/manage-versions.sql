-- LifePilot Version Management SQL Scripts
-- Run these in Supabase SQL Editor to manage app versions

-- ========================================
-- 1. VIEW CURRENT VERSION INFO
-- ========================================

SELECT * FROM app_versions 
WHERE platform = 'android' 
ORDER BY created_at DESC 
LIMIT 1;


-- ========================================
-- 2. INSERT INITIAL VERSION (First Time)
-- ========================================

INSERT INTO app_versions (
  platform,
  min_version,
  latest_version,
  download_url,
  release_notes,
  force_update
) VALUES (
  'android',
  '1.0.0',
  '1.0.0',
  'https://your-project.supabase.co/storage/v1/object/public/apk-updates/lifepilot-v1.0.0.apk',
  'Initial release',
  false
);


-- ========================================
-- 3. UPDATE TO NEW VERSION (Soft Update)
-- ========================================
-- Users CAN continue using old version, but will be notified

UPDATE app_versions 
SET 
  latest_version = '1.1.0',
  download_url = 'https://your-url/lifepilot-v1.1.0.apk',
  release_notes = 'Bug fixes and UI improvements',
  force_update = false,  -- Allow old versions to still work
  updated_at = now()
WHERE platform = 'android';


-- ========================================
-- 4. FORCE UPDATE (Hard Update)
-- ========================================
-- Users MUST update to continue using app

UPDATE app_versions 
SET 
  min_version = '1.1.0',  -- Block versions below this
  latest_version = '1.1.0',
  download_url = 'https://your-url/lifepilot-v1.1.0.apk',
  release_notes = 'Critical security update - please update immediately',
  force_update = true,  -- Force all users to update
  updated_at = now()
WHERE platform = 'android';


-- ========================================
-- 5. DISABLE FORCE UPDATE
-- ========================================
-- Allow older versions to work again

UPDATE app_versions 
SET 
  force_update = false,
  updated_at = now()
WHERE platform = 'android';


-- ========================================
-- 6. TEST FORCE UPDATE (Local Testing)
-- ========================================
-- Set impossibly high version to trigger blocker

UPDATE app_versions 
SET 
  min_version = '99.0.0',
  force_update = true
WHERE platform = 'android';

-- To reset after testing:
UPDATE app_versions 
SET 
  min_version = '1.0.0',
  force_update = false
WHERE platform = 'android';


-- ========================================
-- 7. DELETE ALL VERSION DATA (Cleanup)
-- ========================================
-- WARNING: This removes all version checking

DELETE FROM app_versions WHERE platform = 'android';


-- ========================================
-- 8. VIEW VERSION HISTORY
-- ========================================

SELECT 
  id,
  platform,
  min_version,
  latest_version,
  force_update,
  created_at,
  updated_at
FROM app_versions 
WHERE platform = 'android'
ORDER BY created_at DESC;


-- ========================================
-- 9. EMERGENCY: DISABLE ALL VERSION CHECKS
-- ========================================
-- Use if force update is causing issues

UPDATE app_versions 
SET 
  min_version = '0.0.0',
  force_update = false
WHERE platform = 'android';

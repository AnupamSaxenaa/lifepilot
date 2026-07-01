-- SQL command to update the app_versions table for LifePilot 1.0.5

-- Insert or Update Android Version Info
INSERT INTO app_versions (platform, min_version, latest_version, force_update, release_notes, download_url)
VALUES (
    'android', 
    '1.0.5', -- Setting min_version to 1.0.5 will FORCE everyone below 1.0.5 to update. Change to '1.0.4' if you want it optional.
    '1.0.5', 
    true,    -- Set to false if you don't want a strict forced update immediately
    'Critical fixes for Inactivity Notifications, Profile Stone Collection Gallery, and Widget UI Improvements.',
    'https://github.com/AnupamSaxenaa/lifepilot/releases/download/v1.0.5/lifepilot-v1.0.5.apk'
)
ON CONFLICT (id) DO UPDATE SET
    min_version = EXCLUDED.min_version,
    latest_version = EXCLUDED.latest_version,
    force_update = EXCLUDED.force_update,
    release_notes = EXCLUDED.release_notes,
    download_url = EXCLUDED.download_url,
    updated_at = now();

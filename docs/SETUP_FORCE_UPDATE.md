# Force Update System Setup Guide

## Overview
The force update system checks if users need to download a new APK before they can use the app. This is useful when you make native code changes that can't be delivered via OTA updates.

## 🗄️ Database Setup

### 1. Create the `app_versions` table in Supabase

Run this SQL in your Supabase SQL Editor:

```sql
-- Create app_versions table
CREATE TABLE IF NOT EXISTS app_versions (
  id serial PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  min_version text NOT NULL,
  latest_version text NOT NULL,
  download_url text,
  release_notes text,
  force_update boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_app_versions_platform ON app_versions(platform);

-- Enable RLS (Row Level Security)
ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access (so app can check versions)
CREATE POLICY "Allow public read access" ON app_versions
  FOR SELECT
  USING (true);

-- Create policy to allow authenticated users to insert/update (for admin)
CREATE POLICY "Allow authenticated insert/update" ON app_versions
  FOR ALL
  USING (auth.role() = 'authenticated');
```

### 2. Insert initial version data

```sql
-- Insert Android version info
INSERT INTO app_versions (
  platform,
  min_version,
  latest_version,
  download_url,
  release_notes,
  force_update
) VALUES (
  'android',
  '1.0.0',  -- Minimum version required
  '1.0.0',  -- Latest available version
  'https://your-server.com/lifepilot-v1.0.0.apk',  -- APK download URL
  'Initial release of LifePilot',
  false  -- Set to true to force all users to update
);
```

## 📦 How to Host Your APK

You have several options for hosting the APK:

### Option 1: Supabase Storage (Recommended)

1. **Upload APK to Supabase Storage:**
   - Go to Supabase Dashboard → Storage
   - Create a new public bucket called `apk-updates`
   - Upload your APK file
   - Copy the public URL

2. **Update the database:**
```sql
UPDATE app_versions 
SET download_url = 'https://your-project.supabase.co/storage/v1/object/public/apk-updates/lifepilot-v1.0.0.apk',
    latest_version = '1.0.0'
WHERE platform = 'android';
```

### Option 2: GitHub Releases

1. Create a release on GitHub
2. Upload APK as a release asset
3. Use the direct download URL

### Option 3: Your own server

Host the APK on any web server and provide the direct download URL.

## 🚀 How to Force an Update

When you build a new APK with native changes:

### 1. Update app version in `app.json`:

```json
{
  "expo": {
    "version": "1.1.0"  // Increment this
  },
  "android": {
    "versionCode": 2  // Also increment this
  }
}
```

### 2. Build the new APK:

```bash
eas build --profile preview --platform android
```

### 3. Upload APK to your hosting solution

### 4. Update Supabase with new version:

```sql
-- Update to require new version
UPDATE app_versions 
SET 
  min_version = '1.1.0',  -- Users below this MUST update
  latest_version = '1.1.0',
  download_url = 'https://your-url/lifepilot-v1.1.0.apk',
  release_notes = 'Bug fixes and performance improvements',
  force_update = true,  -- Set to true to immediately block old versions
  updated_at = now()
WHERE platform = 'android';
```

## 📱 User Experience

### When Force Update is Required:

1. ✅ User opens app
2. ✅ App checks version against Supabase
3. ✅ If below `min_version`, full-screen blocker appears
4. ✅ User sees:
   - Current version
   - Latest version
   - Release notes
   - "Download Update" button
5. ✅ User clicks download
6. ✅ Progress bar shows real-time download progress
7. ✅ When complete, Android install prompt opens
8. ✅ User installs new APK
9. ✅ App restarts with new version
10. ✅ Blocker disappears, app works normally

### Version Check Logic:

- If `current_version < min_version` → Force update required
- If `force_update = true` → Force update required
- Otherwise → App works normally, OTA updates can be used

## 🧪 Testing

### Test Force Update:

1. Set your current app version lower in test:
```sql
-- Temporarily set higher min version to test
UPDATE app_versions 
SET min_version = '2.0.0'
WHERE platform = 'android';
```

2. Open app → blocker should appear

3. Reset:
```sql
UPDATE app_versions 
SET min_version = '1.0.0'
WHERE platform = 'android';
```

## 🔧 Troubleshooting

### APK Download Fails:
- Check download_url is publicly accessible
- Verify file exists at the URL
- Test URL in browser directly

### Install Prompt Doesn't Open:
- User needs to enable "Install from Unknown Sources"
- Check Android version (needs 8.0+)
- Verify APK is valid (not corrupted)

### Version Check Not Working:
- Check Supabase RLS policies allow public read
- Verify table exists and has data
- Check app has internet connection

## 📝 Notes

- Force update only works with APK builds (not OTA)
- OTA updates are preferred for JS-only changes
- Use force update only when necessary (native changes, critical bugs)
- Always test before forcing update on production users
- Keep old APKs available in case users need to rollback

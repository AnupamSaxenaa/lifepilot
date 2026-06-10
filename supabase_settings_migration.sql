-- Run this in Supabase SQL Editor to add Settings-related columns
-- These columns are needed for the Settings screen to work

-- 1. Username change tracking (allows only once per 30 days)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Avatar seed for randomization (fallback when no photo uploaded)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_seed TEXT DEFAULT NULL;

-- 3. Avatar URL for uploaded photos
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

-- 4. Create the 'avatars' storage bucket (public, 2MB limit)
-- Go to Supabase Dashboard → Storage → Create Bucket:
--   Name: avatars
--   Public: YES
--   File size limit: 2MB
--   Allowed MIME types: image/jpeg, image/png, image/jpg
--
-- Then add this RLS policy for the bucket:
-- Storage → Policies → avatars bucket → Add Policy:

-- Allow authenticated users to upload their own avatar:
CREATE POLICY "Users can upload own avatar" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow authenticated users to update their own avatar:
CREATE POLICY "Users can update own avatar" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow authenticated users to delete their own avatar:
CREATE POLICY "Users can delete own avatar" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow anyone to read avatars (public):
CREATE POLICY "Avatars are public" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

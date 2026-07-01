
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadApk() {
  const filePath = './lifepilot-v1.0.5.apk';
  const bucketName = 'avatar';
  const fileName = 'lifepilot-v1.0.5.apk';

  console.log('Reading APK file...');
  const fileBuffer = fs.readFileSync(filePath);

  console.log('Uploading to Supabase Storage (avatars bucket)...');
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, fileBuffer, {
      contentType: 'application/vnd.android.package-archive',
      upsert: true
    });

  if (error) {
    console.error('Upload Error:', error.message);
    return;
  }

  console.log('Upload successful!');
  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(fileName);

  console.log('---');
  console.log('YOUR DOWNLOAD URL:');
  console.log(publicUrlData.publicUrl);
  console.log('---');
}

uploadApk();

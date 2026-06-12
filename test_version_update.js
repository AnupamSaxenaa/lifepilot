import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rsglapakzhdpjyplxuwt.supabase.co';
const supabaseKey = 'sb_publishable_cheJ7hTyKYLZaLmvfvpOuw_baQUGfho';
const supabase = createClient(supabaseUrl, supabaseKey);

async function updateVersion() {
  const { data, error } = await supabase
    .from('app_versions')
    .insert([
      {
        platform: 'android',
        min_version: '1.0.0',
        latest_version: '1.0.0',
        release_notes: 'Initial production release vjasper1.0',
        force_update: false
      }
    ]);
  
  if (error) {
    console.error('Error inserting:', error);
  } else {
    console.log('Successfully updated app_versions table:', data);
  }
}

updateVersion();

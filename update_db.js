import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Read keys from src/lib/supabase.js (or .env if available)
const envFile = fs.readFileSync('.env', 'utf8');
const urlMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/);
const keyMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/);

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = keyMatch[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // 1. Update app_versions
  const { data: verData, error: verErr } = await supabase
    .from('app_versions')
    .update({ min_version: '1.0.6', latest_version: '1.0.6', force_update: true })
    .neq('id', '00000000-0000-0000-0000-000000000000'); // match all
    
  if (verErr) {
    console.error('Error updating app_versions:', verErr);
  } else {
    console.log('Successfully updated app_versions to 1.0.6');
  }

  // 2. Reset user XP
  // The user's email is saxenaanupam2004@gmail.com (from previous context)
  const { data: user, error: userErr } = await supabase.auth.signInWithPassword({
    email: 'saxenaanupam2004@gmail.com',
    password: 'dummy' // we can't do this easily.
  });
}
run();

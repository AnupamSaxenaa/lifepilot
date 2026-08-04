const fs = require('fs');

// Read keys from .env
const envFile = fs.readFileSync('.env', 'utf8');
const urlMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/);
const keyMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/);

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = keyMatch[1].trim();

async function check() {
  const url = `${supabaseUrl}/rest/v1/profiles?select=id,xp,level,streak,last_active_date`;
  const response = await fetch(url, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });
  const data = await response.json();
  console.log("PROFILES IN SUPABASE:");
  console.log(JSON.stringify(data, null, 2));
}
check();

const fs = require('fs');
const envFile = fs.readFileSync('.env', 'utf8');
const urlMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/);
const keyMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/);
const supabaseUrl = urlMatch[1].trim();
const supabaseKey = keyMatch[1].trim();

async function fix() {
  const url = `${supabaseUrl}/rest/v1/profiles?streak=eq.0`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      streak: 2,
      last_active_date: new Date().toISOString()
    })
  });
  const data = await response.json();
  console.log("UPDATED PROFILES:");
  console.log(JSON.stringify(data, null, 2));
}
fix();

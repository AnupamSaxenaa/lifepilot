const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Assuming the supabase config is in src/lib/supabase.js
// Let's just grep the URL and KEY from there
const code = fs.readFileSync('src/lib/supabase.js', 'utf8');
const urlMatch = code.match(/supabaseUrl\s*=\s*['"]([^'"]+)['"]/);
const keyMatch = code.match(/supabaseAnonKey\s*=\s*['"]([^'"]+)['"]/);

if (urlMatch && keyMatch) {
  const supabase = createClient(urlMatch[1], keyMatch[1]);
  supabase.from('tasks').select('*').then(({data, error}) => {
    if (error) console.error(error);
    else console.log(`Found ${data.length} tasks in Supabase:`, data.filter(t => t.is_completed).length, "completed");
  });
} else {
  console.log("Could not find keys");
}

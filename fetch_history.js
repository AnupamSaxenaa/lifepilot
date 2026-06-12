const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  try {
    const envFile = fs.readFileSync('.env', 'utf8');
    const urlMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_URL\s*=\s*(.*)/);
    const keyMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY\s*=\s*(.*)/);
    
    if (!urlMatch || !keyMatch) {
      console.log('Keys not found in .env');
      return;
    }
    
    const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());
    
    // Find profile
    console.log('Fetching profile for saxenaanupam2004...');
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .or('username.ilike.%saxenaanupam2004%')
      .limit(1);
      
    if (profileError) {
      console.log('Error fetching profile:', profileError);
      return;
    }
    
    if (!profileData || profileData.length === 0) {
      console.log('Profile saxenaanupam2004 not found. Here are some users:');
      const { data: allUsers } = await supabase.from('profiles').select('username, email').limit(5);
      console.log(allUsers);
      return;
    }
    
    const profile = profileData[0];
    console.log(`Found user: ${profile.username} (ID: ${profile.id})`);
    
    // Fetch tasks
    console.log(`Fetching tasks for ${profile.id}...`);
    const { data: tasks, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
      
    if (taskError) {
      console.log('Error fetching tasks:', taskError);
      return;
    }
    
    console.log(`Total tasks found: ${tasks.length}`);
    const completedTasks = tasks.filter(t => t.is_completed);
    console.log(`Completed tasks (History): ${completedTasks.length}`);
    
    if (completedTasks.length > 0) {
      console.log('--- COMPLETED TASKS ---');
      completedTasks.forEach(t => {
        console.log(`- [x] ${t.title} (Completed at: ${t.completed_at})`);
      });
    } else {
      console.log('No completed tasks found in Supabase.');
    }
    
    console.log('--- UNCOMPLETED TASKS ---');
    const uncompletedTasks = tasks.filter(t => !t.is_completed);
    uncompletedTasks.forEach(t => {
      console.log(`- [ ] ${t.title} (Created at: ${t.created_at})`);
    });
    
  } catch (err) {
    console.log('Script error:', err);
  }
}

main();

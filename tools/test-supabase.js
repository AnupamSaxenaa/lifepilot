const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://rsglapakzhdpjyplxuwt.supabase.co',
  'sb_publishable_cheJ7hTyKYLZaLmvfvpOuw_baQUGfho'
);

async function check() {
  const { data, error } = await supabase.from('alarms').select('*');
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Alarms:', JSON.stringify(data, null, 2));
  }
}

check();

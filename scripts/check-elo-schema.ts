import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  const { data, error } = await supabase.from('team_elo_snapshots').select('*').limit(1);
  if (error) console.error(error);
  else console.log('team_elo_snapshots columns:', Object.keys(data?.[0] || {}));
  console.log('Sample:', data?.[0]);
}
check();

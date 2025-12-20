import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  const { data, error } = await supabase.from('events').select('*').limit(1);
  if (error) console.error(error);
  else console.log('Event columns:', Object.keys(data?.[0] || {}));

  // Also check results
  const { data: results } = await supabase.from('results').select('*').limit(1);
  console.log('Results columns:', Object.keys(results?.[0] || {}));
}
check();

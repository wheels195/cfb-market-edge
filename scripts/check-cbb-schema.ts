import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Check cbb_games
  const { data: games } = await supabase.from('cbb_games').select('*').limit(3);
  console.log('cbb_games columns:', Object.keys(games?.[0] || {}));
  console.log('Sample:', games?.[0]);

  // Check cbb_betting_lines
  const { data: lines } = await supabase.from('cbb_betting_lines').select('*').limit(3);
  console.log('\ncbb_betting_lines columns:', Object.keys(lines?.[0] || {}));
  console.log('Sample:', lines?.[0]);
}

main();

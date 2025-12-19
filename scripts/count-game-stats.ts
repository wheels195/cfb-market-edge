import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('Counting game_advanced_stats...\n');

  // Get total count
  const { count: total } = await supabase
    .from('game_advanced_stats')
    .select('*', { count: 'exact', head: true });

  console.log(`Total records: ${total}`);

  // Count per season
  for (const season of [2021, 2022, 2023, 2024]) {
    const { count } = await supabase
      .from('game_advanced_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season);
    console.log(`  ${season}: ${count}`);
  }

  // Sample some data
  const { data: sample } = await supabase
    .from('game_advanced_stats')
    .select('season, week, team_id, off_ppa')
    .eq('season', 2024)
    .limit(5);

  console.log('\nSample 2024 data:');
  console.log(sample);
}

main().catch(console.error);

/**
 * Check pace data availability for Totals V1 model
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== PACE DATA CHECK ===\n');

  // Check team_advanced_stats for pace data
  console.log('1. team_advanced_stats table:');
  const { data: tasSample } = await supabase.from('team_advanced_stats').select('*').limit(1);
  if (tasSample && tasSample.length > 0) {
    console.log('   Columns:', Object.keys(tasSample[0]).join(', '));
  } else {
    console.log('   No data found');
  }

  // Check coverage by season
  console.log('\n   Coverage by season (plays_per_game):');
  for (const season of [2021, 2022, 2023, 2024]) {
    const { count } = await supabase
      .from('team_advanced_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
      .not('plays_per_game', 'is', null);
    console.log(`   Season ${season}: ${count || 0} teams`);
  }

  // Check advanced_team_ratings for any pace-related columns
  console.log('\n2. advanced_team_ratings table:');
  const { data: atrSample } = await supabase.from('advanced_team_ratings').select('*').limit(1);
  if (atrSample && atrSample.length > 0) {
    console.log('   Columns:', Object.keys(atrSample[0]).join(', '));
  }

  // Check if SP+ has pace data we can use
  console.log('\n3. Checking SP+ data for pace metrics:');
  const { data: spSample } = await supabase
    .from('advanced_team_ratings')
    .select('*')
    .eq('season', 2023)
    .not('sp_overall', 'is', null)
    .limit(3);

  if (spSample && spSample.length > 0) {
    console.log('   Sample SP+ record:');
    for (const key of Object.keys(spSample[0])) {
      const val = spSample[0][key];
      if (val !== null && val !== undefined) {
        console.log(`     ${key}: ${val}`);
      }
    }
  }

  // Check game_advanced_stats for per-game pace
  console.log('\n4. game_advanced_stats table:');
  const { data: gasSample } = await supabase.from('game_advanced_stats').select('*').limit(1);
  if (gasSample && gasSample.length > 0) {
    console.log('   Columns:', Object.keys(gasSample[0]).join(', '));
    console.log('   Sample off_plays:', gasSample[0].off_plays);
  } else {
    console.log('   No data found');
  }

  // Check cfbd_betting_lines for games we need pace for
  console.log('\n5. Games needing pace data:');
  for (const season of [2022, 2023, 2024]) {
    const { count } = await supabase
      .from('cfbd_betting_lines')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
      .not('total_open', 'is', null);
    console.log(`   Season ${season}: ${count || 0} games with totals`);
  }
}

main().catch(console.error);

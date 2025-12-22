import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== CBB Data Coverage Report ===\n');

  // Games and lines by season
  const seasons = [2022, 2023, 2024, 2025];

  console.log('Games & Betting Lines by Season:');
  console.log('-'.repeat(70));

  for (const season of seasons) {
    const { count: gameCount } = await supabase
      .from('cbb_games')
      .select('id', { count: 'exact', head: true })
      .eq('season', season);

    const { count: lineCount } = await supabase
      .from('cbb_betting_lines')
      .select('id', { count: 'exact', head: true })
      .eq('season', season);

    const { count: withSpread } = await supabase
      .from('cbb_betting_lines')
      .select('id', { count: 'exact', head: true })
      .eq('season', season)
      .not('spread_home_close', 'is', null);

    const { count: withTotal } = await supabase
      .from('cbb_betting_lines')
      .select('id', { count: 'exact', head: true })
      .eq('season', season)
      .not('total_close', 'is', null);

    console.log(`${season}: ${gameCount} games, ${lineCount} lines, ${withSpread} spreads, ${withTotal} totals`);
  }

  // Ratings by season
  console.log('\nTeam Ratings by Season:');
  console.log('-'.repeat(70));

  for (const season of seasons) {
    const { count } = await supabase
      .from('cbb_team_ratings')
      .select('id', { count: 'exact', head: true })
      .eq('season', season);
    console.log(`${season}: ${count} team ratings`);
  }

  // Sample betting line structure
  console.log('\nSample Betting Line (with spread):');
  console.log('-'.repeat(70));

  const { data: sample } = await supabase
    .from('cbb_betting_lines')
    .select('*')
    .not('spread_home_close', 'is', null)
    .limit(1)
    .single();

  if (sample) {
    console.log(JSON.stringify(sample, null, 2));
  }

  // Check for T-60 data
  console.log('\nT-60 Spread Coverage:');
  console.log('-'.repeat(70));

  const { count: t60Count } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('dk_spread_t60', 'is', null);

  console.log(`Lines with T-60 spread: ${t60Count}`);

  // Sample rating structure
  console.log('\nSample Team Rating:');
  console.log('-'.repeat(70));

  const { data: ratingSample } = await supabase
    .from('cbb_team_ratings')
    .select('*, team:cbb_teams(name)')
    .eq('season', 2025)
    .order('net_rank', { ascending: true })
    .limit(5);

  if (ratingSample) {
    for (const r of ratingSample) {
      const teamName = (r.team as any)?.name || 'Unknown';
      console.log(`#${r.net_rank} ${teamName}: Off=${r.offensive_rating}, Def=${r.defensive_rating}, Net=${r.net_rating}`);
    }
  }

  // Check games with results
  console.log('\nGames with Results (scores):');
  console.log('-'.repeat(70));

  for (const season of seasons) {
    const { count } = await supabase
      .from('cbb_games')
      .select('id', { count: 'exact', head: true })
      .eq('season', season)
      .not('home_score', 'is', null);
    console.log(`${season}: ${count} games with final scores`);
  }
}

main().catch(console.error);

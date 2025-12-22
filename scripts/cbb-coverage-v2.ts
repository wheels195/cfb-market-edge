import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== CBB Coverage Report v2 ===\n');

  // Direct count of betting lines
  const { count: totalLines } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true });

  console.log(`Total betting lines: ${totalLines}`);

  // Count with different spread columns
  const { count: withSpreadHome } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('spread_home', 'is', null);

  const { count: withSpreadT60 } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('spread_t60', 'is', null);

  const { count: withSpreadClose } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('spread_close', 'is', null);

  const { count: withDkOpen } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('dk_spread_open', 'is', null);

  console.log(`\nSpread Coverage:`);
  console.log(`  spread_home: ${withSpreadHome}`);
  console.log(`  spread_t60: ${withSpreadT60}`);
  console.log(`  spread_close: ${withSpreadClose}`);
  console.log(`  dk_spread_open: ${withDkOpen}`);

  // Totals
  const { count: withTotal } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('total', 'is', null);

  const { count: withTotalOpen } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('total_open', 'is', null);

  console.log(`\nTotals Coverage:`);
  console.log(`  total: ${withTotal}`);
  console.log(`  total_open: ${withTotalOpen}`);

  // Join to get games with all required data
  console.log(`\n--- Checking games with complete backtest data ---`);

  // Get sample games with lines and ratings
  const { data: sampleGames, error } = await supabase
    .from('cbb_betting_lines')
    .select(`
      id,
      game_id,
      spread_home,
      spread_t60,
      spread_close,
      dk_spread_open,
      game:cbb_games!inner(
        id,
        season,
        game_date,
        home_team_id,
        away_team_id,
        home_score,
        away_score
      )
    `)
    .not('spread_t60', 'is', null)
    .not('spread_close', 'is', null)
    .limit(5);

  if (error) {
    console.log('Join error:', error.message);
  }

  console.log('\nSample games with spreads:');
  if (sampleGames) {
    for (const row of sampleGames) {
      const game = row.game as any;
      console.log(`  Season ${game?.season}: T60=${row.spread_t60}, Close=${row.spread_close}, Score=${game?.away_score}-${game?.home_score}`);
    }
  }

  // Count games with both spread and result
  const { count: gamesWithT60AndResult } = await supabase
    .from('cbb_betting_lines')
    .select('id, game:cbb_games!inner(home_score)', { count: 'exact', head: true })
    .not('spread_t60', 'is', null);

  console.log(`\nGames with T-60 spread AND result: ${gamesWithT60AndResult}`);

  // Check ratings coverage
  console.log(`\n--- Ratings coverage check ---`);
  const { data: ratingsSample } = await supabase
    .from('cbb_team_ratings')
    .select('season, team_id, net_rating, offensive_rating, defensive_rating')
    .order('season', { ascending: false })
    .limit(5);

  console.log('Sample ratings:');
  console.log(JSON.stringify(ratingsSample, null, 2));

  // Count unique teams with ratings per season
  for (const season of [2022, 2023, 2024]) {
    const { count } = await supabase
      .from('cbb_team_ratings')
      .select('id', { count: 'exact', head: true })
      .eq('season', season);
    console.log(`${season}: ${count} team ratings`);
  }
}

main().catch(console.error);

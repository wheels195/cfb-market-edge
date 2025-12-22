import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== CBB Full Data Coverage Report ===\n');

  const seasons = [2022, 2023, 2024, 2025];

  // Games by season
  console.log('GAMES:');
  console.log('-'.repeat(70));
  for (const season of seasons) {
    const { count: total } = await supabase
      .from('cbb_games')
      .select('id', { count: 'exact', head: true })
      .eq('season', season);

    const { count: withScores } = await supabase
      .from('cbb_games')
      .select('id', { count: 'exact', head: true })
      .eq('season', season)
      .not('home_score', 'is', null);

    console.log(`${season}: ${total} total, ${withScores} with scores`);
  }

  // Betting lines coverage
  console.log('\nBETTING LINES (Spreads):');
  console.log('-'.repeat(70));

  // We need to join through game_id
  for (const season of seasons) {
    // Get game IDs for season
    const { data: gameIds } = await supabase
      .from('cbb_games')
      .select('id')
      .eq('season', season);

    if (!gameIds) continue;
    const ids = gameIds.map(g => g.id);

    // Count lines for these games
    const { count: total } = await supabase
      .from('cbb_betting_lines')
      .select('id', { count: 'exact', head: true })
      .in('game_id', ids);

    const { count: withT60 } = await supabase
      .from('cbb_betting_lines')
      .select('id', { count: 'exact', head: true })
      .in('game_id', ids)
      .not('spread_t60', 'is', null);

    const { count: withClose } = await supabase
      .from('cbb_betting_lines')
      .select('id', { count: 'exact', head: true })
      .in('game_id', ids)
      .not('spread_close', 'is', null);

    const { count: withOpen } = await supabase
      .from('cbb_betting_lines')
      .select('id', { count: 'exact', head: true })
      .in('game_id', ids)
      .not('dk_spread_open', 'is', null);

    const coverage = gameIds.length > 0 ? ((withT60 || 0) / gameIds.length * 100).toFixed(1) : '0';

    console.log(`${season}: ${gameIds.length} games, ${total} lines, T60=${withT60}, Close=${withClose}, Open=${withOpen} (${coverage}% T-60 coverage)`);
  }

  // Ratings coverage
  console.log('\nTEAM RATINGS:');
  console.log('-'.repeat(70));
  for (const season of seasons) {
    const { count } = await supabase
      .from('cbb_team_ratings')
      .select('id', { count: 'exact', head: true })
      .eq('season', season);
    console.log(`${season}: ${count} team ratings`);
  }

  // Check totals coverage (seems to be missing)
  console.log('\nTOTALS DATA:');
  console.log('-'.repeat(70));
  const { count: withTotals } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('total', 'is', null);

  const { count: withTotalOpen } = await supabase
    .from('cbb_betting_lines')
    .select('id', { count: 'exact', head: true })
    .not('total_open', 'is', null);

  console.log(`Lines with total: ${withTotals}`);
  console.log(`Lines with total_open: ${withTotalOpen}`);

  // Sample complete game for backtest
  console.log('\nSAMPLE COMPLETE GAME (for backtest):');
  console.log('-'.repeat(70));

  const { data: sample } = await supabase
    .from('cbb_games')
    .select(`
      id,
      season,
      game_date,
      home_score,
      away_score,
      home_team:cbb_teams!cbb_games_home_team_id_fkey(name),
      away_team:cbb_teams!cbb_games_away_team_id_fkey(name)
    `)
    .eq('season', 2024)
    .not('home_score', 'is', null)
    .limit(1)
    .single();

  if (sample) {
    console.log(`Game: ${(sample.away_team as any)?.name} @ ${(sample.home_team as any)?.name}`);
    console.log(`Date: ${sample.game_date}`);
    console.log(`Score: ${sample.away_score} - ${sample.home_score}`);

    // Get betting line for this game
    const { data: line } = await supabase
      .from('cbb_betting_lines')
      .select('*')
      .eq('game_id', sample.id)
      .single();

    if (line) {
      console.log(`Spread Open: ${line.dk_spread_open}`);
      console.log(`Spread T60: ${line.spread_t60}`);
      console.log(`Spread Close: ${line.spread_close}`);
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('-'.repeat(70));
  console.log('Spreads: Have DK open, T-60, and close spreads');
  console.log('Totals: MISSING - need to sync from CBBD or Odds API');
  console.log('Ratings: Have offensive/defensive/net ratings per season');
  console.log('Results: Have final scores for completed games');
}

main().catch(console.error);

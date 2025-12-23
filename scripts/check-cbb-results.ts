/**
 * Check CBB qualifying bets and their results
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CBB Qualifying Bets Check ===\n');

  // Check qualifying bets with results
  const { data, count } = await supabase
    .from('cbb_game_predictions')
    .select(`
      game_id,
      qualifies_for_bet,
      bet_result,
      predicted_side,
      edge_points,
      market_spread_home,
      model_spread_home,
      cbb_games (
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        start_date
      )
    `, { count: 'exact' })
    .eq('qualifies_for_bet', true);

  console.log('Total qualifying bets:', count);

  const withResults = data?.filter(d => d.bet_result !== null) || [];
  const pending = data?.filter(d => d.bet_result === null) || [];
  const wins = withResults.filter(d => d.bet_result === 'win').length;
  const losses = withResults.filter(d => d.bet_result === 'loss').length;

  console.log('With results:', withResults.length);
  console.log('  Wins:', wins);
  console.log('  Losses:', losses);
  console.log('  Win Rate:', withResults.length > 0 ? ((wins / withResults.length) * 100).toFixed(1) + '%' : 'N/A');
  console.log('Pending:', pending.length);

  console.log('\n=== Completed Bets ===\n');
  for (const r of withResults) {
    const game = r.cbb_games as any;
    const result = r.bet_result?.toUpperCase();
    const side = r.predicted_side?.toUpperCase();
    console.log(`[${result}] ${game?.away_team_name} @ ${game?.home_team_name}`);
    console.log(`  Bet: ${side}, Edge: ${r.edge_points?.toFixed(1)}, Spread: ${r.market_spread_home}`);
    console.log(`  Score: ${game?.away_score} - ${game?.home_score}`);
    console.log('');
  }

  if (pending.length > 0) {
    console.log('\n=== Pending Bets ===\n');
    for (const r of pending.slice(0, 5)) {
      const game = r.cbb_games as any;
      console.log(`${game?.away_team_name} @ ${game?.home_team_name} (${game?.start_date})`);
      console.log(`  Bet: ${r.predicted_side?.toUpperCase()}, Edge: ${r.edge_points?.toFixed(1)}`);
    }
  }

  // Check if there are completed games that should have been graded
  console.log('\n=== Checking for Ungraded Completed Games ===\n');

  const { data: completedGames } = await supabase
    .from('cbb_game_predictions')
    .select(`
      game_id,
      qualifies_for_bet,
      bet_result,
      predicted_side,
      market_spread_home,
      cbb_games!inner (
        home_team_name,
        away_team_name,
        home_score,
        away_score
      )
    `)
    .eq('qualifies_for_bet', true)
    .is('bet_result', null);

  const ungraded = (completedGames || []).filter(g => {
    const game = g.cbb_games as any;
    return game.home_score !== 0 || game.away_score !== 0;
  });

  console.log('Ungraded completed qualifying bets:', ungraded.length);
  for (const g of ungraded) {
    const game = g.cbb_games as any;
    console.log(`  ${game?.away_team_name} @ ${game?.home_team_name}: ${game?.away_score}-${game?.home_score}`);
  }
}

main().catch(console.error);

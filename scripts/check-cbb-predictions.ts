import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function check() {
  // Check all predictions
  const { count: totalCount } = await supabase
    .from('cbb_game_predictions')
    .select('*', { count: 'exact', head: true });

  // Check qualifying predictions
  const { data: predictions } = await supabase
    .from('cbb_game_predictions')
    .select(`
      game_id,
      market_spread_home,
      model_spread_home,
      edge_points,
      predicted_side,
      qualifies_for_bet,
      qualification_reason,
      cbb_games (
        home_team_name,
        away_team_name,
        start_date
      )
    `)
    .eq('qualifies_for_bet', true);

  console.log('=== CBB Game Predictions ===');
  console.log(`Total predictions: ${totalCount}`);
  console.log(`Qualifying bets: ${predictions?.length || 0}`);
  console.log();

  for (const p of predictions || []) {
    const game = (p as any).cbb_games;
    console.log(`${game?.away_team_name} @ ${game?.home_team_name}`);
    console.log(`  Date: ${game?.start_date}`);
    console.log(`  Market spread: ${p.market_spread_home}`);
    console.log(`  Model spread: ${p.model_spread_home?.toFixed(1)}`);
    console.log(`  Edge: ${p.edge_points?.toFixed(1)} pts`);
    console.log(`  Bet: ${p.predicted_side} (${p.qualification_reason})`);
    console.log();
  }
}

check().catch(console.error);

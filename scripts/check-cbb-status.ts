/**
 * Check CBB prediction status and identify issues
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CBB Prediction Status Check ===\n');

  // Check current predictions
  const { data: preds } = await supabase
    .from('cbb_game_predictions')
    .select('game_id, model_spread_home, market_spread_home, edge_points, qualifies_for_bet, predicted_at')
    .order('predicted_at', { ascending: false })
    .limit(10);

  console.log('Recent Predictions:');
  for (const p of preds || []) {
    console.log(`  Edge: ${p.edge_points?.toFixed(1)?.padStart(6)}, Model: ${p.model_spread_home?.toFixed(1)?.padStart(6)}, Market: ${p.market_spread_home?.toString().padStart(5)}, Qualifies: ${p.qualifies_for_bet}, At: ${p.predicted_at}`);
  }

  // Check for extreme edges
  const { data: extremes } = await supabase
    .from('cbb_game_predictions')
    .select('game_id, model_spread_home, market_spread_home, edge_points')
    .gt('edge_points', 50);

  console.log(`\nExtreme Edges (>50 pts): ${extremes?.length || 0}`);
  for (const e of (extremes || []).slice(0, 5)) {
    console.log(`  Edge: ${e.edge_points?.toFixed(1)}, Model: ${e.model_spread_home?.toFixed(1)}, Market: ${e.market_spread_home}`);
  }

  // Check ratings
  const { data: ratings } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', 2026)
    .order('elo', { ascending: false })
    .limit(5);

  console.log('\nTop Ratings (2026):');
  for (const r of ratings || []) {
    console.log(`  Rating: ${r.elo?.toFixed(1)}, Games: ${r.games_played}`);
  }

  // Check upcoming games with predictions
  const now = new Date();
  const { data: upcoming } = await supabase
    .from('cbb_games')
    .select(`
      id,
      home_team_name,
      away_team_name,
      start_date,
      cbb_game_predictions (
        model_spread_home,
        market_spread_home,
        edge_points,
        qualifies_for_bet,
        qualification_reason
      ),
      cbb_betting_lines (
        spread_home
      )
    `)
    .eq('home_score', 0)
    .eq('away_score', 0)
    .gte('start_date', now.toISOString())
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true })
    .limit(20);

  console.log('\nUpcoming Games:');
  for (const g of upcoming || []) {
    const pred = Array.isArray(g.cbb_game_predictions) ? g.cbb_game_predictions[0] : g.cbb_game_predictions;
    const line = Array.isArray(g.cbb_betting_lines) ? g.cbb_betting_lines[0] : g.cbb_betting_lines;
    const hasPred = !!pred;
    const hasLine = !!line?.spread_home;
    console.log(`  ${g.away_team_name} @ ${g.home_team_name}`);
    console.log(`    Line: ${line?.spread_home ?? 'NONE'}, Pred: ${hasPred ? `Edge ${pred?.edge_points?.toFixed(1)}, Qual: ${pred?.qualifies_for_bet}` : 'NONE'}`);
  }

  // Check if old model predictions exist (home_elo values around 1500 = old Elo model)
  const { data: oldPreds } = await supabase
    .from('cbb_game_predictions')
    .select('home_elo, away_elo')
    .gte('home_elo', 1400)
    .lte('home_elo', 1600)
    .limit(10);

  console.log(`\nOld Elo-style predictions (1400-1600 range): ${oldPreds?.length || 0}`);

  // Check qualifying bets
  const { data: qualBets } = await supabase
    .from('cbb_game_predictions')
    .select('game_id, qualifies_for_bet, bet_result')
    .eq('qualifies_for_bet', true);

  const withResult = (qualBets || []).filter(b => b.bet_result !== null);
  console.log(`\nQualifying Bets: ${qualBets?.length || 0} total, ${withResult.length} with results`);
}

main().catch(console.error);

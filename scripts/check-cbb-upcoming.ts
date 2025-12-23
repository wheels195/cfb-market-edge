/**
 * Check CBB predictions
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CBB Predictions Check ===\n');

  const { data: predictions } = await supabase
    .from('cbb_game_predictions')
    .select(`
      game_id,
      model_spread_home,
      market_spread_home,
      edge_points,
      predicted_side,
      spread_size,
      qualifies_for_bet,
      qualification_reason,
      cbb_games!inner (
        home_team_name,
        away_team_name,
        start_date,
        home_score
      )
    `)
    .eq('cbb_games.home_score', 0)
    .gte('cbb_games.start_date', new Date().toISOString())
    .order('cbb_games.start_date', { ascending: true });

  console.log(`Found ${predictions?.length || 0} upcoming predictions\n`);

  // Get team conferences
  const { data: teams } = await supabase.from('cbb_teams').select('id, name, conference');
  const teamConf = new Map<string, string>();
  for (const t of teams || []) {
    if (t.conference) teamConf.set(t.name, t.conference);
  }

  console.log('=== All Predictions ===\n');
  for (const p of predictions || []) {
    const game = (p as any).cbb_games;
    const homeConf = teamConf.get(game.home_team_name) || '?';
    const awayConf = teamConf.get(game.away_team_name) || '?';

    console.log(`${game.away_team_name} @ ${game.home_team_name}`);
    console.log(`  Market: ${p.market_spread_home}, Model: ${p.model_spread_home?.toFixed(1)}, Edge: ${p.edge_points?.toFixed(1)}`);
    console.log(`  Spread Size: ${p.spread_size?.toFixed(1)}, Side: ${p.predicted_side}`);
    console.log(`  Conferences: ${awayConf} @ ${homeConf}`);
    console.log(`  Qualifies: ${p.qualifies_for_bet ? 'YES' : 'NO'} - ${p.qualification_reason}`);
    console.log('');
  }

  // Show spread distribution
  const spreads = (predictions || []).map(p => p.spread_size || 0);
  console.log('=== Spread Size Distribution ===');
  console.log(`  7-14 pt spreads: ${spreads.filter(s => s >= 7 && s <= 14).length}`);
  console.log(`  < 7 pt spreads: ${spreads.filter(s => s < 7).length}`);
  console.log(`  > 14 pt spreads: ${spreads.filter(s => s > 14).length}`);
}

main().catch(console.error);

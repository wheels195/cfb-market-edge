import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function check() {
  // Query like the API does
  const { data: games } = await supabase
    .from('cbb_games')
    .select(`
      id,
      home_team_name,
      away_team_name,
      home_score,
      away_score,
      cbb_game_predictions (
        qualifies_for_bet,
        bet_result
      )
    `)
    .eq('season', 2026)
    .or('home_score.neq.0,away_score.neq.0')
    .order('start_date', { ascending: false })
    .limit(10);

  for (const game of games || []) {
    const pred = (game as any).cbb_game_predictions;
    console.log(`${game.away_team_name} @ ${game.home_team_name}`);
    console.log('  predictions type:', Array.isArray(pred) ? 'array' : typeof pred);
    console.log('  predictions:', pred);
    console.log();
  }
}
check();

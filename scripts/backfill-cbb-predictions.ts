/**
 * Backfill CBB predictions for completed games
 * This allows us to show historical results with win/loss
 */

import { createClient } from '@supabase/supabase-js';
import { CbbEloSystem, analyzeCbbBet, evaluateCbbBet } from '../src/lib/models/cbb-elo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function backfill() {
  const season = 2026;

  console.log('=== Backfilling CBB Predictions ===\n');

  // Load Elo ratings
  const { data: eloData } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', season);

  const elo = new CbbEloSystem();
  for (const row of eloData || []) {
    elo.setElo(row.team_id, row.elo, row.games_played);
  }
  console.log(`Loaded ${eloData?.length || 0} Elo ratings`);

  // Get completed games with betting lines that don't have predictions yet
  const { data: games, error } = await supabase
    .from('cbb_games')
    .select(`
      id,
      home_team_id,
      away_team_id,
      home_team_name,
      away_team_name,
      start_date,
      home_score,
      away_score,
      cbb_betting_lines (
        spread_home,
        provider
      )
    `)
    .eq('season', season)
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Error fetching games:', error);
    return;
  }

  console.log(`Found ${games?.length || 0} completed D1 games\n`);

  let written = 0;
  let graded = 0;
  let wins = 0;
  let losses = 0;
  let qualifyingBets = 0;

  for (const game of games || []) {
    const bettingLines = (game as any).cbb_betting_lines as Array<{ spread_home: number }> | null;
    const line = bettingLines?.[0];

    if (!line?.spread_home) continue;

    const homeEloData = eloData?.find(e => e.team_id === game.home_team_id);
    const awayEloData = eloData?.find(e => e.team_id === game.away_team_id);

    if (!homeEloData || !awayEloData) continue;

    const modelSpread = elo.getSpread(game.home_team_id, game.away_team_id);
    const marketSpread = line.spread_home;

    const analysis = analyzeCbbBet(
      marketSpread,
      modelSpread,
      homeEloData.games_played,
      awayEloData.games_played
    );

    // Calculate result
    const homeMargin = game.home_score - game.away_score;
    const evaluation = evaluateCbbBet(
      analysis.side,
      marketSpread,
      homeMargin
    );

    const prediction = {
      game_id: game.id,
      model_spread_home: modelSpread,
      market_spread_home: marketSpread,
      edge_points: analysis.absEdge,
      predicted_side: analysis.side,
      home_elo: homeEloData.elo,
      away_elo: awayEloData.elo,
      home_games_played: homeEloData.games_played,
      away_games_played: awayEloData.games_played,
      spread_size: analysis.spreadSize,
      is_underdog_bet: analysis.isUnderdog,
      qualifies_for_bet: analysis.qualifies,
      qualification_reason: analysis.qualifies ? analysis.qualificationReason : analysis.reason,
      bet_result: evaluation.result,
      predicted_at: game.start_date,
      graded_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from('cbb_game_predictions')
      .upsert(prediction, { onConflict: 'game_id' });

    if (upsertError) {
      console.error(`Error for ${game.id}:`, upsertError.message);
    } else {
      written++;
      graded++;

      if (analysis.qualifies) {
        qualifyingBets++;
        if (evaluation.won) wins++;
        else if (!evaluation.push) losses++;

        console.log(`${game.away_team_name} @ ${game.home_team_name}`);
        console.log(`  Spread: ${marketSpread}, Model: ${modelSpread.toFixed(1)}, Edge: ${analysis.absEdge.toFixed(1)}`);
        console.log(`  Bet: ${analysis.side} | Result: ${evaluation.result.toUpperCase()}`);
        console.log(`  Score: ${game.away_score}-${game.home_score}`);
        console.log();
      }
    }
  }

  console.log('=== SUMMARY ===');
  console.log(`Predictions written: ${written}`);
  console.log(`Qualifying bets: ${qualifyingBets}`);
  console.log(`Record: ${wins}-${losses}`);
  if (wins + losses > 0) {
    const winRate = wins / (wins + losses);
    const roi = (wins * 0.91 - losses) / (wins + losses);
    console.log(`Win rate: ${(winRate * 100).toFixed(1)}%`);
    console.log(`ROI: ${(roi * 100).toFixed(1)}%`);
  }
}

backfill().catch(console.error);

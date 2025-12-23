/**
 * Re-grade all CBB bets with the corrected model
 *
 * This script:
 * 1. Recalculates model spreads for completed games using correct ratings
 * 2. Re-evaluates which games qualified for bets
 * 3. Updates bet results
 */

import { createClient } from '@supabase/supabase-js';
import {
  CbbRatingSystem,
  CBB_RATING_CONSTANTS,
  analyzeCbbBet,
  evaluateCbbBet
} from '../src/lib/models/cbb-elo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== Re-grading CBB Bets with Corrected Model ===\n');

  const currentSeason = 2026;

  // Load team conferences
  const { data: teams } = await supabase.from('cbb_teams').select('id, name, conference');
  const teamConf = new Map<string, string>();
  const teamNames = new Map<string, string>();
  for (const t of teams || []) {
    if (t.conference) teamConf.set(t.id, t.conference);
    teamNames.set(t.id, t.name);
  }

  // Load corrected ratings
  const { data: ratings } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', currentSeason);

  const ratingSystem = new CbbRatingSystem();
  for (const [teamId, conf] of teamConf) {
    ratingSystem.setTeamConference(teamId, conf);
  }
  for (const r of ratings || []) {
    ratingSystem.setRating(r.team_id, r.elo, r.games_played);
  }

  console.log(`Loaded ${teamConf.size} team conferences`);
  console.log(`Loaded ${ratings?.length || 0} team ratings\n`);

  // Get all games with predictions
  const { data: predictions } = await supabase
    .from('cbb_game_predictions')
    .select(`
      game_id,
      qualifies_for_bet,
      bet_result,
      cbb_games!inner (
        id,
        home_team_id,
        away_team_id,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        cbb_betting_lines (spread_home)
      )
    `);

  console.log(`Found ${predictions?.length || 0} predictions to re-evaluate\n`);

  let requalified = 0;
  let disqualified = 0;
  let wins = 0;
  let losses = 0;
  let noResult = 0;

  const updates: any[] = [];

  for (const pred of predictions || []) {
    const game = pred.cbb_games as any;
    const lines = game.cbb_betting_lines;
    const line = Array.isArray(lines) ? lines[0] : lines;
    const marketSpread = line?.spread_home;

    if (marketSpread === null || marketSpread === undefined) continue;

    const homeConf = teamConf.get(game.home_team_id) || null;
    const awayConf = teamConf.get(game.away_team_id) || null;

    // Recalculate model spread
    const modelSpread = ratingSystem.getSpread(game.home_team_id, game.away_team_id);

    // Re-analyze bet
    const analysis = analyzeCbbBet(marketSpread, modelSpread, homeConf, awayConf);

    // Check if game is completed
    const isCompleted = game.home_score !== 0 || game.away_score !== 0;

    let betResult = null;
    if (isCompleted && analysis.qualifies) {
      const margin = game.home_score - game.away_score;
      const result = evaluateCbbBet(analysis.side, marketSpread, margin);
      betResult = result.result;

      if (result.result === 'win') wins++;
      else if (result.result === 'loss') losses++;
    } else if (analysis.qualifies) {
      noResult++;
    }

    // Track changes
    if (analysis.qualifies && !pred.qualifies_for_bet) requalified++;
    if (!analysis.qualifies && pred.qualifies_for_bet) disqualified++;

    updates.push({
      game_id: pred.game_id,
      model_spread_home: modelSpread,
      market_spread_home: marketSpread,
      edge_points: analysis.absEdge,
      predicted_side: analysis.side,
      home_elo: ratingSystem.getTotalRating(game.home_team_id),
      away_elo: ratingSystem.getTotalRating(game.away_team_id),
      spread_size: analysis.spreadSize,
      is_underdog_bet: analysis.isUnderdog,
      qualifies_for_bet: analysis.qualifies,
      qualification_reason: analysis.qualifies ? analysis.qualificationReason : analysis.reason,
      bet_result: betResult,
      predicted_at: new Date().toISOString(),
    });
  }

  console.log('=== Re-evaluation Results ===');
  console.log(`  Games analyzed: ${updates.length}`);
  console.log(`  Newly qualified: ${requalified}`);
  console.log(`  Disqualified: ${disqualified}`);
  console.log(`  Qualifying bets with results: ${wins + losses}`);
  console.log(`    Wins: ${wins}`);
  console.log(`    Losses: ${losses}`);
  console.log(`    Win Rate: ${wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0}%`);
  console.log(`  Qualifying bets pending: ${noResult}\n`);

  // Update predictions
  console.log('Updating predictions in database...');
  let updated = 0;
  for (const update of updates) {
    const { error } = await supabase
      .from('cbb_game_predictions')
      .upsert(update, { onConflict: 'game_id' });
    if (!error) updated++;
  }
  console.log(`  Updated ${updated} predictions\n`);

  // Show qualifying bets
  const qualifyingBets = updates.filter(u => u.qualifies_for_bet);
  console.log(`=== Qualifying Bets (${qualifyingBets.length}) ===\n`);

  for (const bet of qualifyingBets.slice(0, 20)) {
    const game = predictions?.find(p => p.game_id === bet.game_id)?.cbb_games as any;
    const result = bet.bet_result ? ` [${bet.bet_result.toUpperCase()}]` : '';
    console.log(`  ${game?.away_team_name} @ ${game?.home_team_name}`);
    console.log(`    Bet ${bet.predicted_side.toUpperCase()}, Edge ${bet.edge_points.toFixed(1)}, Spread ${bet.spread_size.toFixed(1)}${result}`);
  }
}

main().catch(console.error);

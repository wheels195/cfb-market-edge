/**
 * CBB Grade Bets Job
 *
 * Grades completed predictions based on actual game results
 */

import { supabase } from '@/lib/db/client';
import { evaluateCbbBet } from '@/lib/models/cbb-elo';

export interface CbbGradeBetsResult {
  gamesGraded: number;
  wins: number;
  losses: number;
  pushes: number;
  errors: string[];
}

/**
 * Grade completed CBB predictions
 */
export async function gradeCbbBets(): Promise<CbbGradeBetsResult> {
  const result: CbbGradeBetsResult = {
    gamesGraded: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    errors: [],
  };

  try {
    // Get predictions that need grading (game completed, no bet_result yet)
    // CBBD uses 0 for upcoming games, so completed games have non-zero scores
    const { data: ungraded, error: fetchError } = await supabase
      .from('cbb_game_predictions')
      .select(`
        id,
        game_id,
        predicted_side,
        market_spread_home,
        qualifies_for_bet,
        cbb_games!inner (
          home_score,
          away_score
        )
      `)
      .is('bet_result', null)
      .or('cbb_games.home_score.neq.0,cbb_games.away_score.neq.0');

    if (fetchError) {
      result.errors.push(`Fetch error: ${fetchError.message}`);
      return result;
    }

    console.log(`Found ${ungraded?.length || 0} predictions to grade`);

    for (const prediction of ungraded || []) {
      try {
        const gameData = prediction.cbb_games as unknown as { home_score: number; away_score: number };
        const homeMargin = gameData.home_score - gameData.away_score;

        // Evaluate the bet
        const evaluation = evaluateCbbBet(
          prediction.predicted_side as 'home' | 'away',
          prediction.market_spread_home,
          homeMargin
        );

        // Update prediction with result
        const { error: updateError } = await supabase
          .from('cbb_game_predictions')
          .update({
            bet_result: evaluation.result,
            result: evaluation.result, // Also update legacy field
            graded_at: new Date().toISOString(),
          })
          .eq('id', prediction.id);

        if (updateError) {
          result.errors.push(`Update error for ${prediction.id}: ${updateError.message}`);
        } else {
          result.gamesGraded++;

          // Only count stats for qualifying bets
          if (prediction.qualifies_for_bet) {
            if (evaluation.won) result.wins++;
            else if (evaluation.push) result.pushes++;
            else result.losses++;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Game ${prediction.game_id}: ${message}`);
      }
    }

    console.log(`Graded ${result.gamesGraded} games: ${result.wins}W-${result.losses}L-${result.pushes}P`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Job error: ${message}`);
  }

  return result;
}

/**
 * Get CBB betting performance stats
 */
export async function getCbbPerformanceStats(): Promise<{
  total_bets: number;
  wins: number;
  losses: number;
  pushes: number;
  win_rate: number;
  profit_units: number;
  roi: number;
}> {
  // Get all graded qualifying bets
  const { data, error } = await supabase
    .from('cbb_game_predictions')
    .select('bet_result')
    .eq('qualifies_for_bet', true)
    .not('bet_result', 'is', null);

  if (error) {
    console.error('Error fetching stats:', error);
    return {
      total_bets: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      win_rate: 0,
      profit_units: 0,
      roi: 0,
    };
  }

  const results = data || [];
  const wins = results.filter(r => r.bet_result === 'win').length;
  const losses = results.filter(r => r.bet_result === 'loss').length;
  const pushes = results.filter(r => r.bet_result === 'push').length;
  const totalBets = wins + losses; // Exclude pushes from total

  const profitUnits = (wins * 0.91) - losses;
  const roi = totalBets > 0 ? profitUnits / totalBets : 0;
  const winRate = totalBets > 0 ? wins / totalBets : 0;

  return {
    total_bets: totalBets,
    wins,
    losses,
    pushes,
    win_rate: winRate,
    profit_units: profitUnits,
    roi,
  };
}

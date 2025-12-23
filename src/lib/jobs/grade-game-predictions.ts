/**
 * Grade Game Predictions Job
 *
 * Grades the game_predictions table (CFB model predictions).
 * This is separate from bet_records which tracks manual/paper bets.
 */

import { supabase } from '@/lib/db/client';

export interface GradeResult {
  predictionsGraded: number;
  wins: number;
  losses: number;
  pushes: number;
  errors: string[];
}

export async function gradeGamePredictions(): Promise<GradeResult> {
  const result: GradeResult = {
    predictionsGraded: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    errors: [],
  };

  console.log('[GradeGamePredictions] Starting...');

  try {
    // Get ungraded game_predictions
    const { data: ungraded, error: fetchError } = await supabase
      .from('game_predictions')
      .select('id, event_id, closing_spread_home, recommended_side')
      .is('bet_result', null)
      .not('closing_spread_home', 'is', null)
      .not('recommended_side', 'is', null);

    if (fetchError) {
      result.errors.push(`Fetch error: ${fetchError.message}`);
      return result;
    }

    if (!ungraded || ungraded.length === 0) {
      console.log('[GradeGamePredictions] No ungraded predictions found');
      return result;
    }

    console.log(`[GradeGamePredictions] Found ${ungraded.length} ungraded predictions`);

    // Get results for these events
    const eventIds = ungraded.map(p => p.event_id);
    const { data: results, error: resultError } = await supabase
      .from('results')
      .select('event_id, home_score, away_score')
      .in('event_id', eventIds);

    if (resultError) {
      result.errors.push(`Results fetch error: ${resultError.message}`);
      return result;
    }

    // Create lookup map
    const resultMap = new Map<string, { home_score: number; away_score: number }>();
    for (const r of results || []) {
      resultMap.set(r.event_id, { home_score: r.home_score, away_score: r.away_score });
    }

    // Grade each prediction
    for (const pred of ungraded) {
      const gameResult = resultMap.get(pred.event_id);
      if (!gameResult || gameResult.home_score === null) {
        continue; // No result yet
      }

      const betResult = gradePrediction(
        pred.recommended_side,
        pred.closing_spread_home,
        gameResult.home_score,
        gameResult.away_score
      );

      const { error: updateError } = await supabase
        .from('game_predictions')
        .update({ bet_result: betResult })
        .eq('id', pred.id);

      if (updateError) {
        result.errors.push(`Update error for ${pred.id}: ${updateError.message}`);
      } else {
        result.predictionsGraded++;
        if (betResult === 'win') result.wins++;
        else if (betResult === 'loss') result.losses++;
        else result.pushes++;
      }
    }

    console.log(`[GradeGamePredictions] Complete: ${result.predictionsGraded} graded (${result.wins}W-${result.losses}L-${result.pushes}P)`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`GradeGamePredictions failed: ${msg}`);
    console.error(`[GradeGamePredictions] Error: ${msg}`);
  }

  return result;
}

function gradePrediction(
  side: string,
  spreadAtClose: number,
  homeScore: number,
  awayScore: number
): 'win' | 'loss' | 'push' {
  const actualMargin = homeScore - awayScore;

  if (side === 'home') {
    const cover = actualMargin + spreadAtClose;
    if (cover > 0) return 'win';
    if (cover < 0) return 'loss';
    return 'push';
  } else {
    const cover = -actualMargin - spreadAtClose;
    if (cover > 0) return 'win';
    if (cover < 0) return 'loss';
    return 'push';
  }
}

/**
 * Grade Paper Bets Job
 *
 * Grades paper_bets using game results from the results table.
 */

import { supabase } from '@/lib/db/client';

export interface GradePaperBetsResult {
  betsGraded: number;
  wins: number;
  losses: number;
  pushes: number;
  errors: string[];
}

export async function gradePaperBets(): Promise<GradePaperBetsResult> {
  const result: GradePaperBetsResult = {
    betsGraded: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    errors: [],
  };

  console.log('[GradePaperBets] Starting...');

  try {
    // Get pending paper bets
    const { data: pendingBets, error: fetchError } = await supabase
      .from('paper_bets')
      .select(`
        *,
        events!inner(
          id,
          home_team_id,
          away_team_id,
          commence_time,
          status
        )
      `)
      .eq('result', 'pending')
      .limit(100);

    if (fetchError) {
      result.errors.push(`Fetch error: ${fetchError.message}`);
      return result;
    }

    if (!pendingBets || pendingBets.length === 0) {
      console.log('[GradePaperBets] No pending bets');
      return result;
    }

    console.log(`[GradePaperBets] Found ${pendingBets.length} pending bets`);

    // Get results for these events
    const eventIds = pendingBets.map(b => b.event_id);
    const { data: results, error: resultsError } = await supabase
      .from('results')
      .select('event_id, home_score, away_score')
      .in('event_id', eventIds);

    if (resultsError) {
      result.errors.push(`Results fetch error: ${resultsError.message}`);
      return result;
    }

    const resultsMap = new Map(results?.map(r => [r.event_id, r]) || []);

    // Grade each bet
    for (const bet of pendingBets) {
      const gameResult = resultsMap.get(bet.event_id);

      if (!gameResult) {
        // No result yet, skip
        continue;
      }

      const { home_score, away_score } = gameResult;
      const gradeResult = gradeSpreadBet(
        bet.side,
        bet.market_spread_home,
        home_score,
        away_score
      );

      // Calculate profit/loss
      let profitLoss = 0;
      if (gradeResult === 'win') {
        // Use American odds to calculate winnings
        const odds = bet.spread_price_american;
        if (odds > 0) {
          profitLoss = bet.stake_amount * (odds / 100);
        } else {
          profitLoss = bet.stake_amount * (100 / Math.abs(odds));
        }
      } else if (gradeResult === 'loss') {
        profitLoss = -bet.stake_amount;
      }
      // Push = 0 profit/loss

      // Update the bet
      const { error: updateError } = await supabase
        .from('paper_bets')
        .update({
          result: gradeResult,
          home_score,
          away_score,
          profit_loss: profitLoss,
          status: 'settled',
          game_ended_at: new Date().toISOString(),
        })
        .eq('id', bet.id);

      if (updateError) {
        result.errors.push(`Update error for ${bet.id}: ${updateError.message}`);
      } else {
        result.betsGraded++;
        if (gradeResult === 'win') result.wins++;
        else if (gradeResult === 'loss') result.losses++;
        else result.pushes++;

        console.log(`[GradePaperBets] Graded bet ${bet.id}: ${gradeResult} (${profitLoss > 0 ? '+' : ''}$${profitLoss.toFixed(0)})`);
      }
    }

    console.log(`[GradePaperBets] Complete: ${result.betsGraded} graded (${result.wins}W-${result.losses}L-${result.pushes}P)`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(msg);
    console.error('[GradePaperBets] Error:', msg);
  }

  return result;
}

function gradeSpreadBet(
  side: string,
  spreadAtBet: number,
  homeScore: number,
  awayScore: number
): 'win' | 'loss' | 'push' {
  const actualMargin = homeScore - awayScore;

  if (side === 'home') {
    const adjusted = actualMargin + spreadAtBet;
    if (adjusted > 0) return 'win';
    if (adjusted < 0) return 'loss';
    return 'push';
  } else {
    // Away side
    const adjusted = -actualMargin - spreadAtBet;
    if (adjusted > 0) return 'win';
    if (adjusted < 0) return 'loss';
    return 'push';
  }
}

/**
 * Grade Bets Job
 *
 * Grades bet_records using stored spread_at_bet and actual game results.
 * Reads from bet_records table, NOT edges table (cleanup-safe).
 *
 * Schedule: Sundays at 7 AM UTC (1 AM Central Standard / 2 AM Central Daylight)
 */

import { supabase } from '@/lib/db/client';

export interface GradeResult {
  betsGraded: number;
  wins: number;
  losses: number;
  pushes: number;
  clvCalculated: number;
  errors: string[];
}

/**
 * Grade ungraded bet_records that have results available
 */
export async function gradeBets(): Promise<GradeResult> {
  const result: GradeResult = {
    betsGraded: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    clvCalculated: 0,
    errors: [],
  };

  console.log('[GradeBets] Starting bet grading...');

  try {
    // Get ungraded bet_records
    const { data: ungradedBets, error: fetchError } = await supabase
      .from('bet_records')
      .select('*')
      .is('result', null)
      .limit(500);

    if (fetchError) {
      result.errors.push(`Failed to fetch ungraded bets: ${fetchError.message}`);
      return result;
    }

    if (!ungradedBets || ungradedBets.length === 0) {
      console.log('[GradeBets] No ungraded bets found');
      return result;
    }

    console.log(`[GradeBets] Found ${ungradedBets.length} ungraded bets`);

    // Get unique game keys to fetch results
    const gameKeys = [...new Set(ungradedBets.map(b => b.game_key))];

    // For each ungraded bet, check if we have results
    for (const bet of ungradedBets) {
      try {
        // Try to find the result via event lookup
        // game_key format is typically: "away_team @ home_team YYYY-MM-DD"
        const { data: eventResult } = await supabase
          .from('results')
          .select(`
            event_id,
            home_score,
            away_score,
            events!inner(
              home_team_name,
              away_team_name
            )
          `)
          .eq('events.home_team_name', bet.team)
          .eq('events.commence_time', bet.timestamp)
          .limit(1)
          .single();

        // Alternative: Look up by team name and approximate date
        if (!eventResult) {
          // Try a broader search
          const seasonStart = new Date(bet.season, 7, 1); // August 1
          const seasonEnd = new Date(bet.season + 1, 1, 28); // February 28

          const { data: results } = await supabase
            .from('results')
            .select(`
              event_id,
              home_score,
              away_score,
              events!inner(
                id,
                home_team_name,
                away_team_name,
                commence_time
              )
            `)
            .gte('events.commence_time', seasonStart.toISOString())
            .lte('events.commence_time', seasonEnd.toISOString())
            .limit(500);

          if (results) {
            // Find matching game by team and approximate week
            const matchingResult = results.find(r => {
              const event = r.events as { home_team_name?: string; away_team_name?: string };
              const isTeamMatch =
                event?.home_team_name === bet.team ||
                event?.away_team_name === bet.team;

              // Check if within same week window
              const eventDate = new Date((r.events as { commence_time?: string })?.commence_time || 0);
              const betDate = new Date(bet.timestamp);
              const daysDiff = Math.abs(eventDate.getTime() - betDate.getTime()) / (1000 * 60 * 60 * 24);

              return isTeamMatch && daysDiff < 7;
            });

            if (matchingResult) {
              const gradeResult = gradeSpreadBet(
                bet.side,
                bet.spread_at_bet,
                matchingResult.home_score,
                matchingResult.away_score
              );

              // Update bet_record
              const { error: updateError } = await supabase
                .from('bet_records')
                .update({
                  result: gradeResult,
                  home_score: matchingResult.home_score,
                  away_score: matchingResult.away_score,
                })
                .eq('id', bet.id);

              if (updateError) {
                result.errors.push(`Failed to update bet ${bet.id}: ${updateError.message}`);
              } else {
                result.betsGraded++;
                if (gradeResult === 'win') result.wins++;
                else if (gradeResult === 'loss') result.losses++;
                else result.pushes++;

                console.log(`[GradeBets] Graded bet ${bet.id}: ${gradeResult}`);
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Error grading bet ${bet.id}: ${msg}`);
      }
    }

    console.log(`[GradeBets] Complete: ${result.betsGraded} graded (${result.wins}W-${result.losses}L-${result.pushes}P)`);

    // Calculate CLV for bets that have closing lines but no CLV yet
    await calculateCLV(result);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`GradeBets failed: ${msg}`);
    console.error(`[GradeBets] Error: ${msg}`);
  }

  return result;
}

/**
 * Calculate CLV for bets that have closing lines
 * CLV = how much better we got than the closing line
 */
async function calculateCLV(result: GradeResult): Promise<void> {
  console.log('[GradeBets] Calculating CLV for bets with closing data...');

  // Find spread bets with closing lines but no CLV calculated
  const { data: betsNeedingCLV, error } = await supabase
    .from('bet_records')
    .select('id, side, spread_at_bet, spread_at_close, market_type, total_at_bet, total_at_close')
    .not('spread_at_close', 'is', null)
    .is('clv_points', null)
    .limit(500);

  if (error) {
    result.errors.push(`CLV fetch failed: ${error.message}`);
    return;
  }

  if (!betsNeedingCLV || betsNeedingCLV.length === 0) {
    console.log('[GradeBets] No bets need CLV calculation');
    return;
  }

  console.log(`[GradeBets] Calculating CLV for ${betsNeedingCLV.length} bets`);

  for (const bet of betsNeedingCLV) {
    try {
      let clvPoints: number | null = null;

      const marketType = bet.market_type || 'spread';

      if (marketType === 'spread' && bet.spread_at_close !== null) {
        // Spread CLV:
        // Home bet: CLV = spread_at_close - spread_at_bet (if close moved toward away, we got value)
        // Away bet: CLV = spread_at_bet - spread_at_close (if close moved toward home, we got value)
        if (bet.side === 'home') {
          clvPoints = bet.spread_at_close - bet.spread_at_bet;
        } else {
          clvPoints = bet.spread_at_bet - bet.spread_at_close;
        }
      } else if (marketType === 'total' && bet.total_at_close !== null && bet.total_at_bet !== null) {
        // Total CLV:
        // Over bet: CLV = total_at_close - total_at_bet (if close moved higher, we got value)
        // Under bet: CLV = total_at_bet - total_at_close (if close moved lower, we got value)
        if (bet.side === 'over') {
          clvPoints = bet.total_at_close - bet.total_at_bet;
        } else {
          clvPoints = bet.total_at_bet - bet.total_at_close;
        }
      }

      if (clvPoints !== null) {
        const { error: updateError } = await supabase
          .from('bet_records')
          .update({ clv_points: clvPoints })
          .eq('id', bet.id);

        if (updateError) {
          result.errors.push(`CLV update failed for ${bet.id}: ${updateError.message}`);
        } else {
          result.clvCalculated++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`CLV calculation error for ${bet.id}: ${msg}`);
    }
  }

  console.log(`[GradeBets] CLV calculated for ${result.clvCalculated} bets`);
}

/**
 * Grade a spread bet
 *
 * @param side - 'home' or 'away'
 * @param spreadAtBet - the spread when bet was placed (from home perspective)
 * @param homeScore - final home team score
 * @param awayScore - final away team score
 * @returns 'win', 'loss', or 'push'
 */
function gradeSpreadBet(
  side: string,
  spreadAtBet: number,
  homeScore: number,
  awayScore: number
): 'win' | 'loss' | 'push' {
  const actualMargin = homeScore - awayScore; // Positive = home won by that margin

  if (side === 'home') {
    // Home bet wins if actualMargin + spread > 0
    // e.g., Home -7, Home wins by 10: 10 + (-7) = 3 > 0 → WIN
    // e.g., Home -7, Home wins by 7: 7 + (-7) = 0 → PUSH
    // e.g., Home -7, Home wins by 5: 5 + (-7) = -2 < 0 → LOSS
    const adjusted = actualMargin + spreadAtBet;
    if (adjusted > 0) return 'win';
    if (adjusted < 0) return 'loss';
    return 'push';
  } else {
    // Away bet wins if actualMargin + spread < 0
    // (equivalent to away covering the opposite spread)
    // e.g., Away +7, Away loses by 5: -5 + 7 = 2 > 0 → WIN for away
    // Actually, for away side, we flip: adjusted = -actualMargin - spreadAtBet
    const adjusted = -actualMargin - spreadAtBet;
    if (adjusted > 0) return 'win';
    if (adjusted < 0) return 'loss';
    return 'push';
  }
}

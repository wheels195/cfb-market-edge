/**
 * CLV (Closing Line Value) Calculation Module
 *
 * CLV is the gold standard for measuring betting skill. It measures
 * how much better your bet was compared to the closing line.
 *
 * Positive CLV = you beat the closing line (edge)
 * Negative CLV = you got worse than closing (bad timing)
 */

import { supabase } from '@/lib/db/client';

export interface CLVResult {
  eventId: string;
  sportsbookId: string;
  marketType: 'spread' | 'total';
  betSide: string;
  betPoints: number;
  betPriceAmerican: number;
  betTimestamp: string;
  closePoints: number;
  closePriceAmerican: number;
  closeTimestamp: string;
  clvPoints: number;
  clvCents: number | null;
  pinnacleClosePoints: number | null;
  pinnacleClvPoints: number | null;
}

/**
 * Calculate CLV for a completed bet
 *
 * For spreads:
 *   - If you bet Home -6.5 and it closed at Home -7.5, you have +1.0 CLV
 *   - If you bet Away +6.5 and it closed at Away +5.5, you have +1.0 CLV
 *
 * For totals:
 *   - If you bet Over 55.5 and it closed at 56.5, you have +1.0 CLV
 *   - If you bet Under 55.5 and it closed at 54.5, you have +1.0 CLV
 */
export function calculateCLV(
  marketType: 'spread' | 'total',
  betSide: string,
  betPoints: number,
  closePoints: number
): number {
  const movement = closePoints - betPoints;

  if (marketType === 'spread') {
    // For spreads, positive movement means line moved toward the side you bet
    // If you bet Home -6.5 and it closed at -7.5, you got +1.0 CLV
    // (the market agreed with you)
    if (betSide === 'home') {
      return -movement; // Line moving more negative = you got value
    } else {
      return movement; // Line moving more positive = you got value
    }
  } else {
    // For totals
    if (betSide === 'over') {
      return movement; // Line moving up = you got value on over
    } else {
      return -movement; // Line moving down = you got value on under
    }
  }
}

/**
 * Convert CLV points to cents (accounting for juice)
 * Rough approximation: 0.5 points ≈ 10 cents at standard -110
 */
export function clvPointsToCents(clvPoints: number): number {
  return Math.round(clvPoints * 20); // 0.5 pts = 10 cents
}

/**
 * Calculate CLV for all edges from completed games
 */
export async function calculateCLVForCompletedGames(): Promise<{
  processed: number;
  clvResults: CLVResult[];
  errors: string[];
}> {
  const errors: string[] = [];
  const clvResults: CLVResult[] = [];

  try {
    // Get completed events that have edges but no CLV calculated yet
    const { data: completedEdges, error: edgesError } = await supabase
      .from('edges')
      .select(`
        id,
        event_id,
        sportsbook_id,
        market_type,
        recommended_side,
        market_spread_home,
        market_total_points,
        market_price_american,
        as_of,
        events!inner(id, status, commence_time)
      `)
      .eq('events.status', 'final');

    if (edgesError) {
      errors.push(`Failed to fetch edges: ${edgesError.message}`);
      return { processed: 0, clvResults, errors };
    }

    if (!completedEdges || completedEdges.length === 0) {
      return { processed: 0, clvResults, errors };
    }

    for (const edge of completedEdges) {
      try {
        // Get closing line for this event/book/market
        const { data: closingLine, error: closeError } = await supabase
          .from('closing_lines')
          .select('*')
          .eq('event_id', edge.event_id)
          .eq('sportsbook_id', edge.sportsbook_id)
          .eq('market_type', edge.market_type)
          .eq('side', edge.recommended_side)
          .single();

        if (closeError || !closingLine) {
          continue; // No closing line available
        }

        // Get bet points based on market type
        const betPoints = edge.market_type === 'spread'
          ? edge.market_spread_home
          : edge.market_total_points;

        const closePoints = edge.market_type === 'spread'
          ? closingLine.spread_points_home
          : closingLine.total_points;

        if (betPoints === null || closePoints === null) continue;

        // Calculate CLV
        const clvPoints = calculateCLV(
          edge.market_type,
          edge.recommended_side,
          betPoints,
          closePoints
        );

        const clvCents = clvPointsToCents(clvPoints);

        // Try to get Pinnacle closing line for benchmark
        let pinnacleClosePoints: number | null = null;
        let pinnacleClvPoints: number | null = null;

        const { data: pinnacleBook } = await supabase
          .from('sportsbooks')
          .select('id')
          .eq('key', 'pinnacle')
          .single();

        if (pinnacleBook) {
          const { data: pinnacleClose } = await supabase
            .from('closing_lines')
            .select('*')
            .eq('event_id', edge.event_id)
            .eq('sportsbook_id', pinnacleBook.id)
            .eq('market_type', edge.market_type)
            .eq('side', edge.recommended_side)
            .single();

          if (pinnacleClose) {
            pinnacleClosePoints = edge.market_type === 'spread'
              ? pinnacleClose.spread_points_home
              : pinnacleClose.total_points;

            if (pinnacleClosePoints !== null) {
              pinnacleClvPoints = calculateCLV(
                edge.market_type,
                edge.recommended_side,
                betPoints,
                pinnacleClosePoints
              );
            }
          }
        }

        const result: CLVResult = {
          eventId: edge.event_id,
          sportsbookId: edge.sportsbook_id,
          marketType: edge.market_type,
          betSide: edge.recommended_side,
          betPoints,
          betPriceAmerican: edge.market_price_american || -110,
          betTimestamp: edge.as_of,
          closePoints,
          closePriceAmerican: closingLine.price_american,
          closeTimestamp: closingLine.captured_at,
          clvPoints,
          clvCents,
          pinnacleClosePoints,
          pinnacleClvPoints,
        };

        clvResults.push(result);

        // Upsert to clv_results table
        await supabase.from('clv_results').upsert({
          event_id: result.eventId,
          sportsbook_id: result.sportsbookId,
          market_type: result.marketType,
          bet_side: result.betSide,
          bet_points: result.betPoints,
          bet_price_american: result.betPriceAmerican,
          bet_timestamp: result.betTimestamp,
          close_points: result.closePoints,
          close_price_american: result.closePriceAmerican,
          close_timestamp: result.closeTimestamp,
          clv_points: result.clvPoints,
          clv_cents: result.clvCents,
          pinnacle_close_points: result.pinnacleClosePoints,
          pinnacle_clv_points: result.pinnacleClvPoints,
        }, {
          onConflict: 'event_id,sportsbook_id,market_type',
        });
      } catch (err) {
        errors.push(`Error processing edge ${edge.id}: ${err}`);
      }
    }

    return {
      processed: clvResults.length,
      clvResults,
      errors,
    };
  } catch (err) {
    errors.push(`CLV calculation failed: ${err}`);
    return { processed: 0, clvResults, errors };
  }
}

/**
 * Get CLV summary statistics
 */
export async function getCLVSummary(): Promise<{
  totalBets: number;
  avgClvPoints: number;
  avgClvCents: number;
  positiveCLVRate: number;
  avgPinnacleClv: number | null;
  byMarketType: {
    spread: { count: number; avgClv: number };
    total: { count: number; avgClv: number };
  };
}> {
  const { data: clvData, error } = await supabase
    .from('clv_results')
    .select('*');

  if (error || !clvData || clvData.length === 0) {
    return {
      totalBets: 0,
      avgClvPoints: 0,
      avgClvCents: 0,
      positiveCLVRate: 0,
      avgPinnacleClv: null,
      byMarketType: {
        spread: { count: 0, avgClv: 0 },
        total: { count: 0, avgClv: 0 },
      },
    };
  }

  const totalBets = clvData.length;
  const avgClvPoints = clvData.reduce((sum, r) => sum + r.clv_points, 0) / totalBets;
  const avgClvCents = clvData.reduce((sum, r) => sum + (r.clv_cents || 0), 0) / totalBets;
  const positiveCLVRate = clvData.filter(r => r.clv_points > 0).length / totalBets;

  const pinnacleData = clvData.filter(r => r.pinnacle_clv_points !== null);
  const avgPinnacleClv = pinnacleData.length > 0
    ? pinnacleData.reduce((sum, r) => sum + r.pinnacle_clv_points!, 0) / pinnacleData.length
    : null;

  const spreads = clvData.filter(r => r.market_type === 'spread');
  const totals = clvData.filter(r => r.market_type === 'total');

  return {
    totalBets,
    avgClvPoints: Math.round(avgClvPoints * 100) / 100,
    avgClvCents: Math.round(avgClvCents),
    positiveCLVRate: Math.round(positiveCLVRate * 1000) / 10,
    avgPinnacleClv: avgPinnacleClv !== null ? Math.round(avgPinnacleClv * 100) / 100 : null,
    byMarketType: {
      spread: {
        count: spreads.length,
        avgClv: spreads.length > 0
          ? Math.round(spreads.reduce((sum, r) => sum + r.clv_points, 0) / spreads.length * 100) / 100
          : 0,
      },
      total: {
        count: totals.length,
        avgClv: totals.length > 0
          ? Math.round(totals.reduce((sum, r) => sum + r.clv_points, 0) / totals.length * 100) / 100
          : 0,
      },
    },
  };
}

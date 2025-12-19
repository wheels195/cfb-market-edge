/**
 * Line Movement Analysis Module
 *
 * Detects sharp money signals based on line movement patterns:
 * - Opening line: First tick captured for an event/book/market
 * - Current line: Most recent tick
 * - Movement: Current - Opening (for spreads, more negative = moved toward home)
 *
 * Sharp money indicators:
 * - 2+ point movement in one direction = significant sharp action
 * - Reverse movement against public perception = contrarian sharp play
 * - Late sharp movement (within 4 hours of game) = steam move
 */

import { supabase } from '@/lib/db/client';

export interface LineMovementData {
  openingSpread: number | null;
  currentSpread: number | null;
  spreadMovement: number;
  openingTotal: number | null;
  currentTotal: number | null;
  totalMovement: number;
  openingTime: string | null;
  currentTime: string | null;
  tickCount: number;
}

export interface SharpMoneySignal {
  signal: 'sharp_home' | 'sharp_away' | 'sharp_over' | 'sharp_under' | 'neutral';
  movement: number;
  confidence: 'high' | 'medium' | 'low';
  description: string;
  isSteamMove: boolean; // Late sharp movement
}

export interface LineMovementImpact {
  spreadSignal: SharpMoneySignal;
  totalSignal: SharpMoneySignal;
  spreadAdjustment: number; // Points to adjust model (follow sharp money)
  totalAdjustment: number;
  warnings: string[];
  lineMovement: {
    spread: {
      opening: number | null;
      current: number | null;
      movement: number;
      tickCount: number;
    };
    total: {
      opening: number | null;
      current: number | null;
      movement: number;
      tickCount: number;
    };
  };
}

// Thresholds for sharp money detection
const SHARP_THRESHOLD = 2.0;     // 2+ point move = significant
const MAJOR_THRESHOLD = 3.5;    // 3.5+ point move = major sharp action
const STEAM_MOVE_HOURS = 4;     // Movement within 4 hours of kickoff

/**
 * Get opening line (first tick) for an event/book
 */
async function getOpeningTick(
  eventId: string,
  sportsbookId: string,
  marketType: 'spread' | 'total',
  side: string
): Promise<{ points: number; time: string } | null> {
  const { data } = await supabase
    .from('odds_ticks')
    .select('spread_points_home, total_points, captured_at')
    .eq('event_id', eventId)
    .eq('sportsbook_id', sportsbookId)
    .eq('market_type', marketType)
    .eq('side', side)
    .order('captured_at', { ascending: true })
    .limit(1)
    .single();

  if (!data) return null;

  const points = marketType === 'spread' ? data.spread_points_home : data.total_points;
  if (points === null) return null;

  return {
    points,
    time: data.captured_at,
  };
}

/**
 * Get latest tick for an event/book
 */
async function getLatestTick(
  eventId: string,
  sportsbookId: string,
  marketType: 'spread' | 'total',
  side: string
): Promise<{ points: number; time: string } | null> {
  const { data } = await supabase
    .from('odds_ticks')
    .select('spread_points_home, total_points, captured_at')
    .eq('event_id', eventId)
    .eq('sportsbook_id', sportsbookId)
    .eq('market_type', marketType)
    .eq('side', side)
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  const points = marketType === 'spread' ? data.spread_points_home : data.total_points;
  if (points === null) return null;

  return {
    points,
    time: data.captured_at,
  };
}

/**
 * Get tick count for an event/book/market
 */
async function getTickCount(
  eventId: string,
  sportsbookId: string,
  marketType: 'spread' | 'total'
): Promise<number> {
  const { count } = await supabase
    .from('odds_ticks')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('sportsbook_id', sportsbookId)
    .eq('market_type', marketType);

  return count || 0;
}

/**
 * Detect sharp money signal from line movement
 */
function detectSharpSignal(
  movement: number,
  marketType: 'spread' | 'total',
  openingTime: string | null,
  gameTime: string | null
): SharpMoneySignal {
  const absMovement = Math.abs(movement);

  // Check if this is a steam move (late sharp action)
  let isSteamMove = false;
  if (openingTime && gameTime) {
    const opening = new Date(openingTime);
    const game = new Date(gameTime);
    const hoursToGame = (game.getTime() - opening.getTime()) / (1000 * 60 * 60);
    isSteamMove = hoursToGame <= STEAM_MOVE_HOURS && absMovement >= SHARP_THRESHOLD;
  }

  // Determine confidence based on movement size
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (absMovement >= MAJOR_THRESHOLD) {
    confidence = 'high';
  } else if (absMovement >= SHARP_THRESHOLD) {
    confidence = 'medium';
  }

  // For spreads: negative movement = line moved toward home (sharps on home)
  // For totals: negative movement = total dropped (sharps on under)
  if (marketType === 'spread') {
    if (movement <= -SHARP_THRESHOLD) {
      return {
        signal: 'sharp_home',
        movement,
        confidence,
        description: `Line moved ${absMovement.toFixed(1)} pts toward home - sharp money on HOME`,
        isSteamMove,
      };
    }
    if (movement >= SHARP_THRESHOLD) {
      return {
        signal: 'sharp_away',
        movement,
        confidence,
        description: `Line moved ${absMovement.toFixed(1)} pts toward away - sharp money on AWAY`,
        isSteamMove,
      };
    }
  } else {
    if (movement <= -SHARP_THRESHOLD) {
      return {
        signal: 'sharp_under',
        movement,
        confidence,
        description: `Total dropped ${absMovement.toFixed(1)} pts - sharp money on UNDER`,
        isSteamMove,
      };
    }
    if (movement >= SHARP_THRESHOLD) {
      return {
        signal: 'sharp_over',
        movement,
        confidence,
        description: `Total rose ${absMovement.toFixed(1)} pts - sharp money on OVER`,
        isSteamMove,
      };
    }
  }

  return {
    signal: 'neutral',
    movement,
    confidence: 'low',
    description: absMovement > 0.5
      ? `Minor movement (${movement.toFixed(1)} pts) - no clear signal`
      : 'Line stable - no significant movement',
    isSteamMove: false,
  };
}

/**
 * Analyze line movement for an event and sportsbook
 */
export async function analyzeLineMovement(
  eventId: string,
  sportsbookId: string,
  gameTime?: string
): Promise<LineMovementImpact> {
  const warnings: string[] = [];

  // Get opening and current ticks for spread
  const openingSpread = await getOpeningTick(eventId, sportsbookId, 'spread', 'home');
  const currentSpread = await getLatestTick(eventId, sportsbookId, 'spread', 'home');
  const spreadTickCount = await getTickCount(eventId, sportsbookId, 'spread');

  // Get opening and current ticks for total
  const openingTotal = await getOpeningTick(eventId, sportsbookId, 'total', 'over');
  const currentTotal = await getLatestTick(eventId, sportsbookId, 'total', 'over');
  const totalTickCount = await getTickCount(eventId, sportsbookId, 'total');

  // Calculate movements
  const spreadMovement = (openingSpread && currentSpread)
    ? currentSpread.points - openingSpread.points
    : 0;
  const totalMovement = (openingTotal && currentTotal)
    ? currentTotal.points - openingTotal.points
    : 0;

  // Detect sharp signals
  const spreadSignal = detectSharpSignal(
    spreadMovement,
    'spread',
    openingSpread?.time || null,
    gameTime || null
  );
  const totalSignal = detectSharpSignal(
    totalMovement,
    'total',
    openingTotal?.time || null,
    gameTime || null
  );

  // Calculate adjustments to follow sharp money
  // If sharps are on home (line moved negative), add to our home edge
  let spreadAdjustment = 0;
  if (spreadSignal.signal === 'sharp_home') {
    spreadAdjustment = Math.abs(spreadMovement) * 0.3; // 30% of movement
    warnings.push(`SHARP MONEY: ${spreadSignal.description}`);
  } else if (spreadSignal.signal === 'sharp_away') {
    spreadAdjustment = -Math.abs(spreadMovement) * 0.3;
    warnings.push(`SHARP MONEY: ${spreadSignal.description}`);
  }

  let totalAdjustment = 0;
  if (totalSignal.signal === 'sharp_under') {
    totalAdjustment = -Math.abs(totalMovement) * 0.3;
    warnings.push(`SHARP MONEY: ${totalSignal.description}`);
  } else if (totalSignal.signal === 'sharp_over') {
    totalAdjustment = Math.abs(totalMovement) * 0.3;
    warnings.push(`SHARP MONEY: ${totalSignal.description}`);
  }

  // Add steam move warnings
  if (spreadSignal.isSteamMove) {
    warnings.push('STEAM MOVE: Late sharp action on spread - high urgency');
  }
  if (totalSignal.isSteamMove) {
    warnings.push('STEAM MOVE: Late sharp action on total - high urgency');
  }

  // Warn about limited data
  if (spreadTickCount < 5) {
    warnings.push(`LIMITED DATA: Only ${spreadTickCount} spread ticks captured`);
  }
  if (totalTickCount < 5) {
    warnings.push(`LIMITED DATA: Only ${totalTickCount} total ticks captured`);
  }

  return {
    spreadSignal,
    totalSignal,
    spreadAdjustment: Math.round(spreadAdjustment * 10) / 10,
    totalAdjustment: Math.round(totalAdjustment * 10) / 10,
    warnings,
    lineMovement: {
      spread: {
        opening: openingSpread?.points || null,
        current: currentSpread?.points || null,
        movement: Math.round(spreadMovement * 10) / 10,
        tickCount: spreadTickCount,
      },
      total: {
        opening: openingTotal?.points || null,
        current: currentTotal?.points || null,
        movement: Math.round(totalMovement * 10) / 10,
        tickCount: totalTickCount,
      },
    },
  };
}

/**
 * Check if our bet aligns with sharp money
 */
export function betAlignsWithSharps(
  recommendedSide: string,
  spreadSignal: SharpMoneySignal,
  totalSignal: SharpMoneySignal
): { aligns: boolean; message: string } {
  // For spreads
  if (recommendedSide === 'home' && spreadSignal.signal === 'sharp_home') {
    return { aligns: true, message: 'BET ALIGNS WITH SHARPS on Home' };
  }
  if (recommendedSide === 'away' && spreadSignal.signal === 'sharp_away') {
    return { aligns: true, message: 'BET ALIGNS WITH SHARPS on Away' };
  }

  // For totals
  if (recommendedSide === 'over' && totalSignal.signal === 'sharp_over') {
    return { aligns: true, message: 'BET ALIGNS WITH SHARPS on Over' };
  }
  if (recommendedSide === 'under' && totalSignal.signal === 'sharp_under') {
    return { aligns: true, message: 'BET ALIGNS WITH SHARPS on Under' };
  }

  // Check for contradiction
  if (recommendedSide === 'home' && spreadSignal.signal === 'sharp_away') {
    return { aligns: false, message: 'CAUTION: Betting AGAINST sharp money' };
  }
  if (recommendedSide === 'away' && spreadSignal.signal === 'sharp_home') {
    return { aligns: false, message: 'CAUTION: Betting AGAINST sharp money' };
  }
  if (recommendedSide === 'over' && totalSignal.signal === 'sharp_under') {
    return { aligns: false, message: 'CAUTION: Betting AGAINST sharp money' };
  }
  if (recommendedSide === 'under' && totalSignal.signal === 'sharp_over') {
    return { aligns: false, message: 'CAUTION: Betting AGAINST sharp money' };
  }

  return { aligns: false, message: '' };
}

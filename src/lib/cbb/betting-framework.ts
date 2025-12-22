/**
 * CBB Betting Framework - FROZEN
 *
 * Execution Rules (locked):
 * - Execution price: DraftKings spread at T-60 (fallback T-30)
 * - Stake sizing: Flat (1 unit per bet)
 * - Market: Spreads only (no totals, no ML)
 * - Vig assumption: -110 both sides (4.55% theoretical hold)
 *
 * This framework is frozen during model validation.
 * Do NOT modify without explicit approval.
 */

export const CBB_BETTING_FRAMEWORK = {
  // Execution timing
  executionTiming: 't60', // Primary: T-60 minutes before tip
  fallbackTiming: 't30', // Fallback: T-30 if T-60 unavailable
  provider: 'DraftKings',

  // Stake sizing
  stakeType: 'flat' as const,
  unitsPerBet: 1,

  // Market
  marketType: 'spread' as const,

  // Vig assumptions
  standardVig: -110,
  theoreticalHold: 0.0455, // 4.55%

  // Expected baseline loss rate (betting randomly)
  expectedBaselineLoss: -0.0455, // -4.55% ROI

  frozen: true,
  frozenAt: '2024-12-21',
} as const;

/**
 * Calculate profit/loss for a spread bet
 * @param won - Whether the bet won
 * @param odds - American odds (default -110)
 * @returns Profit in units (positive) or loss (negative)
 */
export function calculateSpreadPL(won: boolean, odds: number = -110): number {
  if (won) {
    // Convert American odds to decimal profit
    if (odds < 0) {
      return 100 / Math.abs(odds); // e.g., -110 -> 0.909 units profit
    } else {
      return odds / 100; // e.g., +110 -> 1.1 units profit
    }
  } else {
    return -1; // Lost 1 unit
  }
}

/**
 * Determine if spread bet won
 * @param homeSpread - The spread for the home team (negative = favorite)
 * @param homeScore - Home team final score
 * @param awayScore - Away team final score
 * @param betSide - 'home' or 'away'
 * @returns true if bet won, false if lost, null if push
 */
export function determineSpreadOutcome(
  homeSpread: number,
  homeScore: number,
  awayScore: number,
  betSide: 'home' | 'away'
): boolean | null {
  const actualMargin = homeScore - awayScore;
  const homeCovers = actualMargin + homeSpread > 0;
  const awayCovers = actualMargin + homeSpread < 0;
  const isPush = actualMargin + homeSpread === 0;

  if (isPush) return null;

  if (betSide === 'home') {
    return homeCovers;
  } else {
    return awayCovers;
  }
}

/**
 * Get execution spread from betting line record
 * Prefers T-60, falls back to T-30
 */
export function getExecutionSpread(line: {
  spread_t60: number | null;
  spread_t30: number | null;
  execution_timing: string | null;
}): number | null {
  if (line.execution_timing === 't60' && line.spread_t60 !== null) {
    return line.spread_t60;
  }
  if (line.execution_timing === 't30' && line.spread_t30 !== null) {
    return line.spread_t30;
  }
  return null;
}

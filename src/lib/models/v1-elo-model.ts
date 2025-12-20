/**
 * V1 Elo-Only Model
 *
 * Guardrails (LOCKED):
 * - Train: 2022-2023 (no 2024 data used in training)
 * - Test: 2024 (out-of-sample evaluation only)
 * - Exclusions: Any game with missing Elo (FCS teams)
 * - Features: Elo difference + home field advantage ONLY
 * - No totals, injuries, weather, or other features
 */

export interface V1ModelConfig {
  // Elo to points conversion factor
  // Every X Elo points = 1 point spread
  eloPointsFactor: number;

  // Home field advantage in points
  homeFieldAdvantage: number;
}

export const DEFAULT_V1_CONFIG: V1ModelConfig = {
  eloPointsFactor: 25, // ~25 Elo = 1 point (standard)
  homeFieldAdvantage: 2.5, // Historical CFB HFA
};

export interface V1Projection {
  eventId: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  eloDiff: number; // home - away
  projectedHomeMargin: number; // positive = home favored
  modelSpreadHome: number; // negative of margin (betting convention)
}

/**
 * Project spread using Elo-only model
 *
 * Formula:
 *   projected_home_margin = (home_elo - away_elo) / elo_points_factor + home_field_advantage
 *   model_spread_home = -projected_home_margin (betting line convention)
 */
export function projectSpread(
  homeElo: number,
  awayElo: number,
  config: V1ModelConfig = DEFAULT_V1_CONFIG
): { projectedHomeMargin: number; modelSpreadHome: number } {
  const eloDiff = homeElo - awayElo;
  const projectedHomeMargin = (eloDiff / config.eloPointsFactor) + config.homeFieldAdvantage;
  const modelSpreadHome = -projectedHomeMargin;

  return { projectedHomeMargin, modelSpreadHome };
}

/**
 * Calculate edge: difference between market spread and model spread
 *
 * edge = market_spread_home - model_spread_home
 *
 * If edge > 0: Market has home as bigger underdog than model → bet HOME
 * If edge < 0: Market has home as bigger favorite than model → bet AWAY
 */
export function calculateEdge(
  marketSpreadHome: number,
  modelSpreadHome: number
): { edge: number; side: 'home' | 'away' } {
  const edge = marketSpreadHome - modelSpreadHome;
  const side = edge > 0 ? 'home' : 'away';
  return { edge, side };
}

/**
 * Determine if bet covered
 *
 * For home bet at spread X:
 *   home_margin + X > 0 → cover
 *
 * For away bet at spread X (which is -marketSpreadHome):
 *   away_margin + (-X) > 0 → cover
 *   -home_margin - marketSpreadHome > 0 → cover
 */
export function didCover(
  homeMargin: number,
  marketSpreadHome: number,
  side: 'home' | 'away'
): boolean | null {
  if (side === 'home') {
    const result = homeMargin + marketSpreadHome;
    if (result === 0) return null; // push
    return result > 0;
  } else {
    const result = -homeMargin - marketSpreadHome;
    if (result === 0) return null; // push
    return result > 0;
  }
}

/**
 * Calculate profit from bet outcome
 *
 * American odds conversion:
 *   Positive odds (e.g., +150): profit = stake * (odds/100)
 *   Negative odds (e.g., -110): profit = stake * (100/|odds|)
 */
export function calculateProfit(
  covered: boolean | null,
  priceAmerican: number,
  stake: number = 100
): number {
  if (covered === null) return 0; // push
  if (!covered) return -stake; // loss

  // Win
  if (priceAmerican > 0) {
    return stake * (priceAmerican / 100);
  } else {
    return stake * (100 / Math.abs(priceAmerican));
  }
}

/**
 * Calculate Closing Line Value (CLV)
 *
 * CLV = bet_spread - closing_spread (for home bets)
 * CLV = -bet_spread - (-closing_spread) = closing_spread - bet_spread (for away bets)
 *
 * Positive CLV = got a better number than close
 */
export function calculateCLV(
  betSpreadHome: number,
  closingSpreadHome: number,
  side: 'home' | 'away'
): number {
  if (side === 'home') {
    // Bet home at betSpreadHome, closed at closingSpreadHome
    // If bet was -3 and closed at -3.5, CLV = +0.5 (good)
    return closingSpreadHome - betSpreadHome;
  } else {
    // Bet away, so we bet at -betSpreadHome
    // If home was -3 (away +3), and closed at -3.5 (away +3.5)
    // We bet away +3, closed at +3.5, CLV = +0.5 (good)
    return betSpreadHome - closingSpreadHome;
  }
}

/**
 * Calculate implied probability from American odds
 */
export function impliedProbability(priceAmerican: number): number {
  if (priceAmerican > 0) {
    return 100 / (priceAmerican + 100);
  } else {
    return Math.abs(priceAmerican) / (Math.abs(priceAmerican) + 100);
  }
}

/**
 * Calculate Brier score for a single prediction
 *
 * Brier = (predicted_prob - actual_outcome)^2
 * where actual_outcome = 1 if cover, 0 if not
 */
export function brierScore(predictedProb: number, covered: boolean): number {
  const actual = covered ? 1 : 0;
  return Math.pow(predictedProb - actual, 2);
}

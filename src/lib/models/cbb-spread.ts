/**
 * CBB Spread Prediction Model
 *
 * Uses adjusted efficiency ratings (KenPom-style) to project spreads.
 * Market-anchored approach: starts with market line, applies efficiency adjustment.
 *
 * Key differences from CFB:
 * - Home court advantage: ~3.5 points (vs 2.5 for CFB)
 * - Efficiency ratings are per 100 possessions
 * - Average game has ~67 possessions, so scale factor ~0.67
 */

export interface CBBTeamRatings {
  offensiveRating: number;  // Points per 100 possessions
  defensiveRating: number;  // Points allowed per 100 possessions
  netRating: number;        // Offensive - Defensive
  srsRating?: number;       // Simple Rating System
}

export interface CBBSpreadProjection {
  modelSpreadHome: number;       // Model's projected home spread
  marketSpreadHome: number;      // Current market spread
  edgePoints: number;            // Model - Market (positive = bet home, negative = bet away)
  predictedSide: 'home' | 'away';
  confidence: 'low' | 'medium' | 'high';

  // Raw projections for diagnostics
  rawProjectedMargin: number;    // Pure efficiency-based margin
  homeNetRating: number;
  awayNetRating: number;
  efficiencyDiff: number;
}

// CBB model constants
export const CBB_MODEL_CONFIG = {
  // Home court advantage in CBB is historically 3.5-4 points
  HOME_COURT_ADVANTAGE: 3.5,

  // Scale factor: converts efficiency diff to points
  // Average game ~67 possessions, so raw efficiency diff / 1.5 approximates scoring margin
  EFFICIENCY_SCALE: 0.67,

  // Market anchor weight (0 = pure model, 1 = pure market)
  // We use 0.5 to blend model with market
  MARKET_ANCHOR_WEIGHT: 0.5,

  // Edge thresholds for confidence levels
  EDGE_THRESHOLD_HIGH: 3.0,      // 3+ points = high confidence
  EDGE_THRESHOLD_MEDIUM: 1.5,    // 1.5+ points = medium confidence

  // Max adjustment from market (cap wild swings)
  MAX_ADJUSTMENT: 8.0,
};

/**
 * Calculate raw projected margin from efficiency ratings
 * Positive = home favored, Negative = away favored
 */
export function calculateRawMargin(
  homeRatings: CBBTeamRatings,
  awayRatings: CBBTeamRatings,
  neutralSite: boolean = false
): number {
  const { HOME_COURT_ADVANTAGE, EFFICIENCY_SCALE } = CBB_MODEL_CONFIG;

  // Efficiency differential (home perspective)
  // Home offense vs Away defense + Home defense vs Away offense
  const effDiff = homeRatings.netRating - awayRatings.netRating;

  // Scale to points
  let margin = effDiff * EFFICIENCY_SCALE;

  // Add home court advantage (unless neutral site)
  if (!neutralSite) {
    margin += HOME_COURT_ADVANTAGE;
  }

  return margin;
}

/**
 * Calculate market-anchored spread projection
 */
export function calculateSpreadProjection(
  homeRatings: CBBTeamRatings,
  awayRatings: CBBTeamRatings,
  marketSpreadHome: number,
  neutralSite: boolean = false
): CBBSpreadProjection {
  const { MARKET_ANCHOR_WEIGHT, MAX_ADJUSTMENT, EDGE_THRESHOLD_HIGH, EDGE_THRESHOLD_MEDIUM } = CBB_MODEL_CONFIG;

  // Raw efficiency-based projection
  const rawMargin = calculateRawMargin(homeRatings, awayRatings, neutralSite);

  // Convert to spread (negative margin = home favored = negative spread)
  const rawModelSpread = -rawMargin;

  // Market-anchored: blend model with market
  // adjustment = model - market, capped at MAX_ADJUSTMENT
  const rawAdjustment = rawModelSpread - marketSpreadHome;
  const cappedAdjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawAdjustment));

  // Apply anchor weight
  const blendedAdjustment = cappedAdjustment * (1 - MARKET_ANCHOR_WEIGHT);
  const modelSpreadHome = marketSpreadHome + blendedAdjustment;

  // Calculate edge (model vs market)
  // Positive edge = model thinks home should be MORE favored = bet home
  // Negative edge = model thinks away should be MORE favored = bet away
  const edgePoints = marketSpreadHome - modelSpreadHome;

  // Determine recommended side
  const predictedSide: 'home' | 'away' = edgePoints > 0 ? 'home' : 'away';

  // Determine confidence based on edge magnitude
  const absEdge = Math.abs(edgePoints);
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (absEdge >= EDGE_THRESHOLD_HIGH) {
    confidence = 'high';
  } else if (absEdge >= EDGE_THRESHOLD_MEDIUM) {
    confidence = 'medium';
  }

  return {
    modelSpreadHome: Math.round(modelSpreadHome * 2) / 2, // Round to 0.5
    marketSpreadHome,
    edgePoints: Math.round(edgePoints * 10) / 10, // Round to 0.1
    predictedSide,
    confidence,
    rawProjectedMargin: Math.round(rawMargin * 10) / 10,
    homeNetRating: homeRatings.netRating,
    awayNetRating: awayRatings.netRating,
    efficiencyDiff: homeRatings.netRating - awayRatings.netRating,
  };
}

/**
 * Grade a prediction against actual result
 */
export function gradePrediction(
  prediction: CBBSpreadProjection,
  homeScore: number,
  awayScore: number
): 'win' | 'loss' | 'push' {
  const actualMargin = homeScore - awayScore;

  // Prediction is on the spread, not the margin
  // If model picked Home -5, and actual margin is -3, it's a loss
  // Spread covers when: margin + spread > 0 (for home bet)
  //                     margin + spread < 0 (for away bet)

  if (prediction.predictedSide === 'home') {
    // Bet home at marketSpreadHome
    // Win if: home covers spread
    // margin + spreadHome > 0 means home covered
    const result = actualMargin + prediction.marketSpreadHome;
    if (result > 0) return 'win';
    if (result < 0) return 'loss';
    return 'push';
  } else {
    // Bet away at -marketSpreadHome
    // Win if: away covers spread
    // margin + spreadHome < 0 means away covered
    const result = actualMargin + prediction.marketSpreadHome;
    if (result < 0) return 'win';
    if (result > 0) return 'loss';
    return 'push';
  }
}

/**
 * Simple model that uses SRS ratings if efficiency ratings unavailable
 */
export function calculateSRSSpreadProjection(
  homeSRS: number,
  awaySRS: number,
  marketSpreadHome: number,
  neutralSite: boolean = false
): CBBSpreadProjection {
  const { HOME_COURT_ADVANTAGE, MARKET_ANCHOR_WEIGHT, MAX_ADJUSTMENT, EDGE_THRESHOLD_HIGH, EDGE_THRESHOLD_MEDIUM } = CBB_MODEL_CONFIG;

  // SRS is already a points-based rating
  let rawMargin = homeSRS - awaySRS;

  if (!neutralSite) {
    rawMargin += HOME_COURT_ADVANTAGE;
  }

  const rawModelSpread = -rawMargin;
  const rawAdjustment = rawModelSpread - marketSpreadHome;
  const cappedAdjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawAdjustment));
  const blendedAdjustment = cappedAdjustment * (1 - MARKET_ANCHOR_WEIGHT);
  const modelSpreadHome = marketSpreadHome + blendedAdjustment;

  const edgePoints = marketSpreadHome - modelSpreadHome;
  const predictedSide: 'home' | 'away' = edgePoints > 0 ? 'home' : 'away';

  const absEdge = Math.abs(edgePoints);
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (absEdge >= EDGE_THRESHOLD_HIGH) {
    confidence = 'high';
  } else if (absEdge >= EDGE_THRESHOLD_MEDIUM) {
    confidence = 'medium';
  }

  return {
    modelSpreadHome: Math.round(modelSpreadHome * 2) / 2,
    marketSpreadHome,
    edgePoints: Math.round(edgePoints * 10) / 10,
    predictedSide,
    confidence,
    rawProjectedMargin: Math.round(rawMargin * 10) / 10,
    homeNetRating: homeSRS,
    awayNetRating: awaySRS,
    efficiencyDiff: homeSRS - awaySRS,
  };
}

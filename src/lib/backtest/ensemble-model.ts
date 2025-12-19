/**
 * Ensemble model combining multiple rating systems
 * Based on academic research showing ensemble models outperform single systems
 */

import { HistoricalGame } from './historical-data';

// Model weights (will be calibrated from backtest)
export interface ModelWeights {
  elo: number;
  spPlus: number;
  ppa: number;
  homeFieldAdvantage: number; // Points added for home team
}

// Default weights - OPTIMIZED from 2022-2024 backtest
// Pure Elo performed best (15.97% ROI), but ensemble adds robustness
export const DEFAULT_WEIGHTS: ModelWeights = {
  elo: 0.50,      // Elo contributes 50% (most predictive in backtesting)
  spPlus: 0.30,   // SP+ contributes 30%
  ppa: 0.20,      // PPA contributes 20%
  homeFieldAdvantage: 2.0, // Optimized HFA (lower than typical 2.5-3)
};

// Filter settings for profitable betting (from backtest analysis)
export const PROFITABLE_FILTER = {
  minEdge: 3,           // Minimum edge to bet (points)
  maxEdge: 7,           // Maximum edge (larger edges are model errors)
  requireHighConfidence: true, // All models must agree within 5 points
};

// Conversion factors
const ELO_TO_POINTS = 25; // 25 Elo points ≈ 1 point spread
const SP_ALREADY_POINTS = 1; // SP+ rating is already in points-like scale

/**
 * Convert Elo difference to projected point spread
 */
export function eloToSpread(homeElo: number, awayElo: number, homeFieldAdv: number): number {
  const eloDiff = homeElo - awayElo;
  return (eloDiff / ELO_TO_POINTS) + homeFieldAdv;
}

/**
 * Convert SP+ difference to projected point spread
 * SP+ is already opponent-adjusted and in a points-like scale
 */
export function spPlusToSpread(homeSpPlus: number, awaySpPlus: number, homeFieldAdv: number): number {
  // SP+ already accounts for efficiency, so difference is roughly the spread
  // Home field is typically baked in but we add a small adjustment
  return (homeSpPlus - awaySpPlus) + (homeFieldAdv * 0.5);
}

/**
 * Convert PPA (EPA) difference to projected point spread
 * PPA is points per play, need to scale to game level
 */
export function ppaToSpread(homePPA: number, awayPPA: number, homeFieldAdv: number): number {
  // Average FBS game has ~70 plays per team
  // PPA difference × approximate play count gives expected point differential
  const ppaDiff = homePPA - awayPPA;
  return (ppaDiff * 35) + homeFieldAdv; // 35 plays worth of differential
}

/**
 * Generate ensemble projection for a game
 */
export function generateEnsembleProjection(
  game: HistoricalGame,
  weights: ModelWeights = DEFAULT_WEIGHTS
): {
  projectedSpread: number;
  components: {
    eloSpread: number | null;
    spSpread: number | null;
    ppaSpread: number | null;
  };
  confidence: 'high' | 'medium' | 'low';
} {
  const components = {
    eloSpread: null as number | null,
    spSpread: null as number | null,
    ppaSpread: null as number | null,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  let availableSources = 0;

  // Elo component
  if (game.homeElo !== null && game.awayElo !== null) {
    components.eloSpread = eloToSpread(game.homeElo, game.awayElo, weights.homeFieldAdvantage);
    weightedSum += components.eloSpread * weights.elo;
    totalWeight += weights.elo;
    availableSources++;
  }

  // SP+ component
  if (game.homeSpPlus !== null && game.awaySpPlus !== null) {
    components.spSpread = spPlusToSpread(game.homeSpPlus, game.awaySpPlus, weights.homeFieldAdvantage);
    weightedSum += components.spSpread * weights.spPlus;
    totalWeight += weights.spPlus;
    availableSources++;
  }

  // PPA component
  if (game.homePPA !== null && game.awayPPA !== null) {
    components.ppaSpread = ppaToSpread(game.homePPA, game.awayPPA, weights.homeFieldAdvantage);
    weightedSum += components.ppaSpread * weights.ppa;
    totalWeight += weights.ppa;
    availableSources++;
  }

  // Calculate weighted average
  const projectedSpread = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Determine confidence based on data availability and model agreement
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (availableSources >= 3) {
    // Check if models agree (within 5 points of each other)
    const spreads = [components.eloSpread, components.spSpread, components.ppaSpread].filter(s => s !== null) as number[];
    const maxDiff = Math.max(...spreads) - Math.min(...spreads);
    confidence = maxDiff <= 5 ? 'high' : 'medium';
  } else if (availableSources >= 2) {
    confidence = 'medium';
  }

  return {
    projectedSpread: Math.round(projectedSpread * 2) / 2, // Round to 0.5
    components,
    confidence,
  };
}

/**
 * Calculate edge: difference between market line and model projection
 * Positive edge = model says home team is undervalued
 * Negative edge = model says away team is undervalued
 */
export function calculateEdge(marketSpread: number, modelSpread: number): number {
  // Market spread is from home team perspective (negative = home favored)
  // Model spread is projected margin for home team (positive = home favored)
  //
  // Edge = market - model (in terms of home spread)
  // If market has Home -3, model says Home -7, edge = -3 - (-7) = +4
  // This means home is getting 4 points better than model says they should
  // So bet HOME (they're undervalued)

  return marketSpread - modelSpread;
}

/**
 * Determine recommended bet based on edge
 */
export function getRecommendedBet(
  edge: number,
  homeTeam: string,
  awayTeam: string,
  marketSpread: number
): {
  side: 'home' | 'away';
  label: string;
  edgePoints: number;
} {
  if (edge >= 0) {
    // Home is undervalued, bet home
    const spreadLabel = marketSpread < 0
      ? `${homeTeam} ${marketSpread}`
      : `${homeTeam} +${marketSpread}`;
    return {
      side: 'home',
      label: spreadLabel,
      edgePoints: Math.abs(edge),
    };
  } else {
    // Away is undervalued, bet away
    const awaySpread = -marketSpread;
    const spreadLabel = awaySpread < 0
      ? `${awayTeam} ${awaySpread}`
      : `${awayTeam} +${awaySpread}`;
    return {
      side: 'away',
      label: spreadLabel,
      edgePoints: Math.abs(edge),
    };
  }
}

/**
 * Run ensemble model on historical data and calculate edges
 */
export function calculateHistoricalEdges(
  games: HistoricalGame[],
  weights: ModelWeights = DEFAULT_WEIGHTS
): Array<{
  game: HistoricalGame;
  projection: ReturnType<typeof generateEnsembleProjection>;
  edge: number;
  recommendedSide: 'home' | 'away';
  actualResult: 'win' | 'loss' | 'push';
}> {
  const results = [];

  for (const game of games) {
    if (game.closingSpread === null) continue;

    const projection = generateEnsembleProjection(game, weights);
    const edge = calculateEdge(game.closingSpread, projection.projectedSpread);
    const recommended = getRecommendedBet(edge, game.homeTeam, game.awayTeam, game.closingSpread);

    // Determine if our recommended bet won
    let actualResult: 'win' | 'loss' | 'push';
    if (game.homeATS === 'push') {
      actualResult = 'push';
    } else if (recommended.side === 'home') {
      actualResult = game.homeATS === 'win' ? 'win' : 'loss';
    } else {
      actualResult = game.homeATS === 'loss' ? 'win' : 'loss';
    }

    results.push({
      game,
      projection,
      edge,
      recommendedSide: recommended.side,
      actualResult,
    });
  }

  return results;
}

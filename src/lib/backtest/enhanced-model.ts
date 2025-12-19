/**
 * Enhanced model with additional factors to reduce large-edge errors
 *
 * Key improvements over base ensemble:
 * 1. Recent form adjustment (last 3-5 games ATS performance)
 * 2. Home/away performance splits
 * 3. Strength of schedule consideration
 * 4. Line movement direction (sharp money indicator)
 */

import { HistoricalGame } from './historical-data';
import {
  generateEnsembleProjection,
  calculateEdge,
  DEFAULT_WEIGHTS,
  ModelWeights,
} from './ensemble-model';

export interface EnhancedModelWeights extends ModelWeights {
  recentFormWeight: number;     // Weight for recent performance adjustment
  homeAwayAdjustment: number;   // Additional home/away adjustment factor
  scheduleStrengthWeight: number; // Weight for SOS adjustment
}

export const ENHANCED_WEIGHTS: EnhancedModelWeights = {
  ...DEFAULT_WEIGHTS,
  recentFormWeight: 0.15,        // 15% weight to recent form
  homeAwayAdjustment: 0.5,       // Half-point adjustment for extreme home/away teams
  scheduleStrengthWeight: 0.10,  // 10% weight to SOS
};

/**
 * Calculate recent form for a team based on ATS results
 * Returns adjustment in points (positive = team performing above expectations)
 */
export function calculateRecentForm(
  games: HistoricalGame[],
  teamName: string,
  beforeDate: string,
  lookback: number = 5
): { adjustment: number; recentATS: number; sampleSize: number } {
  // Find this team's recent games before the given date
  const teamGames = games
    .filter(g => {
      const gameDate = new Date(g.date);
      const targetDate = new Date(beforeDate);
      return (
        (g.homeTeam === teamName || g.awayTeam === teamName) &&
        gameDate < targetDate &&
        g.homeATS !== null
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, lookback);

  if (teamGames.length < 3) {
    return { adjustment: 0, recentATS: 0.5, sampleSize: teamGames.length };
  }

  // Calculate ATS win rate
  let atsWins = 0;
  let atsLosses = 0;
  let marginSum = 0;

  for (const game of teamGames) {
    const isHome = game.homeTeam === teamName;
    const atsResult = game.homeATS;

    if (atsResult === 'push') continue;

    if (isHome) {
      if (atsResult === 'win') atsWins++;
      else atsLosses++;
      // Calculate cover margin
      const coverMargin = game.actualMargin + (game.closingSpread || 0);
      marginSum += coverMargin;
    } else {
      if (atsResult === 'loss') atsWins++; // Away cover = home loss
      else atsLosses++;
      const coverMargin = -game.actualMargin - (game.closingSpread || 0);
      marginSum += coverMargin;
    }
  }

  const decided = atsWins + atsLosses;
  if (decided === 0) {
    return { adjustment: 0, recentATS: 0.5, sampleSize: teamGames.length };
  }

  const atsRate = atsWins / decided;
  const avgMargin = marginSum / decided;

  // Convert to adjustment:
  // - Team covering by avg 5 pts over last 5 games = +1 point adjustment
  // - Team losing by avg 5 pts ATS = -1 point adjustment
  const adjustment = avgMargin / 5;

  return {
    adjustment: Math.max(-3, Math.min(3, adjustment)), // Cap at +/- 3 points
    recentATS: Math.round(atsRate * 100) / 100,
    sampleSize: decided,
  };
}

/**
 * Calculate strength of schedule adjustment
 * Based on average opponent Elo in recent games
 */
export function calculateSOSAdjustment(
  games: HistoricalGame[],
  teamName: string,
  beforeDate: string,
  lookback: number = 5
): { adjustment: number; avgOpponentElo: number } {
  const teamGames = games
    .filter(g => {
      const gameDate = new Date(g.date);
      const targetDate = new Date(beforeDate);
      return (
        (g.homeTeam === teamName || g.awayTeam === teamName) &&
        gameDate < targetDate
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, lookback);

  if (teamGames.length < 3) {
    return { adjustment: 0, avgOpponentElo: 1500 };
  }

  let totalOpponentElo = 0;
  let count = 0;

  for (const game of teamGames) {
    const isHome = game.homeTeam === teamName;
    const opponentElo = isHome ? game.awayElo : game.homeElo;

    if (opponentElo !== null) {
      totalOpponentElo += opponentElo;
      count++;
    }
  }

  if (count === 0) {
    return { adjustment: 0, avgOpponentElo: 1500 };
  }

  const avgOpponentElo = totalOpponentElo / count;

  // Adjustment: Playing stronger opponents (higher Elo) means team is battle-tested
  // 100 Elo above average (1600) = +0.5 point adjustment
  const adjustment = (avgOpponentElo - 1500) / 200;

  return {
    adjustment: Math.max(-2, Math.min(2, adjustment)),
    avgOpponentElo: Math.round(avgOpponentElo),
  };
}

/**
 * Detect if line has moved significantly (sharp money indicator)
 */
export function detectLineMoveSignal(
  openingSpread: number | null,
  closingSpread: number | null
): { signal: 'sharp_home' | 'sharp_away' | 'neutral'; movement: number } {
  if (openingSpread === null || closingSpread === null) {
    return { signal: 'neutral', movement: 0 };
  }

  const movement = closingSpread - openingSpread;

  // If line moved 2+ points toward home, sharp money on home
  if (movement <= -2) {
    return { signal: 'sharp_home', movement };
  }
  // If line moved 2+ points toward away, sharp money on away
  if (movement >= 2) {
    return { signal: 'sharp_away', movement };
  }

  return { signal: 'neutral', movement };
}

/**
 * Generate enhanced projection with additional factors
 */
export function generateEnhancedProjection(
  game: HistoricalGame,
  allGames: HistoricalGame[],
  weights: EnhancedModelWeights = ENHANCED_WEIGHTS
): {
  projectedSpread: number;
  baseProjection: ReturnType<typeof generateEnsembleProjection>;
  adjustments: {
    homeRecentForm: number;
    awayRecentForm: number;
    homeSOS: number;
    awaySOS: number;
    lineMove: string;
  };
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
} {
  const warnings: string[] = [];

  // Get base ensemble projection
  const baseProjection = generateEnsembleProjection(game, weights);

  // Calculate recent form adjustments
  const homeForm = calculateRecentForm(allGames, game.homeTeam, game.date);
  const awayForm = calculateRecentForm(allGames, game.awayTeam, game.date);

  // Calculate SOS adjustments
  const homeSOS = calculateSOSAdjustment(allGames, game.homeTeam, game.date);
  const awaySOS = calculateSOSAdjustment(allGames, game.awayTeam, game.date);

  // Detect line movement
  const lineMove = detectLineMoveSignal(game.openingSpread, game.closingSpread);

  // Apply adjustments to base projection
  let adjustedSpread = baseProjection.projectedSpread;

  // Recent form: positive form = team is better than ratings suggest
  const formAdjustment = (homeForm.adjustment - awayForm.adjustment) * weights.recentFormWeight;
  adjustedSpread -= formAdjustment; // Subtract because spread is home perspective (negative = home favored)

  // SOS: team playing tougher schedule may be underrated
  const sosAdjustment = (homeSOS.adjustment - awaySOS.adjustment) * weights.scheduleStrengthWeight;
  adjustedSpread -= sosAdjustment;

  // Add warnings for suspicious situations
  if (Math.abs(baseProjection.projectedSpread - (game.closingSpread || 0)) > 10) {
    warnings.push('LARGE DISAGREEMENT: Model differs from market by 10+ points');
  }

  if (homeForm.sampleSize < 3 || awayForm.sampleSize < 3) {
    warnings.push('LIMITED DATA: Not enough recent games for reliable form analysis');
  }

  if (lineMove.signal !== 'neutral') {
    const direction = lineMove.signal === 'sharp_home' ? 'HOME' : 'AWAY';
    warnings.push(`LINE MOVE: Sharp money detected on ${direction} (${lineMove.movement.toFixed(1)} pts)`);
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = baseProjection.confidence;
  if (warnings.length > 0) {
    confidence = 'low';
  }

  return {
    projectedSpread: Math.round(adjustedSpread * 2) / 2,
    baseProjection,
    adjustments: {
      homeRecentForm: homeForm.adjustment,
      awayRecentForm: awayForm.adjustment,
      homeSOS: homeSOS.adjustment,
      awaySOS: awaySOS.adjustment,
      lineMove: lineMove.signal,
    },
    confidence,
    warnings,
  };
}

/**
 * Run enhanced model on historical data
 */
export function calculateEnhancedEdges(
  games: HistoricalGame[],
  weights: EnhancedModelWeights = ENHANCED_WEIGHTS
): Array<{
  game: HistoricalGame;
  projection: ReturnType<typeof generateEnhancedProjection>;
  edge: number;
  recommendedSide: 'home' | 'away';
  actualResult: 'win' | 'loss' | 'push';
  hasWarnings: boolean;
}> {
  const results = [];

  for (const game of games) {
    if (game.closingSpread === null) continue;

    const projection = generateEnhancedProjection(game, games, weights);
    const edge = calculateEdge(game.closingSpread, projection.projectedSpread);

    const recommendedSide: 'home' | 'away' = edge >= 0 ? 'home' : 'away';

    // Determine if our recommended bet won
    let actualResult: 'win' | 'loss' | 'push';
    if (game.homeATS === 'push') {
      actualResult = 'push';
    } else if (recommendedSide === 'home') {
      actualResult = game.homeATS === 'win' ? 'win' : 'loss';
    } else {
      actualResult = game.homeATS === 'loss' ? 'win' : 'loss';
    }

    results.push({
      game,
      projection,
      edge,
      recommendedSide,
      actualResult,
      hasWarnings: projection.warnings.length > 0,
    });
  }

  return results;
}

/**
 * Main backtest runner - pulls historical data, runs ensemble model, generates calibration
 */

import {
  buildHistoricalDataset,
  filterCompleteGames,
  HistoricalGame,
} from './historical-data';
import {
  calculateHistoricalEdges,
  generateEnsembleProjection,
  ModelWeights,
  DEFAULT_WEIGHTS,
} from './ensemble-model';
import {
  buildCalibrationCurve,
  CalibrationCurve,
  formatCalibrationReport,
  getWinProbability,
  calculateExpectedValue,
  getConfidenceTier,
} from './calibration';

export interface BacktestResult {
  // Data summary
  totalGames: number;
  gamesWithCompleteData: number;
  seasons: number[];

  // Model performance
  calibration: CalibrationCurve;
  report: string;

  // Detailed results for analysis
  allPicks: Array<{
    gameId: number;
    date: string;
    homeTeam: string;
    awayTeam: string;
    marketSpread: number;
    modelSpread: number;
    edge: number;
    recommendedSide: 'home' | 'away';
    recommendedBet: string;
    actualResult: 'win' | 'loss' | 'push';
    winProbability: number;
    expectedValue: number;
    confidenceTier: string;
  }>;

  // Performance by filter
  performanceByEdgeThreshold: Array<{
    minEdge: number;
    games: number;
    wins: number;
    losses: number;
    winRate: number;
    roi: number;
  }>;
}

/**
 * Run full backtest
 */
export async function runBacktest(
  seasons: number[] = [2022, 2023, 2024],
  weights: ModelWeights = DEFAULT_WEIGHTS
): Promise<BacktestResult> {
  console.log('Starting backtest...');
  console.log(`Seasons: ${seasons.join(', ')}`);

  // Step 1: Fetch historical data
  console.log('\n1. Fetching historical data from CFBD...');
  const allGames = await buildHistoricalDataset(seasons);
  console.log(`   Total games fetched: ${allGames.length}`);

  // Step 2: Filter to complete data
  const completeGames = filterCompleteGames(allGames);
  console.log(`   Games with complete data: ${completeGames.length}`);

  // Step 3: Calculate edges for all games
  console.log('\n2. Calculating model projections and edges...');
  const edgeResults = calculateHistoricalEdges(completeGames, weights);
  console.log(`   Edges calculated: ${edgeResults.length}`);

  // Step 4: Build calibration curve
  console.log('\n3. Building calibration curve...');
  const calibrationInput = edgeResults.map(r => ({
    edge: r.edge,
    actualResult: r.actualResult,
  }));
  const calibration = buildCalibrationCurve(calibrationInput);

  // Step 5: Generate detailed picks with probabilities
  console.log('\n4. Generating detailed analysis...');
  const allPicks = edgeResults.map(r => {
    const absEdge = Math.abs(r.edge);
    const winProb = getWinProbability(r.edge, calibration);
    const ev = calculateExpectedValue(winProb);
    const tier = getConfidenceTier(r.edge, winProb);

    const recommendedBet = r.recommendedSide === 'home'
      ? `${r.game.homeTeam} ${r.game.closingSpread! >= 0 ? '+' : ''}${r.game.closingSpread}`
      : `${r.game.awayTeam} ${-r.game.closingSpread! >= 0 ? '+' : ''}${-r.game.closingSpread!}`;

    return {
      gameId: r.game.gameId,
      date: r.game.date,
      homeTeam: r.game.homeTeam,
      awayTeam: r.game.awayTeam,
      marketSpread: r.game.closingSpread!,
      modelSpread: r.projection.projectedSpread,
      edge: Math.round(r.edge * 10) / 10,
      recommendedSide: r.recommendedSide,
      recommendedBet,
      actualResult: r.actualResult,
      winProbability: Math.round(winProb * 1000) / 10, // Convert to percentage with 1 decimal
      expectedValue: ev,
      confidenceTier: tier,
    };
  });

  // Step 6: Calculate performance by edge threshold
  const thresholds = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
  const performanceByEdgeThreshold = thresholds.map(minEdge => {
    const filtered = edgeResults.filter(r => Math.abs(r.edge) >= minEdge);
    const decided = filtered.filter(r => r.actualResult !== 'push');
    const wins = decided.filter(r => r.actualResult === 'win').length;
    const losses = decided.filter(r => r.actualResult === 'loss').length;
    const winRate = decided.length > 0 ? wins / decided.length : 0;
    const roi = decided.length > 0
      ? ((wins * 100 - losses * 110) / (decided.length * 110)) * 100
      : 0;

    return {
      minEdge,
      games: filtered.length,
      wins,
      losses,
      winRate: Math.round(winRate * 1000) / 10,
      roi: Math.round(roi * 100) / 100,
    };
  });

  // Generate report
  const report = formatCalibrationReport(calibration);

  console.log('\n5. Backtest complete!');
  console.log(`   Overall win rate: ${(calibration.overallWinRate * 100).toFixed(1)}%`);
  console.log(`   Overall ROI: ${calibration.overallROI.toFixed(2)}%`);

  return {
    totalGames: allGames.length,
    gamesWithCompleteData: completeGames.length,
    seasons,
    calibration,
    report,
    allPicks,
    performanceByEdgeThreshold,
  };
}

/**
 * Optimize model weights using grid search
 */
export async function optimizeWeights(
  games: HistoricalGame[]
): Promise<{ bestWeights: ModelWeights; bestROI: number }> {
  let bestWeights = DEFAULT_WEIGHTS;
  let bestROI = -Infinity;

  // Grid search over weights
  const eloOptions = [0.2, 0.3, 0.35, 0.4];
  const spOptions = [0.3, 0.4, 0.45, 0.5];
  const hfaOptions = [2.0, 2.5, 3.0, 3.5];

  for (const elo of eloOptions) {
    for (const sp of spOptions) {
      for (const hfa of hfaOptions) {
        const ppa = 1 - elo - sp;
        if (ppa < 0.1 || ppa > 0.4) continue;

        const weights: ModelWeights = {
          elo,
          spPlus: sp,
          ppa,
          homeFieldAdvantage: hfa,
        };

        const results = calculateHistoricalEdges(games, weights);
        const calibration = buildCalibrationCurve(
          results.map(r => ({ edge: r.edge, actualResult: r.actualResult }))
        );

        if (calibration.overallROI > bestROI) {
          bestROI = calibration.overallROI;
          bestWeights = weights;
        }
      }
    }
  }

  return { bestWeights, bestROI };
}

/**
 * Save calibration curve to database for use in live projections
 */
export function serializeCalibration(calibration: CalibrationCurve): string {
  return JSON.stringify({
    points: calibration.points,
    overallWinRate: calibration.overallWinRate,
    overallROI: calibration.overallROI,
    totalGames: calibration.totalGames,
    confidenceByEdge: Object.fromEntries(calibration.confidenceByEdge),
  });
}

/**
 * Load calibration curve from serialized string
 */
export function deserializeCalibration(json: string): CalibrationCurve {
  const data = JSON.parse(json);
  return {
    points: data.points,
    overallWinRate: data.overallWinRate,
    overallROI: data.overallROI,
    totalGames: data.totalGames,
    confidenceByEdge: new Map(Object.entries(data.confidenceByEdge).map(([k, v]) => [parseFloat(k), v as number])),
  };
}

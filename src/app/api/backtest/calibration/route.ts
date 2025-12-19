import { NextResponse } from 'next/server';
import {
  buildHistoricalDataset,
  filterCompleteGames,
} from '@/lib/backtest/historical-data';
import {
  calculateHistoricalEdges,
  DEFAULT_WEIGHTS,
  PROFITABLE_FILTER,
} from '@/lib/backtest/ensemble-model';

export const maxDuration = 300;

interface CalibrationData {
  // Overall stats for filtered bets
  overallStats: {
    totalBets: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
    roi: number;
  };
  // Win probability by edge range (for filtered bets only)
  probabilityByEdge: Array<{
    edgeMin: number;
    edgeMax: number;
    bets: number;
    wins: number;
    losses: number;
    winProbability: number;
    expectedValue: number;
    confidenceTier: string;
  }>;
  // Confidence breakdown
  confidenceStats: {
    high: { bets: number; winRate: number; roi: number };
    medium: { bets: number; winRate: number; roi: number };
    low: { bets: number; winRate: number; roi: number };
  };
  // JSON export of calibration for use in production
  calibrationJSON: string;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const seasonsParam = url.searchParams.get('seasons');
    const seasons = seasonsParam
      ? seasonsParam.split(',').map(s => parseInt(s, 10))
      : [2022, 2023, 2024];

    console.log('Building calibration curve...');

    // Fetch historical data
    const allGames = await buildHistoricalDataset(seasons);
    const completeGames = filterCompleteGames(allGames);

    console.log(`Complete games: ${completeGames.length}`);

    // Calculate edges with optimal weights
    const edgeResults = calculateHistoricalEdges(completeGames, DEFAULT_WEIGHTS);

    // Apply profitable filter
    const filteredResults = edgeResults.filter(r => {
      const absEdge = Math.abs(r.edge);
      if (absEdge < PROFITABLE_FILTER.minEdge) return false;
      if (absEdge >= PROFITABLE_FILTER.maxEdge) return false;
      if (PROFITABLE_FILTER.requireHighConfidence && r.projection.confidence !== 'high') return false;
      return true;
    });

    console.log(`Filtered bets: ${filteredResults.length}`);

    // Overall stats
    const decided = filteredResults.filter(r => r.actualResult !== 'push');
    const wins = decided.filter(r => r.actualResult === 'win').length;
    const losses = decided.filter(r => r.actualResult === 'loss').length;
    const pushes = filteredResults.filter(r => r.actualResult === 'push').length;

    const winRate = decided.length > 0 ? wins / decided.length : 0;
    const profit = (wins * 100) - (losses * 110);
    const totalWagered = decided.length * 110;
    const roi = totalWagered > 0 ? (profit / totalWagered) * 100 : 0;

    // Win probability by edge bucket (within our 3-7 range)
    const edgeBuckets = [
      { min: 3, max: 4 },
      { min: 4, max: 5 },
      { min: 5, max: 6 },
      { min: 6, max: 7 },
    ];

    const probabilityByEdge = edgeBuckets.map(bucket => {
      const bucketResults = filteredResults.filter(r => {
        const absEdge = Math.abs(r.edge);
        return absEdge >= bucket.min && absEdge < bucket.max;
      });

      const bucketDecided = bucketResults.filter(r => r.actualResult !== 'push');
      const bucketWins = bucketDecided.filter(r => r.actualResult === 'win').length;
      const bucketLosses = bucketDecided.filter(r => r.actualResult === 'loss').length;

      const winProb = bucketDecided.length > 0 ? bucketWins / bucketDecided.length : 0;

      // EV at -110 odds: (winProb * 100/110 * 110) - ((1-winProb) * 110)
      // Simplified: (winProb * 100) - ((1-winProb) * 110)
      const ev = (winProb * 100) - ((1 - winProb) * 110);

      // Determine confidence tier
      let tier = 'medium';
      if (winProb >= 0.58 && bucket.min >= 5) tier = 'very-high';
      else if (winProb >= 0.55 && bucket.min >= 4) tier = 'high';
      else if (winProb < 0.52) tier = 'low';

      return {
        edgeMin: bucket.min,
        edgeMax: bucket.max,
        bets: bucketResults.length,
        wins: bucketWins,
        losses: bucketLosses,
        winProbability: Math.round(winProb * 1000) / 10,
        expectedValue: Math.round(ev * 100) / 100,
        confidenceTier: tier,
      };
    });

    // Confidence breakdown (for all data, not just filtered)
    const confidenceStats = {
      high: calculateConfidenceStats(edgeResults, 'high'),
      medium: calculateConfidenceStats(edgeResults, 'medium'),
      low: calculateConfidenceStats(edgeResults, 'low'),
    };

    // Generate calibration JSON for production use
    const calibrationJSON = JSON.stringify({
      generatedAt: new Date().toISOString(),
      seasons,
      weights: DEFAULT_WEIGHTS,
      filters: PROFITABLE_FILTER,
      overallWinRate: Math.round(winRate * 1000) / 10,
      overallROI: Math.round(roi * 100) / 100,
      probabilityByEdge: probabilityByEdge.map(p => ({
        edgeMin: p.edgeMin,
        edgeMax: p.edgeMax,
        winProbability: p.winProbability,
        expectedValue: p.expectedValue,
        confidenceTier: p.confidenceTier,
        sampleSize: p.bets,
      })),
    });

    return NextResponse.json({
      success: true,
      data: {
        overallStats: {
          totalBets: filteredResults.length,
          wins,
          losses,
          pushes,
          winRate: Math.round(winRate * 1000) / 10,
          roi: Math.round(roi * 100) / 100,
        },
        probabilityByEdge,
        confidenceStats,
        calibrationJSON,
        filters: PROFITABLE_FILTER,
        weights: DEFAULT_WEIGHTS,
      } as CalibrationData,
    });
  } catch (error) {
    console.error('Calibration error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function calculateConfidenceStats(
  results: ReturnType<typeof calculateHistoricalEdges>,
  confidence: 'high' | 'medium' | 'low'
) {
  const filtered = results.filter(r => r.projection.confidence === confidence);
  const decided = filtered.filter(r => r.actualResult !== 'push');
  const wins = decided.filter(r => r.actualResult === 'win').length;
  const losses = decided.filter(r => r.actualResult === 'loss').length;

  const winRate = decided.length > 0 ? wins / decided.length : 0;
  const profit = (wins * 100) - (losses * 110);
  const totalWagered = decided.length * 110;
  const roi = totalWagered > 0 ? (profit / totalWagered) * 100 : 0;

  return {
    bets: filtered.length,
    winRate: Math.round(winRate * 1000) / 10,
    roi: Math.round(roi * 100) / 100,
  };
}

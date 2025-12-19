import { NextResponse } from 'next/server';
import {
  buildHistoricalDataset,
  filterCompleteGames,
} from '@/lib/backtest/historical-data';
import {
  calculateHistoricalEdges,
  DEFAULT_WEIGHTS,
  ModelWeights,
} from '@/lib/backtest/ensemble-model';
import { buildCalibrationCurve } from '@/lib/backtest/calibration';

export const maxDuration = 300;

interface StrategyResult {
  name: string;
  description: string;
  filters: {
    minEdge: number;
    maxEdge: number;
    requireHighConfidence: boolean;
    spreadFilter?: string;
  };
  results: {
    totalBets: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
    roi: number;
    profit: number; // Per $100 units
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const seasonsParam = url.searchParams.get('seasons');
    const seasons = seasonsParam
      ? seasonsParam.split(',').map(s => parseInt(s, 10))
      : [2022, 2023, 2024];

    console.log('Running comprehensive strategy analysis...');

    // Fetch historical data
    const allGames = await buildHistoricalDataset(seasons);
    const completeGames = filterCompleteGames(allGames);

    console.log(`Complete games for analysis: ${completeGames.length}`);

    // Get edge results with default weights
    const edgeResults = calculateHistoricalEdges(completeGames, DEFAULT_WEIGHTS);

    // Define strategies to test
    const strategies: StrategyResult[] = [];

    // Strategy 1: All edges (baseline)
    strategies.push(evaluateStrategy(
      'Baseline - All Edges',
      'Bet every game with any model edge',
      edgeResults,
      { minEdge: 0, maxEdge: Infinity, requireHighConfidence: false }
    ));

    // Strategy 2: Minimum edge threshold
    for (const minEdge of [1, 1.5, 2, 2.5, 3]) {
      strategies.push(evaluateStrategy(
        `Min Edge ${minEdge}+`,
        `Only bet when absolute edge >= ${minEdge} points`,
        edgeResults,
        { minEdge, maxEdge: Infinity, requireHighConfidence: false }
      ));
    }

    // Strategy 3: Edge window (sweet spot hypothesis)
    for (const [min, max] of [[2, 5], [2, 6], [2.5, 5.5], [3, 6], [3, 7], [2, 7]]) {
      strategies.push(evaluateStrategy(
        `Edge Window ${min}-${max}`,
        `Only bet when edge is between ${min} and ${max} points`,
        edgeResults,
        { minEdge: min, maxEdge: max, requireHighConfidence: false }
      ));
    }

    // Strategy 4: High confidence only
    strategies.push(evaluateStrategy(
      'High Confidence Only',
      'Only bet when all models agree (within 5 pts)',
      edgeResults,
      { minEdge: 0, maxEdge: Infinity, requireHighConfidence: true }
    ));

    // Strategy 5: High confidence + edge window
    for (const [min, max] of [[2, 6], [2.5, 5.5], [3, 7]]) {
      strategies.push(evaluateStrategy(
        `HC + Edge ${min}-${max}`,
        `High confidence AND edge between ${min}-${max}`,
        edgeResults,
        { minEdge: min, maxEdge: max, requireHighConfidence: true }
      ));
    }

    // Strategy 6: Small spreads only (tight games)
    const smallSpreadResults = edgeResults.filter(r =>
      Math.abs(r.game.closingSpread!) <= 10
    );
    for (const minEdge of [2, 2.5, 3]) {
      strategies.push(evaluateStrategy(
        `Small Spread + Edge ${minEdge}+`,
        `Only games with spread <= 10 and edge >= ${minEdge}`,
        smallSpreadResults,
        { minEdge, maxEdge: Infinity, requireHighConfidence: false, spreadFilter: '<=10' }
      ));
    }

    // Strategy 7: Avoid massive spreads
    const noBlowoutResults = edgeResults.filter(r =>
      Math.abs(r.game.closingSpread!) <= 21
    );
    for (const [min, max] of [[2, 6], [3, 7]]) {
      strategies.push(evaluateStrategy(
        `No Blowouts + Edge ${min}-${max}`,
        `Spread <= 21 AND edge ${min}-${max}`,
        noBlowoutResults,
        { minEdge: min, maxEdge: max, requireHighConfidence: false, spreadFilter: '<=21' }
      ));
    }

    // Sort by ROI
    strategies.sort((a, b) => b.results.roi - a.results.roi);

    // Find profitable strategies
    const profitableStrategies = strategies.filter(s =>
      s.results.roi > 0 && s.results.totalBets >= 50
    );

    return NextResponse.json({
      success: true,
      summary: {
        totalGames: allGames.length,
        completeGames: completeGames.length,
        seasons,
        strategiesTested: strategies.length,
        profitableStrategies: profitableStrategies.length,
      },
      topStrategies: strategies.slice(0, 15),
      profitableStrategies,
      allStrategies: strategies,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function evaluateStrategy(
  name: string,
  description: string,
  allResults: ReturnType<typeof calculateHistoricalEdges>,
  filters: {
    minEdge: number;
    maxEdge: number;
    requireHighConfidence: boolean;
    spreadFilter?: string;
  }
): StrategyResult {
  let filtered = allResults.filter(r => {
    const absEdge = Math.abs(r.edge);
    if (absEdge < filters.minEdge) return false;
    if (absEdge >= filters.maxEdge) return false;
    if (filters.requireHighConfidence && r.projection.confidence !== 'high') return false;
    return true;
  });

  const wins = filtered.filter(r => r.actualResult === 'win').length;
  const losses = filtered.filter(r => r.actualResult === 'loss').length;
  const pushes = filtered.filter(r => r.actualResult === 'push').length;
  const decided = wins + losses;

  const winRate = decided > 0 ? wins / decided : 0;
  // ROI at -110 odds
  const profit = (wins * 100) - (losses * 110);
  const totalWagered = decided * 110;
  const roi = totalWagered > 0 ? (profit / totalWagered) * 100 : 0;

  return {
    name,
    description,
    filters,
    results: {
      totalBets: filtered.length,
      wins,
      losses,
      pushes,
      winRate: Math.round(winRate * 1000) / 10,
      roi: Math.round(roi * 100) / 100,
      profit: Math.round(profit * 100) / 100,
    },
  };
}

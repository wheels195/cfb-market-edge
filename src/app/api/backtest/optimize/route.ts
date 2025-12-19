import { NextResponse } from 'next/server';
import {
  buildHistoricalDataset,
  filterCompleteGames,
} from '@/lib/backtest/historical-data';
import {
  calculateHistoricalEdges,
  ModelWeights,
} from '@/lib/backtest/ensemble-model';

export const maxDuration = 300;

interface OptimizationResult {
  weights: ModelWeights;
  filters: {
    minEdge: number;
    maxEdge: number;
    requireHighConfidence: boolean;
  };
  results: {
    totalBets: number;
    wins: number;
    losses: number;
    winRate: number;
    roi: number;
    profit: number;
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const seasonsParam = url.searchParams.get('seasons');
    const seasons = seasonsParam
      ? seasonsParam.split(',').map(s => parseInt(s, 10))
      : [2022, 2023, 2024];

    console.log('Running weight optimization...');

    // Fetch historical data
    const allGames = await buildHistoricalDataset(seasons);
    const completeGames = filterCompleteGames(allGames);

    console.log(`Complete games: ${completeGames.length}`);

    const results: OptimizationResult[] = [];

    // Grid search over weights
    const eloOptions = [0.2, 0.3, 0.4, 0.5];
    const spOptions = [0.3, 0.4, 0.5, 0.6];
    const hfaOptions = [2.0, 2.5, 3.0, 3.5];

    // Fixed filters based on our earlier analysis (HC + Edge 3-7 was best)
    const filters = {
      minEdge: 3,
      maxEdge: 7,
      requireHighConfidence: true,
    };

    let tested = 0;
    for (const elo of eloOptions) {
      for (const sp of spOptions) {
        for (const hfa of hfaOptions) {
          const ppa = 1 - elo - sp;
          if (ppa < 0.05 || ppa > 0.5) continue;

          tested++;
          const weights: ModelWeights = {
            elo,
            spPlus: sp,
            ppa,
            homeFieldAdvantage: hfa,
          };

          const edgeResults = calculateHistoricalEdges(completeGames, weights);

          // Apply filters
          const filtered = edgeResults.filter(r => {
            const absEdge = Math.abs(r.edge);
            if (absEdge < filters.minEdge) return false;
            if (absEdge >= filters.maxEdge) return false;
            if (filters.requireHighConfidence && r.projection.confidence !== 'high') return false;
            return true;
          });

          const wins = filtered.filter(r => r.actualResult === 'win').length;
          const losses = filtered.filter(r => r.actualResult === 'loss').length;
          const decided = wins + losses;

          if (decided < 50) continue; // Skip if too few bets

          const winRate = decided > 0 ? wins / decided : 0;
          const profit = (wins * 100) - (losses * 110);
          const totalWagered = decided * 110;
          const roi = totalWagered > 0 ? (profit / totalWagered) * 100 : 0;

          results.push({
            weights,
            filters,
            results: {
              totalBets: filtered.length,
              wins,
              losses,
              winRate: Math.round(winRate * 1000) / 10,
              roi: Math.round(roi * 100) / 100,
              profit: Math.round(profit),
            },
          });
        }
      }
    }

    // Sort by ROI
    results.sort((a, b) => b.results.roi - a.results.roi);

    console.log(`Tested ${tested} weight combinations, ${results.length} met minimum bet threshold`);

    // Also test pure models (single source)
    const pureModels = [];

    // Pure Elo
    const pureEloWeights: ModelWeights = { elo: 1, spPlus: 0, ppa: 0, homeFieldAdvantage: 2.5 };
    const pureEloResults = calculateHistoricalEdges(completeGames, pureEloWeights);
    pureModels.push({
      name: 'Pure Elo',
      weights: pureEloWeights,
      ...evaluateFiltered(pureEloResults, filters),
    });

    // Pure SP+
    const pureSpWeights: ModelWeights = { elo: 0, spPlus: 1, ppa: 0, homeFieldAdvantage: 2.5 };
    const pureSpResults = calculateHistoricalEdges(completeGames, pureSpWeights);
    pureModels.push({
      name: 'Pure SP+',
      weights: pureSpWeights,
      ...evaluateFiltered(pureSpResults, filters),
    });

    // Pure PPA
    const purePpaWeights: ModelWeights = { elo: 0, spPlus: 0, ppa: 1, homeFieldAdvantage: 2.5 };
    const purePpaResults = calculateHistoricalEdges(completeGames, purePpaWeights);
    pureModels.push({
      name: 'Pure PPA',
      weights: purePpaWeights,
      ...evaluateFiltered(purePpaResults, filters),
    });

    // Heavy SP+ (recommended by research)
    const heavySpWeights: ModelWeights = { elo: 0.2, spPlus: 0.6, ppa: 0.2, homeFieldAdvantage: 2.5 };
    const heavySpResults = calculateHistoricalEdges(completeGames, heavySpWeights);
    pureModels.push({
      name: 'Heavy SP+ (20/60/20)',
      weights: heavySpWeights,
      ...evaluateFiltered(heavySpResults, filters),
    });

    return NextResponse.json({
      success: true,
      summary: {
        completeGames: completeGames.length,
        seasons,
        combinationsTested: tested,
        validCombinations: results.length,
      },
      topCombinations: results.slice(0, 10),
      pureModels: pureModels.sort((a, b) => b.roi - a.roi),
      bestOverall: results[0],
    });
  } catch (error) {
    console.error('Optimization error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function evaluateFiltered(
  allResults: ReturnType<typeof calculateHistoricalEdges>,
  filters: { minEdge: number; maxEdge: number; requireHighConfidence: boolean }
) {
  const filtered = allResults.filter(r => {
    const absEdge = Math.abs(r.edge);
    if (absEdge < filters.minEdge) return false;
    if (absEdge >= filters.maxEdge) return false;
    if (filters.requireHighConfidence && r.projection.confidence !== 'high') return false;
    return true;
  });

  const wins = filtered.filter(r => r.actualResult === 'win').length;
  const losses = filtered.filter(r => r.actualResult === 'loss').length;
  const decided = wins + losses;

  const winRate = decided > 0 ? wins / decided : 0;
  const profit = (wins * 100) - (losses * 110);
  const totalWagered = decided * 110;
  const roi = totalWagered > 0 ? (profit / totalWagered) * 100 : 0;

  return {
    totalBets: filtered.length,
    wins,
    losses,
    winRate: Math.round(winRate * 1000) / 10,
    roi: Math.round(roi * 100) / 100,
    profit: Math.round(profit),
  };
}

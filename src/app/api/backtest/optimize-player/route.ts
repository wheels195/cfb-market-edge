import { NextResponse } from 'next/server';
import {
  buildHistoricalDataset,
  filterCompleteGames,
  HistoricalGame,
} from '@/lib/backtest/historical-data';
import {
  generateEnsembleProjection,
  calculateEdge,
  DEFAULT_WEIGHTS,
} from '@/lib/backtest/ensemble-model';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

export const maxDuration = 300;

interface ReturningProductionData {
  team: string;
  percentPPA: number;
  percentPassingPPA: number;
}

interface PlayerWeights {
  returningMultiplier: number;   // How much to weight returning production (0-5)
  qbNewPenalty: number;          // Penalty for new QB (0-3 pts)
  qbExpBonus: number;            // Bonus for experienced QB (0-2 pts)
  seasonDecayRate: number;       // How fast effect decays (0.1-0.5)
}

function calculateAdjustment(
  homeReturning: ReturningProductionData | undefined,
  awayReturning: ReturningProductionData | undefined,
  week: number,
  weights: PlayerWeights
): number {
  let adjustment = 0;
  const avgReturning = 0.55;

  // Season decay
  let seasonFactor = 1.0;
  if (week > 8) seasonFactor = weights.seasonDecayRate;
  else if (week > 4) seasonFactor = 0.5 + (weights.seasonDecayRate * 0.5);

  // Home team
  if (homeReturning) {
    const homeDiff = homeReturning.percentPPA - avgReturning;
    adjustment += homeDiff * weights.returningMultiplier * seasonFactor;

    if (homeReturning.percentPassingPPA < 0.2) {
      adjustment -= weights.qbNewPenalty * seasonFactor;
    } else if (homeReturning.percentPassingPPA > 0.9) {
      adjustment += weights.qbExpBonus * seasonFactor;
    }
  }

  // Away team (opposite)
  if (awayReturning) {
    const awayDiff = awayReturning.percentPPA - avgReturning;
    adjustment -= awayDiff * weights.returningMultiplier * seasonFactor;

    if (awayReturning.percentPassingPPA < 0.2) {
      adjustment += weights.qbNewPenalty * seasonFactor;
    } else if (awayReturning.percentPassingPPA > 0.9) {
      adjustment -= weights.qbExpBonus * seasonFactor;
    }
  }

  return adjustment;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const seasonsParam = url.searchParams.get('seasons');
    const seasons = seasonsParam
      ? seasonsParam.split(',').map(s => parseInt(s, 10))
      : [2022, 2023, 2024];

    console.log('Optimizing player factor weights...');

    // Fetch data
    const allGames = await buildHistoricalDataset(seasons);
    const completeGames = filterCompleteGames(allGames);

    const cfbd = getCFBDApiClient();
    const returningBySeasonTeam = new Map<string, ReturningProductionData>();

    for (const season of seasons) {
      try {
        const returning = await cfbd.getReturningProduction(season);
        for (const team of returning) {
          returningBySeasonTeam.set(`${season}-${team.team}`, {
            team: team.team,
            percentPPA: team.percentPPA,
            percentPassingPPA: team.percentPassingPPA,
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch returning production for ${season}:`, err);
      }
    }

    // Grid search over weight combinations
    const weightConfigs: PlayerWeights[] = [];
    for (const returningMult of [2, 3, 4, 5]) {
      for (const qbNewPen of [0.5, 1.0, 1.5, 2.0]) {
        for (const qbExpBonus of [0.25, 0.5, 0.75, 1.0]) {
          for (const decayRate of [0.2, 0.25, 0.3]) {
            weightConfigs.push({
              returningMultiplier: returningMult,
              qbNewPenalty: qbNewPen,
              qbExpBonus: qbExpBonus,
              seasonDecayRate: decayRate,
            });
          }
        }
      }
    }

    console.log(`Testing ${weightConfigs.length} weight configurations...`);

    const results: Array<{
      weights: PlayerWeights;
      filtered: { wins: number; losses: number; winRate: number; roi: number };
      earlySeason: { wins: number; losses: number; winRate: number; roi: number };
    }> = [];

    for (const weights of weightConfigs) {
      let filteredWins = 0;
      let filteredLosses = 0;
      let earlyWins = 0;
      let earlyLosses = 0;

      for (const game of completeGames) {
        if (game.closingSpread === null) continue;

        const projection = generateEnsembleProjection(game, DEFAULT_WEIGHTS);
        const season = new Date(game.date).getFullYear();
        const homeReturning = returningBySeasonTeam.get(`${season}-${game.homeTeam}`);
        const awayReturning = returningBySeasonTeam.get(`${season}-${game.awayTeam}`);

        const playerAdj = calculateAdjustment(
          homeReturning,
          awayReturning,
          game.week,
          weights
        );

        const adjustedSpread = projection.projectedSpread - playerAdj;
        const adjustedEdge = game.closingSpread - adjustedSpread;
        const absEdge = Math.abs(adjustedEdge);

        // Only count filtered bets (edge 3-7)
        if (absEdge >= 3 && absEdge < 7) {
          const recommendedSide = adjustedEdge >= 0 ? 'home' : 'away';

          if (game.homeATS === 'push') continue;

          const won = (recommendedSide === 'home' && game.homeATS === 'win') ||
                      (recommendedSide === 'away' && game.homeATS === 'loss');

          if (won) filteredWins++;
          else filteredLosses++;

          // Track early season separately
          if (game.week <= 4) {
            if (won) earlyWins++;
            else earlyLosses++;
          }
        }
      }

      const filteredTotal = filteredWins + filteredLosses;
      const earlyTotal = earlyWins + earlyLosses;

      results.push({
        weights,
        filtered: {
          wins: filteredWins,
          losses: filteredLosses,
          winRate: filteredTotal > 0 ? Math.round((filteredWins / filteredTotal) * 1000) / 10 : 0,
          roi: filteredTotal > 0 ? Math.round(((filteredWins * 100 - filteredLosses * 110) / (filteredTotal * 110)) * 10000) / 100 : 0,
        },
        earlySeason: {
          wins: earlyWins,
          losses: earlyLosses,
          winRate: earlyTotal > 0 ? Math.round((earlyWins / earlyTotal) * 1000) / 10 : 0,
          roi: earlyTotal > 0 ? Math.round(((earlyWins * 100 - earlyLosses * 110) / (earlyTotal * 110)) * 10000) / 100 : 0,
        },
      });
    }

    // Sort by filtered ROI
    results.sort((a, b) => b.filtered.roi - a.filtered.roi);

    // Get top 10
    const topResults = results.slice(0, 10);

    // Also find best for early season
    const topEarlySeason = [...results]
      .sort((a, b) => b.earlySeason.roi - a.earlySeason.roi)
      .slice(0, 5);

    return NextResponse.json({
      success: true,
      summary: {
        totalGames: completeGames.length,
        configurationsTeested: weightConfigs.length,
        teamsWithData: returningBySeasonTeam.size,
      },
      bestOverall: {
        weights: topResults[0].weights,
        filtered: topResults[0].filtered,
        earlySeason: topResults[0].earlySeason,
      },
      top10Configurations: topResults.map(r => ({
        returningMultiplier: r.weights.returningMultiplier,
        qbNewPenalty: r.weights.qbNewPenalty,
        qbExpBonus: r.weights.qbExpBonus,
        seasonDecayRate: r.weights.seasonDecayRate,
        filteredROI: r.filtered.roi,
        filteredWinRate: r.filtered.winRate,
        earlySeasonROI: r.earlySeason.roi,
      })),
      bestForEarlySeason: topEarlySeason.map(r => ({
        returningMultiplier: r.weights.returningMultiplier,
        qbNewPenalty: r.weights.qbNewPenalty,
        qbExpBonus: r.weights.qbExpBonus,
        filteredROI: r.filtered.roi,
        earlySeasonROI: r.earlySeason.roi,
        earlySeasonWinRate: r.earlySeason.winRate,
      })),
    });
  } catch (error) {
    console.error('Optimize player weights error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

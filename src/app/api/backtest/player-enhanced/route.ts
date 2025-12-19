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
  percentRushingPPA: number;
}

// Calculate player-factor adjustment
function calculatePlayerAdjustment(
  homeReturning: ReturningProductionData | undefined,
  awayReturning: ReturningProductionData | undefined,
  week: number
): { adjustment: number; factors: string[] } {
  const factors: string[] = [];
  let adjustment = 0;

  // Season progression factor
  let seasonFactor = 1.0;
  if (week > 8) seasonFactor = 0.25;
  else if (week > 4) seasonFactor = 0.5;

  const avgReturning = 0.55;

  // Home team
  if (homeReturning) {
    const homeDiff = homeReturning.percentPPA - avgReturning;
    if (Math.abs(homeDiff) > 0.15) {
      adjustment += homeDiff * 3 * seasonFactor;
      factors.push(`Home ${Math.round(homeReturning.percentPPA * 100)}% returning`);
    }
    if (homeReturning.percentPassingPPA < 0.2) {
      adjustment -= 1.0 * seasonFactor;
      factors.push('Home new QB');
    }
  }

  // Away team (opposite direction)
  if (awayReturning) {
    const awayDiff = awayReturning.percentPPA - avgReturning;
    if (Math.abs(awayDiff) > 0.15) {
      adjustment -= awayDiff * 3 * seasonFactor;
      factors.push(`Away ${Math.round(awayReturning.percentPPA * 100)}% returning`);
    }
    if (awayReturning.percentPassingPPA < 0.2) {
      adjustment += 1.0 * seasonFactor;
      factors.push('Away new QB');
    }
  }

  return { adjustment: Math.round(adjustment * 10) / 10, factors };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const seasonsParam = url.searchParams.get('seasons');
    const seasons = seasonsParam
      ? seasonsParam.split(',').map(s => parseInt(s, 10))
      : [2022, 2023, 2024];

    console.log('Running player-enhanced backtest...');

    // Fetch historical data
    const allGames = await buildHistoricalDataset(seasons);
    const completeGames = filterCompleteGames(allGames);

    // Fetch returning production for each season
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
            percentRushingPPA: team.percentRushingPPA,
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch returning production for ${season}:`, err);
      }
    }

    console.log(`Loaded returning production for ${returningBySeasonTeam.size} team-seasons`);

    // Run base model
    const baseResults: Array<{
      game: HistoricalGame;
      edge: number;
      recommendedSide: 'home' | 'away';
      actualResult: 'win' | 'loss' | 'push';
    }> = [];

    // Run player-enhanced model
    const enhancedResults: Array<{
      game: HistoricalGame;
      edge: number;
      playerAdjustment: number;
      adjustedEdge: number;
      recommendedSide: 'home' | 'away';
      actualResult: 'win' | 'loss' | 'push';
      playerFactors: string[];
    }> = [];

    for (const game of completeGames) {
      if (game.closingSpread === null) continue;

      // Base model
      const projection = generateEnsembleProjection(game, DEFAULT_WEIGHTS);
      const baseEdge = calculateEdge(game.closingSpread, projection.projectedSpread);
      const baseRecommendedSide: 'home' | 'away' = baseEdge >= 0 ? 'home' : 'away';

      let baseResult: 'win' | 'loss' | 'push';
      if (game.homeATS === 'push') {
        baseResult = 'push';
      } else if (baseRecommendedSide === 'home') {
        baseResult = game.homeATS === 'win' ? 'win' : 'loss';
      } else {
        baseResult = game.homeATS === 'loss' ? 'win' : 'loss';
      }

      baseResults.push({
        game,
        edge: baseEdge,
        recommendedSide: baseRecommendedSide,
        actualResult: baseResult,
      });

      // Player-enhanced model
      const season = new Date(game.date).getFullYear();
      const homeReturning = returningBySeasonTeam.get(`${season}-${game.homeTeam}`);
      const awayReturning = returningBySeasonTeam.get(`${season}-${game.awayTeam}`);

      const { adjustment: playerAdj, factors: playerFactors } = calculatePlayerAdjustment(
        homeReturning,
        awayReturning,
        game.week
      );

      // Apply player adjustment to projected spread
      const adjustedSpread = projection.projectedSpread - playerAdj;
      const adjustedEdge = game.closingSpread - adjustedSpread;
      const enhancedRecommendedSide: 'home' | 'away' = adjustedEdge >= 0 ? 'home' : 'away';

      let enhancedResult: 'win' | 'loss' | 'push';
      if (game.homeATS === 'push') {
        enhancedResult = 'push';
      } else if (enhancedRecommendedSide === 'home') {
        enhancedResult = game.homeATS === 'win' ? 'win' : 'loss';
      } else {
        enhancedResult = game.homeATS === 'loss' ? 'win' : 'loss';
      }

      enhancedResults.push({
        game,
        edge: baseEdge,
        playerAdjustment: playerAdj,
        adjustedEdge,
        recommendedSide: enhancedRecommendedSide,
        actualResult: enhancedResult,
        playerFactors,
      });
    }

    // Calculate stats helper
    const calcStats = (results: Array<{ actualResult: string; edge?: number; adjustedEdge?: number }>, useAdjusted = false) => {
      const decided = results.filter(r => r.actualResult !== 'push');
      const wins = decided.filter(r => r.actualResult === 'win').length;
      const losses = decided.filter(r => r.actualResult === 'loss').length;
      const winRate = decided.length > 0 ? wins / decided.length : 0;
      const profit = (wins * 100) - (losses * 110);
      const roi = decided.length > 0 ? (profit / (decided.length * 110)) * 100 : 0;
      return {
        totalBets: decided.length,
        wins,
        losses,
        winRate: Math.round(winRate * 1000) / 10,
        roi: Math.round(roi * 100) / 100,
        profit: Math.round(profit),
      };
    };

    // Filter criteria
    const filters = { minEdge: 3, maxEdge: 7 };

    // Base model filtered
    const baseFiltered = baseResults.filter(r => {
      const absEdge = Math.abs(r.edge);
      return absEdge >= filters.minEdge && absEdge < filters.maxEdge;
    });

    // Enhanced model filtered (using adjusted edge)
    const enhancedFiltered = enhancedResults.filter(r => {
      const absEdge = Math.abs(r.adjustedEdge);
      return absEdge >= filters.minEdge && absEdge < filters.maxEdge;
    });

    // Early season analysis (weeks 1-4 where returning production matters most)
    const baseEarlySeason = baseResults.filter(r => r.game.week <= 4);
    const enhancedEarlySeason = enhancedResults.filter(r => r.game.week <= 4);

    const baseEarlyFiltered = baseEarlySeason.filter(r => {
      const absEdge = Math.abs(r.edge);
      return absEdge >= filters.minEdge && absEdge < filters.maxEdge;
    });
    const enhancedEarlyFiltered = enhancedEarlySeason.filter(r => {
      const absEdge = Math.abs(r.adjustedEdge);
      return absEdge >= filters.minEdge && absEdge < filters.maxEdge;
    });

    // Games with significant player adjustments
    const gamesWithAdjustment = enhancedResults.filter(r => Math.abs(r.playerAdjustment) >= 0.5);
    const gamesWithLargeAdjustment = enhancedResults.filter(r => Math.abs(r.playerAdjustment) >= 1.0);

    return NextResponse.json({
      success: true,
      summary: {
        totalGames: completeGames.length,
        seasons,
        teamsWithReturningData: returningBySeasonTeam.size,
      },
      comparison: {
        baseModel: {
          name: 'Base Ensemble (Elo + SP+ + PPA)',
          allGames: calcStats(baseResults),
          filtered: calcStats(baseFiltered),
          earlySeason: calcStats(baseEarlySeason),
          earlySeasonFiltered: calcStats(baseEarlyFiltered),
        },
        playerEnhancedModel: {
          name: 'Player-Enhanced (+ Returning Production)',
          allGames: calcStats(enhancedResults),
          filtered: calcStats(enhancedFiltered),
          earlySeason: calcStats(enhancedEarlySeason),
          earlySeasonFiltered: calcStats(enhancedEarlyFiltered),
        },
      },
      playerFactorAnalysis: {
        gamesWithAnyAdjustment: gamesWithAdjustment.length,
        gamesWithLargeAdjustment: gamesWithLargeAdjustment.length,
        adjustmentStats: calcStats(gamesWithAdjustment),
        largeAdjustmentStats: calcStats(gamesWithLargeAdjustment),
      },
      insights: {
        message: 'Player-enhanced model adds returning production factors',
        expectedImprovement: 'Should improve early season predictions',
      },
    });
  } catch (error) {
    console.error('Player-enhanced backtest error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

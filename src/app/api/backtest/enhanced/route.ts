import { NextResponse } from 'next/server';
import {
  buildHistoricalDataset,
  filterCompleteGames,
} from '@/lib/backtest/historical-data';
import {
  calculateHistoricalEdges,
  DEFAULT_WEIGHTS,
} from '@/lib/backtest/ensemble-model';
import {
  calculateEnhancedEdges,
  ENHANCED_WEIGHTS,
} from '@/lib/backtest/enhanced-model';

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const seasonsParam = url.searchParams.get('seasons');
    const seasons = seasonsParam
      ? seasonsParam.split(',').map(s => parseInt(s, 10))
      : [2022, 2023, 2024];

    console.log('Running enhanced model comparison...');

    // Fetch historical data
    const allGames = await buildHistoricalDataset(seasons);
    const completeGames = filterCompleteGames(allGames);

    console.log(`Complete games: ${completeGames.length}`);

    // Run base model
    const baseResults = calculateHistoricalEdges(completeGames, DEFAULT_WEIGHTS);

    // Run enhanced model
    const enhancedResults = calculateEnhancedEdges(completeGames, ENHANCED_WEIGHTS);

    // Filter settings (our profitable criteria)
    const filters = {
      minEdge: 3,
      maxEdge: 7,
      requireHighConfidence: true,
    };

    // Evaluate base model with filters
    const baseFiltered = baseResults.filter(r => {
      const absEdge = Math.abs(r.edge);
      return absEdge >= filters.minEdge && absEdge < filters.maxEdge &&
             r.projection.confidence === 'high';
    });

    // Evaluate enhanced model with filters + no warnings
    const enhancedFiltered = enhancedResults.filter(r => {
      const absEdge = Math.abs(r.edge);
      return absEdge >= filters.minEdge && absEdge < filters.maxEdge &&
             r.projection.confidence === 'high' && !r.hasWarnings;
    });

    // Also test enhanced without filtering warnings
    const enhancedFilteredWithWarnings = enhancedResults.filter(r => {
      const absEdge = Math.abs(r.edge);
      return absEdge >= filters.minEdge && absEdge < filters.maxEdge &&
             r.projection.confidence === 'high';
    });

    // Calculate stats
    const calcStats = (results: Array<{ actualResult: string }>) => {
      const decided = results.filter(r => r.actualResult !== 'push');
      const wins = decided.filter(r => r.actualResult === 'win').length;
      const losses = decided.filter(r => r.actualResult === 'loss').length;
      const winRate = decided.length > 0 ? wins / decided.length : 0;
      const profit = (wins * 100) - (losses * 110);
      const roi = decided.length > 0 ? (profit / (decided.length * 110)) * 100 : 0;
      return {
        totalBets: results.length,
        wins,
        losses,
        winRate: Math.round(winRate * 1000) / 10,
        roi: Math.round(roi * 100) / 100,
        profit: Math.round(profit),
      };
    };

    // Analyze large edges specifically
    const largeEdgeBase = baseResults.filter(r => Math.abs(r.edge) >= 10);
    const largeEdgeEnhanced = enhancedResults.filter(r => Math.abs(r.edge) >= 10);
    const largeEdgeEnhancedNoWarnings = enhancedResults.filter(r =>
      Math.abs(r.edge) >= 10 && !r.hasWarnings
    );

    // Count warnings by type
    const warningCounts: Record<string, number> = {};
    for (const r of enhancedResults) {
      for (const warning of r.projection.warnings) {
        const key = warning.split(':')[0];
        warningCounts[key] = (warningCounts[key] || 0) + 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalGames: allGames.length,
        completeGames: completeGames.length,
        seasons,
      },
      comparison: {
        baseModel: {
          name: 'Base Ensemble (Elo + SP+ + PPA)',
          allGames: calcStats(baseResults),
          filteredGames: calcStats(baseFiltered),
          largeEdges: calcStats(largeEdgeBase),
        },
        enhancedModel: {
          name: 'Enhanced (+ Recent Form + SOS + Line Movement)',
          allGames: calcStats(enhancedResults),
          filteredGames: calcStats(enhancedFilteredWithWarnings),
          filteredNoWarnings: calcStats(enhancedFiltered),
          largeEdges: calcStats(largeEdgeEnhanced),
          largeEdgesNoWarnings: calcStats(largeEdgeEnhancedNoWarnings),
        },
      },
      warnings: {
        totalGamesWithWarnings: enhancedResults.filter(r => r.hasWarnings).length,
        breakdown: warningCounts,
      },
      insights: {
        message: 'Enhanced model adds recent form, SOS, and line movement detection',
        recommendation: 'Filter out games with warnings for better accuracy',
      },
    });
  } catch (error) {
    console.error('Enhanced model error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

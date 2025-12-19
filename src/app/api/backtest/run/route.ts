import { NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest/backtest-runner';

export const maxDuration = 300; // 5 minutes for full backtest

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const seasonsParam = url.searchParams.get('seasons');
    const seasons = seasonsParam
      ? seasonsParam.split(',').map(s => parseInt(s, 10))
      : [2022, 2023, 2024];

    console.log('Running backtest for seasons:', seasons);

    const result = await runBacktest(seasons);

    // Return summary + sample of picks (full data would be too large)
    return NextResponse.json({
      success: true,
      summary: {
        totalGames: result.totalGames,
        gamesWithCompleteData: result.gamesWithCompleteData,
        seasons: result.seasons,
        overallWinRate: (result.calibration.overallWinRate * 100).toFixed(1) + '%',
        overallROI: result.calibration.overallROI.toFixed(2) + '%',
      },
      performanceByEdge: result.performanceByEdgeThreshold,
      calibrationPoints: result.calibration.points,
      report: result.report,
      // Sample of recent picks for verification
      samplePicks: result.allPicks.slice(-20).map(p => ({
        date: p.date.split('T')[0],
        game: `${p.awayTeam} @ ${p.homeTeam}`,
        marketSpread: p.marketSpread,
        modelSpread: p.modelSpread,
        edge: p.edge,
        bet: p.recommendedBet,
        result: p.actualResult,
        winProb: p.winProbability + '%',
        ev: '$' + p.expectedValue.toFixed(2),
        tier: p.confidenceTier,
      })),
    });
  } catch (error) {
    console.error('Backtest error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { getAPIUsage } from '@/lib/api/cfbd-api';

export async function GET() {
  try {
    const usage = getAPIUsage();

    // Estimate monthly API calls based on current polling schedule:
    // - sync-events: 4x/day = 120/month
    // - poll-odds: Does NOT use CFBD (uses The Odds API)
    // - set-closing-lines: Does NOT use CFBD (uses local data)
    // - sync-results: 1x/day = 30/month (calls getGames)
    // - run-model: 6x/day = 180/month (calls multiple endpoints)
    // - materialize-edges: 288x/day (every 5 min) = 8640/month but mostly local
    //   - weather: 1 call per run = ~300/month (cached)
    //   - returning production: 1 call per run = ~300/month (cached)
    //
    // Estimated CFBD calls per month: ~1000-1500 (well under 5000 limit)
    // Backtest runs are one-time and use ~10-20 calls

    const estimatedMonthly = {
      syncEvents: 120,        // Games list
      syncResults: 30,        // Completed games
      runModel: 180,          // Ratings, PPA, etc.
      weather: 300,           // Weather (with caching)
      returningProduction: 300, // Player returning (with caching)
      backtest: 50,           // Occasional backtest runs
      total: 980,
    };

    return NextResponse.json({
      success: true,
      usage,
      estimates: {
        ...estimatedMonthly,
        note: 'Estimates assume normal cron job operation',
        safetyMargin: Math.round(((5000 - estimatedMonthly.total) / 5000) * 100) + '%',
      },
      tips: [
        'Weather and returning production data are cached per-season',
        'Most expensive operations: backtest runs (10-20 calls each)',
        'Poll-odds uses The Odds API, not CFBD',
        'Consider increasing cache duration for stable data',
      ],
    });
  } catch (error) {
    console.error('API usage error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

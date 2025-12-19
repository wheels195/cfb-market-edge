import { NextResponse } from 'next/server';
import { calculateCLVForCompletedGames, getCLVSummary } from '@/lib/models/clv';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Calculate CLV (Closing Line Value) for completed games
 * This shows how well our edge picks beat the closing line
 */
export async function GET() {
  try {
    // Calculate CLV for completed games
    const clvResult = await calculateCLVForCompletedGames();

    // Get summary statistics
    const summary = await getCLVSummary();

    return NextResponse.json({
      success: true,
      processed: clvResult.processed,
      summary: {
        totalBets: summary.totalBets,
        avgClvPoints: summary.avgClvPoints,
        avgClvCents: summary.avgClvCents,
        positiveCLVRate: `${summary.positiveCLVRate}%`,
        avgPinnacleClv: summary.avgPinnacleClv,
        spreadBets: summary.byMarketType.spread,
        totalBets_type: summary.byMarketType.total,
      },
      errors: clvResult.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

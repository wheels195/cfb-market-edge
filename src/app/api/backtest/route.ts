import { NextResponse } from 'next/server';
import { runBacktest, BacktestConfig } from '@/lib/backtest/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const config: BacktestConfig = {
      startDate: body.startDate,
      endDate: body.endDate,
      edgeThreshold: parseFloat(body.edgeThreshold) || 1.0,
      betTimeMinutes: parseInt(body.betTimeMinutes, 10) || 60,
      sportsbookKey: body.sportsbookKey || undefined,
      marketType: body.marketType || undefined,
    };

    // Validate dates
    if (!config.startDate || !config.endDate) {
      return NextResponse.json(
        { error: 'Start date and end date are required' },
        { status: 400 }
      );
    }

    const result = await runBacktest(config);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

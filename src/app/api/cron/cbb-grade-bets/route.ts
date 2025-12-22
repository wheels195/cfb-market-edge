import { NextResponse } from 'next/server';
import { gradeCbbBets, getCbbPerformanceStats } from '@/lib/cbb/jobs/grade-bets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify cron secret for Vercel cron jobs
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await gradeCbbBets();
    const stats = await getCbbPerformanceStats();

    return NextResponse.json({
      success: result.errors.length === 0,
      ...result,
      season_stats: stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

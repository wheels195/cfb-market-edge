import { NextResponse } from 'next/server';
import { gradeBets } from '@/lib/jobs/grade-bets';
import { startJobRun, completeJobRun } from '@/lib/jobs/sync-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 minutes max

export async function GET(request: Request) {
  // Verify cron secret for Vercel cron jobs
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = await startJobRun('grade_bets');

  try {
    const result = await gradeBets();

    if (jobId) {
      await completeJobRun(
        jobId,
        result.errors.length > 0 ? 'failed' : 'success',
        result.betsGraded,
        result.errors.length > 0 ? result.errors.join('; ') : undefined,
        { result }
      );
    }

    return NextResponse.json({
      success: result.errors.length === 0,
      betsGraded: result.betsGraded,
      wins: result.wins,
      losses: result.losses,
      pushes: result.pushes,
      errors: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (jobId) {
      await completeJobRun(jobId, 'failed', 0, message);
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

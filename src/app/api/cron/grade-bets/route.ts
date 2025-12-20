import { NextResponse } from 'next/server';
import { gradeBets } from '@/lib/jobs/grade-bets';
import { gradePaperBets } from '@/lib/jobs/grade-paper-bets';
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
    // Grade regular bet_records
    const result = await gradeBets();

    // Also grade paper_bets
    const paperResult = await gradePaperBets();

    const totalGraded = result.betsGraded + paperResult.betsGraded;
    const allErrors = [...result.errors, ...paperResult.errors];

    if (jobId) {
      await completeJobRun(
        jobId,
        allErrors.length > 0 ? 'failed' : 'success',
        totalGraded,
        allErrors.length > 0 ? allErrors.join('; ') : undefined,
        { result, paperResult }
      );
    }

    return NextResponse.json({
      success: allErrors.length === 0,
      betsGraded: result.betsGraded,
      paperBetsGraded: paperResult.betsGraded,
      wins: result.wins + paperResult.wins,
      losses: result.losses + paperResult.losses,
      pushes: result.pushes + paperResult.pushes,
      errors: allErrors,
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

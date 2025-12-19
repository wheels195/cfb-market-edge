import { NextResponse } from 'next/server';
import { runCleanup } from '@/lib/jobs/cleanup';
import { startJobRun, completeJobRun } from '@/lib/jobs/sync-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 1 minute max

export async function GET(request: Request) {
  // Verify cron secret for Vercel cron jobs
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = await startJobRun('cleanup');

  try {
    const result = await runCleanup();

    const recordsProcessed =
      result.eventsMarkedFinal +
      result.edgesDeleted +
      result.projectionsDeleted;

    if (jobId) {
      await completeJobRun(
        jobId,
        result.errors.length > 0 ? 'failed' : 'success',
        recordsProcessed,
        result.errors.length > 0 ? result.errors.join('; ') : undefined,
        { result }
      );
    }

    return NextResponse.json({
      success: result.errors.length === 0,
      eventsMarkedFinal: result.eventsMarkedFinal,
      edgesDeleted: result.edgesDeleted,
      projectionsDeleted: result.projectionsDeleted,
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

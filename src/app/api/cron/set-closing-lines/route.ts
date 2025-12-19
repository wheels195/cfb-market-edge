import { NextResponse } from 'next/server';
import { setClosingLines } from '@/lib/jobs/set-closing-lines';
import { startJobRun, completeJobRun } from '@/lib/jobs/sync-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify cron secret for Vercel cron jobs
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = await startJobRun('set_closing_lines');

  try {
    const result = await setClosingLines();

    if (jobId) {
      await completeJobRun(
        jobId,
        result.errors.length === 0 ? 'success' : 'failed',
        result.linesSet,
        result.errors.length > 0 ? result.errors.join('; ') : undefined,
        { result }
      );
    }

    return NextResponse.json({
      success: true,
      ...result,
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

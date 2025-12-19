import { NextResponse } from 'next/server';
import { runPipeline } from '@/lib/jobs/pipeline';
import { startJobRun, completeJobRun } from '@/lib/jobs/sync-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max

export async function GET(request: Request) {
  // Verify cron secret for Vercel cron jobs
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = await startJobRun('run_pipeline');

  try {
    const result = await runPipeline();

    if (jobId) {
      const recordsProcessed =
        (result.steps.syncEvents?.eventsCreated || 0) +
        (result.steps.syncEvents?.eventsUpdated || 0) +
        (result.steps.pollOdds?.ticksInserted || 0) +
        (result.steps.runModel?.projectionsGenerated || 0) +
        (result.steps.materializeEdges?.edgesCreated || 0) +
        (result.steps.materializeEdges?.edgesUpdated || 0);

      await completeJobRun(
        jobId,
        result.success ? 'success' : 'failed',
        recordsProcessed,
        result.errors.length > 0 ? result.errors.join('; ') : undefined,
        { result }
      );
    }

    return NextResponse.json({
      success: result.success,
      coverage: result.coverage,
      timing: result.timing,
      errors: result.errors,
      steps: {
        syncEvents: result.steps.syncEvents ? {
          eventsCreated: result.steps.syncEvents.eventsCreated,
          eventsUpdated: result.steps.syncEvents.eventsUpdated,
        } : null,
        pollOdds: result.steps.pollOdds ? {
          ticksInserted: result.steps.pollOdds.ticksInserted,
        } : null,
        runModel: result.steps.runModel ? {
          ratingsUpdated: result.steps.runModel.ratingsUpdated,
          projectionsGenerated: result.steps.runModel.projectionsGenerated,
        } : null,
        materializeEdges: result.steps.materializeEdges ? {
          edgesCreated: result.steps.materializeEdges.edgesCreated,
          edgesUpdated: result.steps.materializeEdges.edgesUpdated,
        } : null,
      },
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

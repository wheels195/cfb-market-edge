/**
 * Pipeline Orchestration
 *
 * Runs the full pipeline in correct order:
 * 1. Sync upcoming events
 * 2. Poll odds for upcoming events
 * 3. Generate projections for events missing them
 * 4. Materialize edges
 *
 * Includes:
 * - Coverage gate (fail if projections < 95%)
 * - Progress logging
 * - Timeout protection
 */

import { supabase } from '@/lib/db/client';
import { syncEvents, SyncEventsResult } from './sync-events';
import { pollOdds, PollOddsResult } from './poll-odds';
import { runModel, RunModelResult } from './run-model';
import { materializeEdges, MaterializeEdgesResult } from './materialize-edges';

const CONFIG = {
  COVERAGE_THRESHOLD: 0.95,  // 95% of events must have projections
  STEP_TIMEOUT_MS: 120000,   // 2 minute timeout per step
};

export interface PipelineResult {
  success: boolean;
  steps: {
    syncEvents?: SyncEventsResult;
    pollOdds?: PollOddsResult;
    runModel?: RunModelResult;
    materializeEdges?: MaterializeEdgesResult;
  };
  coverage: {
    totalEvents: number;
    eventsWithProjections: number;
    coveragePercent: number;
    passed: boolean;
  };
  errors: string[];
  timing: {
    totalMs: number;
    syncEventsMs?: number;
    pollOddsMs?: number;
    runModelMs?: number;
    materializeEdgesMs?: number;
  };
}

/**
 * Run a step with timeout protection
 */
async function runWithTimeout<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)
  );

  return Promise.race([fn(), timeoutPromise]);
}

/**
 * Check projection coverage - fail if below threshold
 */
async function checkCoverage(): Promise<{
  totalEvents: number;
  eventsWithProjections: number;
  coveragePercent: number;
  passed: boolean;
}> {
  const now = new Date().toISOString();

  // Count upcoming events
  const { count: totalEvents } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gt('commence_time', now);

  // Count events with projections
  const { data: eventIds } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'scheduled')
    .gt('commence_time', now);

  const ids = (eventIds || []).map(e => e.id);

  const { count: withProjections } = await supabase
    .from('projections')
    .select('event_id', { count: 'exact', head: true })
    .in('event_id', ids);

  const total = totalEvents || 0;
  const covered = withProjections || 0;
  const coveragePercent = total > 0 ? covered / total : 0;

  return {
    totalEvents: total,
    eventsWithProjections: covered,
    coveragePercent,
    passed: coveragePercent >= CONFIG.COVERAGE_THRESHOLD,
  };
}

/**
 * Run the full pipeline
 */
export async function runPipeline(options?: {
  skipSync?: boolean;
  skipPoll?: boolean;
  skipModel?: boolean;
}): Promise<PipelineResult> {
  const startTime = Date.now();
  const result: PipelineResult = {
    success: false,
    steps: {},
    coverage: {
      totalEvents: 0,
      eventsWithProjections: 0,
      coveragePercent: 0,
      passed: false,
    },
    errors: [],
    timing: {
      totalMs: 0,
    },
  };

  try {
    // Step 1: Sync events (unless skipped)
    if (!options?.skipSync) {
      console.log('[Pipeline] Step 1: Syncing events...');
      const syncStart = Date.now();
      try {
        result.steps.syncEvents = await runWithTimeout(
          'syncEvents',
          syncEvents,
          CONFIG.STEP_TIMEOUT_MS
        );
        result.timing.syncEventsMs = Date.now() - syncStart;
        console.log(`[Pipeline] Events synced in ${result.timing.syncEventsMs}ms`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`syncEvents: ${msg}`);
        console.error(`[Pipeline] syncEvents failed: ${msg}`);
      }
    }

    // Step 2: Poll odds (unless skipped)
    if (!options?.skipPoll) {
      console.log('[Pipeline] Step 2: Polling odds...');
      const pollStart = Date.now();
      try {
        result.steps.pollOdds = await runWithTimeout(
          'pollOdds',
          pollOdds,
          CONFIG.STEP_TIMEOUT_MS
        );
        result.timing.pollOddsMs = Date.now() - pollStart;
        console.log(`[Pipeline] Odds polled in ${result.timing.pollOddsMs}ms`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`pollOdds: ${msg}`);
        console.error(`[Pipeline] pollOdds failed: ${msg}`);
      }
    }

    // Step 3: Run model / generate projections (unless skipped)
    if (!options?.skipModel) {
      console.log('[Pipeline] Step 3: Running model...');
      const modelStart = Date.now();
      try {
        result.steps.runModel = await runWithTimeout(
          'runModel',
          runModel,
          CONFIG.STEP_TIMEOUT_MS * 3  // Model gets extra time
        );
        result.timing.runModelMs = Date.now() - modelStart;
        console.log(`[Pipeline] Model run in ${result.timing.runModelMs}ms`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`runModel: ${msg}`);
        console.error(`[Pipeline] runModel failed: ${msg}`);
      }
    }

    // Check coverage before materializing edges
    console.log('[Pipeline] Checking projection coverage...');
    result.coverage = await checkCoverage();
    console.log(`[Pipeline] Coverage: ${(result.coverage.coveragePercent * 100).toFixed(1)}% (${result.coverage.eventsWithProjections}/${result.coverage.totalEvents})`);

    if (!result.coverage.passed) {
      result.errors.push(`Coverage gate failed: ${(result.coverage.coveragePercent * 100).toFixed(1)}% < ${CONFIG.COVERAGE_THRESHOLD * 100}%`);
      console.error(`[Pipeline] COVERAGE GATE FAILED - not materializing edges`);
      result.timing.totalMs = Date.now() - startTime;
      return result;
    }

    // Step 4: Materialize edges
    console.log('[Pipeline] Step 4: Materializing edges...');
    const edgesStart = Date.now();
    try {
      result.steps.materializeEdges = await runWithTimeout(
        'materializeEdges',
        materializeEdges,
        CONFIG.STEP_TIMEOUT_MS * 2  // Edges get extra time
      );
      result.timing.materializeEdgesMs = Date.now() - edgesStart;
      console.log(`[Pipeline] Edges materialized in ${result.timing.materializeEdgesMs}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`materializeEdges: ${msg}`);
      console.error(`[Pipeline] materializeEdges failed: ${msg}`);
    }

    result.success = result.errors.length === 0;
    result.timing.totalMs = Date.now() - startTime;

    console.log(`[Pipeline] Complete in ${result.timing.totalMs}ms - ${result.success ? 'SUCCESS' : 'FAILED'}`);
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Pipeline failed: ${msg}`);
    result.timing.totalMs = Date.now() - startTime;
    return result;
  }
}

/**
 * Run edges-only pipeline (for more frequent updates)
 * Assumes events and projections are already synced
 */
export async function runEdgesOnly(): Promise<PipelineResult> {
  return runPipeline({
    skipSync: true,
    skipPoll: true,
    skipModel: true,
  });
}

/**
 * Run full daily pipeline
 */
export async function runDailyPipeline(): Promise<PipelineResult> {
  return runPipeline();
}

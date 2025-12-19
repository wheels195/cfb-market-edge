/**
 * Cleanup Job - Nightly maintenance
 *
 * 1. Mark past events as 'final' if they have results
 * 2. Delete edges for events that are past and have no results (orphaned)
 * 3. Delete stale projections for past events
 *
 * This prevents "stale" records from appearing in production queries.
 */

import { supabase } from '@/lib/db/client';

export interface CleanupResult {
  eventsMarkedFinal: number;
  edgesDeleted: number;
  projectionsDeleted: number;
  errors: string[];
}

/**
 * Run cleanup job
 */
export async function runCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    eventsMarkedFinal: 0,
    edgesDeleted: 0,
    projectionsDeleted: 0,
    errors: [],
  };

  const now = new Date();
  // Events more than 6 hours past their start time are "past"
  const cutoffTime = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();

  console.log(`[Cleanup] Starting cleanup, cutoff time: ${cutoffTime}`);

  try {
    // Step 1: Mark past events with results as 'final'
    console.log('[Cleanup] Step 1: Marking past events as final...');
    const { data: eventsToFinalize } = await supabase
      .from('events')
      .select(`
        id,
        results!inner(id)
      `)
      .eq('status', 'scheduled')
      .lt('commence_time', cutoffTime);

    if (eventsToFinalize && eventsToFinalize.length > 0) {
      const eventIds = eventsToFinalize.map(e => e.id);
      const { error: updateError } = await supabase
        .from('events')
        .update({ status: 'final' })
        .in('id', eventIds);

      if (updateError) {
        result.errors.push(`Failed to mark events final: ${updateError.message}`);
      } else {
        result.eventsMarkedFinal = eventIds.length;
        console.log(`[Cleanup] Marked ${eventIds.length} events as final`);
      }
    }

    // Step 2: Delete edges for past events (regardless of results)
    // These are stale and shouldn't appear in UI
    console.log('[Cleanup] Step 2: Deleting edges for past events...');
    const { data: pastEventIds } = await supabase
      .from('events')
      .select('id')
      .lt('commence_time', cutoffTime);

    if (pastEventIds && pastEventIds.length > 0) {
      const ids = pastEventIds.map(e => e.id);

      const { count: deletedEdges, error: deleteEdgesError } = await supabase
        .from('edges')
        .delete({ count: 'exact' })
        .in('event_id', ids);

      if (deleteEdgesError) {
        result.errors.push(`Failed to delete edges: ${deleteEdgesError.message}`);
      } else {
        result.edgesDeleted = deletedEdges || 0;
        console.log(`[Cleanup] Deleted ${deletedEdges} edges for past events`);
      }
    }

    // Step 3: Delete projections for past events
    console.log('[Cleanup] Step 3: Deleting projections for past events...');
    if (pastEventIds && pastEventIds.length > 0) {
      const ids = pastEventIds.map(e => e.id);

      const { count: deletedProjections, error: deleteProjectionsError } = await supabase
        .from('projections')
        .delete({ count: 'exact' })
        .in('event_id', ids);

      if (deleteProjectionsError) {
        result.errors.push(`Failed to delete projections: ${deleteProjectionsError.message}`);
      } else {
        result.projectionsDeleted = deletedProjections || 0;
        console.log(`[Cleanup] Deleted ${deletedProjections} projections for past events`);
      }
    }

    console.log('[Cleanup] Complete');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Cleanup failed: ${msg}`);
    console.error(`[Cleanup] Error: ${msg}`);
  }

  return result;
}

/**
 * Delete orphaned edges (events that no longer exist)
 */
export async function deleteOrphanedEdges(): Promise<number> {
  // This would require a more complex query to find edges
  // where the event_id doesn't exist in events table
  // For now, we rely on the main cleanup to handle past events
  return 0;
}

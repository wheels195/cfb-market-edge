import { supabase } from '@/lib/db/client';
import {
  processGameResult,
  getDefaultModelVersionId,
} from '@/lib/models/elo';
import {
  generateProjection,
  saveProjection,
  updateTeamStats,
} from '@/lib/models/projections';

// Configuration
const CONFIG = {
  BATCH_SIZE: 100,           // Max events per batch
  LOOKAHEAD_DAYS: 10,        // Process events within this window (tightened for performance)
  MAX_RESULTS_HISTORY: 500,  // Limit results query
  TIMEOUT_MS: 30000,         // 30s timeout for operations
};

export interface RunModelResult {
  ratingsUpdated: number;
  projectionsGenerated: number;
  errors: string[];
  timing: {
    ratingsMs?: number;
    projectionsMs?: number;
  };
}

/**
 * Get current season
 */
function getCurrentSeason(): number {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  if (month < 6) return year - 1;
  return year;
}

/**
 * Run the model: update ratings from results and generate projections
 */
export async function runModel(): Promise<RunModelResult> {
  const result: RunModelResult = {
    ratingsUpdated: 0,
    projectionsGenerated: 0,
    errors: [],
    timing: {},
  };

  try {
    console.log('[runModel] Starting model run...');
    const modelVersionId = await getDefaultModelVersionId();
    const season = getCurrentSeason();
    console.log(`[runModel] Season: ${season}, Model: ${modelVersionId}`);

    // Step 1: Update ratings from any new results
    console.log('[runModel] Step 1: Updating ratings from results...');
    const ratingsStart = Date.now();
    await updateRatingsFromResults(modelVersionId, season, result);
    result.timing.ratingsMs = Date.now() - ratingsStart;
    console.log(`[runModel] Ratings updated: ${result.ratingsUpdated} in ${result.timing.ratingsMs}ms`);

    // Step 2: Generate projections for upcoming events
    console.log('[runModel] Step 2: Generating projections...');
    const projectionsStart = Date.now();
    await generateProjectionsForUpcoming(modelVersionId, season, result);
    result.timing.projectionsMs = Date.now() - projectionsStart;
    console.log(`[runModel] Projections generated: ${result.projectionsGenerated} in ${result.timing.projectionsMs}ms`);

    console.log('[runModel] Complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Model run failed: ${message}`);
    console.error(`[runModel] Error: ${message}`);
  }

  return result;
}

/**
 * Update Elo ratings and team stats from results
 * LIMIT: Only processes most recent results (bounded query)
 */
async function updateRatingsFromResults(
  modelVersionId: string,
  season: number,
  result: RunModelResult
): Promise<void> {
  console.log('[updateRatings] Fetching results...');

  // Get results - LIMIT to prevent unbounded queries
  const { data: results, error: resultsError } = await supabase
    .from('results')
    .select(`
      *,
      event:events(
        id,
        home_team_id,
        away_team_id,
        commence_time
      )
    `)
    .order('completed_at', { ascending: false })
    .limit(CONFIG.MAX_RESULTS_HISTORY);

  if (resultsError) {
    result.errors.push(`Failed to fetch results: ${resultsError.message}`);
    return;
  }

  if (!results || results.length === 0) {
    console.log('[updateRatings] No results to process');
    return;
  }

  console.log(`[updateRatings] Found ${results.length} results (limited to ${CONFIG.MAX_RESULTS_HISTORY})`);

  // Get existing team ratings to check what's already processed
  const { data: allRatings } = await supabase
    .from('team_ratings')
    .select('team_id, games_played')
    .eq('model_version_id', modelVersionId)
    .eq('season', season);

  const ratingsByTeam = new Map<string, number>();
  for (const rating of allRatings || []) {
    ratingsByTeam.set(rating.team_id, rating.games_played);
  }
  console.log(`[updateRatings] Existing ratings for ${ratingsByTeam.size} teams`);

  // Track processed games to avoid double-counting
  const processedEvents = new Set<string>();
  let processed = 0;

  for (const res of results) {
    const event = Array.isArray(res.event) ? res.event[0] : res.event;
    if (!event) continue;
    if (processedEvents.has(event.id)) continue;

    try {
      // Update Elo ratings
      await processGameResult(
        event.home_team_id,
        event.away_team_id,
        res.home_score,
        res.away_score,
        modelVersionId,
        season
      );

      // Update team stats for totals model
      await updateTeamStats(event.home_team_id, season, res.home_score, res.away_score);
      await updateTeamStats(event.away_team_id, season, res.away_score, res.home_score);

      processedEvents.add(event.id);
      result.ratingsUpdated++;
      processed++;

      // Progress logging every 50 results
      if (processed % 50 === 0) {
        console.log(`[updateRatings] Processed ${processed}/${results.length} results`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Rating update for ${res.event_id}: ${message}`);
    }
  }

  console.log(`[updateRatings] Completed: ${processed} ratings updated`);
}

/**
 * Generate projections for upcoming events
 * LIMIT: Only processes events within LOOKAHEAD_DAYS, batched
 */
async function generateProjectionsForUpcoming(
  modelVersionId: string,
  season: number,
  result: RunModelResult
): Promise<void> {
  const now = new Date();
  const lookaheadEnd = new Date(now.getTime() + CONFIG.LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  console.log(`[generateProjections] Looking for events between ${now.toISOString()} and ${lookaheadEnd.toISOString()}`);

  // Get upcoming events within lookahead window - LIMIT to batch size
  const { data: upcomingEvents, error: eventsError } = await supabase
    .from('events')
    .select('id, home_team_id, away_team_id')
    .eq('status', 'scheduled')
    .gt('commence_time', now.toISOString())
    .lt('commence_time', lookaheadEnd.toISOString())
    .order('commence_time', { ascending: true })
    .limit(CONFIG.BATCH_SIZE);

  if (eventsError) {
    result.errors.push(`Failed to fetch events: ${eventsError.message}`);
    return;
  }

  if (!upcomingEvents || upcomingEvents.length === 0) {
    console.log('[generateProjections] No upcoming events found');
    return;
  }

  console.log(`[generateProjections] Found ${upcomingEvents.length} events (limited to ${CONFIG.BATCH_SIZE})`);

  // Check which events already have projections
  const eventIds = upcomingEvents.map(e => e.id);
  const { data: existingProjections } = await supabase
    .from('projections')
    .select('event_id')
    .in('event_id', eventIds);

  const existingEventIds = new Set((existingProjections || []).map(p => p.event_id));
  const eventsNeedingProjections = upcomingEvents.filter(e => !existingEventIds.has(e.id));

  console.log(`[generateProjections] ${existingEventIds.size} already have projections, ${eventsNeedingProjections.length} need projections`);

  let generated = 0;
  for (const event of eventsNeedingProjections) {
    try {
      const projection = await generateProjection(
        event.id,
        event.home_team_id,
        event.away_team_id,
        season,
        modelVersionId
      );

      await saveProjection(projection, modelVersionId);
      result.projectionsGenerated++;
      generated++;

      // Progress logging every 10 projections
      if (generated % 10 === 0) {
        console.log(`[generateProjections] Generated ${generated}/${eventsNeedingProjections.length}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Projection for ${event.id}: ${message}`);
    }
  }

  console.log(`[generateProjections] Completed: ${generated} projections generated`);
}

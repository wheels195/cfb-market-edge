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

export interface RunModelResult {
  ratingsUpdated: number;
  projectionsGenerated: number;
  errors: string[];
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
  };

  try {
    const modelVersionId = await getDefaultModelVersionId();
    const season = getCurrentSeason();

    // Step 1: Update ratings from any new results
    await updateRatingsFromResults(modelVersionId, season, result);

    // Step 2: Generate projections for upcoming events
    await generateProjectionsForUpcoming(modelVersionId, season, result);

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Model run failed: ${message}`);
  }

  return result;
}

/**
 * Update Elo ratings and team stats from results
 */
async function updateRatingsFromResults(
  modelVersionId: string,
  season: number,
  result: RunModelResult
): Promise<void> {
  // Get results that haven't been processed for ratings
  // We track this by checking if the team has a rating with games_played matching
  const { data: results } = await supabase
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
    .order('completed_at', { ascending: true });

  if (!results) return;

  // Get all team ratings to check which results are already processed
  const { data: allRatings } = await supabase
    .from('team_ratings')
    .select('team_id, games_played')
    .eq('model_version_id', modelVersionId)
    .eq('season', season);

  const ratingsByTeam = new Map<string, number>();
  for (const rating of allRatings || []) {
    ratingsByTeam.set(rating.team_id, rating.games_played);
  }

  // Track processed games to avoid double-counting
  const processedEvents = new Set<string>();

  for (const res of results) {
    if (!res.event) continue;
    if (processedEvents.has(res.event.id)) continue;

    try {
      // Update Elo ratings
      await processGameResult(
        res.event.home_team_id,
        res.event.away_team_id,
        res.home_score,
        res.away_score,
        modelVersionId,
        season
      );

      // Update team stats for totals model
      await updateTeamStats(res.event.home_team_id, season, res.home_score, res.away_score);
      await updateTeamStats(res.event.away_team_id, season, res.away_score, res.home_score);

      processedEvents.add(res.event.id);
      result.ratingsUpdated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Rating update for ${res.event_id}: ${message}`);
    }
  }
}

/**
 * Generate projections for upcoming events
 */
async function generateProjectionsForUpcoming(
  modelVersionId: string,
  season: number,
  result: RunModelResult
): Promise<void> {
  // Get upcoming events without projections
  const { data: upcomingEvents } = await supabase
    .from('events')
    .select('id, home_team_id, away_team_id')
    .eq('status', 'scheduled')
    .gt('commence_time', new Date().toISOString())
    .order('commence_time', { ascending: true });

  if (!upcomingEvents) return;

  for (const event of upcomingEvents) {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Projection for ${event.id}: ${message}`);
    }
  }
}

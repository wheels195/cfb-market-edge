import { supabase } from '@/lib/db/client';
import { getOddsApiClient } from '@/lib/api/odds-api';
import { OddsApiEvent } from '@/types/odds-api';

export interface SyncEventsResult {
  eventsProcessed: number;
  eventsCreated: number;
  eventsUpdated: number;
  teamsCreated: number;
  errors: string[];
}

/**
 * Sync upcoming NCAAF events from The Odds API
 */
export async function syncEvents(): Promise<SyncEventsResult> {
  const result: SyncEventsResult = {
    eventsProcessed: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    teamsCreated: 0,
    errors: [],
  };

  try {
    const client = getOddsApiClient();
    const events = await client.getOdds(); // Gets events with odds

    for (const event of events) {
      try {
        await processEvent(event, result);
        result.eventsProcessed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Event ${event.id}: ${message}`);
      }
    }

    // Log API usage
    const quota = client.getQuota();
    if (quota) {
      console.log(`Odds API quota: ${quota.requests_remaining} remaining, ${quota.requests_used} used`);
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Fetch failed: ${message}`);
  }

  return result;
}

/**
 * Process a single event from the API
 */
async function processEvent(event: OddsApiEvent, result: SyncEventsResult): Promise<void> {
  // Ensure teams exist
  const homeTeamId = await ensureTeam(event.home_team, result);
  const awayTeamId = await ensureTeam(event.away_team, result);

  if (!homeTeamId || !awayTeamId) {
    throw new Error('Failed to create teams');
  }

  // Check if event exists
  const { data: existingEvent } = await supabase
    .from('events')
    .select('id')
    .eq('odds_api_event_id', event.id)
    .single();

  if (existingEvent) {
    // Update existing event
    const { error } = await supabase
      .from('events')
      .update({
        commence_time: event.commence_time,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
      })
      .eq('id', existingEvent.id);

    if (error) throw error;
    result.eventsUpdated++;
  } else {
    // Create new event
    const { error } = await supabase
      .from('events')
      .insert({
        league: 'NCAAF',
        commence_time: event.commence_time,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        odds_api_event_id: event.id,
        status: 'scheduled',
      });

    if (error) throw error;
    result.eventsCreated++;
  }
}

/**
 * Ensure a team exists in the database, creating if necessary
 */
async function ensureTeam(teamName: string, result: SyncEventsResult): Promise<string | null> {
  // First check by odds_api_name or name
  const { data: existingTeam } = await supabase
    .from('teams')
    .select('id')
    .or(`name.eq.${teamName},odds_api_name.eq.${teamName}`)
    .single();

  if (existingTeam) {
    return existingTeam.id;
  }

  // Check aliases
  const { data: aliasMatch } = await supabase
    .from('team_aliases')
    .select('team_id')
    .eq('alias', teamName)
    .single();

  if (aliasMatch) {
    return aliasMatch.team_id;
  }

  // Create new team
  const { data: newTeam, error } = await supabase
    .from('teams')
    .insert({
      name: teamName,
      odds_api_name: teamName,
    })
    .select('id')
    .single();

  if (error || !newTeam) {
    console.error('Failed to create team:', teamName, error);
    return null;
  }

  // Also create an alias
  await supabase
    .from('team_aliases')
    .insert({
      team_id: newTeam.id,
      alias: teamName,
      source: 'odds_api',
    });

  result.teamsCreated++;
  return newTeam.id;
}

/**
 * Start a job run record
 */
export async function startJobRun(jobName: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('job_runs')
    .insert({
      job_name: jobName,
      status: 'running',
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to start job run:', error);
    return null;
  }

  return data.id;
}

/**
 * Complete a job run record
 */
export async function completeJobRun(
  jobId: string,
  status: 'success' | 'failed',
  recordsProcessed?: number,
  errorMessage?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await supabase
    .from('job_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      records_processed: recordsProcessed,
      error_message: errorMessage,
      metadata,
    })
    .eq('id', jobId);
}

/**
 * Update daily API usage stats
 */
export async function updateApiUsage(
  oddsApiCalls: number = 0,
  cfbdApiCalls: number = 0,
  eventsSynced: number = 0,
  ticksWritten: number = 0,
  dedupeHits: number = 0,
  errors: number = 0
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Try to update existing record
  const { data: existing } = await supabase
    .from('api_usage_daily')
    .select('*')
    .eq('date', today)
    .single();

  if (existing) {
    await supabase
      .from('api_usage_daily')
      .update({
        odds_api_calls: existing.odds_api_calls + oddsApiCalls,
        cfbd_api_calls: existing.cfbd_api_calls + cfbdApiCalls,
        events_synced: existing.events_synced + eventsSynced,
        ticks_written: existing.ticks_written + ticksWritten,
        dedupe_hits: existing.dedupe_hits + dedupeHits,
        errors: existing.errors + errors,
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('api_usage_daily')
      .insert({
        date: today,
        odds_api_calls: oddsApiCalls,
        cfbd_api_calls: cfbdApiCalls,
        events_synced: eventsSynced,
        ticks_written: ticksWritten,
        dedupe_hits: dedupeHits,
        errors: errors,
      });
  }
}

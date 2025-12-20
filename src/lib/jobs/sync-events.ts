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
 * Known Odds API name -> CFBD name mappings for teams that use different names
 * This allows us to find the canonical CFBD team when Odds API sends a mascot name
 */
const ODDS_API_TO_CFBD_NAME: Record<string, string> = {
  'Alabama Crimson Tide': 'Alabama',
  'Appalachian State Mountaineers': 'App State',
  'Arizona State Sun Devils': 'Arizona State',
  'Arizona Wildcats': 'Arizona',
  'Army Black Knights': 'Army',
  'BYU Cougars': 'BYU',
  'California Golden Bears': 'California',
  'Central Michigan Chippewas': 'Central Michigan',
  'Cincinnati Bearcats': 'Cincinnati',
  'Clemson Tigers': 'Clemson',
  'Coastal Carolina Chanticleers': 'Coastal Carolina',
  'Duke Blue Devils': 'Duke',
  'East Carolina Pirates': 'East Carolina',
  'Florida International Panthers': 'Florida International',
  'Fresno State Bulldogs': 'Fresno State',
  'Georgia Bulldogs': 'Georgia',
  'Georgia Southern Eagles': 'Georgia Southern',
  'Georgia Tech Yellow Jackets': 'Georgia Tech',
  'Hawaii Rainbow Warriors': "Hawai'i",
  'Houston Cougars': 'Houston',
  'Illinois Fighting Illini': 'Illinois',
  'Indiana Hoosiers': 'Indiana',
  'Iowa Hawkeyes': 'Iowa',
  'James Madison Dukes': 'James Madison',
  'Louisiana Tech Bulldogs': 'Louisiana Tech',
  'Louisville Cardinals': 'Louisville',
  'LSU Tigers': 'LSU',
  'Miami (OH) RedHawks': 'Miami (OH)',
  'Miami Hurricanes': 'Miami',
  'Michigan Wolverines': 'Michigan',
  'Minnesota Golden Gophers': 'Minnesota',
  'Mississippi State Bulldogs': 'Mississippi State',
  'Missouri Tigers': 'Missouri',
  'Navy Midshipmen': 'Navy',
  'Nebraska Cornhuskers': 'Nebraska',
  'New Mexico Lobos': 'New Mexico',
  'North Texas Mean Green': 'North Texas',
  'Northwestern Wildcats': 'Northwestern',
  'Ohio Bobcats': 'Ohio',
  'Ohio State Buckeyes': 'Ohio State',
  'Ole Miss Rebels': 'Ole Miss',
  'Oregon Ducks': 'Oregon',
  'Penn State Nittany Lions': 'Penn State',
  'Pittsburgh Panthers': 'Pittsburgh',
  'Rice Owls': 'Rice',
  'San Diego State Aztecs': 'San Diego State',
  'SMU Mustangs': 'SMU',
  'Southern Mississippi Golden Eagles': 'Southern Miss',
  'TCU Horned Frogs': 'TCU',
  'Tennessee Volunteers': 'Tennessee',
  'Texas A&M Aggies': 'Texas A&M',
  'Texas Longhorns': 'Texas',
  'Texas State Bobcats': 'Texas State',
  'Texas Tech Red Raiders': 'Texas Tech',
  'Toledo Rockets': 'Toledo',
  'Tulane Green Wave': 'Tulane',
  'UConn Huskies': 'UConn',
  'UNLV Rebels': 'UNLV',
  'USC Trojans': 'USC',
  'Utah State Aggies': 'Utah State',
  'Utah Utes': 'Utah',
  'UTSA Roadrunners': 'UTSA',
  'Vanderbilt Commodores': 'Vanderbilt',
  'Virginia Cavaliers': 'Virginia',
  'Wake Forest Demon Deacons': 'Wake Forest',
  'Washington State Cougars': 'Washington State',
  'Western Kentucky Hilltoppers': 'Western Kentucky',
};

/**
 * Ensure a team exists in the database, finding the canonical CFBD team
 *
 * Lookup priority:
 * 1. Match by odds_api_name (canonical teams have this set after migration)
 * 2. Match by name (for CFBD-style short names)
 * 3. Use ODDS_API_TO_CFBD_NAME mapping to find CFBD team
 * 4. Check team_aliases table
 * 5. Create new team only if all lookups fail (should be rare for FBS teams)
 */
async function ensureTeam(teamName: string, result: SyncEventsResult): Promise<string | null> {
  // 1. Check by odds_api_name (most common for canonical teams)
  const { data: byOddsName } = await supabase
    .from('teams')
    .select('id')
    .eq('odds_api_name', teamName)
    .maybeSingle();

  if (byOddsName) {
    return byOddsName.id;
  }

  // 2. Check by exact name match
  const { data: byName } = await supabase
    .from('teams')
    .select('id')
    .eq('name', teamName)
    .maybeSingle();

  if (byName) {
    return byName.id;
  }

  // 3. Try mapping to CFBD name and lookup
  const cfbdName = ODDS_API_TO_CFBD_NAME[teamName];
  if (cfbdName) {
    const { data: byCfbdName } = await supabase
      .from('teams')
      .select('id')
      .eq('name', cfbdName)
      .maybeSingle();

    if (byCfbdName) {
      // Found the CFBD team - set the odds_api_name for future lookups
      await supabase
        .from('teams')
        .update({ odds_api_name: teamName })
        .eq('id', byCfbdName.id);

      console.log(`Linked Odds API name "${teamName}" to CFBD team "${cfbdName}"`);
      return byCfbdName.id;
    }
  }

  // 4. Check aliases
  const { data: aliasMatch } = await supabase
    .from('team_aliases')
    .select('team_id')
    .eq('alias', teamName)
    .maybeSingle();

  if (aliasMatch) {
    return aliasMatch.team_id;
  }

  // 5. Create new team only if all lookups fail
  // Log a warning since this shouldn't happen for known FBS teams
  console.warn(`Creating new team for unknown Odds API name: "${teamName}"`);

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

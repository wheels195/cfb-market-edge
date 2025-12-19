import { supabase } from '@/lib/db/client';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';
import { CFBDGame } from '@/types/cfbd-api';

export interface SyncResultsResult {
  gamesProcessed: number;
  resultsCreated: number;
  eventsUpdated: number;
  errors: string[];
}

/**
 * Sync game results from CollegeFootballData
 */
export async function syncResults(): Promise<SyncResultsResult> {
  const result: SyncResultsResult = {
    gamesProcessed: 0,
    resultsCreated: 0,
    eventsUpdated: 0,
    errors: [],
  };

  try {
    const client = getCFBDApiClient();
    const season = client.getCurrentSeason();

    // Get completed games from CFBD
    const completedGames = await client.getCompletedGames(season);

    // Get our events that might need results
    const { data: events } = await supabase
      .from('events')
      .select(`
        id,
        odds_api_event_id,
        cfbd_game_id,
        commence_time,
        home_team:teams!events_home_team_id_fkey(name, cfbd_team_id),
        away_team:teams!events_away_team_id_fkey(name, cfbd_team_id)
      `)
      .in('status', ['scheduled', 'in_progress'])
      .lt('commence_time', new Date().toISOString());

    if (!events || events.length === 0) return result;

    for (const rawEvent of events) {
      try {
        // Normalize event (Supabase returns arrays for relations)
        const homeTeam = Array.isArray(rawEvent.home_team) ? rawEvent.home_team[0] : rawEvent.home_team;
        const awayTeam = Array.isArray(rawEvent.away_team) ? rawEvent.away_team[0] : rawEvent.away_team;
        const event = {
          id: rawEvent.id,
          odds_api_event_id: rawEvent.odds_api_event_id,
          cfbd_game_id: rawEvent.cfbd_game_id,
          commence_time: rawEvent.commence_time,
          home_team: homeTeam || null,
          away_team: awayTeam || null,
        };
        const matched = await matchAndUpdateResult(event, completedGames, result);
        if (matched) result.gamesProcessed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Event ${rawEvent.id}: ${message}`);
      }
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Fetch failed: ${message}`);
  }

  return result;
}

/**
 * Match an event to a CFBD game and update the result
 */
async function matchAndUpdateResult(
  event: {
    id: string;
    odds_api_event_id: string;
    cfbd_game_id: string | null;
    commence_time: string;
    home_team: { name: string; cfbd_team_id: string | null } | null;
    away_team: { name: string; cfbd_team_id: string | null } | null;
  },
  completedGames: CFBDGame[],
  result: SyncResultsResult
): Promise<boolean> {
  // Try to find matching CFBD game
  let matchedGame: CFBDGame | undefined;

  // First try by cfbd_game_id if we have it
  if (event.cfbd_game_id) {
    matchedGame = completedGames.find(g => g.id.toString() === event.cfbd_game_id);
  }

  // Otherwise try to match by teams and date
  if (!matchedGame && event.home_team && event.away_team) {
    const eventDate = new Date(event.commence_time);

    matchedGame = completedGames.find(game => {
      // Check if date is within 1 day (to handle timezone issues)
      const gameDate = new Date(game.startDate);
      const dateDiff = Math.abs(eventDate.getTime() - gameDate.getTime());
      if (dateDiff > 24 * 60 * 60 * 1000) return false;

      // Try to match team names
      const homeMatch = matchTeamName(event.home_team!.name, game.homeTeam);
      const awayMatch = matchTeamName(event.away_team!.name, game.awayTeam);

      return homeMatch && awayMatch;
    });
  }

  if (!matchedGame) return false;
  if (matchedGame.homePoints === null || matchedGame.awayPoints === null) return false;

  // Check if result already exists
  const { data: existingResult } = await supabase
    .from('results')
    .select('event_id')
    .eq('event_id', event.id)
    .single();

  if (!existingResult) {
    // Create result
    const { error: resultError } = await supabase
      .from('results')
      .insert({
        event_id: event.id,
        home_score: matchedGame.homePoints,
        away_score: matchedGame.awayPoints,
        completed_at: matchedGame.startDate,
      });

    if (resultError) throw resultError;
    result.resultsCreated++;
  }

  // Update event status and CFBD game ID
  const { error: eventError } = await supabase
    .from('events')
    .update({
      status: 'final',
      cfbd_game_id: matchedGame.id.toString(),
    })
    .eq('id', event.id);

  if (eventError) throw eventError;
  result.eventsUpdated++;

  return true;
}

/**
 * Fuzzy match team names between APIs
 */
function matchTeamName(oddsApiName: string, cfbdName: string): boolean {
  // Normalize names
  const normalize = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/state/g, 'st')
      .replace(/university/g, '');

  const n1 = normalize(oddsApiName);
  const n2 = normalize(cfbdName);

  // Exact match
  if (n1 === n2) return true;

  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Common abbreviations
  const abbrevs: Record<string, string[]> = {
    'alabama': ['bama'],
    'ohio': ['osu', 'ohio st'],
    'michigan': ['mich', 'um'],
    'georgia': ['uga'],
    'lsu': ['louisiana st'],
    'usc': ['southern cal', 'socal'],
    'ucla': ['uc los angeles'],
    'ole miss': ['mississippi'],
    'miami': ['miami fl', 'miami oh'],
  };

  for (const [full, abbrs] of Object.entries(abbrevs)) {
    if ((n1.includes(full) || abbrs.some(a => n1.includes(normalize(a)))) &&
        (n2.includes(full) || abbrs.some(a => n2.includes(normalize(a))))) {
      return true;
    }
  }

  return false;
}

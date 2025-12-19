/**
 * Situational Factors Module
 *
 * Tracks travel distance, rest days, and situational spots
 * that affect game outcomes but aren't captured in pure stats.
 */

import { supabase } from '@/lib/db/client';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

// Team location data (populated from CFBD or manually)
interface TeamLocation {
  teamId: string;
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  elevation: number; // feet - matters for high altitude venues
  timezone: string;
}

// Situational impact adjustments (in points)
const SITUATIONAL_ADJUSTMENTS = {
  // Rest advantage
  restAdvantage: {
    extraWeekRest: 1.5,      // Coming off bye week
    shortWeek: -1.0,         // Thursday game after Sunday
    twoWeeksRest: 2.0,       // Two weeks off
  },

  // Travel factors
  travel: {
    perThousandMiles: -0.3,  // Slight disadvantage per 1000 miles
    crossCountry: -0.5,      // 2000+ miles
    timezonePerHour: -0.2,   // Per hour of timezone change
    altitude: {
      over5000ft: 1.5,       // Home advantage at altitude
      over7000ft: 2.5,       // Significant altitude (Colorado)
    },
  },

  // Situational spots
  spots: {
    rivalry: 1.0,            // Extra motivation in rivalry games
    revenge: 0.5,            // Lost to this team last year
    letdown: -1.0,           // Coming off emotional win
    lookahead: -0.5,         // Big game next week
    trapGame: -1.5,          // Favored against weak team before rival
  },

  // Bowl game adjustments
  bowl: {
    motivationGap: 2.0,      // When one team is more motivated
    extraPrepTime: 0.5,      // Per extra week of prep
    neutralSite: -0.5,       // Removes home field for "home" team
  },
};

// High-altitude venues
const HIGH_ALTITUDE_VENUES: Record<string, number> = {
  'colorado': 5430,
  'air force': 7258,
  'byu': 4649,
  'utah': 4657,
  'utah state': 4775,
  'new mexico': 5312,
  'wyoming': 7220,
  'colorado state': 5003,
  'boise state': 2730, // Not super high but indoor-ish
};

// Known rivalries (team1 vs team2)
const RIVALRIES: Array<[string, string, string]> = [
  ['ohio state', 'michigan', 'The Game'],
  ['alabama', 'auburn', 'Iron Bowl'],
  ['georgia', 'florida', 'Worlds Largest Outdoor Cocktail Party'],
  ['texas', 'oklahoma', 'Red River Rivalry'],
  ['usc', 'notre dame', 'Jeweled Shillelagh'],
  ['army', 'navy', 'Army-Navy Game'],
  ['florida', 'florida state', 'Sunshine Showdown'],
  ['clemson', 'south carolina', 'Palmetto Bowl'],
  ['michigan', 'michigan state', 'Paul Bunyan Trophy'],
  ['wisconsin', 'minnesota', "Paul Bunyan's Axe"],
  ['oregon', 'oregon state', 'Civil War'],
  ['washington', 'washington state', 'Apple Cup'],
  ['indiana', 'purdue', 'Old Oaken Bucket'],
  ['iowa', 'iowa state', 'Cy-Hawk'],
  ['kansas', 'kansas state', 'Sunflower Showdown'],
  ['texas', 'texas a&m', 'Lone Star Showdown'],
  ['penn state', 'ohio state', 'Big Ten East Rivalry'],
  ['oklahoma', 'oklahoma state', 'Bedlam'],
  ['tennessee', 'alabama', 'Third Saturday in October'],
  ['lsu', 'alabama', 'Game of the Century'],
];

/**
 * Calculate distance between two points using Haversine formula
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get team location data
 */
export async function getTeamLocation(teamId: string): Promise<TeamLocation | null> {
  const { data: team } = await supabase
    .from('teams')
    .select('id, name, city, state, latitude, longitude, elevation_ft')
    .eq('id', teamId)
    .single();

  if (!team || !team.latitude || !team.longitude) {
    return null;
  }

  return {
    teamId: team.id,
    name: team.name,
    city: team.city || '',
    state: team.state || '',
    latitude: team.latitude,
    longitude: team.longitude,
    elevation: team.elevation_ft || 0,
    timezone: getTimezoneFromState(team.state || ''),
  };
}

/**
 * Rough timezone mapping by state
 */
function getTimezoneFromState(state: string): string {
  const eastern = ['me', 'nh', 'vt', 'ma', 'ri', 'ct', 'ny', 'nj', 'pa', 'de', 'md', 'va', 'wv', 'nc', 'sc', 'ga', 'fl', 'oh', 'mi', 'in', 'ky', 'tn'];
  const central = ['wi', 'il', 'mn', 'ia', 'mo', 'ar', 'la', 'ms', 'al', 'ok', 'tx', 'ks', 'ne', 'sd', 'nd'];
  const mountain = ['mt', 'wy', 'co', 'nm', 'az', 'ut', 'id'];
  const pacific = ['wa', 'or', 'ca', 'nv'];

  const s = state.toLowerCase();
  if (eastern.includes(s)) return 'America/New_York';
  if (central.includes(s)) return 'America/Chicago';
  if (mountain.includes(s)) return 'America/Denver';
  if (pacific.includes(s)) return 'America/Los_Angeles';
  return 'America/Chicago'; // Default to Central
}

/**
 * Calculate timezone difference in hours
 */
function getTimezoneOffset(tz1: string, tz2: string): number {
  const offsets: Record<string, number> = {
    'America/New_York': -5,
    'America/Chicago': -6,
    'America/Denver': -7,
    'America/Los_Angeles': -8,
  };
  return Math.abs((offsets[tz1] || -6) - (offsets[tz2] || -6));
}

/**
 * Calculate rest days since last game
 */
export async function getRestDays(
  teamId: string,
  gameDate: Date,
  season: number
): Promise<{
  restDays: number;
  previousGame: { opponent: string; result: string; date: string } | null;
  isByeWeek: boolean;
}> {
  // Get team's previous game
  const { data: prevGames } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team_id,
      away_team_id,
      results(home_score, away_score),
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name)
    `)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'final')
    .lt('commence_time', gameDate.toISOString())
    .order('commence_time', { ascending: false })
    .limit(1);

  if (!prevGames || prevGames.length === 0) {
    return {
      restDays: 14, // Season opener - assume well-rested
      previousGame: null,
      isByeWeek: false,
    };
  }

  const prevGame = prevGames[0];
  const prevDate = new Date(prevGame.commence_time);
  const restDays = Math.floor((gameDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

  const wasHome = prevGame.home_team_id === teamId;
  // Supabase returns arrays for joins
  const awayTeamData = Array.isArray(prevGame.away_team) ? prevGame.away_team[0] : prevGame.away_team;
  const homeTeamData = Array.isArray(prevGame.home_team) ? prevGame.home_team[0] : prevGame.home_team;
  const opponent = wasHome
    ? (awayTeamData as { name: string } | null)?.name
    : (homeTeamData as { name: string } | null)?.name;

  // Supabase returns arrays for joins
  const resultsData = Array.isArray(prevGame.results) ? prevGame.results[0] : prevGame.results;
  const results = resultsData as { home_score: number; away_score: number } | null;
  let result = 'Unknown';
  if (results) {
    const teamScore = wasHome ? results.home_score : results.away_score;
    const oppScore = wasHome ? results.away_score : results.home_score;
    result = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'T';
  }

  return {
    restDays,
    previousGame: {
      opponent: opponent || 'Unknown',
      result,
      date: prevDate.toISOString().split('T')[0],
    },
    isByeWeek: restDays >= 12,
  };
}

/**
 * Check if this is a rivalry game
 */
export function isRivalryGame(homeTeam: string, awayTeam: string): {
  isRivalry: boolean;
  rivalryName: string | null;
} {
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();

  for (const [team1, team2, name] of RIVALRIES) {
    if ((home.includes(team1) && away.includes(team2)) ||
        (home.includes(team2) && away.includes(team1))) {
      return { isRivalry: true, rivalryName: name };
    }
  }

  return { isRivalry: false, rivalryName: null };
}

/**
 * Check for revenge spot (lost to this opponent last year)
 */
export async function isRevengeSpot(
  teamId: string,
  opponentId: string,
  season: number
): Promise<boolean> {
  const { data: lastYearGames } = await supabase
    .from('events')
    .select(`
      id,
      home_team_id,
      away_team_id,
      results(home_score, away_score)
    `)
    .or(`and(home_team_id.eq.${teamId},away_team_id.eq.${opponentId}),and(home_team_id.eq.${opponentId},away_team_id.eq.${teamId})`)
    .gte('commence_time', `${season - 1}-01-01`)
    .lt('commence_time', `${season}-01-01`)
    .eq('status', 'final');

  if (!lastYearGames || lastYearGames.length === 0) {
    return false;
  }

  // Check if team lost to opponent last year
  for (const game of lastYearGames) {
    // Supabase returns arrays for joins
    const resultsData = Array.isArray(game.results) ? game.results[0] : game.results;
    const results = resultsData as { home_score: number; away_score: number } | null;
    if (!results) continue;

    const wasHome = game.home_team_id === teamId;
    const teamScore = wasHome ? results.home_score : results.away_score;
    const oppScore = wasHome ? results.away_score : results.home_score;

    if (oppScore > teamScore) {
      return true; // Lost to this team last year
    }
  }

  return false;
}

/**
 * Calculate full situational adjustment
 */
export async function calculateSituationalAdjustment(
  eventId: string,
  homeTeamId: string,
  awayTeamId: string,
  gameDate: Date,
  season: number
): Promise<{
  homeAdjustment: number;
  awayAdjustment: number;
  factors: {
    homeRest: { days: number; adjustment: number };
    awayRest: { days: number; adjustment: number };
    travel: { distance: number; adjustment: number };
    altitude: { feet: number; adjustment: number };
    rivalry: { isRivalry: boolean; rivalryName: string | null };
    revenge: { home: boolean; away: boolean };
  };
  confidence: 'high' | 'medium' | 'low';
}> {
  // Get locations
  const [homeLoc, awayLoc] = await Promise.all([
    getTeamLocation(homeTeamId),
    getTeamLocation(awayTeamId),
  ]);

  // Get rest days
  const [homeRest, awayRest] = await Promise.all([
    getRestDays(homeTeamId, gameDate, season),
    getRestDays(awayTeamId, gameDate, season),
  ]);

  // Get team names for rivalry check
  const { data: homeTeam } = await supabase.from('teams').select('name').eq('id', homeTeamId).single();
  const { data: awayTeam } = await supabase.from('teams').select('name').eq('id', awayTeamId).single();

  let homeAdj = 0;
  let awayAdj = 0;

  // Rest adjustments
  let homeRestAdj = 0;
  if (homeRest.isByeWeek) homeRestAdj = SITUATIONAL_ADJUSTMENTS.restAdvantage.extraWeekRest;
  else if (homeRest.restDays <= 5) homeRestAdj = SITUATIONAL_ADJUSTMENTS.restAdvantage.shortWeek;

  let awayRestAdj = 0;
  if (awayRest.isByeWeek) awayRestAdj = SITUATIONAL_ADJUSTMENTS.restAdvantage.extraWeekRest;
  else if (awayRest.restDays <= 5) awayRestAdj = SITUATIONAL_ADJUSTMENTS.restAdvantage.shortWeek;

  homeAdj += homeRestAdj;
  awayAdj += awayRestAdj;

  // Travel adjustment (away team disadvantage)
  let travelDistance = 0;
  let travelAdj = 0;
  if (homeLoc && awayLoc) {
    travelDistance = calculateDistance(
      awayLoc.latitude,
      awayLoc.longitude,
      homeLoc.latitude,
      homeLoc.longitude
    );

    travelAdj = (travelDistance / 1000) * SITUATIONAL_ADJUSTMENTS.travel.perThousandMiles;
    if (travelDistance > 2000) {
      travelAdj += SITUATIONAL_ADJUSTMENTS.travel.crossCountry;
    }

    // Timezone adjustment
    const tzDiff = getTimezoneOffset(awayLoc.timezone, homeLoc.timezone);
    travelAdj += tzDiff * SITUATIONAL_ADJUSTMENTS.travel.timezonePerHour;

    awayAdj += travelAdj;
  }

  // Altitude adjustment
  let altitudeAdj = 0;
  let altitude = 0;
  if (homeTeam) {
    const homeKey = homeTeam.name.toLowerCase();
    altitude = HIGH_ALTITUDE_VENUES[homeKey] || homeLoc?.elevation || 0;

    if (altitude >= 7000) {
      altitudeAdj = SITUATIONAL_ADJUSTMENTS.travel.altitude.over7000ft;
    } else if (altitude >= 5000) {
      altitudeAdj = SITUATIONAL_ADJUSTMENTS.travel.altitude.over5000ft;
    }

    homeAdj += altitudeAdj;
  }

  // Rivalry check
  const rivalry = homeTeam && awayTeam
    ? isRivalryGame(homeTeam.name, awayTeam.name)
    : { isRivalry: false, rivalryName: null };

  // Revenge spot check
  const [homeRevenge, awayRevenge] = await Promise.all([
    isRevengeSpot(homeTeamId, awayTeamId, season),
    isRevengeSpot(awayTeamId, homeTeamId, season),
  ]);

  if (homeRevenge) homeAdj += SITUATIONAL_ADJUSTMENTS.spots.revenge;
  if (awayRevenge) awayAdj += SITUATIONAL_ADJUSTMENTS.spots.revenge;

  // Letdown spot check (coming off big emotional win)
  if (homeRest.previousGame?.result === 'W' && rivalry.isRivalry) {
    // Won a rivalry game last week - potential letdown
    homeAdj += SITUATIONAL_ADJUSTMENTS.spots.letdown;
  }
  if (awayRest.previousGame?.result === 'W' && rivalry.isRivalry) {
    awayAdj += SITUATIONAL_ADJUSTMENTS.spots.letdown;
  }

  // Confidence based on data availability
  const hasLocation = homeLoc && awayLoc;
  const hasFullRest = homeRest.previousGame && awayRest.previousGame;
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (!hasLocation && !hasFullRest) confidence = 'low';
  else if (!hasLocation || !hasFullRest) confidence = 'medium';

  return {
    homeAdjustment: Math.round(homeAdj * 10) / 10,
    awayAdjustment: Math.round(awayAdj * 10) / 10,
    factors: {
      homeRest: { days: homeRest.restDays, adjustment: homeRestAdj },
      awayRest: { days: awayRest.restDays, adjustment: awayRestAdj },
      travel: { distance: Math.round(travelDistance), adjustment: Math.round(travelAdj * 10) / 10 },
      altitude: { feet: altitude, adjustment: altitudeAdj },
      rivalry: rivalry,
      revenge: { home: homeRevenge, away: awayRevenge },
    },
    confidence,
  };
}

/**
 * Sync team location data from CFBD
 */
export async function syncTeamLocations(): Promise<{
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let updated = 0;

  try {
    const cfbd = getCFBDApiClient();
    const teams = await cfbd.getTeams();

    for (const team of teams) {
      if (!team.location?.latitude || !team.location?.longitude) continue;

      const { error } = await supabase
        .from('teams')
        .update({
          city: team.location.city || null,
          state: team.location.state || null,
          latitude: team.location.latitude,
          longitude: team.location.longitude,
          venue_name: team.location.name || null,
          elevation_ft: (team.location as unknown as { elevation?: string }).elevation
            ? parseInt((team.location as unknown as { elevation: string }).elevation, 10) || null
            : null,
          conference: team.conference || null,
        })
        .eq('name', team.school);

      if (error) {
        errors.push(`Failed to update ${team.school}: ${error.message}`);
      } else {
        updated++;
      }
    }

    return { updated, errors };
  } catch (err) {
    errors.push(`Sync failed: ${err}`);
    return { updated: 0, errors };
  }
}

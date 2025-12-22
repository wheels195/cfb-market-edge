/**
 * CBB Season Sync - DIAGNOSTIC VERSION
 *
 * Enhanced instrumentation to diagnose coverage gaps:
 * - Split skip reasons: NO_ODDS_API_EVENT vs EVENT_FOUND_TEAM_LOOKUP_FAILED
 * - Track all Odds API events and DK presence
 * - ±12h event proximity check for skipped games
 * - Top 25 unmatched team strings post-normalization
 * - API parameter verification
 */

import { createClient } from '@supabase/supabase-js';
import {
  buildTeamLookupCache,
  lookupTeam,
  logUnmatchedTeam,
  getCacheStats,
  normalizeTeamName,
  TeamLookupCache,
} from '../src/lib/cbb/team-lookup';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ODDS_API_KEY = process.env.ODDS_API_KEY!;
const BASE_URL = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'basketball_ncaab';

// ============================================
// CONFIGURATION
// ============================================
const SEASON = 2024;
const DIAGNOSTIC_MODE = true; // Collect detailed diagnostics
const MAX_GAMES_TO_SYNC = 500; // Limit for diagnostic run (set to Infinity for full run)

const SEASON_DATES: Record<number, { start: string; end: string }> = {
  2022: { start: '2021-11-01', end: '2022-04-10' },
  2023: { start: '2022-11-01', end: '2023-04-10' },
  2024: { start: '2023-11-01', end: '2024-04-10' },
  2025: { start: '2024-11-01', end: '2025-04-10' },
};

interface GameToSync {
  id: string;
  cbbd_game_id: number;
  start_date: string;
  home_team_name: string;
  away_team_name: string;
  home_team_id: string;
  away_team_id: string;
}

// ============================================
// DIAGNOSTIC TRACKING
// ============================================
interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  home_team_normalized: string;
  away_team_normalized: string;
  has_draftkings: boolean;
  bookmakers: string[];
}

interface SkippedGame {
  cbbd_game_id: number;
  start_date: string;
  home_team_name: string;
  away_team_name: string;
  reason: string;
  nearby_events: string[]; // Events within ±12h containing either team
}

const diagnostics = {
  totalOddsApiEvents: 0,
  eventsWithDK: 0,
  eventsWithoutDK: 0,
  uniqueEventsById: new Map<string, OddsApiEvent>(),

  // Skip reason breakdown
  skipReasons: {
    NO_API_DATA: 0,                    // API returned nothing for query time
    NO_ODDS_API_EVENT: 0,              // API returned events but none matched our game
    EVENT_FOUND_TEAM_LOOKUP_FAILED: 0, // Found potential event but team mapping failed
    NO_DK_BOOKMAKER: 0,                // Event matched but no DraftKings
    NO_SPREADS_MARKET: 0,              // DK found but no spreads market
    NO_HOME_SPREAD: 0,                 // Spreads found but couldn't extract home spread
  },

  // Team tracking
  unmatchedTeamStrings: new Map<string, number>(), // raw string -> count
  unmatchedNormalized: new Map<string, Set<string>>(), // normalized -> raw strings

  // Skipped games for proximity analysis
  skippedGames: [] as SkippedGame[],

  // Successful matches
  successfulMatches: 0,
  swappedMatches: 0, // Games where Odds API home/away was opposite of CBBD
};

let apiCalls = 0;
let creditsUsed = 0;
let teamCache: TeamLookupCache;

async function fetchHistoricalOdds(date: string, maxRetries = 3): Promise<any> {
  const url = new URL(`${BASE_URL}/historical/sports/${SPORT_KEY}/odds`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'spreads');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('bookmakers', 'draftkings');
  url.searchParams.set('date', date);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    apiCalls++;
    creditsUsed += 10;

    try {
      const response = await fetch(url.toString());

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
        console.log(`    [429] Rate limited. Waiting ${waitSeconds}s...`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, waitSeconds * 1000));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        if (response.status === 422) return null;
        console.log(`    API Error: ${response.status}`);
        return null;
      }

      const remaining = response.headers.get('x-requests-remaining');
      if (apiCalls % 50 === 0) {
        console.log(`    [API] Calls: ${apiCalls}, Credits: ${creditsUsed}, Remaining: ${remaining}`);
      }

      return response.json();
    } catch (error) {
      console.log(`    Fetch error (attempt ${attempt}): ${error}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return null;
    }
  }
  return null;
}

function trackUnmatchedTeam(teamString: string): void {
  // Track raw string count
  diagnostics.unmatchedTeamStrings.set(
    teamString,
    (diagnostics.unmatchedTeamStrings.get(teamString) || 0) + 1
  );

  // Track normalized grouping
  const normalized = normalizeTeamName(teamString);
  if (!diagnostics.unmatchedNormalized.has(normalized)) {
    diagnostics.unmatchedNormalized.set(normalized, new Set());
  }
  diagnostics.unmatchedNormalized.get(normalized)!.add(teamString);
}

function findNearbyEvents(game: GameToSync): string[] {
  const gameTime = new Date(game.start_date).getTime();
  const windowMs = 12 * 60 * 60 * 1000; // ±12 hours

  const homeNorm = normalizeTeamName(game.home_team_name);
  const awayNorm = normalizeTeamName(game.away_team_name);

  const nearby: string[] = [];

  for (const [eventId, event] of diagnostics.uniqueEventsById) {
    const eventTime = new Date(event.commence_time).getTime();
    if (Math.abs(eventTime - gameTime) <= windowMs) {
      // Check if event contains either team
      if (event.home_team_normalized === homeNorm ||
          event.away_team_normalized === homeNorm ||
          event.home_team_normalized === awayNorm ||
          event.away_team_normalized === awayNorm) {
        nearby.push(`${event.home_team} vs ${event.away_team} @ ${event.commence_time}`);
      }
    }
  }

  return nearby;
}

async function run() {
  const seasonDates = SEASON_DATES[SEASON];
  if (!seasonDates) {
    console.error(`Unknown season: ${SEASON}`);
    return;
  }

  console.log('========================================');
  console.log(`  CBB Season Sync - DIAGNOSTIC MODE`);
  console.log(`  Season: ${SEASON - 1}-${String(SEASON).slice(2)}`);
  console.log(`  Range: ${seasonDates.start} to ${seasonDates.end}`);
  console.log('========================================\n');

  // Verify API parameters
  console.log('API Configuration:');
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Sport Key: ${SPORT_KEY}`);
  console.log(`  Regions: us`);
  console.log(`  Markets: spreads`);
  console.log(`  Bookmakers: draftkings`);
  console.log(`  Odds Format: american\n`);

  // Build team lookup cache
  console.log('Building team lookup cache...');
  teamCache = await buildTeamLookupCache(supabase);
  const cacheStats = getCacheStats(teamCache);
  console.log(`  byOddsApiName: ${cacheStats.byOddsApiName}`);
  console.log(`  byAlias: ${cacheStats.byAlias}`);
  console.log(`  byMapping: ${cacheStats.byMapping}`);
  console.log(`  byNormalized: ${cacheStats.byNormalized}`);
  console.log(`  Total lookups: ${cacheStats.total}\n`);

  // Get games to sync
  console.log('Fetching games for season...');
  const { data: allGames, error: gamesError } = await supabase
    .from('cbb_games')
    .select('id, cbbd_game_id, start_date, home_team_name, away_team_name, home_team_id, away_team_id, status')
    .eq('season', SEASON)
    .eq('status', 'final')
    .gte('start_date', seasonDates.start)
    .lte('start_date', seasonDates.end + 'T23:59:59')
    .order('start_date')
    .limit(MAX_GAMES_TO_SYNC);

  if (gamesError) {
    console.error('Error fetching games:', gamesError);
    return;
  }

  console.log(`Total games to analyze: ${allGames?.length || 0}\n`);

  if (!allGames || allGames.length === 0) {
    console.log('No games found.');
    return;
  }

  // Check which already have lines
  const gameIds = allGames.map(g => g.cbbd_game_id);
  const { data: existingLines } = await supabase
    .from('cbb_betting_lines')
    .select('cbbd_game_id')
    .eq('provider', 'DraftKings')
    .in('cbbd_game_id', gameIds);

  const alreadySynced = new Set((existingLines || []).map(l => l.cbbd_game_id));
  const gamesToSync = allGames.filter(g => !alreadySynced.has(g.cbbd_game_id));

  console.log(`Already synced: ${alreadySynced.size}`);
  console.log(`Games to analyze: ${gamesToSync.length}\n`);

  if (gamesToSync.length === 0) {
    console.log('All games already synced!');
    return;
  }

  // Group games by query time
  const gamesByQueryTime = new Map<string, GameToSync[]>();

  for (const game of gamesToSync) {
    const gameDate = new Date(game.start_date);
    gameDate.setMinutes(gameDate.getMinutes() - 15);
    const mins = Math.floor(gameDate.getMinutes() / 10) * 10;
    gameDate.setMinutes(mins);
    gameDate.setSeconds(0);
    gameDate.setMilliseconds(0);

    const queryTime = gameDate.toISOString().replace(/\.\d{3}Z$/, 'Z');

    if (!gamesByQueryTime.has(queryTime)) {
      gamesByQueryTime.set(queryTime, []);
    }
    gamesByQueryTime.get(queryTime)!.push(game);
  }

  console.log(`Unique API timestamps: ${gamesByQueryTime.size}`);
  console.log(`Estimated credits: ~${gamesByQueryTime.size * 10}\n`);

  // Batch for bulk upsert
  const BATCH_SIZE = 50;
  const lineBatch: any[] = [];
  let linesCreated = 0;

  async function flushBatch(): Promise<number> {
    if (lineBatch.length === 0) return 0;
    const { error } = await supabase
      .from('cbb_betting_lines')
      .upsert(lineBatch, { onConflict: 'cbbd_game_id,provider' });
    if (error) {
      console.log(`  [Batch] Error: ${error.message}`);
      return 0;
    }
    const count = lineBatch.length;
    lineBatch.length = 0;
    return count;
  }

  // Process games
  const queryTimes = Array.from(gamesByQueryTime.keys()).sort();
  let processedTimestamps = 0;

  console.log('Starting diagnostic sync...\n');

  for (const queryTime of queryTimes) {
    const gamesAtTime = gamesByQueryTime.get(queryTime)!;
    processedTimestamps++;

    if (processedTimestamps % 50 === 0) {
      console.log(`Progress: ${processedTimestamps}/${queryTimes.length} timestamps`);
    }

    await new Promise(r => setTimeout(r, 250));

    const oddsData = await fetchHistoricalOdds(queryTime);

    // Track all events from API response
    if (oddsData?.data) {
      for (const event of oddsData.data) {
        diagnostics.totalOddsApiEvents++;

        const hasDK = event.bookmakers?.some((b: any) => b.key === 'draftkings');
        if (hasDK) {
          diagnostics.eventsWithDK++;
        } else {
          diagnostics.eventsWithoutDK++;
        }

        // Store unique event for proximity analysis
        if (!diagnostics.uniqueEventsById.has(event.id)) {
          diagnostics.uniqueEventsById.set(event.id, {
            id: event.id,
            commence_time: event.commence_time,
            home_team: event.home_team,
            away_team: event.away_team,
            home_team_normalized: normalizeTeamName(event.home_team),
            away_team_normalized: normalizeTeamName(event.away_team),
            has_draftkings: hasDK,
            bookmakers: event.bookmakers?.map((b: any) => b.key) || [],
          });
        }
      }
    }

    // Handle no API data
    if (!oddsData || !oddsData.data || oddsData.data.length === 0) {
      for (const game of gamesAtTime) {
        diagnostics.skipReasons.NO_API_DATA++;
        diagnostics.skippedGames.push({
          cbbd_game_id: game.cbbd_game_id,
          start_date: game.start_date,
          home_team_name: game.home_team_name,
          away_team_name: game.away_team_name,
          reason: 'NO_API_DATA',
          nearby_events: [],
        });
      }
      continue;
    }

    // Process each game
    for (const game of gamesAtTime) {
      let matched = false;
      let teamLookupFailed = false;
      let potentialEventFound = false;

      for (const event of oddsData.data) {
        const homeTeam = lookupTeam(event.home_team, teamCache);
        const awayTeam = lookupTeam(event.away_team, teamCache);

        // Track unmatched teams
        if (!homeTeam) {
          trackUnmatchedTeam(event.home_team);
        }
        if (!awayTeam) {
          trackUnmatchedTeam(event.away_team);
        }

        // Check if this event could be our game (by normalized name match)
        const gameHomeNorm = normalizeTeamName(game.home_team_name);
        const gameAwayNorm = normalizeTeamName(game.away_team_name);
        const eventHomeNorm = normalizeTeamName(event.home_team);
        const eventAwayNorm = normalizeTeamName(event.away_team);

        if ((eventHomeNorm === gameHomeNorm && eventAwayNorm === gameAwayNorm) ||
            (eventHomeNorm === gameAwayNorm && eventAwayNorm === gameHomeNorm)) {
          potentialEventFound = true;

          if (!homeTeam || !awayTeam) {
            teamLookupFailed = true;
            await logUnmatchedTeam(supabase, event.home_team, `season ${SEASON}`, teamCache);
            await logUnmatchedTeam(supabase, event.away_team, `season ${SEASON}`, teamCache);
            continue;
          }
        }

        if (!homeTeam || !awayTeam) continue;

        // Check for match - allow home/away swap (neutral site games, data discrepancies)
        let isSwapped = false;
        if (homeTeam.teamId === game.home_team_id && awayTeam.teamId === game.away_team_id) {
          isSwapped = false;
        } else if (homeTeam.teamId === game.away_team_id && awayTeam.teamId === game.home_team_id) {
          isSwapped = true;
        } else {
          continue; // No match
        }

        matched = true;
        if (isSwapped) {
          diagnostics.swappedMatches++;
        }

        const dk = event.bookmakers.find((b: any) => b.key === 'draftkings');
        if (!dk) {
          diagnostics.skipReasons.NO_DK_BOOKMAKER++;
          diagnostics.skippedGames.push({
            cbbd_game_id: game.cbbd_game_id,
            start_date: game.start_date,
            home_team_name: game.home_team_name,
            away_team_name: game.away_team_name,
            reason: 'NO_DK_BOOKMAKER',
            nearby_events: [],
          });
          break;
        }

        const spreadsMarket = dk.markets.find((m: any) => m.key === 'spreads');
        if (!spreadsMarket) {
          diagnostics.skipReasons.NO_SPREADS_MARKET++;
          diagnostics.skippedGames.push({
            cbbd_game_id: game.cbbd_game_id,
            start_date: game.start_date,
            home_team_name: game.home_team_name,
            away_team_name: game.away_team_name,
            reason: 'NO_SPREADS_MARKET',
            nearby_events: [],
          });
          break;
        }

        // Get spread for the team that CBBD considers home
        const cbbdHomeTeamId = game.home_team_id;
        let spreadHome: number | null = null;
        for (const outcome of spreadsMarket.outcomes) {
          const outcomeTeam = lookupTeam(outcome.name, teamCache);
          if (outcomeTeam?.teamId === cbbdHomeTeamId) {
            spreadHome = outcome.point;
            break;
          }
        }

        if (spreadHome === null) {
          diagnostics.skipReasons.NO_HOME_SPREAD++;
          diagnostics.skippedGames.push({
            cbbd_game_id: game.cbbd_game_id,
            start_date: game.start_date,
            home_team_name: game.home_team_name,
            away_team_name: game.away_team_name,
            reason: 'NO_HOME_SPREAD',
            nearby_events: [],
          });
          break;
        }

        // Success!
        diagnostics.successfulMatches++;

        lineBatch.push({
          game_id: game.id,
          cbbd_game_id: game.cbbd_game_id,
          provider: 'DraftKings',
          spread_home: spreadHome,
          spread_open: spreadHome,
        });

        if (lineBatch.length >= BATCH_SIZE) {
          linesCreated += await flushBatch();
          console.log(`  [Progress] ${linesCreated} lines synced`);
        }

        break;
      }

      if (!matched) {
        if (teamLookupFailed) {
          diagnostics.skipReasons.EVENT_FOUND_TEAM_LOOKUP_FAILED++;
          diagnostics.skippedGames.push({
            cbbd_game_id: game.cbbd_game_id,
            start_date: game.start_date,
            home_team_name: game.home_team_name,
            away_team_name: game.away_team_name,
            reason: 'EVENT_FOUND_TEAM_LOOKUP_FAILED',
            nearby_events: [],
          });
        } else {
          diagnostics.skipReasons.NO_ODDS_API_EVENT++;
          diagnostics.skippedGames.push({
            cbbd_game_id: game.cbbd_game_id,
            start_date: game.start_date,
            home_team_name: game.home_team_name,
            away_team_name: game.away_team_name,
            reason: 'NO_ODDS_API_EVENT',
            nearby_events: [],
          });
        }
      }
    }
  }

  // Flush remaining
  if (lineBatch.length > 0) {
    linesCreated += await flushBatch();
  }

  // Run proximity analysis for skipped games
  console.log('\nRunning ±12h proximity analysis for skipped games...');
  let gamesWithNearbyEvents = 0;
  for (const skipped of diagnostics.skippedGames) {
    if (skipped.reason === 'NO_ODDS_API_EVENT' || skipped.reason === 'NO_API_DATA') {
      skipped.nearby_events = findNearbyEvents({
        id: '',
        cbbd_game_id: skipped.cbbd_game_id,
        start_date: skipped.start_date,
        home_team_name: skipped.home_team_name,
        away_team_name: skipped.away_team_name,
        home_team_id: '',
        away_team_id: '',
      });
      if (skipped.nearby_events.length > 0) {
        gamesWithNearbyEvents++;
      }
    }
  }

  // ========================================
  // DIAGNOSTIC REPORT
  // ========================================
  console.log('\n========================================');
  console.log('  DIAGNOSTIC REPORT');
  console.log('========================================\n');

  console.log('--- API Statistics ---');
  console.log(`Total Odds API events seen: ${diagnostics.totalOddsApiEvents}`);
  console.log(`Unique events (by ID): ${diagnostics.uniqueEventsById.size}`);
  console.log(`Events with DraftKings: ${diagnostics.eventsWithDK} (${(diagnostics.eventsWithDK / diagnostics.totalOddsApiEvents * 100).toFixed(1)}%)`);
  console.log(`Events without DraftKings: ${diagnostics.eventsWithoutDK} (${(diagnostics.eventsWithoutDK / diagnostics.totalOddsApiEvents * 100).toFixed(1)}%)`);

  console.log('\n--- Skip Reasons (Split) ---');
  console.log(`NO_API_DATA:                    ${diagnostics.skipReasons.NO_API_DATA}`);
  console.log(`NO_ODDS_API_EVENT:              ${diagnostics.skipReasons.NO_ODDS_API_EVENT}`);
  console.log(`EVENT_FOUND_TEAM_LOOKUP_FAILED: ${diagnostics.skipReasons.EVENT_FOUND_TEAM_LOOKUP_FAILED}`);
  console.log(`NO_DK_BOOKMAKER:                ${diagnostics.skipReasons.NO_DK_BOOKMAKER}`);
  console.log(`NO_SPREADS_MARKET:              ${diagnostics.skipReasons.NO_SPREADS_MARKET}`);
  console.log(`NO_HOME_SPREAD:                 ${diagnostics.skipReasons.NO_HOME_SPREAD}`);

  const totalSkipped = Object.values(diagnostics.skipReasons).reduce((a, b) => a + b, 0);
  console.log(`\nTotal skipped: ${totalSkipped}`);
  console.log(`Successful matches: ${diagnostics.successfulMatches}`);
  console.log(`  - Normal (same home/away): ${diagnostics.successfulMatches - diagnostics.swappedMatches}`);
  console.log(`  - Swapped (Odds API home ≠ CBBD home): ${diagnostics.swappedMatches}`);

  console.log('\n--- ±12h Proximity Analysis ---');
  const noEventSkips = diagnostics.skippedGames.filter(g =>
    g.reason === 'NO_ODDS_API_EVENT' || g.reason === 'NO_API_DATA');
  console.log(`Games with NO_ODDS_API_EVENT or NO_API_DATA: ${noEventSkips.length}`);
  console.log(`  - With nearby events (potential mapping issue): ${gamesWithNearbyEvents}`);
  console.log(`  - No nearby events (genuine API gap): ${noEventSkips.length - gamesWithNearbyEvents}`);

  // Show sample of games with nearby events
  const sampleWithNearby = diagnostics.skippedGames
    .filter(g => g.nearby_events.length > 0)
    .slice(0, 5);
  if (sampleWithNearby.length > 0) {
    console.log('\n  Sample games with nearby events:');
    for (const g of sampleWithNearby) {
      console.log(`    ${g.home_team_name} vs ${g.away_team_name} @ ${g.start_date}`);
      console.log(`      Nearby: ${g.nearby_events[0]}`);
    }
  }

  console.log('\n--- Top 25 Unmatched Team Strings (Post-Normalization) ---');
  const sortedNormalized = Array.from(diagnostics.unmatchedNormalized.entries())
    .map(([norm, rawSet]) => ({
      normalized: norm,
      rawStrings: Array.from(rawSet),
      count: Array.from(rawSet).reduce((sum, raw) =>
        sum + (diagnostics.unmatchedTeamStrings.get(raw) || 0), 0),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  for (const item of sortedNormalized) {
    console.log(`  [${item.count}x] "${item.normalized}"`);
    console.log(`       Raw: ${item.rawStrings.join(', ')}`);
  }

  console.log('\n--- Coverage Summary ---');
  const totalGames = gamesToSync.length;
  const coverageRate = (diagnostics.successfulMatches / totalGames * 100).toFixed(1);
  console.log(`Games analyzed: ${totalGames}`);
  console.log(`Lines synced: ${linesCreated}`);
  console.log(`Coverage: ${diagnostics.successfulMatches}/${totalGames} (${coverageRate}%)`);

  // Attribution breakdown
  const mappingIssues = diagnostics.skipReasons.EVENT_FOUND_TEAM_LOOKUP_FAILED + gamesWithNearbyEvents;
  const apiGaps = diagnostics.skipReasons.NO_API_DATA +
    (diagnostics.skipReasons.NO_ODDS_API_EVENT - gamesWithNearbyEvents) +
    diagnostics.skipReasons.NO_DK_BOOKMAKER;

  console.log('\n--- Missingness Attribution ---');
  console.log(`Mapping issues (fixable): ${mappingIssues} (${(mappingIssues / totalSkipped * 100).toFixed(1)}%)`);
  console.log(`API coverage gaps: ${apiGaps} (${(apiGaps / totalSkipped * 100).toFixed(1)}%)`);
  console.log(`Other (spreads market issues): ${diagnostics.skipReasons.NO_SPREADS_MARKET + diagnostics.skipReasons.NO_HOME_SPREAD}`);

  console.log('\n========================================');
  console.log('  API Credits Used: ' + creditsUsed);
  console.log('========================================');
}

run().catch(console.error);

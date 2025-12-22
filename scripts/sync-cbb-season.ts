/**
 * CBB Season Sync
 *
 * Syncs DraftKings spreads for a full CBB season.
 * Designed for smoke testing the full pipeline before scaling.
 *
 * Features:
 * - 429 backoff with Retry-After
 * - Batch commits (50 lines)
 * - Coverage dashboard
 * - Progress tracking
 * - Resumable (skips already-synced games)
 *
 * Usage: Set SEASON below (e.g., 2024 = 2023-24 season)
 */

import { createClient } from '@supabase/supabase-js';
import {
  buildTeamLookupCache,
  lookupTeam,
  logUnmatchedTeam,
  getCacheStats,
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
// CONFIGURATION - Set the season to sync
// ============================================
const SEASON = 2022; // 2022 = 2021-22 season (games from Nov 2021 - Apr 2022)

// Season date ranges (CBB seasons run Nov-Apr)
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
  home_score: number | null;
  away_score: number | null;
}

interface CoverageStats {
  totalGames: number;
  alreadySynced: number;
  gamesAttempted: number;
  gamesWithMappings: number;
  gamesWithDKClose: number;
  insertedLines: number;
  skippedReasons: Map<string, number>;
}

let apiCalls = 0;
let creditsUsed = 0;
let teamCache: TeamLookupCache;

const coverage: CoverageStats = {
  totalGames: 0,
  alreadySynced: 0,
  gamesAttempted: 0,
  gamesWithMappings: 0,
  gamesWithDKClose: 0,
  insertedLines: 0,
  skippedReasons: new Map(),
};

function trackSkip(reason: string): void {
  coverage.skippedReasons.set(reason, (coverage.skippedReasons.get(reason) || 0) + 1);
}

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

async function run() {
  const seasonDates = SEASON_DATES[SEASON];
  if (!seasonDates) {
    console.error(`Unknown season: ${SEASON}`);
    return;
  }

  console.log('========================================');
  console.log(`  CBB Season Sync: ${SEASON - 1}-${String(SEASON).slice(2)}`);
  console.log(`  Range: ${seasonDates.start} to ${seasonDates.end}`);
  console.log('========================================\n');

  // Build team lookup cache
  console.log('Building team lookup cache...');
  teamCache = await buildTeamLookupCache(supabase);
  const cacheStats = getCacheStats(teamCache);
  console.log(`  Total lookups available: ${cacheStats.total}\n`);

  if (cacheStats.total === 0) {
    console.error('ERROR: No team mappings found!');
    return;
  }

  // Get all completed games for the season (paginate to avoid 1000 row limit)
  console.log('Fetching games for season...');
  const allGames: GameToSync[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: batch, error: gamesError } = await supabase
      .from('cbb_games')
      .select('id, cbbd_game_id, start_date, home_team_name, away_team_name, home_team_id, away_team_id, home_score, away_score, status')
      .eq('season', SEASON)
      .eq('status', 'final')
      .gte('start_date', seasonDates.start)
      .lte('start_date', seasonDates.end + 'T23:59:59')
      .order('start_date')
      .range(offset, offset + PAGE_SIZE - 1);

    if (gamesError) {
      console.error('Error fetching games:', gamesError);
      return;
    }

    if (batch && batch.length > 0) {
      allGames.push(...batch);
      offset += batch.length;
      hasMore = batch.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  coverage.totalGames = allGames.length;
  console.log(`Total completed games in season: ${coverage.totalGames}\n`);

  if (!allGames || allGames.length === 0) {
    console.log('No games found.');
    return;
  }

  // Check which games already have lines
  const gameIds = allGames.map(g => g.cbbd_game_id);
  const { data: existingLines } = await supabase
    .from('cbb_betting_lines')
    .select('cbbd_game_id')
    .eq('provider', 'DraftKings')
    .in('cbbd_game_id', gameIds);

  const alreadySynced = new Set((existingLines || []).map(l => l.cbbd_game_id));
  coverage.alreadySynced = alreadySynced.size;

  const gamesToSync = allGames.filter(g => !alreadySynced.has(g.cbbd_game_id));
  console.log(`Already synced: ${coverage.alreadySynced}`);
  console.log(`Games to sync: ${gamesToSync.length}\n`);

  if (gamesToSync.length === 0) {
    console.log('All games already synced!');
    return;
  }

  // Group games by query time (15 min before tipoff, rounded to 10 min)
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

  const uniqueTimestamps = gamesByQueryTime.size;
  console.log(`Unique API timestamps: ${uniqueTimestamps}`);
  console.log(`Estimated credits: ~${uniqueTimestamps * 10}`);
  console.log(`Estimated time: ~${Math.ceil(uniqueTimestamps * 0.3 / 60)} minutes\n`);

  // Batch for bulk upsert
  const BATCH_SIZE = 50;
  const lineBatch: any[] = [];
  let linesCreated = 0;

  async function flushBatch(): Promise<number> {
    if (lineBatch.length === 0) return 0;

    // Dedupe by cbbd_game_id (keep last occurrence)
    const deduped = new Map<number, any>();
    for (const line of lineBatch) {
      deduped.set(line.cbbd_game_id, line);
    }
    const uniqueLines = Array.from(deduped.values());

    const { error } = await supabase
      .from('cbb_betting_lines')
      .upsert(uniqueLines, { onConflict: 'cbbd_game_id,provider' });

    if (error) {
      console.log(`  [Batch] Error: ${error.message}`);
      return 0;
    }

    const count = uniqueLines.length;
    lineBatch.length = 0;
    return count;
  }

  // Process in chronological order
  const queryTimes = Array.from(gamesByQueryTime.keys()).sort();
  const unmatchedTeamNames = new Set<string>();
  const processedGameIds = new Set<number>(); // Track games already synced this run
  let processedTimestamps = 0;

  console.log('Starting sync...\n');

  for (const queryTime of queryTimes) {
    const gamesAtTime = gamesByQueryTime.get(queryTime)!;
    processedTimestamps++;

    // Progress every 100 timestamps
    if (processedTimestamps % 100 === 0) {
      console.log(`Progress: ${processedTimestamps}/${uniqueTimestamps} timestamps (${(processedTimestamps / uniqueTimestamps * 100).toFixed(1)}%)`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 250));

    const oddsData = await fetchHistoricalOdds(queryTime);

    if (!oddsData || !oddsData.data || oddsData.data.length === 0) {
      for (const _ of gamesAtTime) {
        trackSkip('no_api_data');
      }
      continue;
    }

    for (const game of gamesAtTime) {
      coverage.gamesAttempted++;
      let matched = false;

      for (const event of oddsData.data) {
        const eventHomeTeam = lookupTeam(event.home_team, teamCache);
        const eventAwayTeam = lookupTeam(event.away_team, teamCache);

        if (!eventHomeTeam) {
          if (!unmatchedTeamNames.has(event.home_team)) {
            unmatchedTeamNames.add(event.home_team);
            await logUnmatchedTeam(supabase, event.home_team, `season ${SEASON}`, teamCache);
          }
        }
        if (!eventAwayTeam) {
          if (!unmatchedTeamNames.has(event.away_team)) {
            unmatchedTeamNames.add(event.away_team);
            await logUnmatchedTeam(supabase, event.away_team, `season ${SEASON}`, teamCache);
          }
        }

        if (!eventHomeTeam || !eventAwayTeam) continue;

        // Check for match - allow home/away swap (neutral site games, data discrepancies)
        let isSwapped = false;
        if (eventHomeTeam.teamId === game.home_team_id && eventAwayTeam.teamId === game.away_team_id) {
          // Normal match - Odds API home = CBBD home
          isSwapped = false;
        } else if (eventHomeTeam.teamId === game.away_team_id && eventAwayTeam.teamId === game.home_team_id) {
          // Swapped match - Odds API home = CBBD away (neutral site or data discrepancy)
          isSwapped = true;
        } else {
          continue; // No match
        }

        matched = true;
        coverage.gamesWithMappings++;

        const dk = event.bookmakers.find((b: any) => b.key === 'draftkings');
        if (!dk) {
          trackSkip('no_dk_bookmaker');
          continue;
        }

        const spreadsMarket = dk.markets.find((m: any) => m.key === 'spreads');
        if (!spreadsMarket) {
          trackSkip('no_spreads_market');
          continue;
        }

        // Get spread for the team that CBBD considers home
        // If swapped, we need to get the Odds API away team's spread (which is CBBD home)
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
          trackSkip('no_home_spread');
          continue;
        }

        coverage.gamesWithDKClose++;

        // Skip if already processed this run (avoid duplicates)
        if (processedGameIds.has(game.cbbd_game_id)) {
          break;
        }
        processedGameIds.add(game.cbbd_game_id);

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
        trackSkip('no_team_match');
      }
    }
  }

  // Flush remaining
  if (lineBatch.length > 0) {
    linesCreated += await flushBatch();
  }

  coverage.insertedLines = linesCreated;

  // Results
  console.log('\n========================================');
  console.log('  Sync Results');
  console.log('========================================');
  console.log(`API calls: ${apiCalls}`);
  console.log(`Credits used: ${creditsUsed}`);
  console.log(`Unmatched team names: ${unmatchedTeamNames.size}`);

  if (unmatchedTeamNames.size > 0 && unmatchedTeamNames.size <= 20) {
    console.log('\nUnmatched teams:');
    for (const name of unmatchedTeamNames) {
      console.log(`  - ${name}`);
    }
  }

  // Coverage Dashboard
  console.log('\n========================================');
  console.log('  Coverage Dashboard');
  console.log('========================================');
  console.log(`Total games in season:    ${coverage.totalGames}`);
  console.log(`Already synced:           ${coverage.alreadySynced}`);
  console.log(`Games attempted:          ${coverage.gamesAttempted}`);
  console.log(`Games with mappings:      ${coverage.gamesWithMappings}`);
  console.log(`Games with DK close:      ${coverage.gamesWithDKClose}`);
  console.log(`Lines inserted:           ${coverage.insertedLines}`);

  const totalSynced = coverage.alreadySynced + coverage.insertedLines;
  const coverageRate = (totalSynced / coverage.totalGames * 100).toFixed(1);
  console.log(`\nTotal coverage: ${totalSynced}/${coverage.totalGames} (${coverageRate}%)`);

  console.log('\nSkipped by reason:');
  for (const [reason, count] of coverage.skippedReasons) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log('\n========================================');
  console.log('  Sync Complete');
  console.log('========================================');
}

run().catch(console.error);

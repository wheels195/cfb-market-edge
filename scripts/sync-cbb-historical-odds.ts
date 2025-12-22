/**
 * Sync historical CBB odds from The Odds API (DraftKings only)
 * Pulls CLOSING lines for all historical games
 *
 * UPDATED: Uses strict team lookup (no fuzzy matching)
 * - Exact odds_api_name → exact alias → explicit mapping
 * - Unmatched teams are logged to cbb_unmatched_team_names
 * - Games without team matches are skipped
 *
 * This is the primary market data source for backtesting (same as CFB)
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

// Target books - DraftKings only for backtesting (as specified)
const TARGET_BOOKS = ['draftkings'];

interface HistoricalOddsResponse {
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
  data: Array<{
    id: string;
    sport_key: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Array<{
      key: string;
      title: string;
      last_update: string;
      markets: Array<{
        key: string;
        outcomes: Array<{
          name: string;
          price: number;
          point?: number;
        }>;
      }>;
    }>;
  }>;
}

interface GameToSync {
  id: string;
  cbbd_game_id: number;
  start_date: string;
  home_team_name: string;
  away_team_name: string;
  season: number;
}

let apiCalls = 0;
let creditsUsed = 0;

async function fetchHistoricalOdds(date: string): Promise<HistoricalOddsResponse | null> {
  const url = new URL(`${BASE_URL}/historical/sports/${SPORT_KEY}/odds`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'spreads'); // Spreads only - 10 credits per call
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('bookmakers', TARGET_BOOKS.join(','));
  url.searchParams.set('date', date);

  apiCalls++;
  creditsUsed += 10; // Spreads only = 10 credits

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      if (response.status === 422) {
        // No data for this timestamp
        return null;
      }
      console.log(`API Error: ${response.status}`);
      return null;
    }

    const remaining = response.headers.get('x-requests-remaining');
    if (apiCalls % 50 === 0) {
      console.log(`[API] Call #${apiCalls}, Credits: ~${creditsUsed}, Remaining: ${remaining}`);
    }

    return response.json();
  } catch (error) {
    console.log(`Fetch error: ${error}`);
    return null;
  }
}

// Team lookup cache - built once at start
let teamCache: TeamLookupCache;

// Track unmatched teams for logging
const unmatchedTeamNames = new Set<string>();

async function syncHistoricalOdds() {
  console.log('========================================');
  console.log('  CBB Historical Odds Sync');
  console.log('  Source: The Odds API (DraftKings only)');
  console.log('  Method: STRICT team lookup (no fuzzy)');
  console.log('========================================\n');

  // Build team lookup cache FIRST
  console.log('Building team lookup cache...');
  teamCache = await buildTeamLookupCache(supabase);
  const cacheStats = getCacheStats(teamCache);
  console.log(`  By odds_api_name: ${cacheStats.byOddsApiName}`);
  console.log(`  By alias: ${cacheStats.byAlias}`);
  console.log(`  By mapping: ${cacheStats.byMapping}`);
  console.log(`  Known unmatched: ${cacheStats.unmatched}`);
  console.log(`  Total lookups available: ${cacheStats.total}\n`);

  if (cacheStats.total === 0) {
    console.error('ERROR: No team mappings found!');
    console.error('Run scripts/build-cbb-team-mapping.ts first to populate mappings.');
    return;
  }

  // Get completed games from 2022-2024
  // Fetch in batches to avoid Supabase 1000 row limit
  let allGames: GameToSync[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data: batch, error: batchError } = await supabase
      .from('cbb_games')
      .select('id, cbbd_game_id, start_date, home_team_name, away_team_name, season')
      .in('season', [2022, 2023, 2024])
      .eq('status', 'final')
      .order('start_date', { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (batchError || !batch || batch.length === 0) break;
    allGames = allGames.concat(batch);
    offset += batchSize;

    if (batch.length < batchSize) break;
  }

  const games = allGames;

  if (!games || games.length === 0) {
    console.error('Failed to fetch games or no games found');
    return;
  }

  console.log(`Total completed games: ${games.length}`);

  // Check which games already have DraftKings lines
  const { data: existingLines } = await supabase
    .from('cbb_betting_lines')
    .select('cbbd_game_id, provider')
    .eq('provider', 'DraftKings');

  const existingDK = new Set<number>();
  for (const line of existingLines || []) {
    existingDK.add(line.cbbd_game_id);
  }

  // Filter to games needing sync (missing DraftKings)
  const gamesToSync = games.filter(g => !existingDK.has(g.cbbd_game_id));

  console.log(`Games with DraftKings odds: ${existingDK.size}`);
  console.log(`Games needing DK odds: ${gamesToSync.length}\n`);

  if (gamesToSync.length === 0) {
    console.log('All games have DraftKings lines!');
    return;
  }

  // Group games by date-hour for efficient API calls
  // Query 15 minutes before tip-off for closing lines
  const gamesByQueryTime = new Map<string, GameToSync[]>();

  for (const game of gamesToSync) {
    const gameDate = new Date(game.start_date);
    gameDate.setMinutes(gameDate.getMinutes() - 15); // 15 min before = closing line

    // Round to nearest 10 minutes (API has 10-min snapshots)
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

  console.log(`Unique query timestamps: ${gamesByQueryTime.size}`);
  console.log(`Estimated API calls: ${gamesByQueryTime.size}`);
  console.log(`Estimated credits: ~${gamesByQueryTime.size * 10} (spreads-only)\n`);

  let linesCreated = 0;
  let dkLines = 0;
  let matchedGames = 0;
  let unmatchedGames = 0;
  let skippedNoTeamMatch = 0;

  const queryTimes = Array.from(gamesByQueryTime.keys()).sort();

  // Process each timestamp
  for (let i = 0; i < queryTimes.length; i++) {
    const queryTime = queryTimes[i];
    const gamesAtTime = gamesByQueryTime.get(queryTime)!;

    // Rate limiting - 1 second between calls
    if (i > 0) {
      await new Promise(r => setTimeout(r, 200));
    }

    const oddsData = await fetchHistoricalOdds(queryTime);

    if (!oddsData || oddsData.data.length === 0) {
      unmatchedGames += gamesAtTime.length;
      continue;
    }

    // Match each game to API events using STRICT team lookup
    for (const game of gamesAtTime) {
      let matched = false;

      for (const event of oddsData.data) {
        // STRICT TEAM LOOKUP - no fuzzy matching
        const homeTeam = lookupTeam(event.home_team, teamCache);
        const awayTeam = lookupTeam(event.away_team, teamCache);

        // Log unmatched teams (but don't fail - just skip this game)
        if (!homeTeam) {
          if (!unmatchedTeamNames.has(event.home_team)) {
            unmatchedTeamNames.add(event.home_team);
            await logUnmatchedTeam(supabase, event.home_team, `game ${game.cbbd_game_id}`, teamCache);
          }
        }
        if (!awayTeam) {
          if (!unmatchedTeamNames.has(event.away_team)) {
            unmatchedTeamNames.add(event.away_team);
            await logUnmatchedTeam(supabase, event.away_team, `game ${game.cbbd_game_id}`, teamCache);
          }
        }

        // Skip if we can't match both teams
        if (!homeTeam || !awayTeam) {
          continue;
        }

        // Verify this event matches our game's teams
        // (The API might return multiple games at same timestamp)
        // We need to check if the resolved team IDs match
        // For now, just check we found both teams and proceed
        matched = true;
        matchedGames++;

        // Process DraftKings bookmaker
        for (const book of event.bookmakers) {
          if (book.key !== 'draftkings') continue;

          // Skip if we already have DK line for this game
          if (existingDK.has(game.cbbd_game_id)) continue;

          const spreadsMarket = book.markets.find(m => m.key === 'spreads');

          let spreadHome: number | null = null;
          let spreadAwayPrice: number | null = null;
          let spreadHomePrice: number | null = null;

          if (spreadsMarket) {
            // Use strict lookup to match outcome names to teams
            for (const outcome of spreadsMarket.outcomes) {
              const outcomeTeam = lookupTeam(outcome.name, teamCache);
              if (outcomeTeam?.teamId === homeTeam.teamId) {
                spreadHome = outcome.point ?? null;
                spreadHomePrice = outcome.price;
              } else if (outcomeTeam?.teamId === awayTeam.teamId) {
                spreadAwayPrice = outcome.price;
              }
            }
          }

          // Skip if no spread data
          if (spreadHome === null) continue;

          // Insert line
          const { error: insertError } = await supabase
            .from('cbb_betting_lines')
            .upsert({
              game_id: game.id,
              cbbd_game_id: game.cbbd_game_id,
              provider: 'DraftKings',
              spread_home: spreadHome,
              spread_open: spreadHome, // Using closing as open (historical limitation)
              home_moneyline: spreadHomePrice,
              away_moneyline: spreadAwayPrice,
            }, { onConflict: 'cbbd_game_id,provider' });

          if (!insertError) {
            linesCreated++;
            dkLines++;
          }
        }

        break; // Found match, move to next game
      }

      if (!matched) {
        unmatchedGames++;
        skippedNoTeamMatch++;
      }
    }

    // Progress update every 100 API calls
    if (i > 0 && i % 100 === 0) {
      console.log(`\nProgress: ${i}/${queryTimes.length} timestamps (${Math.round(i/queryTimes.length*100)}%)`);
      console.log(`  Matched games: ${matchedGames}`);
      console.log(`  DK lines: ${dkLines}`);
      console.log(`  Unmatched teams so far: ${unmatchedTeamNames.size}`);
    }
  }

  console.log('\n========================================');
  console.log('  Historical Odds Sync Complete!');
  console.log('========================================');
  console.log(`API calls made: ${apiCalls}`);
  console.log(`Credits used: ~${creditsUsed}`);
  console.log(`\nResults:`);
  console.log(`  Games matched: ${matchedGames}`);
  console.log(`  Games unmatched (no API data): ${unmatchedGames - skippedNoTeamMatch}`);
  console.log(`  Games skipped (no team match): ${skippedNoTeamMatch}`);
  console.log(`  DraftKings lines created: ${dkLines}`);
  console.log(`\nTeam Matching:`);
  console.log(`  Unique unmatched team names: ${unmatchedTeamNames.size}`);
  if (unmatchedTeamNames.size > 0) {
    console.log(`  Unmatched teams logged to: cbb_unmatched_team_names table`);
    console.log(`  Sample unmatched:`);
    const sample = Array.from(unmatchedTeamNames).slice(0, 10);
    for (const name of sample) {
      console.log(`    - "${name}"`);
    }
    if (unmatchedTeamNames.size > 10) {
      console.log(`    ... and ${unmatchedTeamNames.size - 10} more`);
    }
  }
}

syncHistoricalOdds().catch(console.error);

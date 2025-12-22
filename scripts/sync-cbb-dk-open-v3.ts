/**
 * Sync DK Opening Spreads v3 - Fixed for cbb_betting_lines
 *
 * Previous version wrote to wrong table (cbb_games instead of cbb_betting_lines).
 * This version:
 * 1. Targets cbb_betting_lines rows with spread_t60 but no dk_spread_open
 * 2. Uses wider timestamp grid (T-72h through T-12h) to find earliest available
 * 3. Stores dk_spread_open and dk_spread_open_ts in cbb_betting_lines
 *
 * OPEN = earliest DK snapshot found for that game
 */

import { createClient } from '@supabase/supabase-js';
import {
  buildTeamLookupCache,
  lookupTeam,
  TeamLookupCache,
} from '../src/lib/cbb/team-lookup';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ODDS_API_KEY = process.env.ODDS_API_KEY!;
const BASE_URL = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'basketball_ncaab';

// Rate limiting
const RATE_LIMIT_MS = 350;

// Timestamp offsets to try (hours before game)
// Go from earliest to latest, take first match found
const HOUR_OFFSETS = [72, 60, 48, 36, 24, 18, 12, 6];

interface GameToSync {
  betting_line_id: string;
  game_id: string;
  cbbd_game_id: number;
  start_date: string;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
}

interface SyncStats {
  datesProcessed: number;
  gamesMatched: number;
  gamesNoData: number;
  apiCalls: number;
  creditsUsed: number;
}

const stats: SyncStats = {
  datesProcessed: 0,
  gamesMatched: 0,
  gamesNoData: 0,
  apiCalls: 0,
  creditsUsed: 0,
};

let teamCache: TeamLookupCache;

/**
 * Fetch historical odds for a specific timestamp
 */
async function fetchHistoricalOdds(isoTimestamp: string): Promise<any> {
  const url = new URL(`${BASE_URL}/historical/sports/${SPORT_KEY}/odds`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'spreads');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('bookmakers', 'draftkings');
  url.searchParams.set('date', isoTimestamp);

  stats.apiCalls++;
  stats.creditsUsed += 10;

  try {
    const response = await fetch(url.toString());

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
      console.log(`  [429] Rate limited. Waiting ${waitSeconds}s...`);
      await new Promise(r => setTimeout(r, waitSeconds * 1000));
      stats.apiCalls--; // Don't double count
      stats.creditsUsed -= 10;
      return fetchHistoricalOdds(isoTimestamp);
    }

    if (!response.ok) {
      return null;
    }

    const remaining = response.headers.get('x-requests-remaining');
    if (stats.apiCalls % 50 === 0) {
      console.log(`  [API] Calls: ${stats.apiCalls}, Credits: ${stats.creditsUsed}, Remaining: ${remaining}`);
    }

    return response.json();
  } catch (error) {
    console.log(`  [ERROR] Fetch failed: ${error}`);
    return null;
  }
}

/**
 * Build a lookup map from API response: key -> { homeSpread, capturedAt }
 */
function buildSpreadLookup(
  oddsData: any,
  capturedAt: string
): Map<string, { homeTeamId: string; awayTeamId: string; homeSpread: number; capturedAt: string }> {
  const lookup = new Map<string, { homeTeamId: string; awayTeamId: string; homeSpread: number; capturedAt: string }>();

  if (!oddsData?.data) return lookup;

  for (const event of oddsData.data) {
    const homeTeam = lookupTeam(event.home_team, teamCache);
    const awayTeam = lookupTeam(event.away_team, teamCache);

    if (!homeTeam || !awayTeam) continue;

    const dk = event.bookmakers?.find((b: any) => b.key === 'draftkings');
    if (!dk) continue;

    const spreadsMarket = dk.markets?.find((m: any) => m.key === 'spreads');
    if (!spreadsMarket) continue;

    // Find the home team's spread from outcomes
    let homeSpread: number | null = null;
    for (const outcome of spreadsMarket.outcomes) {
      const outcomeTeam = lookupTeam(outcome.name, teamCache);
      if (outcomeTeam?.teamId === homeTeam.teamId) {
        homeSpread = outcome.point;
        break;
      }
    }

    if (homeSpread === null) continue;

    // Key by both team IDs
    const key = `${homeTeam.teamId}_${awayTeam.teamId}`;
    lookup.set(key, {
      homeTeamId: homeTeam.teamId,
      awayTeamId: awayTeam.teamId,
      homeSpread,
      capturedAt,
    });
  }

  return lookup;
}

/**
 * Get betting lines with T-60 but no dk_spread_open, joined with game info
 */
async function getGamesNeedingSync(): Promise<GameToSync[]> {
  const games: GameToSync[] = [];
  let offset = 0;
  const pageSize = 1000;

  console.log('Fetching betting lines needing open spread sync...');

  while (true) {
    const { data, error } = await supabase
      .from('cbb_betting_lines')
      .select(`
        id,
        game_id,
        cbbd_game_id,
        cbb_games!inner(
          start_date,
          home_team_id,
          away_team_id,
          home_team:cbb_teams!cbb_games_home_team_id_fkey(id, name),
          away_team:cbb_teams!cbb_games_away_team_id_fkey(id, name)
        )
      `)
      .not('spread_t60', 'is', null)
      .is('dk_spread_open', null)
      .order('cbbd_game_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching games:', error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const g = row.cbb_games as any;
      games.push({
        betting_line_id: row.id,
        game_id: row.game_id,
        cbbd_game_id: row.cbbd_game_id,
        start_date: g.start_date,
        home_team_id: g.home_team_id,
        away_team_id: g.away_team_id,
        home_team_name: g.home_team?.name || '',
        away_team_name: g.away_team?.name || '',
      });
    }

    console.log(`  Fetched ${offset + data.length} betting lines...`);

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return games;
}

/**
 * Group games by date
 */
function groupByDate(games: GameToSync[]): Map<string, GameToSync[]> {
  const byDate = new Map<string, GameToSync[]>();

  for (const game of games) {
    const date = game.start_date.split('T')[0];
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date)!.push(game);
  }

  return byDate;
}

/**
 * Process a single date: query multiple timestamps, take earliest match per game
 */
async function processDate(dateStr: string, games: GameToSync[]): Promise<number> {
  // Track which games we've found data for (earliest wins)
  const foundSpreads = new Map<string, { homeSpread: number; capturedAt: string }>();

  // Convert game date to Date object for offset calculations
  const gameDate = new Date(`${dateStr}T12:00:00Z`); // Noon on game day

  // Try each offset, earliest first
  for (const hoursOffset of HOUR_OFFSETS) {
    // Skip if we've already found data for all games
    const gamesStillNeeded = games.filter(g => !foundSpreads.has(g.betting_line_id));
    if (gamesStillNeeded.length === 0) break;

    const queryDate = new Date(gameDate);
    queryDate.setHours(queryDate.getHours() - hoursOffset);
    const queryTimestamp = queryDate.toISOString().replace(/\.\d{3}Z$/, 'Z');

    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    const oddsData = await fetchHistoricalOdds(queryTimestamp);

    if (!oddsData) continue;

    const spreadLookup = buildSpreadLookup(oddsData, queryTimestamp);

    // Match games that don't have data yet
    for (const game of gamesStillNeeded) {
      const normalKey = `${game.home_team_id}_${game.away_team_id}`;
      const swappedKey = `${game.away_team_id}_${game.home_team_id}`;

      let spread = spreadLookup.get(normalKey);
      let isSwapped = false;

      if (!spread) {
        spread = spreadLookup.get(swappedKey);
        isSwapped = true;
      }

      if (spread) {
        const homeSpread = isSwapped ? -spread.homeSpread : spread.homeSpread;
        foundSpreads.set(game.betting_line_id, {
          homeSpread,
          capturedAt: spread.capturedAt,
        });
      }
    }
  }

  // Update database for found spreads
  let matched = 0;
  for (const game of games) {
    const spread = foundSpreads.get(game.betting_line_id);
    if (spread) {
      await supabase
        .from('cbb_betting_lines')
        .update({
          dk_spread_open: spread.homeSpread,
          dk_spread_open_ts: spread.capturedAt,
        })
        .eq('id', game.betting_line_id);
      matched++;
    }
  }

  return matched;
}

async function main() {
  console.log('========================================');
  console.log('  Sync DK Opening Spreads v3');
  console.log('  (Fixed: targets cbb_betting_lines)');
  console.log('========================================\n');

  if (!ODDS_API_KEY) {
    console.error('ODDS_API_KEY not set!');
    process.exit(1);
  }

  // Build team lookup cache
  console.log('Building team lookup cache...');
  teamCache = await buildTeamLookupCache(supabase);

  // Get games needing sync
  const games = await getGamesNeedingSync();
  console.log(`\nTotal betting lines needing open spread: ${games.length}`);

  if (games.length === 0) {
    console.log('No games need syncing!');
    return;
  }

  // Group by date
  const byDate = groupByDate(games);
  const dates = Array.from(byDate.keys()).sort();

  console.log(`Unique dates: ${dates.length}`);
  console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log(`Timestamp offsets to try: ${HOUR_OFFSETS.join('h, ')}h`);
  console.log(`Max API calls: ${dates.length * HOUR_OFFSETS.length} (${dates.length} dates × ${HOUR_OFFSETS.length} offsets)`);
  console.log(`Max credits: ${dates.length * HOUR_OFFSETS.length * 10}\n`);

  console.log('Starting sync...\n');

  for (let i = 0; i < dates.length; i++) {
    const dateStr = dates[i];
    const dateGames = byDate.get(dateStr)!;

    const matched = await processDate(dateStr, dateGames);

    stats.datesProcessed++;
    stats.gamesMatched += matched;
    stats.gamesNoData += dateGames.length - matched;

    // Progress logging
    if ((i + 1) % 25 === 0 || i === dates.length - 1) {
      const pct = ((i + 1) / dates.length * 100).toFixed(1);
      console.log(`Progress: ${i + 1}/${dates.length} (${pct}%)`);
      console.log(`  Matched: ${stats.gamesMatched}, NoData: ${stats.gamesNoData}, API Calls: ${stats.apiCalls}`);
    }
  }

  console.log('\n========================================');
  console.log('  Sync Complete');
  console.log('========================================');
  console.log(`Dates processed: ${stats.datesProcessed}`);
  console.log(`Games matched: ${stats.gamesMatched}`);
  console.log(`Games with no data: ${stats.gamesNoData}`);
  console.log(`API calls: ${stats.apiCalls}`);
  console.log(`Credits used: ${stats.creditsUsed}`);

  // Calculate new coverage
  const { count: hasOpen } = await supabase
    .from('cbb_betting_lines')
    .select('*', { count: 'exact', head: true })
    .not('dk_spread_open', 'is', null);

  const { count: hasT60 } = await supabase
    .from('cbb_betting_lines')
    .select('*', { count: 'exact', head: true })
    .not('spread_t60', 'is', null);

  console.log(`\nNew coverage: ${hasOpen}/${hasT60} T-60 games have opens (${((hasOpen || 0) / (hasT60 || 1) * 100).toFixed(1)}%)`);
}

main().catch(console.error);

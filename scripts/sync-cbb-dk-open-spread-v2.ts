/**
 * Sync DK Opening Spreads - Efficient Date-Based Approach
 *
 * Instead of querying per-game (expensive), we:
 * 1. Get all unique game dates needing sync
 * 2. For each date, query Historical Odds API ONCE at T-24h
 * 3. Build a lookup map of all DK spreads from that response
 * 4. Match to our games and store opening spreads
 *
 * Idempotent: Tracks completed dates in `cbb_sync_progress` table
 * Resumable: Skips already-completed dates
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
const RATE_LIMIT_MS = 300;

interface GameToSync {
  id: string;
  cbbd_game_id: number;
  start_date: string;
  home_team_name: string;
  away_team_name: string;
  home_team_id: string;
  away_team_id: string;
}

interface SyncStats {
  datesProcessed: number;
  datesSkipped: number;
  gamesMatched: number;
  gamesNoData: number;
  apiCalls: number;
  creditsUsed: number;
}

const stats: SyncStats = {
  datesProcessed: 0,
  datesSkipped: 0,
  gamesMatched: 0,
  gamesNoData: 0,
  apiCalls: 0,
  creditsUsed: 0,
};

let teamCache: TeamLookupCache;

/**
 * Fetch historical odds for a specific timestamp
 * Returns ALL games available at that timestamp
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
      return fetchHistoricalOdds(isoTimestamp);
    }

    if (!response.ok) {
      console.log(`  [${response.status}] API error for ${isoTimestamp}`);
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
 * Build a lookup map from API response: eventKey -> { homeSpread, capturedAt }
 * eventKey = normalized "hometeam_awayteam" for matching
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

    // Key by both team IDs for reliable matching
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
 * Get games for a specific date that need open spread sync
 */
async function getGamesForDate(dateStr: string): Promise<GameToSync[]> {
  const startOfDay = `${dateStr}T00:00:00Z`;
  const endOfDay = `${dateStr}T23:59:59Z`;

  const { data, error } = await supabase
    .from('cbb_games')
    .select(`
      id,
      cbbd_game_id,
      start_date,
      home_team_id,
      away_team_id,
      home_team:cbb_teams!cbb_games_home_team_id_fkey(id, name),
      away_team:cbb_teams!cbb_games_away_team_id_fkey(id, name)
    `)
    .gte('start_date', startOfDay)
    .lte('start_date', endOfDay)
    .is('dk_spread_open', null);

  if (error || !data) return [];

  return data.map((g: any) => ({
    id: g.id,
    cbbd_game_id: g.cbbd_game_id,
    start_date: g.start_date,
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    home_team_name: g.home_team?.name || '',
    away_team_name: g.away_team?.name || '',
  }));
}

/**
 * Get all unique dates that have games needing sync
 */
async function getUniqueDatesNeedingSync(): Promise<string[]> {
  const dates = new Set<string>();
  let offset = 0;
  const pageSize = 1000;

  console.log('  Fetching all games needing sync (paginated)...');

  while (true) {
    const { data, error } = await supabase
      .from('cbb_games')
      .select('start_date')
      .is('dk_spread_open', null)
      .not('start_date', 'is', null)
      .order('start_date', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching dates:', error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const date = row.start_date.split('T')[0];
      dates.add(date);
    }

    console.log(`    Fetched ${offset + data.length} games, ${dates.size} unique dates so far...`);

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return Array.from(dates).sort();
}

/**
 * Check if a date has already been processed
 */
async function isDateProcessed(dateStr: string): Promise<boolean> {
  const { data } = await supabase
    .from('cbb_sync_progress')
    .select('id')
    .eq('sync_type', 'dk_open_spread')
    .eq('date_key', dateStr)
    .single();

  return !!data;
}

/**
 * Mark a date as processed
 */
async function markDateProcessed(dateStr: string, gamesMatched: number, gamesTotal: number): Promise<void> {
  await supabase
    .from('cbb_sync_progress')
    .upsert({
      sync_type: 'dk_open_spread',
      date_key: dateStr,
      games_matched: gamesMatched,
      games_total: gamesTotal,
      completed_at: new Date().toISOString(),
    }, {
      onConflict: 'sync_type,date_key',
    });
}

/**
 * Process a single date: fetch odds, match games, update DB
 */
async function processDate(dateStr: string): Promise<{ matched: number; total: number }> {
  // Get games for this date
  const games = await getGamesForDate(dateStr);
  if (games.length === 0) {
    return { matched: 0, total: 0 };
  }

  // Query at T-24h (day before at noon ET = 17:00 UTC)
  // This captures most opening lines
  const queryDate = new Date(`${dateStr}T17:00:00Z`);
  queryDate.setDate(queryDate.getDate() - 1);
  const queryTimestamp = queryDate.toISOString().replace(/\.\d{3}Z$/, 'Z');

  await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  const oddsData = await fetchHistoricalOdds(queryTimestamp);

  if (!oddsData) {
    return { matched: 0, total: games.length };
  }

  // Build lookup from API response
  const spreadLookup = buildSpreadLookup(oddsData, queryTimestamp);

  // Match games to spreads
  let matched = 0;
  const updates: Array<{ id: string; dk_spread_open: number; dk_spread_open_ts: string }> = [];

  for (const game of games) {
    // Try normal key
    const normalKey = `${game.home_team_id}_${game.away_team_id}`;
    // Try swapped key (in case home/away are flipped)
    const swappedKey = `${game.away_team_id}_${game.home_team_id}`;

    let spread = spreadLookup.get(normalKey);
    let isSwapped = false;

    if (!spread) {
      spread = spreadLookup.get(swappedKey);
      isSwapped = true;
    }

    if (spread) {
      // If swapped, negate the spread (home becomes away)
      const homeSpread = isSwapped ? -spread.homeSpread : spread.homeSpread;

      updates.push({
        id: game.id,
        dk_spread_open: homeSpread,
        dk_spread_open_ts: spread.capturedAt,
      });
      matched++;
    }
  }

  // Batch update games
  if (updates.length > 0) {
    for (const update of updates) {
      await supabase
        .from('cbb_games')
        .update({
          dk_spread_open: update.dk_spread_open,
          dk_spread_open_ts: update.dk_spread_open_ts,
        })
        .eq('id', update.id);
    }
  }

  return { matched, total: games.length };
}

/**
 * Ensure sync progress table exists
 */
async function ensureSyncProgressTable(): Promise<void> {
  // Check if table exists by trying to query it
  const { error } = await supabase
    .from('cbb_sync_progress')
    .select('id')
    .limit(1);

  if (error?.code === '42P01') {
    // Table doesn't exist - create it
    console.log('Creating cbb_sync_progress table...');

    // Note: This requires appropriate permissions
    // If it fails, we'll proceed without resumability
    const { error: createError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS cbb_sync_progress (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sync_type TEXT NOT NULL,
          date_key TEXT NOT NULL,
          games_matched INTEGER,
          games_total INTEGER,
          completed_at TIMESTAMPTZ,
          UNIQUE(sync_type, date_key)
        );
      `
    });

    if (createError) {
      console.log('Warning: Could not create progress table. Sync will not be resumable.');
    }
  }
}

async function main() {
  console.log('========================================');
  console.log('  Sync DK Opening Spreads (Date-Based)');
  console.log('========================================\n');

  // Build team lookup cache
  console.log('Building team lookup cache...');
  teamCache = await buildTeamLookupCache(supabase);

  // Ensure progress table exists
  await ensureSyncProgressTable();

  // Get unique dates needing sync
  console.log('\nFetching dates needing sync...');
  const dates = await getUniqueDatesNeedingSync();
  console.log(`Dates to process: ${dates.length}`);

  if (dates.length === 0) {
    console.log('No dates need syncing!');
    return;
  }

  console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log(`Estimated API calls: ${dates.length} (1 per date)`);
  console.log(`Estimated credits: ${dates.length * 10}\n`);

  console.log('Starting sync...\n');

  for (let i = 0; i < dates.length; i++) {
    const dateStr = dates[i];

    // Check if already processed (resumability)
    const alreadyDone = await isDateProcessed(dateStr);
    if (alreadyDone) {
      stats.datesSkipped++;
      continue;
    }

    // Process this date
    const result = await processDate(dateStr);

    stats.datesProcessed++;
    stats.gamesMatched += result.matched;
    stats.gamesNoData += result.total - result.matched;

    // Mark as processed
    await markDateProcessed(dateStr, result.matched, result.total);

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
  console.log(`Dates skipped (already done): ${stats.datesSkipped}`);
  console.log(`Games matched: ${stats.gamesMatched}`);
  console.log(`Games with no data: ${stats.gamesNoData}`);
  console.log(`API calls: ${stats.apiCalls}`);
  console.log(`Credits used: ${stats.creditsUsed}`);
}

main().catch(console.error);

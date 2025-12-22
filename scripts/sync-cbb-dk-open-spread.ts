/**
 * Sync TRUE DK Opening Spreads
 *
 * Fetches earliest available DK spread for each game.
 * Strategy: Query at T-24h (typical opening window for CBB).
 * If unavailable, try T-12h, T-6h.
 *
 * Stores:
 * - dk_spread_open: The opening spread value
 * - dk_spread_open_ts: When it was captured
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

// Configuration
const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 250;

// Time offsets to try (hours before game)
const OPEN_OFFSETS_HOURS = [24, 18, 12, 6];

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
  total: number;
  synced: number;
  noData: number;
  apiCalls: number;
  creditsUsed: number;
}

const stats: SyncStats = {
  total: 0,
  synced: 0,
  noData: 0,
  apiCalls: 0,
  creditsUsed: 0,
};

let teamCache: TeamLookupCache;

async function fetchHistoricalOdds(date: string): Promise<any> {
  const url = new URL(`${BASE_URL}/historical/sports/${SPORT_KEY}/odds`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'spreads');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('bookmakers', 'draftkings');
  url.searchParams.set('date', date);

  stats.apiCalls++;
  stats.creditsUsed += 10;

  try {
    const response = await fetch(url.toString());

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
      console.log(`    [429] Rate limited. Waiting ${waitSeconds}s...`);
      await new Promise(r => setTimeout(r, waitSeconds * 1000));
      return fetchHistoricalOdds(date); // Retry
    }

    if (!response.ok) {
      return null;
    }

    if (stats.apiCalls % 100 === 0) {
      const remaining = response.headers.get('x-requests-remaining');
      console.log(`    [API] Calls: ${stats.apiCalls}, Credits: ${stats.creditsUsed}, Remaining: ${remaining}`);
    }

    return response.json();
  } catch (error) {
    return null;
  }
}

function getQueryTime(gameDate: Date, hoursOffset: number): string {
  const queryDate = new Date(gameDate.getTime() - hoursOffset * 60 * 60 * 1000);
  // Round to nearest 10 minutes
  const mins = Math.floor(queryDate.getMinutes() / 10) * 10;
  queryDate.setMinutes(mins);
  queryDate.setSeconds(0);
  queryDate.setMilliseconds(0);
  return queryDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function findOpenSpread(
  game: GameToSync
): Promise<{ spread: number; capturedAt: string } | null> {
  const gameDate = new Date(game.start_date);

  for (const hoursOffset of OPEN_OFFSETS_HOURS) {
    const queryTime = getQueryTime(gameDate, hoursOffset);

    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    const oddsData = await fetchHistoricalOdds(queryTime);

    if (!oddsData?.data) continue;

    for (const event of oddsData.data) {
      const eventHomeTeam = lookupTeam(event.home_team, teamCache);
      const eventAwayTeam = lookupTeam(event.away_team, teamCache);

      if (!eventHomeTeam || !eventAwayTeam) continue;

      // Check for match
      const normalMatch = eventHomeTeam.teamId === game.home_team_id && eventAwayTeam.teamId === game.away_team_id;
      const swappedMatch = eventHomeTeam.teamId === game.away_team_id && eventAwayTeam.teamId === game.home_team_id;

      if (!normalMatch && !swappedMatch) continue;

      const dk = event.bookmakers?.find((b: any) => b.key === 'draftkings');
      if (!dk) continue;

      const spreadsMarket = dk.markets?.find((m: any) => m.key === 'spreads');
      if (!spreadsMarket) continue;

      // Get spread for CBBD home team
      for (const outcome of spreadsMarket.outcomes) {
        const outcomeTeam = lookupTeam(outcome.name, teamCache);
        if (outcomeTeam?.teamId === game.home_team_id) {
          return { spread: outcome.point, capturedAt: queryTime };
        }
      }
    }
  }

  return null;
}

async function run() {
  console.log('========================================');
  console.log('  Sync DK Opening Spreads');
  console.log('========================================\n');

  // Build team lookup cache
  console.log('Building team lookup cache...');
  teamCache = await buildTeamLookupCache(supabase);
  console.log('');

  // Get games needing open spread sync
  console.log('Fetching games needing open spread sync...');
  const allGames: GameToSync[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('cbb_betting_lines')
      .select(`
        id,
        cbbd_game_id,
        dk_spread_open,
        cbb_games!inner (
          id,
          start_date,
          home_team_name,
          away_team_name,
          home_team_id,
          away_team_id
        )
      `)
      .eq('provider', 'DraftKings')
      .not('execution_timing', 'is', null)
      .is('dk_spread_open', null)
      .order('cbb_games(start_date)')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching games:', error.message);
      return;
    }

    if (batch && batch.length > 0) {
      for (const row of batch) {
        const g = row.cbb_games as any;
        allGames.push({
          id: row.id,
          cbbd_game_id: row.cbbd_game_id,
          start_date: g.start_date,
          home_team_name: g.home_team_name,
          away_team_name: g.away_team_name,
          home_team_id: g.home_team_id,
          away_team_id: g.away_team_id,
        });
      }
      offset += batch.length;
      hasMore = batch.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  stats.total = allGames.length;
  console.log(`Games to sync: ${stats.total}\n`);

  if (allGames.length === 0) {
    console.log('All games already have opening spreads!');
    return;
  }

  // Estimate credits
  const maxCallsPerGame = OPEN_OFFSETS_HOURS.length;
  const estCredits = stats.total * maxCallsPerGame * 10;
  console.log(`Estimated max credits: ${estCredits.toLocaleString()} (${maxCallsPerGame} calls/game max)`);
  console.log('Starting sync...\n');

  // Process games
  const updateBatch: any[] = [];
  let processed = 0;

  async function flushBatch() {
    if (updateBatch.length === 0) return;

    for (const update of updateBatch) {
      const { error } = await supabase
        .from('cbb_betting_lines')
        .update({
          dk_spread_open: update.dk_spread_open,
          dk_spread_open_ts: update.dk_spread_open_ts,
        })
        .eq('id', update.id);

      if (error) {
        console.log(`  Update error: ${error.message}`);
      }
    }
    updateBatch.length = 0;
  }

  for (const game of allGames) {
    processed++;

    if (processed % 100 === 0) {
      console.log(`Progress: ${processed}/${stats.total} (${(processed / stats.total * 100).toFixed(1)}%)`);
      console.log(`  Synced: ${stats.synced}, NoData: ${stats.noData}, API Calls: ${stats.apiCalls}`);
    }

    const result = await findOpenSpread(game);

    if (result) {
      stats.synced++;
      updateBatch.push({
        id: game.id,
        dk_spread_open: result.spread,
        dk_spread_open_ts: result.capturedAt,
      });
    } else {
      stats.noData++;
    }

    if (updateBatch.length >= BATCH_SIZE) {
      await flushBatch();
    }
  }

  // Flush remaining
  await flushBatch();

  // Results
  console.log('\n========================================');
  console.log('  Sync Results');
  console.log('========================================');
  console.log(`Total games: ${stats.total}`);
  console.log(`Synced: ${stats.synced} (${(stats.synced / stats.total * 100).toFixed(1)}%)`);
  console.log(`No data: ${stats.noData}`);
  console.log(`API calls: ${stats.apiCalls}`);
  console.log(`Credits used: ${stats.creditsUsed.toLocaleString()}`);
}

run().catch(console.error);

/**
 * CBB Bet Timing Sync
 *
 * Captures DraftKings spreads at execution timing:
 * - Primary: T-60 minutes before scheduled tip
 * - Fallback: T-30 minutes if T-60 unavailable
 *
 * All modeling and backtests use execution_spread (T-60 preferred, T-30 fallback).
 * Closing line stored separately for CLV diagnostics only.
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
// CONFIGURATION
// ============================================
const SEASON = 2022; // Set season to sync
const BATCH_SIZE = 50;

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

interface SyncStats {
  totalGames: number;
  t60Success: number;
  t30Fallback: number;
  noData: number;
  noDK: number;
  noTeamMatch: number;
}

const stats: SyncStats = {
  totalGames: 0,
  t60Success: 0,
  t30Fallback: 0,
  noData: 0,
  noDK: 0,
  noTeamMatch: 0,
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
        return null;
      }

      if (apiCalls % 100 === 0) {
        const remaining = response.headers.get('x-requests-remaining');
        console.log(`    [API] Calls: ${apiCalls}, Credits: ${creditsUsed}, Remaining: ${remaining}`);
      }

      return response.json();
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return null;
    }
  }
  return null;
}

function getQueryTime(gameDate: Date, minutesBefore: number): string {
  const queryDate = new Date(gameDate.getTime() - minutesBefore * 60 * 1000);
  // Round to nearest 10 minutes
  const mins = Math.floor(queryDate.getMinutes() / 10) * 10;
  queryDate.setMinutes(mins);
  queryDate.setSeconds(0);
  queryDate.setMilliseconds(0);
  return queryDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function findSpreadForGame(
  game: GameToSync,
  oddsData: any,
  teamCache: TeamLookupCache
): Promise<{ spread: number; teamMatched: boolean } | null> {
  if (!oddsData?.data) return null;

  for (const event of oddsData.data) {
    const eventHomeTeam = lookupTeam(event.home_team, teamCache);
    const eventAwayTeam = lookupTeam(event.away_team, teamCache);

    if (!eventHomeTeam || !eventAwayTeam) continue;

    // Check for match (allow home/away swap)
    const normalMatch = eventHomeTeam.teamId === game.home_team_id && eventAwayTeam.teamId === game.away_team_id;
    const swappedMatch = eventHomeTeam.teamId === game.away_team_id && eventAwayTeam.teamId === game.home_team_id;

    if (!normalMatch && !swappedMatch) continue;

    const dk = event.bookmakers?.find((b: any) => b.key === 'draftkings');
    if (!dk) return { spread: 0, teamMatched: true }; // Team matched but no DK

    const spreadsMarket = dk.markets?.find((m: any) => m.key === 'spreads');
    if (!spreadsMarket) return { spread: 0, teamMatched: true };

    // Get spread for CBBD home team
    for (const outcome of spreadsMarket.outcomes) {
      const outcomeTeam = lookupTeam(outcome.name, teamCache);
      if (outcomeTeam?.teamId === game.home_team_id) {
        return { spread: outcome.point, teamMatched: true };
      }
    }

    return { spread: 0, teamMatched: true }; // Matched but couldn't extract spread
  }

  return null; // No match found
}

async function syncGameBetTiming(game: GameToSync): Promise<{
  timing: 't60' | 't30' | null;
  spread: number | null;
  capturedAt: string | null;
}> {
  const gameDate = new Date(game.start_date);

  // Try T-60 first
  const t60Query = getQueryTime(gameDate, 60);
  await new Promise(r => setTimeout(r, 250)); // Rate limit
  const t60Data = await fetchHistoricalOdds(t60Query);

  const t60Result = await findSpreadForGame(game, t60Data, teamCache);
  if (t60Result && t60Result.spread !== 0) {
    return { timing: 't60', spread: t60Result.spread, capturedAt: t60Query };
  }

  // T-60 failed, try T-30 fallback
  const t30Query = getQueryTime(gameDate, 30);
  await new Promise(r => setTimeout(r, 250)); // Rate limit
  const t30Data = await fetchHistoricalOdds(t30Query);

  const t30Result = await findSpreadForGame(game, t30Data, teamCache);
  if (t30Result && t30Result.spread !== 0) {
    return { timing: 't30', spread: t30Result.spread, capturedAt: t30Query };
  }

  // Check why we failed
  if (t60Result?.teamMatched || t30Result?.teamMatched) {
    stats.noDK++;
  } else {
    stats.noTeamMatch++;
  }

  return { timing: null, spread: null, capturedAt: null };
}

async function run() {
  const seasonDates = SEASON_DATES[SEASON];
  if (!seasonDates) {
    console.error(`Unknown season: ${SEASON}`);
    return;
  }

  console.log('========================================');
  console.log(`  CBB Bet Timing Sync: ${SEASON - 1}-${String(SEASON).slice(2)}`);
  console.log(`  T-60 primary, T-30 fallback`);
  console.log('========================================\n');

  // Build team lookup cache
  console.log('Building team lookup cache...');
  teamCache = await buildTeamLookupCache(supabase);
  const cacheStats = getCacheStats(teamCache);
  console.log(`  Total lookups: ${cacheStats.total}\n`);

  // Get games needing bet timing sync (execution_timing IS NULL)
  console.log('Fetching games needing bet timing sync...');
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
        game_id,
        execution_timing,
        cbb_games!inner (
          id,
          start_date,
          home_team_name,
          away_team_name,
          home_team_id,
          away_team_id,
          season
        )
      `)
      .eq('provider', 'DraftKings')
      .eq('cbb_games.season', SEASON)
      .is('execution_timing', null)
      .gte('cbb_games.start_date', seasonDates.start)
      .lte('cbb_games.start_date', seasonDates.end + 'T23:59:59')
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

  stats.totalGames = allGames.length;
  console.log(`Games to sync: ${stats.totalGames}\n`);

  if (allGames.length === 0) {
    console.log('All games already have bet timing!');
    return;
  }

  // Process games
  const updateBatch: any[] = [];
  let processed = 0;

  async function flushBatch() {
    if (updateBatch.length === 0) return;

    for (const update of updateBatch) {
      const { error } = await supabase
        .from('cbb_betting_lines')
        .update({
          spread_t60: update.spread_t60,
          spread_t30: update.spread_t30,
          execution_timing: update.execution_timing,
          captured_at_t60: update.captured_at_t60,
          captured_at_t30: update.captured_at_t30,
        })
        .eq('id', update.id);

      if (error) {
        console.log(`  Update error: ${error.message}`);
      }
    }
    updateBatch.length = 0;
  }

  console.log('Starting bet timing sync...\n');

  for (const game of allGames) {
    processed++;

    if (processed % 100 === 0) {
      console.log(`Progress: ${processed}/${stats.totalGames} (${(processed / stats.totalGames * 100).toFixed(1)}%)`);
      console.log(`  T-60: ${stats.t60Success}, T-30: ${stats.t30Fallback}, NoData: ${stats.noData + stats.noDK + stats.noTeamMatch}`);
    }

    const result = await syncGameBetTiming(game);

    if (result.timing === 't60') {
      stats.t60Success++;
      updateBatch.push({
        id: game.id,
        spread_t60: result.spread,
        spread_t30: null,
        execution_timing: 't60',
        captured_at_t60: result.capturedAt,
        captured_at_t30: null,
      });
    } else if (result.timing === 't30') {
      stats.t30Fallback++;
      updateBatch.push({
        id: game.id,
        spread_t60: null,
        spread_t30: result.spread,
        execution_timing: 't30',
        captured_at_t60: null,
        captured_at_t30: result.capturedAt,
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
  console.log(`Total games: ${stats.totalGames}`);
  console.log(`T-60 success: ${stats.t60Success} (${(stats.t60Success / stats.totalGames * 100).toFixed(1)}%)`);
  console.log(`T-30 fallback: ${stats.t30Fallback} (${(stats.t30Fallback / stats.totalGames * 100).toFixed(1)}%)`);
  console.log(`No data: ${stats.noData}`);
  console.log(`No DK bookmaker: ${stats.noDK}`);
  console.log(`No team match: ${stats.noTeamMatch}`);
  console.log(`\nAPI calls: ${apiCalls}`);
  console.log(`Credits used: ${creditsUsed}`);

  const successRate = ((stats.t60Success + stats.t30Fallback) / stats.totalGames * 100).toFixed(1);
  console.log(`\nExecution spread coverage: ${successRate}%`);
}

run().catch(console.error);

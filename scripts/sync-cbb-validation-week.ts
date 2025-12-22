/**
 * CBB Validation Week Sync
 *
 * Syncs a single week of DraftKings spreads for validation.
 * Uses strict team lookup and validates results immediately.
 *
 * Rigorous validation includes:
 * 1. Sign convention: correlation(-spread, margin) > 0, mean margin split
 * 2. Join verification: game_id and cbbd_game_id consistency
 * 3. Outlier guardrails: warning at |spread| > 40, fail at |spread| > 50
 *
 * Usage: Set START_DATE and END_DATE for the validation window.
 */

import { createClient } from '@supabase/supabase-js';
import {
  buildTeamLookupCache,
  lookupTeam,
  logUnmatchedTeam,
  getCacheStats,
  TeamLookupCache,
} from '../src/lib/cbb/team-lookup';

// Pearson correlation coefficient
function correlation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0 || n !== y.length) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : numerator / denom;
}

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const squaredDiffs = arr.map(x => (x - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ODDS_API_KEY = process.env.ODDS_API_KEY!;
const BASE_URL = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'basketball_ncaab';

// VALIDATION WINDOW - 1 week in Jan 2024
const START_DATE = '2024-01-08'; // Monday
const END_DATE = '2024-01-14';   // Sunday

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

let apiCalls = 0;
let creditsUsed = 0;
let teamCache: TeamLookupCache;

// Coverage tracking
interface CoverageStats {
  scheduledGames: number;
  gamesWithMappings: number;
  gamesWithDKClose: number;
  insertedLines: number;
  skippedReasons: Map<string, number>;
}

const coverage: CoverageStats = {
  scheduledGames: 0,
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

      // Handle 429 rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
        console.log(`  [429] Rate limited. Waiting ${waitSeconds}s (attempt ${attempt}/${maxRetries})...`);

        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, waitSeconds * 1000));
          continue;
        } else {
          console.log(`  [429] Max retries exceeded for ${date}`);
          return null;
        }
      }

      if (!response.ok) {
        if (response.status === 422) return null; // No data for this timestamp
        console.log(`  API Error: ${response.status}`);
        return null;
      }

      const remaining = response.headers.get('x-requests-remaining');
      console.log(`  [API] Credits used: ${creditsUsed}, Remaining: ${remaining}`);

      return response.json();
    } catch (error) {
      console.log(`  Fetch error (attempt ${attempt}/${maxRetries}): ${error}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
        continue;
      }
      return null;
    }
  }

  return null;
}

async function run() {
  console.log('========================================');
  console.log('  CBB Validation Week Sync');
  console.log(`  Window: ${START_DATE} to ${END_DATE}`);
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

  // Get games in validation window
  const { data: games } = await supabase
    .from('cbb_games')
    .select('id, cbbd_game_id, start_date, home_team_name, away_team_name, home_team_id, away_team_id, home_score, away_score')
    .gte('start_date', START_DATE)
    .lte('start_date', END_DATE + 'T23:59:59')
    .eq('status', 'final')
    .order('start_date');

  coverage.scheduledGames = games?.length || 0;
  console.log(`Games in validation window: ${coverage.scheduledGames}\n`);

  if (!games || games.length === 0) {
    console.log('No games found in window.');
    return;
  }

  // Show sample games
  console.log('Sample games:');
  for (const g of games.slice(0, 5)) {
    console.log(`  ${g.start_date.split('T')[0]}: ${g.away_team_name} @ ${g.home_team_name}`);
  }
  console.log('');

  // Group games by query time (15 min before tipoff, rounded to 10 min)
  const gamesByQueryTime = new Map<string, GameToSync[]>();

  for (const game of games) {
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

  // Sync with validation
  let linesCreated = 0;
  let matchedGames = 0;
  let unmatchedGames = 0;
  let skippedNoData = 0;
  const unmatchedTeamNames = new Set<string>();
  const validationSamples: any[] = [];

  // Batch for bulk upsert
  const BATCH_SIZE = 50;
  const lineBatch: any[] = [];

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
    console.log(`  [Batch] Committed ${count} lines`);
    lineBatch.length = 0;
    return count;
  }

  const queryTimes = Array.from(gamesByQueryTime.keys()).sort();

  for (let i = 0; i < queryTimes.length; i++) {
    const queryTime = queryTimes[i];
    const gamesAtTime = gamesByQueryTime.get(queryTime)!;

    if (i > 0) {
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`Fetching ${queryTime}...`);
    const oddsData = await fetchHistoricalOdds(queryTime);

    if (!oddsData || !oddsData.data || oddsData.data.length === 0) {
      skippedNoData += gamesAtTime.length;
      for (const _ of gamesAtTime) {
        trackSkip('no_api_data');
      }
      continue;
    }

    for (const game of gamesAtTime) {
      let matched = false;

      for (const event of oddsData.data) {
        // Strict team lookup
        const homeTeam = lookupTeam(event.home_team, teamCache);
        const awayTeam = lookupTeam(event.away_team, teamCache);

        if (!homeTeam) {
          if (!unmatchedTeamNames.has(event.home_team)) {
            unmatchedTeamNames.add(event.home_team);
            await logUnmatchedTeam(supabase, event.home_team, `validation week`, teamCache);
          }
        }
        if (!awayTeam) {
          if (!unmatchedTeamNames.has(event.away_team)) {
            unmatchedTeamNames.add(event.away_team);
            await logUnmatchedTeam(supabase, event.away_team, `validation week`, teamCache);
          }
        }

        if (!homeTeam || !awayTeam) continue;

        // Verify team IDs match our game
        if (homeTeam.teamId !== game.home_team_id || awayTeam.teamId !== game.away_team_id) {
          continue; // Wrong game
        }

        matched = true;
        matchedGames++;
        coverage.gamesWithMappings++;

        // Find DraftKings bookmaker
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

        // Find home team spread
        let spreadHome: number | null = null;
        for (const outcome of spreadsMarket.outcomes) {
          const outcomeTeam = lookupTeam(outcome.name, teamCache);
          if (outcomeTeam?.teamId === homeTeam.teamId) {
            spreadHome = outcome.point;
            break;
          }
        }

        if (spreadHome === null) {
          trackSkip('no_home_spread');
          continue;
        }

        coverage.gamesWithDKClose++;

        // Validate before inserting
        const homeMargin = game.home_score !== null && game.away_score !== null
          ? game.home_score - game.away_score
          : null;

        // Save sample for validation report
        if (validationSamples.length < 10) {
          validationSamples.push({
            game: `${game.away_team_name} @ ${game.home_team_name}`,
            date: game.start_date.split('T')[0],
            oddsApiHome: event.home_team,
            oddsApiAway: event.away_team,
            spreadHome,
            homeMargin,
            homeFavored: spreadHome < 0,
            homeActuallyWon: homeMargin !== null ? homeMargin > 0 : null,
          });
        }

        // Add to batch for bulk upsert
        lineBatch.push({
          game_id: game.id,
          cbbd_game_id: game.cbbd_game_id,
          provider: 'DraftKings',
          spread_home: spreadHome,
          spread_open: spreadHome,
        });

        // Flush batch when it reaches BATCH_SIZE
        if (lineBatch.length >= BATCH_SIZE) {
          linesCreated += await flushBatch();
        }

        break;
      }

      if (!matched) {
        unmatchedGames++;
        trackSkip('no_team_match');
      }
    }
  }

  // Flush any remaining lines
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
  console.log(`\nMatching:`);
  console.log(`  Matched games: ${matchedGames}`);
  console.log(`  Unmatched games: ${unmatchedGames}`);
  console.log(`  Skipped (no API data): ${skippedNoData}`);
  console.log(`  Lines created: ${linesCreated}`);
  console.log(`  Unmatched team names: ${unmatchedTeamNames.size}`);

  if (unmatchedTeamNames.size > 0) {
    console.log('\nUnmatched teams:');
    for (const name of unmatchedTeamNames) {
      console.log(`  - ${name}`);
    }
  }

  // Coverage Dashboard
  console.log('\n========================================');
  console.log('  Coverage Dashboard');
  console.log('========================================');
  console.log(`Scheduled games:      ${coverage.scheduledGames}`);
  console.log(`Games with mappings:  ${coverage.gamesWithMappings}`);
  console.log(`Games with DK close:  ${coverage.gamesWithDKClose}`);
  console.log(`Inserted lines:       ${coverage.insertedLines}`);
  console.log(`\nSkipped by reason:`);
  for (const [reason, count] of coverage.skippedReasons) {
    console.log(`  ${reason}: ${count}`);
  }

  // =========================================
  // RIGOROUS POST-SYNC VALIDATION
  // =========================================
  console.log('\n========================================');
  console.log('  Rigorous Post-Sync Validation');
  console.log('========================================\n');

  // Fetch all newly synced lines for validation
  const { data: syncedLines } = await supabase
    .from('cbb_betting_lines')
    .select(`
      id,
      cbbd_game_id,
      game_id,
      spread_home,
      provider,
      cbb_games!inner(
        id,
        cbbd_game_id,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        status
      )
    `)
    .eq('provider', 'DraftKings')
    .not('spread_home', 'is', null)
    .gte('cbb_games.start_date', START_DATE)
    .lte('cbb_games.start_date', END_DATE + 'T23:59:59');

  if (!syncedLines || syncedLines.length === 0) {
    console.log('No lines to validate.\n');
    return;
  }

  console.log(`Lines to validate: ${syncedLines.length}\n`);

  // Filter to completed games
  const completedGames = syncedLines.filter(d => {
    const game = (d as any).cbb_games;
    return game.status === 'final' && game.home_score !== null && game.away_score !== null;
  });

  console.log(`Completed games: ${completedGames.length}\n`);

  // =========================================
  // TEST 1: Sign Convention (Deterministic)
  // =========================================
  console.log('1. Sign Convention Validation...');

  const spreads: number[] = [];
  const margins: number[] = [];
  const homeFavoredMargins: number[] = [];
  const homeUnderdogMargins: number[] = [];

  for (const line of completedGames) {
    const game = (line as any).cbb_games;
    const spreadHome = line.spread_home;
    const margin = game.home_score - game.away_score;

    spreads.push(-spreadHome); // Negative because spread_home < 0 means home favored
    margins.push(margin);

    if (spreadHome < 0) {
      homeFavoredMargins.push(margin);
    } else if (spreadHome > 0) {
      homeUnderdogMargins.push(margin);
    }
  }

  const corr = correlation(spreads, margins);
  const meanHomeFavored = homeFavoredMargins.length > 0
    ? homeFavoredMargins.reduce((a, b) => a + b, 0) / homeFavoredMargins.length
    : 0;
  const meanHomeUnderdog = homeUnderdogMargins.length > 0
    ? homeUnderdogMargins.reduce((a, b) => a + b, 0) / homeUnderdogMargins.length
    : 0;

  const signConventionPassed = corr > 0 && meanHomeFavored > meanHomeUnderdog;

  console.log(`   Correlation(-spread, margin): ${corr.toFixed(3)} ${corr > 0 ? '✓' : '✗'}`);
  console.log(`   Mean margin (home favored): ${meanHomeFavored.toFixed(1)} (n=${homeFavoredMargins.length})`);
  console.log(`   Mean margin (home underdog): ${meanHomeUnderdog.toFixed(1)} (n=${homeUnderdogMargins.length})`);
  console.log(`   Margin difference: ${(meanHomeFavored - meanHomeUnderdog).toFixed(1)} ${meanHomeFavored > meanHomeUnderdog ? '✓' : '✗'}`);
  console.log(`   ${signConventionPassed ? '✓ PASS' : '✗ FAIL'}: Sign convention\n`);

  // =========================================
  // TEST 2: Join Verification
  // =========================================
  console.log('2. Join Verification...');

  let gameIdMismatches = 0;
  let cbbdIdMismatches = 0;

  for (const line of syncedLines) {
    const game = (line as any).cbb_games;
    if (line.game_id !== game.id) {
      gameIdMismatches++;
    }
    if (line.cbbd_game_id !== game.cbbd_game_id) {
      cbbdIdMismatches++;
    }
  }

  console.log(`   Game ID mismatches: ${gameIdMismatches} ${gameIdMismatches === 0 ? '✓' : '✗'}`);
  console.log(`   CBBD ID mismatches: ${cbbdIdMismatches} ${cbbdIdMismatches === 0 ? '✓' : '✗'}`);
  const joinsPassed = gameIdMismatches === 0 && cbbdIdMismatches === 0;
  console.log(`   ${joinsPassed ? '✓ PASS' : '✗ FAIL'}: Join verification\n`);

  // =========================================
  // TEST 3: Outlier Guardrails
  // =========================================
  console.log('3. Outlier Check...');

  const SPREAD_WARNING_LIMIT = 40;
  const SPREAD_HARD_LIMIT = 50;
  const warnings: any[] = [];
  const hardOutliers: any[] = [];

  for (const line of syncedLines) {
    const absSpread = Math.abs(line.spread_home);
    const game = (line as any).cbb_games;
    if (absSpread > SPREAD_HARD_LIMIT) {
      hardOutliers.push({
        game: `${game.away_team_name} @ ${game.home_team_name}`,
        spread: line.spread_home,
      });
    } else if (absSpread > SPREAD_WARNING_LIMIT) {
      warnings.push({
        game: `${game.away_team_name} @ ${game.home_team_name}`,
        spread: line.spread_home,
      });
    }
  }

  console.log(`   Hard outliers (|spread| > ${SPREAD_HARD_LIMIT}): ${hardOutliers.length} ${hardOutliers.length === 0 ? '✓' : '✗'}`);
  if (hardOutliers.length > 0) {
    for (const o of hardOutliers.slice(0, 3)) {
      console.log(`     ${o.game}: ${o.spread}`);
    }
  }
  console.log(`   Warnings (${SPREAD_WARNING_LIMIT} < |spread| <= ${SPREAD_HARD_LIMIT}): ${warnings.length}`);
  if (warnings.length > 0) {
    for (const w of warnings.slice(0, 3)) {
      console.log(`     ${w.game}: ${w.spread}`);
    }
  }
  const outliersPassed = hardOutliers.length === 0;
  console.log(`   ${outliersPassed ? '✓ PASS' : '✗ FAIL'}: Outlier guardrails\n`);

  // =========================================
  // TEST 4: No Duplicates
  // =========================================
  console.log('4. Duplicate Check...');

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const line of syncedLines) {
    const key = `${line.cbbd_game_id}-${line.provider}`;
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.add(key);
  }

  console.log(`   Duplicates: ${duplicates.length} ${duplicates.length === 0 ? '✓' : '✗'}`);
  const dupsPassed = duplicates.length === 0;
  console.log(`   ${dupsPassed ? '✓ PASS' : '✗ FAIL'}: No duplicates\n`);

  // =========================================
  // Sample Output
  // =========================================
  console.log('========================================');
  console.log('  Sample Games (first 5)');
  console.log('========================================\n');

  for (const s of validationSamples.slice(0, 5)) {
    console.log(`${s.date}: ${s.game}`);
    console.log(`  Odds API: ${s.oddsApiAway} @ ${s.oddsApiHome}`);
    console.log(`  Spread: Home ${s.spreadHome > 0 ? '+' : ''}${s.spreadHome} ${s.homeFavored ? '(favored)' : '(underdog)'}`);
    if (s.homeMargin !== null) {
      console.log(`  Result: Home ${s.homeMargin > 0 ? 'won' : 'lost'} by ${Math.abs(s.homeMargin)}`);
    }
    console.log('');
  }

  // =========================================
  // Summary Statistics
  // =========================================
  if (completedGames.length > 0) {
    console.log('========================================');
    console.log('  Summary Statistics');
    console.log('========================================');
    console.log(`Correlation(-spread, margin): ${corr.toFixed(4)}`);
    console.log(`Home favored games: ${homeFavoredMargins.length}`);
    console.log(`  Mean margin: ${meanHomeFavored.toFixed(2)}`);
    console.log(`  Std dev: ${stdDev(homeFavoredMargins).toFixed(2)}`);
    console.log(`Home underdog games: ${homeUnderdogMargins.length}`);
    console.log(`  Mean margin: ${meanHomeUnderdog.toFixed(2)}`);
    console.log(`  Std dev: ${stdDev(homeUnderdogMargins).toFixed(2)}`);
    console.log('');
  }

  // =========================================
  // Final Result
  // =========================================
  const allPassed = signConventionPassed && joinsPassed && outliersPassed && dupsPassed;

  console.log('========================================');
  console.log(allPassed ? '  ALL VALIDATION TESTS PASSED' : '  SOME VALIDATION TESTS FAILED');
  console.log('========================================');

  if (!allPassed) {
    console.log('\nFailed tests:');
    if (!signConventionPassed) console.log('  - Sign convention');
    if (!joinsPassed) console.log('  - Join verification');
    if (!outliersPassed) console.log('  - Outlier guardrails');
    if (!dupsPassed) console.log('  - No duplicates');
  }
}

run().catch(console.error);

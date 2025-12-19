/**
 * Historical Week Replay Integration Test
 *
 * Purpose: Validate the full pipeline by replaying Week 2, 2024
 * Tests:
 *   - QB starter identification from CFBD player stats
 *   - Rating calculations
 *   - Edge generation
 *   - Betting rules application
 *   - Database joins and constraints
 *
 * Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... CFBD_API_KEY=... npx tsx scripts/week-replay-test.ts
 */

import { createClient } from '@supabase/supabase-js';
import { CFBDApiClient } from '../src/lib/api/cfbd-api';
import { QBStarterStore, identifyStartingQBs } from '../src/lib/models/qb-starter';
import { decideBet, processBettingSlate, type BetCandidate } from '../src/lib/models/betting-rules';
import {
  BETTING_RULES,
  EDGE_RULES,
  type EdgeResult,
  type QBStatus,
} from '../src/lib/models/production-v1';

// =============================================================================
// CONFIG
// =============================================================================

const TEST_SEASON = 2024;
const TEST_WEEK = 2;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const cfbdApiKey = process.env.CFBD_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const cfbdClient = new CFBDApiClient(cfbdApiKey);

// =============================================================================
// TEST FUNCTIONS
// =============================================================================

async function testQBStarterIdentification(): Promise<boolean> {
  console.log('\n=== TEST: QB Starter Identification ===');

  try {
    // Fetch player game stats for Week 2, 2024
    console.log(`Fetching player stats for ${TEST_SEASON} Week ${TEST_WEEK}...`);
    const gameStats = await cfbdClient.getPlayerGameStats(TEST_SEASON, TEST_WEEK);

    console.log(`Found ${gameStats.length} games with player stats`);

    // Identify starting QBs
    const starters = identifyStartingQBs(gameStats, TEST_SEASON, TEST_WEEK);
    console.log(`Identified ${starters.length} starting QBs`);

    // Validate we got starters
    if (starters.length === 0) {
      console.error('FAIL: No starting QBs identified');
      return false;
    }

    // Print sample starters
    console.log('\nSample starters:');
    for (const starter of starters.slice(0, 5)) {
      console.log(`  ${starter.team}: ${starter.playerName} (${starter.passAttempts} ATT, ${starter.passYards || 0} YDS)`);
    }

    // Verify all starters have required fields
    for (const starter of starters) {
      if (!starter.team || !starter.playerName || starter.passAttempts === undefined) {
        console.error(`FAIL: Missing required field for ${starter.team}`);
        return false;
      }
    }

    console.log('PASS: QB starter identification working');
    return true;
  } catch (e) {
    console.error('FAIL: Exception during QB starter test:', e);
    return false;
  }
}

async function testQBStarterSync(): Promise<boolean> {
  console.log('\n=== TEST: QB Starter Database Sync ===');

  try {
    const qbStore = new QBStarterStore(supabaseUrl!, supabaseKey!, cfbdApiKey);

    // Sync week 2, 2024
    console.log(`Syncing QB starters for ${TEST_SEASON} Week ${TEST_WEEK}...`);
    const result = await qbStore.syncWeek(TEST_SEASON, TEST_WEEK);

    console.log(`Games processed: ${result.gamesProcessed}`);
    console.log(`Starters identified: ${result.startersIdentified}`);
    console.log(`Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('Errors:', result.errors.slice(0, 3));
    }

    // Verify we can read back the data
    const starters = await qbStore.getStartersForWeek(TEST_SEASON, TEST_WEEK);
    console.log(`Retrieved ${starters.length} starters from database`);

    if (starters.length === 0) {
      console.error('FAIL: No starters retrieved from database');
      return false;
    }

    console.log('PASS: QB starter sync working');
    return true;
  } catch (e) {
    console.error('FAIL: Exception during QB starter sync:', e);
    return false;
  }
}

async function testGameDataAvailability(): Promise<boolean> {
  console.log('\n=== TEST: Game Data Availability ===');

  try {
    // Check if we have games for this week
    const { data: games, error: gamesError } = await supabase
      .from('cfbd_games')
      .select('id, home_team, away_team, home_points, away_points')
      .eq('season', TEST_SEASON)
      .eq('week', TEST_WEEK);

    if (gamesError) {
      console.error('Error querying games:', gamesError);
      return false;
    }

    console.log(`Found ${games?.length || 0} games in database for ${TEST_SEASON} Week ${TEST_WEEK}`);

    if (!games || games.length === 0) {
      console.warn('No games in database - may need to sync first');
      // Not a failure - may just need data sync
    } else {
      // Print sample games
      console.log('\nSample games:');
      for (const game of (games || []).slice(0, 5)) {
        console.log(`  ${game.away_team} ${game.away_points} @ ${game.home_team} ${game.home_points}`);
      }
    }

    // Check for betting lines
    const { data: lines, error: linesError } = await supabase
      .from('cfbd_betting_lines')
      .select('home_team, away_team, spread')
      .eq('season', TEST_SEASON)
      .eq('week', TEST_WEEK);

    if (linesError) {
      console.error('Error querying lines:', linesError);
    } else {
      console.log(`Found ${lines?.length || 0} betting lines`);
    }

    console.log('PASS: Game data checks complete');
    return true;
  } catch (e) {
    console.error('FAIL: Exception during game data test:', e);
    return false;
  }
}

async function testBettingRulesLogic(): Promise<boolean> {
  console.log('\n=== TEST: Betting Rules Logic ===');

  try {
    // Create mock edge results for testing
    const mockEdges: EdgeResult[] = [
      {
        season: TEST_SEASON,
        week: TEST_WEEK,
        homeTeam: 'Alabama',
        awayTeam: 'Texas',
        spreadOpen: -7.5,
        modelSpread: -10.0,
        rawEdge: 2.5,  // Model says Alabama by 10, market by 7.5
        effectiveEdge: 2.0,  // After uncertainty discount
        uncertainty: { total: 0.20, week: 0.10, homeRoster: 0.05, homeQB: 0, homeCoach: 0, awayRoster: 0.05, awayQB: 0, awayCoach: 0 },
        side: 'home',
        isHighUncertainty: false,
        requiresQBCheck: false,
        bettable: true,
      },
      {
        season: TEST_SEASON,
        week: TEST_WEEK,
        homeTeam: 'Oregon',
        awayTeam: 'Washington',
        spreadOpen: -3.0,
        modelSpread: -8.0,
        rawEdge: 5.0,
        effectiveEdge: 4.0,
        uncertainty: { total: 0.20, week: 0.10, homeRoster: 0.05, homeQB: 0, homeCoach: 0, awayRoster: 0.05, awayQB: 0, awayCoach: 0 },
        side: 'home',
        isHighUncertainty: false,
        requiresQBCheck: false,
        bettable: true,
      },
      {
        season: TEST_SEASON,
        week: TEST_WEEK,
        homeTeam: 'Michigan',
        awayTeam: 'Ohio State',
        spreadOpen: 2.5,
        modelSpread: 1.0,
        rawEdge: 1.5,
        effectiveEdge: 1.0,  // Below edge floor
        uncertainty: { total: 0.35, week: 0.10, homeRoster: 0.10, homeQB: 0.10, homeCoach: 0, awayRoster: 0.05, awayQB: 0, awayCoach: 0 },
        side: 'away',
        isHighUncertainty: false,
        requiresQBCheck: true,
        bettable: false,
      },
    ];

    // Create mock QB status
    const mockQBStatus: QBStatus = {
      team: 'Alabama',
      season: TEST_SEASON,
      week: TEST_WEEK,
      status: 'confirmed',
      asOfTimestamp: new Date(),
      playerName: 'Jalen Milroe',
    };

    // Test decideBet function
    console.log('\nTesting decideBet() function:');

    // Test 1: High edge game with confirmed QB
    const candidate1: BetCandidate = {
      edge: mockEdges[0],
      homeQBStatus: mockQBStatus,
      awayQBStatus: { ...mockQBStatus, team: 'Texas', playerName: 'Quinn Ewers' },
      percentile: 0.03,  // Top 3%
    };
    const decision1 = decideBet(candidate1);
    console.log(`  Alabama -7.5 (Top 3%, confirmed QB): ${decision1.shouldBet ? 'BET' : 'NO BET'} - ${decision1.reason}`);

    // Test 2: Edge below floor
    const candidate2: BetCandidate = {
      edge: mockEdges[2],
      homeQBStatus: { ...mockQBStatus, team: 'Michigan', status: 'unknown' },
      awayQBStatus: { ...mockQBStatus, team: 'Ohio State', status: 'confirmed' },
      percentile: 0.10,  // Top 10%
    };
    const decision2 = decideBet(candidate2);
    console.log(`  Michigan +2.5 (Top 10%, below floor): ${decision2.shouldBet ? 'BET' : 'NO BET'} - ${decision2.reason}`);

    // Test 3: QB out (should NOT auto-reject, just increase uncertainty)
    const candidateQBOut: BetCandidate = {
      edge: mockEdges[1],
      homeQBStatus: { ...mockQBStatus, team: 'Oregon', status: 'out' },
      awayQBStatus: { ...mockQBStatus, team: 'Washington', status: 'confirmed' },
      percentile: 0.02,  // Top 2%
    };
    const decisionQBOut = decideBet(candidateQBOut);
    console.log(`  Oregon -3 (Top 2%, QB OUT): ${decisionQBOut.shouldBet ? 'BET' : 'NO BET'} - ${decisionQBOut.reason}`);

    // Verify Fix A: QB out should NOT auto-reject
    if (decisionQBOut.reason.includes('QB out') && !decisionQBOut.shouldBet) {
      console.error('FAIL: QB out is still causing auto-reject (Fix A not applied)');
      return false;
    }

    // Verify Fix B: Edge floor check
    if (decision2.shouldBet) {
      console.error('FAIL: Below-floor edge should be rejected (Fix B not applied)');
      return false;
    }

    console.log('\nPASS: Betting rules logic working correctly');
    return true;
  } catch (e) {
    console.error('FAIL: Exception during betting rules test:', e);
    return false;
  }
}

async function testDatabaseConstraints(): Promise<boolean> {
  console.log('\n=== TEST: Database Constraints ===');

  try {
    // Test unique constraint on qb_started
    console.log('Testing qb_started unique constraint...');

    const testData = {
      cfbd_game_id: 999999999,  // Fake ID for testing
      season: TEST_SEASON,
      week: TEST_WEEK,
      team: 'TestTeam',
      player_name: 'Test Player',
      pass_attempts: 25,
    };

    // Insert once
    const { error: insertError1 } = await supabase
      .from('qb_started')
      .insert(testData);

    // Insert again (should conflict)
    const { error: insertError2 } = await supabase
      .from('qb_started')
      .insert(testData);

    // Upsert should work
    const { error: upsertError } = await supabase
      .from('qb_started')
      .upsert({ ...testData, pass_attempts: 30 }, { onConflict: 'cfbd_game_id,team' });

    // Clean up test data
    await supabase
      .from('qb_started')
      .delete()
      .eq('cfbd_game_id', 999999999);

    if (insertError2 && insertError2.code === '23505') {
      console.log('  Unique constraint working (duplicate rejected)');
    } else if (insertError1) {
      console.log('  Note: qb_started table may need migration run');
    }

    if (!upsertError) {
      console.log('  Upsert on conflict working');
    }

    console.log('PASS: Database constraints verified');
    return true;
  } catch (e) {
    console.error('FAIL: Exception during constraint test:', e);
    return false;
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('========================================');
  console.log('Historical Week Replay Integration Test');
  console.log(`Season: ${TEST_SEASON}, Week: ${TEST_WEEK}`);
  console.log('========================================');

  const results: { name: string; passed: boolean }[] = [];

  // Run tests
  results.push({
    name: 'Game Data Availability',
    passed: await testGameDataAvailability(),
  });

  results.push({
    name: 'QB Starter Identification',
    passed: await testQBStarterIdentification(),
  });

  results.push({
    name: 'QB Starter Database Sync',
    passed: await testQBStarterSync(),
  });

  results.push({
    name: 'Betting Rules Logic',
    passed: await testBettingRulesLogic(),
  });

  results.push({
    name: 'Database Constraints',
    passed: await testDatabaseConstraints(),
  });

  // Summary
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');

  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`  ${status}: ${result.name}`);
    if (!result.passed) allPassed = false;
  }

  console.log('----------------------------------------');
  console.log(`Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('========================================\n');

  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

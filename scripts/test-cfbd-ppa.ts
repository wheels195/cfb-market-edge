/**
 * Test CFBD Game PPA API to see how much data we get
 */
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const cfbd = getCFBDApiClient();

async function main() {
  console.log('Testing CFBD Game PPA endpoint...\n');

  // Test 1: Get all games for a season (no week filter)
  console.log('Test 1: Season 2024 (no week filter)');
  try {
    const allGames = await cfbd.getGamePPA(2024);
    console.log(`  Got ${allGames.length} games`);
    if (allGames.length > 0) {
      console.log(`  Sample: ${allGames[0].team} vs ${allGames[0].opponent}`);
    }
  } catch (err) {
    console.log(`  Error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  // Test 2: Get games for a specific week
  console.log('\nTest 2: Season 2024, Week 1');
  try {
    const week1Games = await cfbd.getGamePPA(2024, 1);
    console.log(`  Got ${week1Games.length} games`);
  } catch (err) {
    console.log(`  Error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  // Test 3: Get games for a specific team
  console.log('\nTest 3: Season 2024, Team = Ohio State');
  try {
    const osuGames = await cfbd.getGamePPA(2024, undefined, 'Ohio State');
    console.log(`  Got ${osuGames.length} games`);
    for (const game of osuGames.slice(0, 5)) {
      console.log(`    Week ${game.week || '?'}: ${game.team} vs ${game.opponent} - Off: ${game.offense?.overall?.toFixed(3)}, Def: ${game.defense?.overall?.toFixed(3)}`);
    }
  } catch (err) {
    console.log(`  Error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  // Test 4: Get all regular season games
  console.log('\nTest 4: Season 2024, Regular Season (no week)');
  try {
    const regularGames = await cfbd.getGamePPA(2024, undefined, undefined, 'regular');
    console.log(`  Got ${regularGames.length} games`);
  } catch (err) {
    console.log(`  Error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  // Test 5: Check games endpoint for total game count
  console.log('\nTest 5: Total games via /games endpoint for 2024');
  try {
    const allSeasonGames = await cfbd.getGames(2024);
    console.log(`  Got ${allSeasonGames.length} total games in 2024`);
    const fbsGames = allSeasonGames.filter(g =>
      g.homeConference && g.awayConference
    );
    console.log(`  FBS vs FBS games: ${fbsGames.length}`);
  } catch (err) {
    console.log(`  Error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }
}

main().catch(console.error);

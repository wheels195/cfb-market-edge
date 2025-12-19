/**
 * Test CFBD SP+ endpoint
 */
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

async function main() {
  const client = getCFBDApiClient();

  console.log('Testing SP+ ratings endpoint...');

  try {
    const spRatings = await client.getSPRatings(2024);
    console.log(`Got ${spRatings.length} SP+ ratings for 2024`);
    console.log('\nTop 10 by SP+:');

    const sorted = spRatings
      .filter(r => r.spOverall !== null)
      .sort((a, b) => (b.spOverall || 0) - (a.spOverall || 0))
      .slice(0, 10);

    for (const team of sorted) {
      console.log(`  ${team.team}: ${team.spOverall?.toFixed(1)} (Off: ${team.spOffense?.toFixed(1)}, Def: ${team.spDefense?.toFixed(1)})`);
    }
  } catch (err) {
    console.log('Error fetching SP+:', err instanceof Error ? err.message : err);
  }

  console.log('\nTesting team ratings endpoint...');
  try {
    const ratings = await client.getTeamRatings(2024);
    console.log(`Got ${ratings.length} team ratings for 2024`);
  } catch (err) {
    console.log('Error fetching ratings:', err instanceof Error ? err.message : err);
  }
}

main();

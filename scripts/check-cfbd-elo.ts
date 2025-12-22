/**
 * Check what CFBD API returns for 2025 Elo ratings
 */

import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const cfbd = getCFBDApiClient();

async function main() {
  console.log('=== Checking CFBD API for 2025 Elo Data ===\n');

  // Check each week
  for (const week of [0, 1, 5, 10, 13, 14, 15, 16]) {
    try {
      const eloData = await cfbd.getEloRatings(2025, undefined, week);
      console.log(`Week ${week}: ${eloData.length} teams`);

      if (eloData.length > 0 && week >= 13) {
        // Show sample for late weeks
        const sample = eloData.slice(0, 3);
        for (const e of sample) {
          console.log(`  ${e.team}: ${e.elo}`);
        }
      }
    } catch (err) {
      console.log(`Week ${week}: ERROR - ${err}`);
    }
  }

  // Also check specific team progression
  console.log('\n=== Ohio State Elo by Week (from CFBD) ===');
  for (const week of [0, 5, 10, 13, 14, 15]) {
    try {
      const eloData = await cfbd.getEloRatings(2025, 'Ohio State', week);
      if (eloData.length > 0) {
        console.log(`Week ${week}: ${eloData[0].elo}`);
      }
    } catch (err) {
      console.log(`Week ${week}: N/A`);
    }
  }
}

main().catch(console.error);

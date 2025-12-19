/**
 * Run advanced stats sync from CFBD
 */

import { syncAdvancedStats } from '../src/lib/jobs/sync-advanced-stats';

async function main() {
  console.log('=== SYNCING ADVANCED STATS FROM CFBD ===\n');

  const result = await syncAdvancedStats(2024);

  console.log(`\nSuccess: ${result.success}`);
  console.log(`Teams updated: ${result.teamsUpdated}`);

  if (result.errors.length > 0) {
    console.log(`\nErrors:`);
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }
}

main().catch(console.error);

/**
 * Test pace adjustment calculation
 */

import { getPaceAdjustment } from '../src/lib/jobs/sync-advanced-stats';

async function main() {
  // Oklahoma home team ID: 123a4056-3b26-4e23-a053-3d3ca673703a
  // Alabama away team ID: 680661f6-7e62-447c-be1b-dfb7201d2645
  const homeTeamId = '123a4056-3b26-4e23-a053-3d3ca673703a';
  const awayTeamId = '680661f6-7e62-447c-be1b-dfb7201d2645';

  console.log('Testing getPaceAdjustment for Oklahoma vs Alabama...');

  try {
    const paceAdj = await getPaceAdjustment(homeTeamId, awayTeamId, 2024);
    console.log('\nPace Adjustment Result:');
    console.log(JSON.stringify(paceAdj, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

main();

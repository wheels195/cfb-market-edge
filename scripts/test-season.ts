/**
 * Test what season is being used
 */

import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

async function main() {
  const cfbd = getCFBDApiClient();
  const currentSeason = cfbd.getCurrentSeason();
  console.log('Current season from CFBD client:', currentSeason);
}

main();

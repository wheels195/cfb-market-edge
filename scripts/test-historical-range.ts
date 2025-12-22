/**
 * Test what date range is available for NCAAF historical odds
 */

const ODDS_API_KEY = 'e035a3d861365e045027dc00c240c941';

async function testDate(date: string): Promise<boolean> {
  const url = `https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds?` +
    `apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&oddsFormat=american&date=${date}`;

  const response = await fetch(url);
  console.log(`${date}: ${response.status} (${response.headers.get('x-requests-remaining')} remaining)`);
  return response.ok;
}

async function main() {
  console.log('Testing NCAAF historical data availability...\n');

  // Test various dates
  const testDates = [
    '2022-08-27T16:00:00Z', // Week 0, 2022
    '2022-09-03T16:00:00Z', // Week 1, 2022
    '2022-10-01T16:00:00Z', // Oct 2022
    '2023-01-09T20:00:00Z', // CFP Championship 2023
    '2023-08-26T16:00:00Z', // Week 0, 2023
    '2023-09-02T16:00:00Z', // Week 1, 2023
    '2023-10-07T16:00:00Z', // Oct 2023
    '2024-01-08T20:00:00Z', // CFP Championship 2024
    '2024-08-24T16:00:00Z', // Week 0, 2024
    '2024-09-07T16:00:00Z', // Week 1, 2024
    '2024-10-05T16:00:00Z', // Oct 2024
  ];

  for (const date of testDates) {
    await testDate(date);
    await new Promise(r => setTimeout(r, 500));
  }
}

main().catch(console.error);

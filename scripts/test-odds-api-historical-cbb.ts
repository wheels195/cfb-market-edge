/**
 * Test The Odds API Historical endpoint for CBB
 * Check what historical data is available and estimate sync costs
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'basketball_ncaab';

interface HistoricalOddsResponse {
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
  data: Array<{
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Array<{
      key: string;
      title: string;
      last_update: string;
      markets: Array<{
        key: string;
        last_update: string;
        outcomes: Array<{
          name: string;
          price: number;
          point?: number;
        }>;
      }>;
    }>;
  }>;
}

async function testHistoricalEndpoint() {
  console.log('========================================');
  console.log('  The Odds API - Historical CBB Test');
  console.log('========================================\n');

  if (!ODDS_API_KEY) {
    console.error('ODDS_API_KEY not set');
    process.exit(1);
  }

  // Test dates from different periods
  const testDates = [
    '2024-03-15T18:00:00Z', // March Madness 2024
    '2024-01-15T20:00:00Z', // Regular season 2024
    '2023-03-17T18:00:00Z', // March Madness 2023
    '2023-01-10T20:00:00Z', // Regular season 2023
    '2022-03-18T18:00:00Z', // March Madness 2022
    '2022-01-15T20:00:00Z', // Regular season 2022
  ];

  for (const testDate of testDates) {
    console.log(`\n--- Testing ${testDate} ---`);

    try {
      const url = new URL(`${BASE_URL}/historical/sports/${SPORT_KEY}/odds`);
      url.searchParams.set('apiKey', ODDS_API_KEY);
      url.searchParams.set('regions', 'us');
      url.searchParams.set('markets', 'spreads');
      url.searchParams.set('oddsFormat', 'american');
      url.searchParams.set('bookmakers', 'draftkings');
      url.searchParams.set('date', testDate);

      const response = await fetch(url.toString());

      const remaining = response.headers.get('x-requests-remaining');
      const used = response.headers.get('x-requests-used');
      console.log(`API Quota: ${used} used, ${remaining} remaining`);

      if (!response.ok) {
        console.log(`HTTP ${response.status}: ${response.statusText}`);
        const text = await response.text();
        console.log(`Response: ${text.substring(0, 200)}`);
        continue;
      }

      const data: HistoricalOddsResponse = await response.json();

      console.log(`Timestamp: ${data.timestamp}`);
      console.log(`Previous: ${data.previous_timestamp}`);
      console.log(`Next: ${data.next_timestamp}`);
      console.log(`Events found: ${data.data.length}`);

      if (data.data.length > 0) {
        // Show first few events
        console.log('\nSample events:');
        for (const event of data.data.slice(0, 3)) {
          console.log(`  ${event.away_team} @ ${event.home_team} (${event.commence_time})`);

          const dk = event.bookmakers.find(b => b.key === 'draftkings');
          if (dk) {
            const spreads = dk.markets.find(m => m.key === 'spreads');
            if (spreads) {
              const homeSpread = spreads.outcomes.find(o => o.name === event.home_team);
              console.log(`    DK Spread: ${event.home_team} ${homeSpread?.point}`);
            }
          }
        }
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      console.log(`Error: ${error}`);
    }
  }

  console.log('\n========================================');
  console.log('  Cost Estimation');
  console.log('========================================');
  console.log(`
Historical API costs 10 credits per region per market.
With spreads + totals (2 markets) in US region:
  - Per snapshot: 20 credits
  - Per game day: ~2-3 snapshots (open, midday, close) = 40-60 credits

For 3 seasons (2022-2024):
  - ~120 game days per season
  - 360 total days
  - ~14,400 - 21,600 credits needed

Your $30/month plan likely has ~10,000 credits.

Recommendation: Use CBBD's ESPN BET closing lines for backtest training.
They're highly correlated with DraftKings (within 0.5 pts usually).
Use DraftKings live data for production betting.
  `);
}

testHistoricalEndpoint().catch(console.error);

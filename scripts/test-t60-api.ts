/**
 * Quick test of Historical Odds API for T-60 sync
 */

const ODDS_API_KEY = 'e035a3d861365e045027dc00c240c941';

async function main() {
  // Test with a known date during 2024 CFB season
  // Oct 5, 2024 at noon (lots of games)
  const testDate = '2024-10-05T16:00:00Z';

  console.log(`Testing Historical Odds API for: ${testDate}`);

  const url = `https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds?` +
    `apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&oddsFormat=american&date=${testDate}`;

  console.log(`\nURL: ${url.replace(ODDS_API_KEY, 'HIDDEN')}\n`);

  const response = await fetch(url);

  console.log(`Status: ${response.status}`);
  console.log(`Remaining: ${response.headers.get('x-requests-remaining')}`);

  if (!response.ok) {
    const text = await response.text();
    console.error('Error:', text);
    return;
  }

  const json = await response.json();

  // The response structure might be { data: [...], timestamp: ... }
  const data = json.data || json;

  console.log(`\nGames found: ${Array.isArray(data) ? data.length : 'N/A'}`);

  if (Array.isArray(data) && data.length > 0) {
    console.log('\nSample game:');
    const game = data[0];
    console.log(`  ${game.away_team} @ ${game.home_team}`);
    console.log(`  Commence: ${game.commence_time}`);
    console.log(`  Bookmakers: ${game.bookmakers?.length || 0}`);

    // Find DraftKings
    const dk = game.bookmakers?.find((b: any) => b.key === 'draftkings');
    if (dk) {
      console.log(`\n  DraftKings spreads:`);
      const spreads = dk.markets?.find((m: any) => m.key === 'spreads');
      if (spreads) {
        for (const outcome of spreads.outcomes || []) {
          console.log(`    ${outcome.name}: ${outcome.point} (${outcome.price})`);
        }
      }
    }
  }

  console.log('\n=== Raw response (first 2000 chars) ===');
  console.log(JSON.stringify(json, null, 2).substring(0, 2000));
}

main().catch(console.error);

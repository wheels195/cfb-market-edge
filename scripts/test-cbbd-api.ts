/**
 * Test the College Basketball Data API (CBBD)
 * Uses the same API key as CFBD
 */

const CBBD_BASE_URL = 'https://api.collegebasketballdata.com';
const API_KEY = process.env.CFBD_API_KEY;

if (!API_KEY) {
  console.error('CFBD_API_KEY is required');
  process.exit(1);
}

async function fetchCBBD<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${CBBD_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  console.log(`Fetching: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CBBD API error: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.json();
}

async function testAPI() {
  console.log('=== Testing CBBD API ===\n');

  // Test 1: Get teams
  console.log('1. Fetching teams...');
  try {
    const teams = await fetchCBBD<any[]>('/teams');
    console.log(`   Found ${teams.length} teams`);
    console.log(`   Sample: ${teams.slice(0, 3).map((t: any) => t.school || t.name).join(', ')}`);
  } catch (e) {
    console.error(`   Error: ${e}`);
  }

  // Test 2: Get games for current season
  console.log('\n2. Fetching 2024 games...');
  try {
    const games = await fetchCBBD<any[]>('/games', { season: '2025' });
    console.log(`   Found ${games.length} games`);
    if (games.length > 0) {
      const sample = games[0];
      console.log(`   Sample: ${sample.awayTeam || sample.away_team} @ ${sample.homeTeam || sample.home_team}`);
    }
  } catch (e) {
    console.error(`   Error: ${e}`);
  }

  // Test 3: Get adjusted efficiency ratings
  console.log('\n3. Fetching adjusted efficiency ratings...');
  try {
    const ratings = await fetchCBBD<any[]>('/ratings/adjusted', { season: '2025' });
    console.log(`   Found ${ratings.length} team ratings`);
    if (ratings.length > 0) {
      const top5 = ratings.slice(0, 5);
      console.log('   Top 5 by adjusted efficiency:');
      top5.forEach((r: any, i: number) => {
        console.log(`     ${i + 1}. ${r.team || r.school}: ${r.adjustedEfficiency?.toFixed(2) || r.rating?.toFixed(2) || 'N/A'}`);
      });
    }
  } catch (e) {
    console.error(`   Error: ${e}`);
  }

  // Test 4: Get SRS ratings
  console.log('\n4. Fetching SRS ratings...');
  try {
    const srs = await fetchCBBD<any[]>('/ratings/srs', { season: '2025' });
    console.log(`   Found ${srs.length} SRS ratings`);
    if (srs.length > 0) {
      const top3 = srs.slice(0, 3);
      console.log('   Top 3:');
      top3.forEach((r: any, i: number) => {
        console.log(`     ${i + 1}. ${r.team || r.school}: ${r.rating?.toFixed(2) || 'N/A'}`);
      });
    }
  } catch (e) {
    console.error(`   Error: ${e}`);
  }

  // Test 5: Get betting lines
  console.log('\n5. Fetching betting lines...');
  try {
    const lines = await fetchCBBD<any[]>('/lines', { season: '2025' });
    console.log(`   Found ${lines.length} games with lines`);
    if (lines.length > 0) {
      const sample = lines[0];
      console.log(`   Sample game: ${sample.awayTeam} @ ${sample.homeTeam}`);
      if (sample.lines && sample.lines.length > 0) {
        console.log(`   Lines available from: ${sample.lines.map((l: any) => l.provider).join(', ')}`);
      }
    }
  } catch (e) {
    console.error(`   Error: ${e}`);
  }

  // Test 6: Get conferences
  console.log('\n6. Fetching conferences...');
  try {
    const conferences = await fetchCBBD<any[]>('/conferences');
    console.log(`   Found ${conferences.length} conferences`);
    console.log(`   Sample: ${conferences.slice(0, 5).map((c: any) => c.name || c.abbreviation).join(', ')}`);
  } catch (e) {
    console.error(`   Error: ${e}`);
  }

  console.log('\n=== API Test Complete ===');
}

testAPI().catch(console.error);

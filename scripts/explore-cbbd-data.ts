/**
 * Explore CBBD API data structures
 */

const CBBD_BASE_URL = 'https://api.collegebasketballdata.com';
const API_KEY = process.env.CFBD_API_KEY;

async function fetchCBBD<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${CBBD_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`CBBD API error: ${response.status}`);
  }

  return response.json();
}

async function explore() {
  console.log('=== CBBD Data Structure Exploration ===\n');

  // 1. Team structure
  console.log('1. TEAM STRUCTURE:');
  const teams = await fetchCBBD<any[]>('/teams');
  const d1Teams = teams.filter(t => t.conference); // D1 teams have conference
  console.log(`   Total teams: ${teams.length}, D1 teams with conference: ${d1Teams.length}`);
  console.log('   Sample team:', JSON.stringify(d1Teams[0], null, 2));

  // 2. Game structure
  console.log('\n2. GAME STRUCTURE:');
  const games = await fetchCBBD<any[]>('/games', { season: '2025' });
  const completedGames = games.filter(g => g.homeScore !== null);
  console.log(`   Total games: ${games.length}, Completed: ${completedGames.length}`);
  console.log('   Sample completed game:', JSON.stringify(completedGames[0], null, 2));

  // 3. Adjusted ratings structure
  console.log('\n3. ADJUSTED RATINGS STRUCTURE:');
  const ratings = await fetchCBBD<any[]>('/ratings/adjusted', { season: '2025' });
  console.log(`   Total ratings: ${ratings.length}`);
  console.log('   Sample rating:', JSON.stringify(ratings[0], null, 2));

  // 4. SRS ratings structure
  console.log('\n4. SRS RATINGS STRUCTURE:');
  const srs = await fetchCBBD<any[]>('/ratings/srs', { season: '2025' });
  console.log(`   Total SRS ratings: ${srs.length}`);
  console.log('   Sample SRS:', JSON.stringify(srs[0], null, 2));

  // 5. Betting lines structure
  console.log('\n5. BETTING LINES STRUCTURE:');
  const lines = await fetchCBBD<any[]>('/lines', { season: '2025' });
  const gamesWithLines = lines.filter(l => l.lines && l.lines.length > 0);
  console.log(`   Games with betting data: ${gamesWithLines.length}`);
  if (gamesWithLines.length > 0) {
    console.log('   Sample game with lines:', JSON.stringify(gamesWithLines[0], null, 2));
  }

  // 6. Check conferences
  console.log('\n6. CONFERENCES:');
  const conferences = await fetchCBBD<any[]>('/conferences');
  console.log('   Sample conference:', JSON.stringify(conferences[0], null, 2));
  console.log('   Major conferences:', conferences.filter(c =>
    ['ACC', 'Big Ten', 'Big 12', 'SEC', 'Pac-12', 'Big East'].some(name =>
      c.name?.includes(name) || c.abbreviation?.includes(name)
    )
  ).map(c => c.name || c.abbreviation).join(', '));

  console.log('\n=== Exploration Complete ===');
}

explore().catch(console.error);

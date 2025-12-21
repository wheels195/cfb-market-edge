const API_KEY = process.env.CFBD_API_KEY;
const BASE_URL = 'https://api.collegefootballdata.com';

async function cfbdFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function main() {
  console.log('=== ARMY 2025 SEASON GAMES ===\n');

  try {
    const games = await cfbdFetch('/games', { year: '2025', team: 'Army' });

    let wins = 0;
    let losses = 0;

    for (const g of games) {
      const isHome = g.home_team === 'Army';
      const armyScore = isHome ? g.home_points : g.away_points;
      const oppScore = isHome ? g.away_points : g.home_points;
      const opp = isHome ? g.away_team : g.home_team;

      if (armyScore === null) {
        console.log(`Week ${g.week}: vs ${opp} - NOT PLAYED`);
      } else {
        const result = armyScore > oppScore ? 'W' : armyScore < oppScore ? 'L' : 'T';
        if (armyScore > oppScore) wins++;
        else if (armyScore < oppScore) losses++;
        console.log(`Week ${g.week}: vs ${opp} ${armyScore}-${oppScore} (${result})`);
      }
    }

    console.log(`\nRecord: ${wins}-${losses}`);
  } catch (e) {
    console.log('Error:', e);
  }

  // Also check UConn
  console.log('\n=== UCONN 2025 SEASON GAMES ===\n');

  try {
    const games = await cfbdFetch('/games', { year: '2025', team: 'Connecticut' });

    let wins = 0;
    let losses = 0;

    for (const g of games) {
      const isHome = g.home_team === 'Connecticut';
      const teamScore = isHome ? g.home_points : g.away_points;
      const oppScore = isHome ? g.away_points : g.home_points;
      const opp = isHome ? g.away_team : g.home_team;

      if (teamScore === null) {
        console.log(`Week ${g.week}: vs ${opp} - NOT PLAYED`);
      } else {
        const result = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'T';
        if (teamScore > oppScore) wins++;
        else if (teamScore < oppScore) losses++;
        console.log(`Week ${g.week}: vs ${opp} ${teamScore}-${oppScore} (${result})`);
      }
    }

    console.log(`\nRecord: ${wins}-${losses}`);
  } catch (e) {
    console.log('Error:', e);
  }
}

main().catch(console.error);

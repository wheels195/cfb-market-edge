import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

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
  console.log('=== CFBD BOWL GAMES CHECK ===\n');

  // Check 2024 postseason games
  try {
    const games2024 = await cfbdFetch('/games', { year: '2024', seasonType: 'postseason' });
    console.log('2024 Bowl Games:', games2024.length);

    // Find Penn State and Army games
    for (const g of games2024.slice(0, 10)) {
      if (g.home_team?.includes('Penn State') || g.away_team?.includes('Penn State') ||
          g.home_team?.includes('Army') || g.away_team?.includes('Army') ||
          g.home_team?.includes('Clemson') || g.away_team?.includes('Clemson') ||
          g.home_team?.includes('UConn') || g.away_team?.includes('UConn')) {
        console.log(`  ${g.away_team} @ ${g.home_team} (Week ${g.week})`);
        console.log(`    Date: ${g.start_date}`);
      }
    }
  } catch (e) {
    console.log('Error fetching 2024:', e);
  }

  // Check 2025 postseason games
  try {
    const games2025 = await cfbdFetch('/games', { year: '2025', seasonType: 'postseason' });
    console.log('\n2025 Bowl Games:', games2025.length);

    for (const g of games2025.slice(0, 10)) {
      console.log(`  ${g.away_team} @ ${g.home_team}`);
      console.log(`    Date: ${g.start_date}`);
    }
  } catch (e) {
    console.log('Error fetching 2025:', e);
  }

  // What season does our system think it is?
  const today = new Date();
  const season = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  console.log('\n=== SYSTEM STATE ===');
  console.log('Today:', today.toISOString());
  console.log('Calculated season:', season);

  // Check Army's Elo in both seasons
  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('name', 'Army')
    .single();

  if (team) {
    console.log('\n=== ARMY ELO COMPARISON ===');

    for (const yr of [2024, 2025]) {
      const { data: elo } = await supabase
        .from('team_elo_snapshots')
        .select('elo, week')
        .eq('team_id', team.id)
        .eq('season', yr)
        .eq('week', 13)
        .single();

      console.log(`Season ${yr} Week 13:`, elo?.elo || 'N/A');
    }

    // Get CFBD's latest for 2024
    try {
      const eloData = await cfbdFetch('/ratings/elo', { year: '2024' });
      const army = eloData.find((d: any) => d.team === 'Army');
      console.log('CFBD 2024 latest:', army?.elo || 'N/A');
    } catch (e) {
      console.log('CFBD 2024 error:', e);
    }
  }
}

main().catch(console.error);

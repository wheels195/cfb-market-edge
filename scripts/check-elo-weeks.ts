import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Get Army's team ID
  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('name', 'Army')
    .single();

  if (team === null) {
    console.log('Army not found');
    return;
  }

  console.log('=== ARMY ELO SNAPSHOTS IN DB ===\n');

  // Get all snapshots for Army
  const { data: snapshots } = await supabase
    .from('team_elo_snapshots')
    .select('season, week, elo')
    .eq('team_id', team.id)
    .order('season', { ascending: false })
    .order('week', { ascending: false });

  for (const s of snapshots || []) {
    console.log(`Season ${s.season} Week ${s.week}: ${s.elo}`);
  }

  // Check what weeks exist for 2025
  console.log('\n=== WEEKS AVAILABLE FOR 2025 ===\n');

  const { data: weeks2025 } = await supabase
    .from('team_elo_snapshots')
    .select('week')
    .eq('season', 2025);

  const uniqueWeeks = [...new Set((weeks2025 || []).map(w => w.week))].sort((a, b) => a - b);
  console.log('Weeks with data:', uniqueWeeks.join(', '));

  // What is CFBD returning for 2025?
  console.log('\n=== CHECKING CFBD 2025 WEEKLY DATA ===\n');

  const API_KEY = process.env.CFBD_API_KEY;
  for (const week of [0, 1, 13, 14, 15, 16]) {
    const url = `https://api.collegefootballdata.com/ratings/elo?year=2025&week=${week}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });

    if (response.status === 200) {
      const data = await response.json();
      const army = data.find((d: any) => d.team.toLowerCase() === 'army');
      console.log(`2025 Week ${week}: ${data.length} teams | Army: ${army?.elo || 'N/A'}`);
    } else {
      console.log(`2025 Week ${week}: HTTP ${response.status}`);
    }
  }
}

main().catch(console.error);

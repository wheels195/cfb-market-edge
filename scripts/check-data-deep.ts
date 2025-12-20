import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Check all seasons in cfbd_betting_lines
  console.log('=== CFBD BETTING LINES BY SEASON ===');
  const { data: seasonCounts } = await supabase
    .from('cfbd_betting_lines')
    .select('season')
    .order('season');

  const bySeason = new Map<number, number>();
  for (const r of seasonCounts || []) {
    bySeason.set(r.season, (bySeason.get(r.season) || 0) + 1);
  }

  for (const [s, c] of Array.from(bySeason.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`Season ${s}: ${c} games`);
  }

  // Check pace data by season
  console.log('\n=== PACE DATA BY SEASON (team_advanced_stats) ===');
  const { data: paceData } = await supabase
    .from('team_advanced_stats')
    .select('season, plays_per_game')
    .not('plays_per_game', 'is', null);

  const paceBySeason = new Map<number, number>();
  for (const r of paceData || []) {
    paceBySeason.set(r.season, (paceBySeason.get(r.season) || 0) + 1);
  }

  for (const [s, c] of Array.from(paceBySeason.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`Season ${s}: ${c} teams with pace`);
  }

  // Check game_advanced_stats for pace by week
  console.log('\n=== GAME ADVANCED STATS (WEEKLY PACE SOURCE) ===');
  const { data: gameStats } = await supabase
    .from('game_advanced_stats')
    .select('season, week')
    .limit(2000);

  const gameStatsBySeason = new Map<number, Set<number>>();
  for (const r of gameStats || []) {
    const key = r.season;
    if (!gameStatsBySeason.has(key)) gameStatsBySeason.set(key, new Set());
    gameStatsBySeason.get(key)!.add(r.week);
  }

  for (const [s, weeks] of Array.from(gameStatsBySeason.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`Season ${s}: Weeks ${Array.from(weeks).sort((a, b) => a - b).join(', ')}`);
  }

  // Check team_elo_snapshots more thoroughly
  console.log('\n=== ELO SNAPSHOTS BY SEASON/WEEK ===');
  const { data: eloData } = await supabase
    .from('team_elo_snapshots')
    .select('season, week')
    .order('season')
    .order('week');

  const eloBySeason = new Map<number, Set<number>>();
  for (const r of eloData || []) {
    if (!eloBySeason.has(r.season)) eloBySeason.set(r.season, new Set());
    eloBySeason.get(r.season)!.add(r.week);
  }

  for (const [s, weeks] of Array.from(eloBySeason.entries()).sort((a, b) => a[0] - b[0])) {
    const weekArray = Array.from(weeks).sort((a, b) => a - b);
    console.log(`Season ${s}: Weeks ${weekArray[0]}-${weekArray[weekArray.length-1]} (${weeks.size} weeks)`);
  }

  // Check cfbd_betting_lines columns
  console.log('\n=== CFBD BETTING LINES SAMPLE ===');
  const { data: sampleLines } = await supabase
    .from('cfbd_betting_lines')
    .select('*')
    .eq('season', 2023)
    .limit(3);

  if (sampleLines && sampleLines.length > 0) {
    console.log('Columns:', Object.keys(sampleLines[0]).join(', '));
    console.log('Sample row:', JSON.stringify(sampleLines[0], null, 2));
  }
}

main().catch(console.error);

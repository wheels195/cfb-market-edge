import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function investigateNames() {
  // 1. Get sample of team names from teams table
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, odds_api_name, cfbd_team_id')
    .order('name')
    .limit(30);

  console.log('=== TEAMS TABLE (source of truth) ===');
  teams?.forEach(t => console.log(`  ${t.name} | odds_api: ${t.odds_api_name || 'null'}`));

  // 2. Check what names are in today's events
  const now = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 48*60*60*1000).toISOString();

  const { data: events } = await supabase
    .from('events')
    .select('commence_time, home_team:home_team_id(name, odds_api_name), away_team:away_team_id(name, odds_api_name)')
    .gte('commence_time', now)
    .lte('commence_time', tomorrow)
    .order('commence_time');

  console.log('\n=== UPCOMING GAMES - TEAM NAMES ===');
  events?.forEach(e => {
    const home = e.home_team as any;
    const away = e.away_team as any;
    console.log(`  ${away?.name} @ ${home?.name}`);
  });

  // 3. Get unique team names used in current events
  const uniqueNames = new Set<string>();
  events?.forEach(e => {
    const home = e.home_team as any;
    const away = e.away_team as any;
    if (home?.name) uniqueNames.add(home.name);
    if (away?.name) uniqueNames.add(away.name);
  });

  console.log('\n=== UNIQUE TEAM NAMES IN UPCOMING GAMES ===');
  Array.from(uniqueNames).sort().forEach(n => console.log(`  "${n}"`));
}

investigateNames();

/**
 * Compare team names between Odds API and CBBD
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  // Check sample odds tick team names vs game team names
  const { data: ticks } = await supabase
    .from('cbb_odds_ticks')
    .select('home_team, away_team, commence_time, spread_home')
    .order('captured_at', { ascending: false })
    .limit(20);

  console.log('=== Odds API Team Names ===');
  for (const tick of ticks || []) {
    console.log(`${tick.away_team} @ ${tick.home_team} (spread: ${tick.spread_home})`);
  }

  // Check corresponding game names
  const { data: games } = await supabase
    .from('cbb_games')
    .select('home_team_name, away_team_name, start_date')
    .gte('start_date', '2025-12-22')
    .lte('start_date', '2025-12-24')
    .eq('home_score', 0)
    .limit(20);

  console.log('\n=== CBBD Game Team Names ===');
  for (const game of games || []) {
    console.log(`${game.away_team_name} @ ${game.home_team_name}`);
  }

  // Try to match some
  console.log('\n=== Attempting Matches ===');
  for (const tick of (ticks || []).slice(0, 5)) {
    const homeSearch = tick.home_team.split(' ')[0]; // First word
    const { data: matches } = await supabase
      .from('cbb_games')
      .select('id, home_team_name, away_team_name, start_date')
      .gte('start_date', '2025-12-22')
      .lte('start_date', '2025-12-25')
      .eq('home_score', 0)
      .ilike('home_team_name', `%${homeSearch}%`)
      .limit(1);

    if (matches && matches.length > 0) {
      console.log(`MATCH: "${tick.home_team}" -> "${matches[0].home_team_name}"`);
    } else {
      console.log(`NO MATCH: "${tick.home_team}"`);
    }
  }
}

main().catch(console.error);

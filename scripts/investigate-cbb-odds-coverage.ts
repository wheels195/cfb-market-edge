/**
 * Investigate why only 16 games have betting lines
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CBB Odds Coverage Investigation ===\n');

  const now = new Date();
  const future7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const future14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  // 1. Total upcoming games in database
  const { count: totalUpcoming } = await supabase
    .from('cbb_games')
    .select('*', { count: 'exact', head: true })
    .gte('start_date', now.toISOString())
    .lte('start_date', future14.toISOString())
    .eq('home_score', 0)
    .eq('away_score', 0);

  console.log(`1. Total upcoming games (next 14 days): ${totalUpcoming}`);

  // 2. Games with both teams matched (D1 only)
  const { count: d1Games } = await supabase
    .from('cbb_games')
    .select('*', { count: 'exact', head: true })
    .gte('start_date', now.toISOString())
    .lte('start_date', future14.toISOString())
    .eq('home_score', 0)
    .eq('away_score', 0)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  console.log(`2. D1 games (both teams matched): ${d1Games}`);

  // 3. Games in next 7 days
  const { count: games7days } = await supabase
    .from('cbb_games')
    .select('*', { count: 'exact', head: true })
    .gte('start_date', now.toISOString())
    .lte('start_date', future7.toISOString())
    .eq('home_score', 0)
    .eq('away_score', 0)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  console.log(`3. D1 games next 7 days: ${games7days}`);

  // 4. Check betting lines table
  const { count: totalLines } = await supabase
    .from('cbb_betting_lines')
    .select('*', { count: 'exact', head: true });

  console.log(`\n4. Total betting lines in database: ${totalLines}`);

  // 5. Recent betting lines
  const { data: recentLines } = await supabase
    .from('cbb_betting_lines')
    .select('game_id, spread_home, updated_at')
    .order('updated_at', { ascending: false })
    .limit(10);

  console.log(`\n5. Most recent betting line updates:`);
  for (const line of recentLines || []) {
    console.log(`   ${line.game_id}: spread ${line.spread_home}, updated ${line.updated_at}`);
  }

  // 6. Games WITH betting lines
  const { data: gamesWithLines } = await supabase
    .from('cbb_games')
    .select(`
      id,
      home_team_name,
      away_team_name,
      start_date,
      cbb_betting_lines (spread_home)
    `)
    .gte('start_date', now.toISOString())
    .lte('start_date', future7.toISOString())
    .eq('home_score', 0)
    .eq('away_score', 0)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  const withOdds = (gamesWithLines || []).filter(g => {
    const lines = (g as any).cbb_betting_lines;
    const line = Array.isArray(lines) ? lines[0] : lines;
    return line?.spread_home !== null && line?.spread_home !== undefined;
  });

  console.log(`\n6. D1 games with betting lines (next 7 days): ${withOdds.length}`);

  // 7. Sample games WITHOUT odds
  const withoutOdds = (gamesWithLines || []).filter(g => {
    const lines = (g as any).cbb_betting_lines;
    const line = Array.isArray(lines) ? lines[0] : lines;
    return line?.spread_home === null || line?.spread_home === undefined;
  }).slice(0, 10);

  console.log(`\n7. Sample D1 games WITHOUT betting lines:`);
  for (const game of withoutOdds) {
    console.log(`   ${game.away_team_name} @ ${game.home_team_name} (${game.start_date})`);
  }

  // 8. Sample games WITH odds
  console.log(`\n8. Games WITH betting lines:`);
  for (const game of withOdds.slice(0, 10)) {
    const lines = (game as any).cbb_betting_lines;
    const line = Array.isArray(lines) ? lines[0] : lines;
    console.log(`   ${game.away_team_name} @ ${game.home_team_name} - spread ${line?.spread_home}`);
  }

  // 9. Check when odds sync last ran
  console.log('\n9. Checking recent cron activity...');

  // Check cbb_games updated recently (might indicate sync)
  const { data: recentUpdates } = await supabase
    .from('cbb_games')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  console.log(`   Most recent game update: ${recentUpdates?.[0]?.updated_at || 'unknown'}`);

  // 10. Check if we have The Odds API data
  console.log('\n10. Checking betting_lines provider distribution:');
  const { data: providers } = await supabase
    .from('cbb_betting_lines')
    .select('provider')
    .limit(100);

  const providerCounts: Record<string, number> = {};
  for (const p of providers || []) {
    providerCounts[p.provider || 'null'] = (providerCounts[p.provider || 'null'] || 0) + 1;
  }
  console.log(`   Providers: ${JSON.stringify(providerCounts)}`);

  console.log('\n=== DIAGNOSIS ===');
  console.log(`Total upcoming D1 games: ${d1Games}`);
  console.log(`Games with odds: ${withOdds.length}`);
  console.log(`Missing odds: ${(d1Games || 0) - withOdds.length}`);

  if (withOdds.length < 50) {
    console.log('\nPOSSIBLE ISSUES:');
    console.log('1. The Odds API CBB sync may not be running');
    console.log('2. The Odds API quota may be exhausted');
    console.log('3. Team name matching between Odds API and CBBD may be failing');
    console.log('4. The cbb-sync-odds cron job may not be set up');
  }
}

main().catch(console.error);

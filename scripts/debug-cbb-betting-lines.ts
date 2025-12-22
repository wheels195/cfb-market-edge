import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function debug() {
  const season = 2026;
  const now = new Date();

  console.log('=== CBB Betting Lines Debug ===\n');
  console.log(`Season: ${season}`);
  console.log(`Current time: ${now.toISOString()}\n`);

  // Check how many games have betting lines
  const { data: gamesWithLines, error: e1 } = await supabase
    .from('cbb_games')
    .select(`
      id,
      start_date,
      home_team_name,
      away_team_name,
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      cbb_betting_lines (
        spread_home,
        total,
        provider
      )
    `)
    .eq('season', season)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .eq('home_score', 0)
    .eq('away_score', 0)
    .gte('start_date', now.toISOString())
    .order('start_date', { ascending: true })
    .limit(20);

  if (e1) {
    console.error('Error:', e1.message);
    return;
  }

  console.log(`Found ${gamesWithLines?.length || 0} upcoming D1 games\n`);

  for (const game of gamesWithLines || []) {
    const lines = game.cbb_betting_lines as any[] | null;
    const hasLines = lines && lines.length > 0;
    const spread = hasLines ? lines[0].spread_home : null;

    console.log(`${game.away_team_name} @ ${game.home_team_name}`);
    console.log(`  Date: ${game.start_date}`);
    console.log(`  Has betting lines: ${hasLines ? 'YES' : 'NO'}`);
    if (hasLines) {
      console.log(`  Spread (home): ${spread}`);
      console.log(`  Provider: ${lines![0].provider}`);
    }
    console.log();
  }

  // Check total betting lines count
  const { count: linesCount } = await supabase
    .from('cbb_betting_lines')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal betting lines in table: ${linesCount}`);

  // Check Elo snapshots
  const { data: eloData, error: e2 } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', season)
    .limit(10);

  console.log(`\nElo snapshots sample (season ${season}):`);
  if (eloData && eloData.length > 0) {
    for (const row of eloData) {
      console.log(`  Team ${row.team_id}: Elo=${row.elo}, Games=${row.games_played}`);
    }
  } else {
    console.log('  No Elo snapshots found!');
  }

  // Get games with proper betting lines and calculate potential qualifications
  const { data: testGames } = await supabase
    .from('cbb_games')
    .select(`
      id,
      start_date,
      home_team_name,
      away_team_name,
      home_team_id,
      away_team_id,
      cbb_betting_lines (spread_home)
    `)
    .eq('season', season)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .gte('start_date', now.toISOString())
    .order('start_date', { ascending: true })
    .limit(100);

  // Load all Elo data
  const { data: allElo } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', season);

  const eloMap = new Map<string, { elo: number; games: number }>();
  for (const row of allElo || []) {
    eloMap.set(row.team_id, { elo: row.elo, games: row.games_played });
  }

  console.log(`\n=== Games with spread >= 10 and potential edge ===\n`);

  let qualifyingCount = 0;
  for (const game of testGames || []) {
    const lines = game.cbb_betting_lines as any[] | null;
    const spread = lines?.[0]?.spread_home;

    if (spread === null || spread === undefined) continue;

    const spreadSize = Math.abs(spread);
    if (spreadSize < 10) continue;

    const homeElo = eloMap.get(game.home_team_id)?.elo || 1500;
    const awayElo = eloMap.get(game.away_team_id)?.elo || 1500;
    const homeGames = eloMap.get(game.home_team_id)?.games || 0;
    const awayGames = eloMap.get(game.away_team_id)?.games || 0;

    // Model spread: (awayElo - homeElo) / 25 - 2.5
    const modelSpread = (awayElo - homeElo) / 25 - 2.5;
    const edge = spread - modelSpread;
    const absEdge = Math.abs(edge);

    // Determine side
    const side = edge > 0 ? 'home' : 'away';
    const isUnderdog = (side === 'home' && spread > 0) || (side === 'away' && spread < 0);

    const meetsMinGames = homeGames >= 5 && awayGames >= 5;
    const meetsEdge = absEdge >= 2.5 && absEdge <= 5.0;
    const qualifies = meetsMinGames && meetsEdge && spreadSize >= 10 && isUnderdog;

    console.log(`${game.away_team_name} @ ${game.home_team_name}`);
    console.log(`  Market spread: ${spread > 0 ? '+' : ''}${spread.toFixed(1)}`);
    console.log(`  Model spread: ${modelSpread > 0 ? '+' : ''}${modelSpread.toFixed(1)}`);
    console.log(`  Edge: ${absEdge.toFixed(1)} pts (${side})`);
    console.log(`  Games: home=${homeGames}, away=${awayGames}`);
    console.log(`  Is underdog bet: ${isUnderdog}`);
    console.log(`  QUALIFIES: ${qualifies ? 'YES ✓' : 'NO'}`);
    if (!qualifies) {
      if (!meetsMinGames) console.log(`    ❌ Need 5+ games each`);
      if (!meetsEdge) console.log(`    ❌ Edge not in 2.5-5 range`);
      if (!isUnderdog) console.log(`    ❌ Not underdog bet`);
    } else {
      qualifyingCount++;
    }
    console.log();
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total qualifying bets found: ${qualifyingCount}`);
}

debug().catch(console.error);

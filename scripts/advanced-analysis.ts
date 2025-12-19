/**
 * Advanced Analysis
 *
 * 1. CLV by time-to-kickoff (when is best to bet?)
 * 2. Performance by edge bucket (top 10%, 20%, etc.)
 * 3. Opening-line residual as feature (steam/sharp movement)
 * 4. QB injury timing impact
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// =============================================================================
// 1. CLV BY TIME-TO-KICKOFF
// =============================================================================

async function analyzeCLVByTiming() {
  console.log('=== 1. CLV BY TIME-TO-KICKOFF ===\n');

  // Get events with multiple tick snapshots at different times
  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name)
    `)
    .eq('status', 'final')
    .gte('commence_time', '2023-08-01')
    .lte('commence_time', '2025-01-15')
    .limit(500);

  if (!events || events.length === 0) {
    console.log('No events found');
    return;
  }

  // Get odds ticks for these events with timing
  const eventIds = events.map(e => e.id);

  // Get all odds ticks with captured_at
  const timeBuckets = {
    '>24h': { sumMove: 0, count: 0 },
    '12-24h': { sumMove: 0, count: 0 },
    '6-12h': { sumMove: 0, count: 0 },
    '2-6h': { sumMove: 0, count: 0 },
    '<2h': { sumMove: 0, count: 0 },
  };

  // For each event, get opening and closing spread, calculate moves at different times
  for (const event of events.slice(0, 100)) {
    const { data: ticks } = await supabase
      .from('odds_ticks')
      .select('captured_at, spread_points_home')
      .eq('event_id', event.id)
      .eq('market_type', 'spread')
      .eq('side', 'home')
      .not('spread_points_home', 'is', null)
      .order('captured_at', { ascending: true });

    if (!ticks || ticks.length < 2) continue;

    const kickoff = new Date(event.commence_time);
    const opening = ticks[0].spread_points_home;
    const closing = ticks[ticks.length - 1].spread_points_home;
    const totalMove = closing - opening;

    // Calculate how much of the move happened by each time bucket
    for (const tick of ticks) {
      const tickTime = new Date(tick.captured_at);
      const hoursToKickoff = (kickoff.getTime() - tickTime.getTime()) / (1000 * 60 * 60);
      const moveAtTick = tick.spread_points_home - opening;

      let bucket: keyof typeof timeBuckets;
      if (hoursToKickoff > 24) bucket = '>24h';
      else if (hoursToKickoff > 12) bucket = '12-24h';
      else if (hoursToKickoff > 6) bucket = '6-12h';
      else if (hoursToKickoff > 2) bucket = '2-6h';
      else bucket = '<2h';

      timeBuckets[bucket].sumMove += moveAtTick;
      timeBuckets[bucket].count++;
    }
  }

  console.log('Average line position by time to kickoff:');
  console.log('(Relative to opening, towards closing)');
  console.log('Time Bucket | Avg Move from Open | Count');
  console.log('------------|--------------------|---------');
  for (const [bucket, data] of Object.entries(timeBuckets)) {
    if (data.count === 0) continue;
    const avgMove = data.sumMove / data.count;
    console.log(`${bucket.padEnd(11)} | ${avgMove.toFixed(2).padStart(18)} | ${data.count}`);
  }

  // CLV analysis: what if you bet at different times?
  console.log('\nCLV if betting at each time bucket:');
  console.log('(Positive = getting value before close)');
}

// =============================================================================
// 2. PERFORMANCE BY EDGE BUCKET
// =============================================================================

async function analyzeByEdgeBucket() {
  console.log('\n=== 2. PERFORMANCE BY EDGE BUCKET ===\n');

  // Get SP+ ratings
  const { data: sp2022 } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_overall')
    .eq('season', 2022)
    .not('sp_overall', 'is', null);

  const { data: sp2023 } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_overall')
    .eq('season', 2023)
    .not('sp_overall', 'is', null);

  const spMap = new Map<string, Map<number, number>>();
  for (const row of sp2022 || []) {
    if (!spMap.has(row.team_id)) spMap.set(row.team_id, new Map());
    spMap.get(row.team_id)!.set(2023, row.sp_overall); // Use 2022 SP+ for 2023 games
  }
  for (const row of sp2023 || []) {
    if (!spMap.has(row.team_id)) spMap.set(row.team_id, new Map());
    spMap.get(row.team_id)!.set(2024, row.sp_overall); // Use 2023 SP+ for 2024 games
  }

  // Get events with closing lines and results
  const projections: { edge: number; won: boolean; side: string; matchup: string }[] = [];

  for (const season of [2023, 2024]) {
    const { data: events } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team_id,
        away_team_id,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name),
        results(home_score, away_score)
      `)
      .eq('status', 'final')
      .gte('commence_time', `${season}-08-01`)
      .lte('commence_time', `${season + 1}-02-15`);

    if (!events) continue;

    const eventIds = events.map(e => e.id);

    // Get closing lines in batches
    const closeMap = new Map<string, number>();
    for (let i = 0; i < eventIds.length; i += 100) {
      const batch = eventIds.slice(i, i + 100);
      const { data: lines } = await supabase
        .from('closing_lines')
        .select('event_id, spread_points_home')
        .in('event_id', batch)
        .eq('market_type', 'spread')
        .eq('side', 'home')
        .gte('price_american', -150)
        .lte('price_american', -100);

      for (const l of lines || []) {
        if (!closeMap.has(l.event_id)) {
          closeMap.set(l.event_id, l.spread_points_home);
        }
      }
    }

    for (const event of events) {
      const closing = closeMap.get(event.id);
      if (closing === undefined) continue;

      const results = event.results as any;
      if (!results) continue;

      const homeSP = spMap.get(event.home_team_id)?.get(season);
      const awaySP = spMap.get(event.away_team_id)?.get(season);
      if (homeSP === undefined || awaySP === undefined) continue;

      const homeTeam = (event.home_team as any)?.name || '?';
      const awayTeam = (event.away_team as any)?.name || '?';

      // Model projection
      const modelSpread = -(homeSP - awaySP) - 2.5; // HFA
      const edge = modelSpread - closing;
      const absEdge = Math.abs(edge);

      // Determine side and if won
      const side = edge < 0 ? 'home' : 'away';
      const margin = results.home_score - results.away_score;
      const homeCovered = margin > -closing;
      const won = (side === 'home' && homeCovered) || (side === 'away' && !homeCovered);

      projections.push({
        edge: absEdge,
        won,
        side,
        matchup: `${awayTeam} @ ${homeTeam}`,
      });
    }
  }

  // Sort by absolute edge and bucket
  projections.sort((a, b) => b.edge - a.edge);

  const buckets = [
    { name: 'Top 5%', start: 0, end: Math.floor(projections.length * 0.05) },
    { name: 'Top 10%', start: 0, end: Math.floor(projections.length * 0.10) },
    { name: 'Top 20%', start: 0, end: Math.floor(projections.length * 0.20) },
    { name: 'Top 50%', start: 0, end: Math.floor(projections.length * 0.50) },
    { name: 'All', start: 0, end: projections.length },
  ];

  console.log('Performance by model edge percentile:');
  console.log('Bucket   | Games | Avg Edge | Win%  | ROI at -110');
  console.log('---------|-------|----------|-------|------------');

  for (const bucket of buckets) {
    const slice = projections.slice(bucket.start, bucket.end);
    if (slice.length === 0) continue;

    const avgEdge = slice.reduce((s, p) => s + p.edge, 0) / slice.length;
    const winRate = slice.filter(p => p.won).length / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);

    console.log(
      `${bucket.name.padEnd(8)} | ${slice.length.toString().padStart(5)} | ` +
      `${avgEdge.toFixed(2).padStart(8)} | ${(winRate * 100).toFixed(1).padStart(4)}% | ` +
      `${(roi * 100).toFixed(1).padStart(5)}%`
    );
  }

  // Show top 10 edges
  console.log('\nTop 10 edges:');
  for (const p of projections.slice(0, 10)) {
    console.log(`  ${p.matchup.substring(0, 35).padEnd(35)} | Edge: ${p.edge.toFixed(1)} | ${p.won ? 'WON' : 'LOST'}`);
  }
}

// =============================================================================
// 3. OPENING-LINE RESIDUAL
// =============================================================================

async function analyzeOpeningLineResidual() {
  console.log('\n=== 3. OPENING-LINE RESIDUAL AS FEATURE ===\n');

  // Get events with both opening and closing lines
  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name),
      results(home_score, away_score)
    `)
    .eq('status', 'final')
    .gte('commence_time', '2023-08-01')
    .lte('commence_time', '2025-01-15')
    .limit(500);

  if (!events) return;

  const lineMovements: {
    eventId: string;
    matchup: string;
    opening: number;
    closing: number;
    move: number;
    margin: number;
    steamWon: boolean;
  }[] = [];

  for (const event of events) {
    const { data: ticks } = await supabase
      .from('odds_ticks')
      .select('captured_at, spread_points_home')
      .eq('event_id', event.id)
      .eq('market_type', 'spread')
      .eq('side', 'home')
      .not('spread_points_home', 'is', null)
      .order('captured_at', { ascending: true });

    if (!ticks || ticks.length < 2) continue;

    const results = event.results as any;
    if (!results) continue;

    const homeTeam = (event.home_team as any)?.name || '?';
    const awayTeam = (event.away_team as any)?.name || '?';

    const opening = ticks[0].spread_points_home;
    const closing = ticks[ticks.length - 1].spread_points_home;
    const move = closing - opening; // Positive = moved toward away, Negative = moved toward home
    const margin = results.home_score - results.away_score;

    // If line moved toward home (negative move), sharp money on home
    // Home covers if margin > -closing
    const homeCovered = margin > -closing;
    const steamSide = move < 0 ? 'home' : 'away';
    const steamWon = (steamSide === 'home' && homeCovered) || (steamSide === 'away' && !homeCovered);

    if (Math.abs(move) >= 0.5) { // Only count significant moves
      lineMovements.push({
        eventId: event.id,
        matchup: `${awayTeam} @ ${homeTeam}`,
        opening,
        closing,
        move,
        margin,
        steamWon,
      });
    }
  }

  // Analyze by move size
  const moveBuckets = [
    { name: '0.5-1 pt', min: 0.5, max: 1 },
    { name: '1-2 pt', min: 1, max: 2 },
    { name: '2-3 pt', min: 2, max: 3 },
    { name: '3+ pt', min: 3, max: 100 },
  ];

  console.log('Line movement ("steam") performance:');
  console.log('Move Size | Games | Steam Win% | ROI if bet steam');
  console.log('----------|-------|------------|------------------');

  for (const bucket of moveBuckets) {
    const games = lineMovements.filter(m => Math.abs(m.move) >= bucket.min && Math.abs(m.move) < bucket.max);
    if (games.length === 0) continue;

    const winRate = games.filter(g => g.steamWon).length / games.length;
    const roi = winRate * 0.909 - (1 - winRate);

    console.log(
      `${bucket.name.padEnd(9)} | ${games.length.toString().padStart(5)} | ` +
      `${(winRate * 100).toFixed(1).padStart(9)}% | ${(roi * 100).toFixed(1).padStart(5)}%`
    );
  }

  // Show biggest moves
  lineMovements.sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
  console.log('\nBiggest line moves:');
  for (const m of lineMovements.slice(0, 10)) {
    const direction = m.move < 0 ? 'toward HOME' : 'toward AWAY';
    console.log(
      `  ${m.matchup.substring(0, 30).padEnd(30)} | ` +
      `${m.opening.toFixed(1)} → ${m.closing.toFixed(1)} (${direction}) | ` +
      `${m.steamWon ? 'STEAM WON' : 'STEAM LOST'}`
    );
  }
}

// =============================================================================
// 4. QB INJURY TIMING
// =============================================================================

async function analyzeQBInjuries() {
  console.log('\n=== 4. QB INJURY TIMING IMPACT ===\n');

  // Check if we have player data that could indicate QB status
  const { data: playerSeasons } = await supabase
    .from('player_seasons')
    .select('*')
    .ilike('position', '%QB%')
    .eq('season', 2023)
    .limit(20);

  console.log('Sample QB player_seasons data:');
  if (playerSeasons && playerSeasons.length > 0) {
    console.log(`Found ${playerSeasons.length} QB records`);
    console.log(JSON.stringify(playerSeasons[0], null, 2));
  } else {
    console.log('No QB data found in player_seasons');
  }

  // Check player_usage for QBs
  const { data: playerUsage } = await supabase
    .from('player_usage')
    .select('*')
    .ilike('position', '%QB%')
    .eq('season', 2023)
    .limit(20);

  console.log('\nSample QB player_usage data:');
  if (playerUsage && playerUsage.length > 0) {
    console.log(`Found ${playerUsage.length} QB usage records`);
    console.log(JSON.stringify(playerUsage[0], null, 2));

    // Check for games where starting QB usage dropped significantly
    // (could indicate injury/benching)
    console.log('\nNote: QB injury detection would require:');
    console.log('- Tracking weekly QB usage/snaps');
    console.log('- Detecting sudden drops in usage');
    console.log('- Cross-referencing with injury reports');
    console.log('- Currently, we have aggregate season data, not weekly');
  } else {
    console.log('No QB data found in player_usage');
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('=== ADVANCED ANALYSIS ===\n');

  await analyzeByEdgeBucket();
  await analyzeOpeningLineResidual();
  await analyzeQBInjuries();
  // await analyzeCLVByTiming(); // Takes longer, run separately if needed

  console.log('\n=== ANALYSIS COMPLETE ===');
}

main().catch(console.error);

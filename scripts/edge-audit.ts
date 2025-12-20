/**
 * Edge Audit Script
 *
 * Audits edge calculation for transparency and debugging.
 * MARKET_ANCHORED should differ from market by ~0-3 points most of the time.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const MODEL_VERSIONS = {
  MARKET_ANCHORED: 'SPREADS_MARKET_ANCHORED_V1',
  ELO_RAW: 'SPREADS_ELO_RAW_V1',
};

async function auditSingleEvent(eventId: string) {
  console.log('='.repeat(60));
  console.log('EDGE AUDIT - Single Event');
  console.log('='.repeat(60));

  // Get model version IDs
  const { data: versions } = await supabase
    .from('model_versions')
    .select('id, name')
    .in('name', [MODEL_VERSIONS.MARKET_ANCHORED, MODEL_VERSIONS.ELO_RAW]);

  const marketAnchoredId = versions?.find(v => v.name === MODEL_VERSIONS.MARKET_ANCHORED)?.id;
  const eloRawId = versions?.find(v => v.name === MODEL_VERSIONS.ELO_RAW)?.id;

  // Get event details
  const { data: event } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name)
    `)
    .eq('id', eventId)
    .single();

  if (!event) {
    console.log('Event not found:', eventId);
    return;
  }

  const home = (event.home_team as any)?.name || 'Unknown';
  const away = (event.away_team as any)?.name || 'Unknown';

  console.log(`\nEvent: ${away} @ ${home}`);
  console.log(`Event ID: ${eventId}`);
  console.log(`Commence: ${event.commence_time}`);

  // 1. Get the projection row used
  console.log('\n' + '-'.repeat(60));
  console.log('PROJECTION ROW (MARKET_ANCHORED)');
  console.log('-'.repeat(60));

  const { data: projection } = await supabase
    .from('projections')
    .select('*')
    .eq('event_id', eventId)
    .eq('model_version_id', marketAnchoredId)
    .single();

  if (!projection) {
    console.log('No MARKET_ANCHORED projection found!');
  } else {
    console.log(`  model_version_id: ${projection.model_version_id}`);
    console.log(`  generated_at:     ${projection.generated_at}`);
    console.log(`  model_spread_home: ${projection.model_spread_home}`);
    console.log(`  home_rating (baseline): ${projection.home_rating}`);
    console.log(`  away_rating (total_adj): ${projection.away_rating}`);

    // The baseline and adjustments are stored in home_rating and away_rating
    const baseline = projection.home_rating;
    const totalAdjustment = projection.away_rating;

    console.log(`\n  BREAKDOWN:`);
    console.log(`    Market baseline used: ${baseline}`);
    console.log(`    Total adjustment:     ${totalAdjustment}`);
    console.log(`    Final model spread:   ${projection.model_spread_home}`);
    console.log(`    Computed:             ${baseline} + ${totalAdjustment} = ${baseline + totalAdjustment}`);
  }

  // 2. Get ELO_RAW projection for comparison
  console.log('\n' + '-'.repeat(60));
  console.log('PROJECTION ROW (ELO_RAW)');
  console.log('-'.repeat(60));

  const { data: eloProjection } = await supabase
    .from('projections')
    .select('*')
    .eq('event_id', eventId)
    .eq('model_version_id', eloRawId)
    .single();

  if (!eloProjection) {
    console.log('No ELO_RAW projection found!');
  } else {
    console.log(`  model_version_id: ${eloProjection.model_version_id}`);
    console.log(`  generated_at:     ${eloProjection.generated_at}`);
    console.log(`  model_spread_home: ${eloProjection.model_spread_home}`);
    console.log(`  home_elo:         ${eloProjection.home_rating}`);
    console.log(`  away_elo:         ${eloProjection.away_rating}`);
  }

  // 3. Get the odds tick used for edge calculation
  console.log('\n' + '-'.repeat(60));
  console.log('ODDS TICKS (spread, home side)');
  console.log('-'.repeat(60));

  const { data: ticks } = await supabase
    .from('odds_ticks')
    .select(`
      spread_points_home,
      price_american,
      captured_at,
      sportsbooks(key, name)
    `)
    .eq('event_id', eventId)
    .eq('market_type', 'spread')
    .eq('side', 'home')
    .not('spread_points_home', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(10);

  console.log(`  Latest ticks (${ticks?.length || 0} found):`);
  for (const tick of ticks || []) {
    const book = (tick.sportsbooks as any)?.key || 'unknown';
    console.log(`    ${book}: ${tick.spread_points_home} @ ${tick.captured_at}`);
  }

  // Get the tick actually used (most recent per book)
  const latestByBook = new Map();
  for (const tick of ticks || []) {
    const bookKey = (tick.sportsbooks as any)?.key || 'unknown';
    if (!latestByBook.has(bookKey)) {
      latestByBook.set(bookKey, tick);
    }
  }

  // 4. Get the edge row
  console.log('\n' + '-'.repeat(60));
  console.log('EDGE ROWS');
  console.log('-'.repeat(60));

  const { data: edges } = await supabase
    .from('edges')
    .select(`
      sportsbook_id,
      market_spread_home,
      model_spread_home,
      edge_points,
      recommended_side,
      recommended_bet_label,
      as_of,
      explain,
      sportsbooks(key, name)
    `)
    .eq('event_id', eventId)
    .eq('market_type', 'spread');

  console.log(`  Edges found: ${edges?.length || 0}`);
  for (const edge of edges || []) {
    const book = (edge.sportsbooks as any)?.key || 'unknown';
    const explain = edge.explain as any;

    console.log(`\n  [${book}]`);
    console.log(`    market_spread_home: ${edge.market_spread_home}`);
    console.log(`    model_spread_home:  ${edge.model_spread_home}`);
    console.log(`    edge_points:        ${edge.edge_points}`);
    console.log(`    as_of:              ${edge.as_of}`);
    console.log(`    recommended:        ${edge.recommended_bet_label}`);
    console.log(`    tier:               ${explain?.confidenceTier}`);
    console.log(`    elo_disagreement:   ${explain?.eloDisagreementPoints}`);

    // VERIFY EDGE CALCULATION
    const expectedEdge = edge.market_spread_home - edge.model_spread_home;
    console.log(`    VERIFY: ${edge.market_spread_home} - ${edge.model_spread_home} = ${expectedEdge} (stored: ${edge.edge_points})`);

    if (Math.abs(expectedEdge - edge.edge_points) > 0.01) {
      console.log(`    *** MISMATCH! ***`);
    }
  }

  // 5. CRITICAL CHECK: Is the model using the market line as baseline?
  console.log('\n' + '-'.repeat(60));
  console.log('CRITICAL SANITY CHECK');
  console.log('-'.repeat(60));

  if (projection && ticks && ticks.length > 0) {
    const baselineInProjection = projection.home_rating;
    const latestMarketLine = ticks[0].spread_points_home;

    console.log(`  Baseline stored in projection: ${baselineInProjection}`);
    console.log(`  Latest market line available:  ${latestMarketLine}`);

    const diff = Math.abs(baselineInProjection - latestMarketLine);
    if (diff > 1) {
      console.log(`  *** WARNING: Baseline differs from current market by ${diff} pts ***`);
      console.log(`  This could indicate stale baseline or timing issue.`);
    } else {
      console.log(`  OK: Baseline matches market within 1 pt.`);
    }

    // Check total adjustment magnitude
    const totalAdj = projection.away_rating;
    if (Math.abs(totalAdj) > 5) {
      console.log(`\n  *** WARNING: Total adjustment ${totalAdj} is VERY LARGE ***`);
      console.log(`  MARKET_ANCHORED adjustments should typically be -3 to +3 pts.`);
    } else {
      console.log(`\n  OK: Total adjustment ${totalAdj} is within reasonable range.`);
    }
  }
}

async function distributionCheck() {
  console.log('\n\n' + '='.repeat(60));
  console.log('DISTRIBUTION CHECK');
  console.log('='.repeat(60));

  const now = new Date();
  const { data: allEdges } = await supabase
    .from('edges')
    .select(`
      event_id,
      edge_points,
      events(commence_time)
    `)
    .eq('market_type', 'spread');

  // Filter to upcoming
  const upcomingEdges = (allEdges || []).filter(e =>
    e.events?.commence_time && new Date(e.events.commence_time) > now
  );

  // Dedupe by event (keep max abs edge per event)
  const byEvent = new Map();
  for (const e of upcomingEdges) {
    const existing = byEvent.get(e.event_id);
    if (!existing || Math.abs(e.edge_points) > Math.abs(existing.edge_points)) {
      byEvent.set(e.event_id, e);
    }
  }

  const uniqueEdges = Array.from(byEvent.values());

  // Calculate distribution
  const buckets = {
    '0-1': 0,
    '1-2': 0,
    '2-3': 0,
    '3-4': 0,
    '4-5': 0,
    '5-6': 0,
    '6+': 0,
  };

  for (const e of uniqueEdges) {
    const abs = Math.abs(e.edge_points);
    if (abs < 1) buckets['0-1']++;
    else if (abs < 2) buckets['1-2']++;
    else if (abs < 3) buckets['2-3']++;
    else if (abs < 4) buckets['3-4']++;
    else if (abs < 5) buckets['4-5']++;
    else if (abs < 6) buckets['5-6']++;
    else buckets['6+']++;
  }

  const total = uniqueEdges.length;
  console.log(`\nEdge distribution (${total} unique events):`);
  console.log('-'.repeat(40));

  for (const [bucket, count] of Object.entries(buckets)) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
    const bar = '#'.repeat(Math.round(count / total * 30));
    console.log(`  ${bucket.padEnd(6)} pts: ${count.toString().padStart(3)} (${pct.padStart(5)}%) ${bar}`);
  }

  // FAIL CHECK
  const largeEdgeCount = buckets['6+'];
  const largeEdgePct = total > 0 ? (largeEdgeCount / total) * 100 : 0;

  console.log('\n' + '-'.repeat(40));
  console.log(`Large edges (>6 pts): ${largeEdgeCount} / ${total} = ${largeEdgePct.toFixed(1)}%`);

  if (largeEdgePct > 2) {
    console.log('\n*** FAIL: >2% of games have |edge| > 6 pts ***');
    console.log('MARKET_ANCHORED should differ from market by ~0-3 pts.');
    console.log('Investigate: baseline selection, adjustment magnitude, or model logic.');

    // Show the offending games
    console.log('\nGames with |edge| > 6:');
    const largeEdgeGames = uniqueEdges.filter(e => Math.abs(e.edge_points) > 6);
    for (const e of largeEdgeGames) {
      console.log(`  ${e.event_id}: ${e.edge_points.toFixed(1)} pts`);
    }
  } else {
    console.log('\nOK: Large edge percentage is acceptable.');
  }
}

async function main() {
  // Get the Oregon vs JMU event (the one with 13.5 pt edge)
  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name)
    `)
    .eq('status', 'scheduled')
    .gt('commence_time', new Date().toISOString())
    .limit(50);

  // Find the Oregon game
  const oregonGame = events?.find(e =>
    (e.home_team as any)?.name?.includes('Oregon') ||
    (e.away_team as any)?.name?.includes('Oregon')
  );

  if (oregonGame) {
    await auditSingleEvent(oregonGame.id);
  } else {
    // Audit first upcoming event
    const firstEvent = events?.[0];
    if (firstEvent) {
      await auditSingleEvent(firstEvent.id);
    }
  }

  await distributionCheck();
}

main().catch(console.error);

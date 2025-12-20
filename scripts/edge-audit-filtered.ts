/**
 * Edge Audit Script - Filtered to DraftKings and Bovada only
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const ALLOWED_BOOKS = ['draftkings', 'bovada'];

async function main() {
  console.log('='.repeat(60));
  console.log('EDGE AUDIT - DraftKings & Bovada Only');
  console.log('='.repeat(60));

  // Get allowed sportsbook IDs
  const { data: allowedBooks } = await supabase
    .from('sportsbooks')
    .select('id, key, name')
    .in('key', ALLOWED_BOOKS);

  const allowedIds = (allowedBooks || []).map(b => b.id);
  console.log(`\nFiltering to: ${(allowedBooks || []).map(b => b.name).join(', ')}`);

  // Get all edges from allowed books
  const now = new Date();
  const { data: edges } = await supabase
    .from('edges')
    .select(`
      event_id,
      edge_points,
      market_spread_home,
      model_spread_home,
      explain,
      sportsbooks(key, name),
      events(
        commence_time,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name)
      )
    `)
    .in('sportsbook_id', allowedIds)
    .eq('market_type', 'spread');

  // Filter to upcoming only
  const upcomingEdges = (edges || []).filter(e =>
    e.events?.commence_time && new Date(e.events.commence_time) > now
  );

  console.log(`\nFound ${upcomingEdges.length} edges from allowed books\n`);

  // Show all edges sorted by absolute value
  console.log('-'.repeat(60));
  console.log('ALL EDGES (sorted by |edge|)');
  console.log('-'.repeat(60));

  const sorted = [...upcomingEdges].sort((a, b) => Math.abs(b.edge_points) - Math.abs(a.edge_points));

  for (const edge of sorted) {
    const home = (edge.events?.home_team as any)?.name || 'Unknown';
    const away = (edge.events?.away_team as any)?.name || 'Unknown';
    const book = (edge.sportsbooks as any)?.key || 'unknown';
    const explain = edge.explain as any;

    const tier = explain?.confidenceTier || 'unknown';
    const isOutlier = explain?.isOutlier || false;
    const consensus = explain?.consensusSpread;

    console.log(`\n${away} @ ${home} [${book}]`);
    console.log(`  Market: ${edge.market_spread_home > 0 ? '+' : ''}${edge.market_spread_home}`);
    console.log(`  Model:  ${edge.model_spread_home?.toFixed(1)}`);
    console.log(`  Edge:   ${edge.edge_points?.toFixed(1)} pts`);
    console.log(`  Tier:   ${tier}${isOutlier ? ' (OUTLIER)' : ''}`);
    console.log(`  Consensus: ${consensus?.toFixed(1) || 'N/A'}`);

    if (isOutlier) {
      console.log(`  *** OUTLIER WARNING: This line deviates from market consensus ***`);
    }
  }

  // Distribution check
  console.log('\n\n' + '='.repeat(60));
  console.log('DISTRIBUTION CHECK');
  console.log('='.repeat(60));

  // Dedupe by event (take max abs edge per event)
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
  console.log(`\nEdge distribution (${total} unique events, DK/Bovada only):`);
  console.log('-'.repeat(40));

  for (const [bucket, count] of Object.entries(buckets)) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
    const bar = '#'.repeat(Math.round(count / total * 30));
    console.log(`  ${bucket.padEnd(6)} pts: ${count.toString().padStart(3)} (${pct.padStart(5)}%) ${bar}`);
  }

  // Check for large edges
  const largeEdgeCount = buckets['6+'];
  const largeEdgePct = total > 0 ? (largeEdgeCount / total) * 100 : 0;

  console.log('\n' + '-'.repeat(40));
  console.log(`Large edges (>6 pts): ${largeEdgeCount} / ${total} = ${largeEdgePct.toFixed(1)}%`);

  if (largeEdgePct > 2) {
    console.log('\n*** FAIL: >2% of games have |edge| > 6 pts ***');
  } else {
    console.log('\n*** PASS: Large edge percentage is acceptable ***');
  }

  // Show expected edge range
  console.log('\n' + '='.repeat(60));
  console.log('EXPECTED BEHAVIOR');
  console.log('='.repeat(60));
  console.log('MARKET_ANCHORED should differ from market by ~0-3 pts.');
  console.log('This model uses the market line as baseline and applies');
  console.log('small adjustments for conference strength, bowl games, etc.');
  console.log('');
  console.log('If edges are consistently >5 pts, investigate:');
  console.log('  1. Baseline selection (is it using stale market line?)');
  console.log('  2. Adjustment magnitude (are adjustments too large?)');
  console.log('  3. Data quality (are spreads from reliable books?)');
}

main().catch(console.error);

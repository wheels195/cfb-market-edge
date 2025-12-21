/**
 * Run materializeEdgesV2 - the clean architecture version
 * that reads projections from the database (doesn't generate them)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== MATERIALIZE EDGES V2 ===\n');

  // Check projections first
  const { data: versions } = await supabase
    .from('model_versions')
    .select('id, name')
    .in('name', ['SPREADS_MARKET_ANCHORED_V1', 'SPREADS_ELO_RAW_V1']);

  const marketAnchoredId = versions?.find(v => v.name === 'SPREADS_MARKET_ANCHORED_V1')?.id;

  const { count: projectionCount } = await supabase
    .from('projections')
    .select('id', { count: 'exact', head: true })
    .eq('model_version_id', marketAnchoredId);

  console.log(`Market-anchored projections available: ${projectionCount}\n`);

  // Import and run
  const { materializeEdgesV2 } = await import('../src/lib/jobs/materialize-edges-v2');

  console.log('Running materializeEdgesV2...\n');
  const result = await materializeEdgesV2();

  console.log('\n=== RESULT ===');
  console.log(`Events processed: ${result.eventsProcessed}`);
  console.log(`Events skipped: ${result.eventsSkipped}`);
  console.log(`Edges created: ${result.edgesCreated}`);
  console.log(`Edges updated: ${result.edgesUpdated}`);
  console.log(`Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of result.errors.slice(0, 5)) {
      console.log(`  - ${err}`);
    }
  }

  // Show top edges
  console.log('\n=== TOP EDGES (by absolute value) ===');
  const now = new Date();
  const { data: edges } = await supabase
    .from('edges')
    .select(`
      event_id,
      sportsbook_id,
      market_spread_home,
      model_spread_home,
      edge_points,
      recommended_side,
      recommended_bet_label,
      explain,
      sportsbooks(name),
      events(
        commence_time,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name)
      )
    `)
    .eq('market_type', 'spread')
    .order('edge_points', { ascending: false })
    .limit(20);

  // Filter to upcoming and dedupe by event
  const upcoming = (edges || []).filter(e =>
    e.events?.commence_time && new Date(e.events.commence_time) > now
  );

  const byEvent = new Map();
  for (const e of upcoming) {
    const eventId = e.event_id;
    if (!byEvent.has(eventId) || Math.abs(e.edge_points) > Math.abs(byEvent.get(eventId).edge_points)) {
      byEvent.set(eventId, e);
    }
  }

  const sorted = Array.from(byEvent.values())
    .sort((a, b) => Math.abs(b.edge_points) - Math.abs(a.edge_points))
    .slice(0, 5);

  for (const edge of sorted) {
    const home = (edge.events?.home_team as any)?.name || 'Unknown';
    const away = (edge.events?.away_team as any)?.name || 'Unknown';
    const book = (edge.sportsbooks as any)?.name || 'Unknown';
    const explain = edge.explain as any;

    console.log(`\n${away} @ ${home} [${book}]`);
    console.log(`  Market: ${edge.market_spread_home > 0 ? '+' : ''}${edge.market_spread_home}`);
    console.log(`  Model:  ${edge.model_spread_home?.toFixed(1)}`);
    console.log(`  Edge:   ${edge.edge_points?.toFixed(1)} pts → ${edge.recommended_bet_label}`);
    console.log(`  Tier:   ${explain?.confidenceTier || 'unknown'}`);
    console.log(`  EV:     ${explain?.expectedValue}%`);
    if (explain?.eloDisagreementPoints !== null && explain?.eloDisagreementPoints !== undefined) {
      console.log(`  Elo Δ:  ${explain.eloDisagreementPoints?.toFixed(1)} pts (${explain.eloDisagreementPoints > 5 ? 'WARNING' : 'OK'})`);
    }
  }
}

main().catch(console.error);

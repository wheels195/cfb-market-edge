/**
 * Test Dual Model Pipeline
 *
 * Verifies the refactored pipeline:
 * 1. Check model versions exist
 * 2. Generate dual projections for upcoming events
 * 3. Materialize edges from projections (V2)
 * 4. Verify edge output has correct structure
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

async function main() {
  console.log('=== DUAL MODEL PIPELINE TEST ===\n');

  // Step 1: Verify model versions
  console.log('Step 1: Checking model versions...');
  const { data: versions } = await supabase
    .from('model_versions')
    .select('id, name, description')
    .in('name', [MODEL_VERSIONS.MARKET_ANCHORED, MODEL_VERSIONS.ELO_RAW]);

  if (!versions || versions.length < 2) {
    console.error('ERROR: Missing model versions. Found:', versions);
    console.log('Run: npx tsx scripts/migrate-dual-models.ts');
    return;
  }

  const marketAnchoredId = versions.find(v => v.name === MODEL_VERSIONS.MARKET_ANCHORED)?.id;
  const eloRawId = versions.find(v => v.name === MODEL_VERSIONS.ELO_RAW)?.id;

  console.log('  MARKET_ANCHORED:', marketAnchoredId);
  console.log('  ELO_RAW:', eloRawId);
  console.log('  OK\n');

  // Step 2: Check upcoming events
  console.log('Step 2: Checking upcoming events...');
  const now = new Date();
  const { data: upcomingEvents } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name)
    `)
    .eq('status', 'scheduled')
    .gt('commence_time', now.toISOString())
    .order('commence_time', { ascending: true })
    .limit(10);

  if (!upcomingEvents || upcomingEvents.length === 0) {
    console.log('  No upcoming events found');
    return;
  }

  console.log(`  Found ${upcomingEvents.length} upcoming events`);
  for (const e of upcomingEvents.slice(0, 3)) {
    const home = (e.home_team as any)?.name || 'Unknown';
    const away = (e.away_team as any)?.name || 'Unknown';
    console.log(`  - ${away} @ ${home}`);
  }
  console.log('  ...\n');

  // Step 3: Check projections for both models
  console.log('Step 3: Checking projections...');
  const eventIds = upcomingEvents.map(e => e.id);

  const { data: marketProjections } = await supabase
    .from('projections')
    .select('event_id, model_spread_home')
    .in('event_id', eventIds)
    .eq('model_version_id', marketAnchoredId);

  const { data: eloProjections } = await supabase
    .from('projections')
    .select('event_id, model_spread_home')
    .in('event_id', eventIds)
    .eq('model_version_id', eloRawId);

  console.log(`  MARKET_ANCHORED projections: ${marketProjections?.length || 0}/${eventIds.length}`);
  console.log(`  ELO_RAW projections: ${eloProjections?.length || 0}/${eventIds.length}`);

  if (!marketProjections || marketProjections.length === 0) {
    console.log('\n  WARNING: No market-anchored projections. Run: npx tsx -e "import {runModel} from \'./src/lib/jobs/run-model\'; runModel().then(console.log);"');
  }
  console.log();

  // Step 4: Check edges
  console.log('Step 4: Checking edges...');
  const { data: edges } = await supabase
    .from('edges')
    .select(`
      event_id,
      sportsbook_id,
      market_type,
      market_spread_home,
      model_spread_home,
      edge_points,
      recommended_side,
      recommended_bet_label,
      explain,
      sportsbooks(name)
    `)
    .in('event_id', eventIds)
    .eq('market_type', 'spread')
    .order('edge_points', { ascending: false })
    .limit(20);

  if (!edges || edges.length === 0) {
    console.log('  No edges found. Need to run materializeEdgesV2.');
  } else {
    console.log(`  Found ${edges.length} spread edges\n`);

    // Group by event
    const edgesByEvent = new Map<string, typeof edges[0]>();
    for (const e of edges) {
      if (!edgesByEvent.has(e.event_id) || Math.abs(e.edge_points) > Math.abs(edgesByEvent.get(e.event_id)!.edge_points)) {
        edgesByEvent.set(e.event_id, e);
      }
    }

    console.log('  Top edges by event:');
    const sortedEdges = Array.from(edgesByEvent.values())
      .sort((a, b) => Math.abs(b.edge_points) - Math.abs(a.edge_points))
      .slice(0, 5);

    for (const edge of sortedEdges) {
      const event = upcomingEvents.find(e => e.id === edge.event_id);
      const home = (event?.home_team as any)?.name || 'Unknown';
      const away = (event?.away_team as any)?.name || 'Unknown';
      const book = (edge.sportsbooks as any)?.name || 'Unknown';

      console.log(`\n  ${away} @ ${home} [${book}]`);
      console.log(`    Market: ${edge.market_spread_home > 0 ? '+' : ''}${edge.market_spread_home}`);
      console.log(`    Model:  ${edge.model_spread_home?.toFixed(1)}`);
      console.log(`    Edge:   ${edge.edge_points?.toFixed(1)} pts`);
      console.log(`    Bet:    ${edge.recommended_bet_label}`);

      // Check if explain has the expected structure
      if (edge.explain) {
        const explain = edge.explain as any;
        console.log(`    EV:     ${explain.expectedValue}%`);
        console.log(`    Tier:   ${explain.confidenceTier}`);
        if (explain.eloDisagreementPoints !== null) {
          console.log(`    Elo Δ:  ${explain.eloDisagreementPoints?.toFixed(1)} pts`);
        }
        if (explain.warnings?.length > 0) {
          console.log(`    Warn:   ${explain.warnings.join(', ')}`);
        }
      }
    }
  }

  // Step 5: Compare projections
  console.log('\n\nStep 5: Comparing market-anchored vs elo-raw projections...');
  if (marketProjections && eloProjections) {
    const marketByEvent = new Map(marketProjections.map(p => [p.event_id, p.model_spread_home]));
    const eloByEvent = new Map(eloProjections.map(p => [p.event_id, p.model_spread_home]));

    const comparisons = [];
    for (const [eventId, marketSpread] of marketByEvent) {
      const eloSpread = eloByEvent.get(eventId);
      if (eloSpread !== undefined) {
        const disagreement = Math.abs(marketSpread - eloSpread);
        comparisons.push({ eventId, marketSpread, eloSpread, disagreement });
      }
    }

    // Sort by disagreement
    comparisons.sort((a, b) => b.disagreement - a.disagreement);

    if (comparisons.length > 0) {
      console.log('\n  Largest disagreements:');
      for (const c of comparisons.slice(0, 5)) {
        const event = upcomingEvents.find(e => e.id === c.eventId);
        const home = (event?.home_team as any)?.name || 'Unknown';
        const away = (event?.away_team as any)?.name || 'Unknown';

        console.log(`\n  ${away} @ ${home}`);
        console.log(`    Market-Anchored: ${c.marketSpread?.toFixed(1)}`);
        console.log(`    Elo-Raw:         ${c.eloSpread?.toFixed(1)}`);
        console.log(`    Disagreement:    ${c.disagreement?.toFixed(1)} pts`);
      }
    }
  }

  console.log('\n\n=== TEST COMPLETE ===');
}

main().catch(console.error);

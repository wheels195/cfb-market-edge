/**
 * Test T-60 Production Model on 2025 Bowl Games
 *
 * Runs materializeEdgesT60() and shows results.
 */

import { createClient } from '@supabase/supabase-js';
import { materializeEdgesT60 } from '../src/lib/jobs/materialize-edges-t60';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('==========================================');
  console.log('  T-60 Production Model Test');
  console.log('  2025 Bowl Games');
  console.log('==========================================\n');

  // Run materialize
  console.log('Running materializeEdgesT60()...\n');
  const result = await materializeEdgesT60();

  console.log('Results:');
  console.log(`  Events processed: ${result.eventsProcessed}`);
  console.log(`  FBS filtered out: ${result.fbsFiltered}`);
  console.log(`  Edges created: ${result.edgesCreated}`);
  console.log(`  Edges updated: ${result.edgesUpdated}`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    result.errors.forEach(e => console.log(`  - ${e}`));
  }

  // Fetch and display edges
  console.log('\n==========================================');
  console.log('  Current Edges (T-60 Model)');
  console.log('==========================================\n');

  const { data: edges } = await supabase
    .from('edges')
    .select(`
      id,
      event_id,
      market_spread_home,
      model_spread_home,
      edge_points,
      recommended_side,
      recommended_bet_label,
      explain,
      events!inner(
        commence_time,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name)
      )
    `)
    .eq('market_type', 'spread')
    .order('edge_points', { ascending: false });

  if (!edges || edges.length === 0) {
    console.log('No edges found.');
    return;
  }

  // Display edges
  console.log('| Matchup | Market | Model | Edge | Qualifies | Recommendation |');
  console.log('|---------|--------|-------|------|-----------|----------------|');

  for (const edge of edges) {
    const homeTeam = Array.isArray(edge.events.home_team)
      ? edge.events.home_team[0]?.name
      : edge.events.home_team?.name;
    const awayTeam = Array.isArray(edge.events.away_team)
      ? edge.events.away_team[0]?.name
      : edge.events.away_team?.name;

    const matchup = `${awayTeam} @ ${homeTeam}`;
    const market = edge.market_spread_home >= 0 ? `+${edge.market_spread_home}` : `${edge.market_spread_home}`;
    const model = edge.model_spread_home >= 0 ? `+${edge.model_spread_home.toFixed(1)}` : `${edge.model_spread_home.toFixed(1)}`;
    const edgePts = edge.edge_points >= 0 ? `+${edge.edge_points.toFixed(1)}` : `${edge.edge_points.toFixed(1)}`;
    const qualifies = edge.explain?.qualifies ? 'YES' : 'no';
    const rec = edge.explain?.qualifies ? edge.recommended_bet_label : edge.explain?.reason?.substring(0, 30) || '-';

    console.log(`| ${matchup.substring(0, 30).padEnd(30)} | ${market.padStart(6)} | ${model.padStart(6)} | ${edgePts.padStart(5)} | ${qualifies.padStart(9)} | ${rec.substring(0, 30)} |`);
  }

  // Summary of qualified bets
  const qualifiedEdges = edges.filter(e => e.explain?.qualifies);
  console.log(`\n--- Summary ---`);
  console.log(`Total edges: ${edges.length}`);
  console.log(`Qualified bets (2.5-5 pt edge): ${qualifiedEdges.length}`);

  if (qualifiedEdges.length > 0) {
    console.log('\nQualified Bets:');
    for (const edge of qualifiedEdges) {
      const homeTeam = Array.isArray(edge.events.home_team)
        ? edge.events.home_team[0]?.name
        : edge.events.home_team?.name;
      const awayTeam = Array.isArray(edge.events.away_team)
        ? edge.events.away_team[0]?.name
        : edge.events.away_team?.name;

      console.log(`  ${edge.recommended_bet_label}`);
      console.log(`    ${awayTeam} @ ${homeTeam}`);
      console.log(`    Edge: ${Math.abs(edge.edge_points).toFixed(1)} pts`);
      console.log(`    Win Prob: ${edge.explain?.winProbability}%`);
      console.log(`    Expected ROI: ${edge.explain?.expectedValue}%`);
      console.log('');
    }
  }
}

main().catch(console.error);

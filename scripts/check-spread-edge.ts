/**
 * Check Alabama spread edge details
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Alabama event ID from earlier: 8687dbf9-121c-48eb-958d-9e8543a57052
  const eventId = '8687dbf9-121c-48eb-958d-9e8543a57052';

  const { data: edges } = await supabase
    .from('edges')
    .select('*')
    .eq('event_id', eventId)
    .eq('market_type', 'spread');

  console.log('Alabama @ Oklahoma SPREAD edges:\n');

  for (const edge of edges || []) {
    console.log(`Sportsbook: ${edge.sportsbook_id.slice(0, 8)}`);
    console.log(`  market_spread_home: ${edge.market_spread_home}`);
    console.log(`  model_spread_home: ${edge.model_spread_home}`);
    console.log(`  edge_points: ${edge.edge_points}`);
    console.log(`  recommended_side: ${edge.recommended_side}`);
    console.log(`  recommended_bet_label: ${edge.recommended_bet_label}`);
    console.log(`  as_of: ${edge.as_of}`);
    console.log(`  explain.rawEdge: ${edge.explain?.rawEdge}`);
    console.log(`  explain.cappedEdge: ${edge.explain?.cappedEdge}`);
    console.log(`  explain.adjustmentBreakdown:`, JSON.stringify(edge.explain?.adjustmentBreakdown, null, 4));
    console.log('');
  }
}

main().catch(console.error);

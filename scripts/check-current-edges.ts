import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Get upcoming edges - one per event (dedupe by taking max edge per event)
  const { data: edges, error } = await supabase
    .from('edges')
    .select(`
      *,
      sportsbooks(name),
      events(
        id,
        commence_time,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name)
      )
    `)
    .eq('market_type', 'spread')
    .order('edge_points', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error:', error);
    return;
  }

  // Filter to upcoming games and dedupe by event
  const now = new Date();
  const upcoming = (edges || []).filter(e =>
    e.events?.commence_time && new Date(e.events.commence_time) > now
  );

  // Dedupe by event_id (keep highest edge per game)
  const byEvent = new Map();
  for (const e of upcoming) {
    const eventId = e.events?.id;
    if (!eventId) continue;
    if (!byEvent.has(eventId) || Math.abs(e.edge_points) > Math.abs(byEvent.get(eventId).edge_points)) {
      byEvent.set(eventId, e);
    }
  }

  // Sort by absolute edge
  const deduped = Array.from(byEvent.values()).sort((a, b) =>
    Math.abs(b.edge_points) - Math.abs(a.edge_points)
  );

  console.log('=== CURRENT BOWL GAME EDGES (Top 10) ===\n');

  for (const e of deduped.slice(0, 10)) {
    const home = (e.events?.home_team as any)?.name || 'Unknown';
    const away = (e.events?.away_team as any)?.name || 'Unknown';
    const book = (e.sportsbooks as any)?.name || 'Unknown';
    const time = e.events?.commence_time
      ? new Date(e.events.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';

    console.log(`${away} @ ${home} (${time}) [${book}]`);
    console.log(`  Market: ${e.market_spread_home > 0 ? '+' : ''}${e.market_spread_home}`);
    console.log(`  Model: ${e.model_spread_home?.toFixed(1)}`);
    console.log(`  Edge: ${e.edge_points?.toFixed(1)} pts → ${e.recommended_bet_label}`);
    console.log();
  }
}

main().catch(console.error);

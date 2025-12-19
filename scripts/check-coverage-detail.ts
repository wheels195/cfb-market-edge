import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  const now = new Date();
  const lookaheadEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  // Get events in lookahead window
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'scheduled')
    .gt('commence_time', now.toISOString())
    .lt('commence_time', lookaheadEnd.toISOString());

  const eventIds = (events || []).map(e => e.id);
  console.log(`Events in 10-day window: ${eventIds.length}`);

  // Get sportsbooks
  const { data: sportsbooks } = await supabase
    .from('sportsbooks')
    .select('id, key, name');

  console.log('\nCoverage by sportsbook (ticks in last 2 hours):');

  for (const sb of sportsbooks || []) {
    // Count spread coverage
    const { data: spreadTicks } = await supabase
      .from('odds_ticks')
      .select('event_id')
      .in('event_id', eventIds)
      .eq('sportsbook_id', sb.id)
      .eq('market_type', 'spread')
      .gte('captured_at', twoHoursAgo);

    const spreadEvents = new Set((spreadTicks || []).map(t => t.event_id));

    // Count total coverage
    const { data: totalTicks } = await supabase
      .from('odds_ticks')
      .select('event_id')
      .in('event_id', eventIds)
      .eq('sportsbook_id', sb.id)
      .eq('market_type', 'total')
      .gte('captured_at', twoHoursAgo);

    const totalEvents = new Set((totalTicks || []).map(t => t.event_id));

    console.log(`  ${sb.name}: spread=${spreadEvents.size}/${eventIds.length} (${(spreadEvents.size / eventIds.length * 100).toFixed(1)}%), total=${totalEvents.size}/${eventIds.length} (${(totalEvents.size / eventIds.length * 100).toFixed(1)}%)`);
  }

  // Check if we need to bypass the gate for now
  console.log('\n--- Note: The 85% coverage gate may need adjustment for off-season or low-odds periods ---');
}

check().catch(console.error);

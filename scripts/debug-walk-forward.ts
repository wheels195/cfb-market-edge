import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  const season = 2022;
  const seasonStart = `${season}-08-01`;
  const seasonEnd = `${season + 1}-02-15`;

  console.log(`Debugging walk-forward for ${season} season`);
  console.log(`Date range: ${seasonStart} to ${seasonEnd}\n`);

  // Get events
  const { data: events } = await supabase
    .from('events')
    .select('id, commence_time, status')
    .eq('status', 'final')
    .gte('commence_time', seasonStart)
    .lte('commence_time', seasonEnd)
    .limit(100);

  console.log(`Found ${events?.length || 0} events`);

  if (!events || events.length === 0) return;

  // Get event IDs
  const eventIds = events.map(e => e.id);
  console.log(`\nSample event IDs: ${eventIds.slice(0, 3).join(', ')}`);

  // Query closing lines for these events
  const { data: closingLines, error } = await supabase
    .from('closing_lines')
    .select('event_id, spread_points_home, market_type, side')
    .in('event_id', eventIds.slice(0, 20)) // Just check first 20
    .eq('market_type', 'spread')
    .eq('side', 'home');

  if (error) {
    console.log(`\nClosing lines error: ${error.message}`);
    return;
  }

  console.log(`\nClosing lines found for first 20 events: ${closingLines?.length || 0}`);
  if (closingLines && closingLines.length > 0) {
    console.log('\nSample closing lines:');
    for (const cl of closingLines.slice(0, 5)) {
      console.log(`  Event ${cl.event_id}: spread=${cl.spread_points_home}`);
    }
  }

  // Check how many events have closing lines
  const { data: allCL } = await supabase
    .from('closing_lines')
    .select('event_id')
    .in('event_id', eventIds)
    .eq('market_type', 'spread')
    .eq('side', 'home');

  const uniqueEventIds = new Set((allCL || []).map(c => c.event_id));
  console.log(`\nEvents with spread closing lines: ${uniqueEventIds.size} out of ${eventIds.length}`);
}

main().catch(console.error);

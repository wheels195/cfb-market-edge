import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  // Check odds_ticks table
  const { count } = await supabase.from('odds_ticks').select('*', { count: 'exact', head: true });
  console.log('Total odds_ticks:', count);

  // Sample
  const { data } = await supabase.from('odds_ticks').select('*').limit(5);
  console.log('\nSample odds_ticks:');
  console.log(JSON.stringify(data, null, 2));

  // Check for events with multiple ticks
  const { data: tickCounts } = await supabase
    .from('odds_ticks')
    .select('event_id')
    .limit(10000);

  const counts = new Map<string, number>();
  for (const t of tickCounts || []) {
    counts.set(t.event_id, (counts.get(t.event_id) || 0) + 1);
  }

  const multiTick = Array.from(counts.entries()).filter(([_, c]) => c > 4);
  console.log('\nEvents with 5+ ticks:', multiTick.length);

  // Get an event with multiple ticks
  if (multiTick.length > 0) {
    const [eventId] = multiTick[0];
    const { data: ticks } = await supabase
      .from('odds_ticks')
      .select('captured_at, spread_points_home, market_type, side')
      .eq('event_id', eventId)
      .eq('market_type', 'spread')
      .eq('side', 'home')
      .order('captured_at');

    console.log('\nSample event ticks:');
    console.log(JSON.stringify(ticks, null, 2));
  }
}

check();

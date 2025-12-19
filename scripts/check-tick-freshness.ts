import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  // Get latest ticks
  const { data: ticks } = await supabase
    .from('odds_ticks')
    .select('captured_at, event_id')
    .order('captured_at', { ascending: false })
    .limit(5);

  console.log('Latest 5 ticks:');
  for (const t of ticks || []) {
    console.log(`  ${t.captured_at}`);
  }

  // Get upcoming events count
  const { count } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gt('commence_time', new Date().toISOString());

  console.log(`\nUpcoming scheduled events: ${count}`);

  // Check coverage manually
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  console.log(`\nTwo hours ago: ${twoHoursAgo}`);

  const { data: recentTicks } = await supabase
    .from('odds_ticks')
    .select('event_id')
    .gte('captured_at', twoHoursAgo);

  const uniqueEvents = new Set((recentTicks || []).map(t => t.event_id));
  console.log(`Events with ticks in last 2 hours: ${uniqueEvents.size}`);
}

check().catch(console.error);

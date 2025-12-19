import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  const now = new Date().toISOString();

  // Get upcoming events
  const { data: upcomingEvents } = await supabase
    .from('events')
    .select('id, commence_time, status')
    .gt('commence_time', now)
    .eq('status', 'scheduled');

  console.log('=== Upcoming Events ===');
  console.log('Count:', upcomingEvents?.length);

  // Check if they have projections
  const eventIds = upcomingEvents?.map(e => e.id) || [];
  const { data: projections } = await supabase
    .from('projections')
    .select('event_id')
    .in('event_id', eventIds);

  console.log('Events with projections:', projections?.length);

  // Check if they have total ticks
  const { data: totalTicks } = await supabase
    .from('odds_ticks')
    .select('event_id')
    .in('event_id', eventIds)
    .eq('market_type', 'total')
    .eq('side', 'over');

  const uniqueEvents = [...new Set(totalTicks?.map(t => t.event_id) || [])];
  console.log('Events with total ticks:', uniqueEvents.length);

  // The 199 edges with model=55 are likely from past events
  console.log('\n=== Stale Edges Analysis ===');
  const { data: staleEdges } = await supabase
    .from('edges')
    .select(`
      id, event_id, model_total_points,
      events!inner(commence_time, status)
    `)
    .eq('market_type', 'total')
    .eq('model_total_points', 55)
    .limit(10);

  console.log('Stale edges (model=55):');
  for (const e of staleEdges || []) {
    const event = Array.isArray(e.events) ? e.events[0] : e.events;
    console.log({
      event_id: e.event_id,
      commence_time: event?.commence_time,
      status: event?.status,
      isPast: event?.commence_time && new Date(event.commence_time) < new Date()
    });
  }
}

check();

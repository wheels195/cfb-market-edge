import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  // Get total edges still showing 55
  const { data: staleEdges } = await supabase
    .from('edges')
    .select(`
      id, event_id, model_total_points,
      events!inner(commence_time, status)
    `)
    .eq('market_type', 'total')
    .eq('model_total_points', 55)
    .limit(20);

  const now = new Date();
  let pastEvents = 0;
  let futureEvents = 0;
  let noProjection = 0;

  const eventIds = (staleEdges || []).map(e => e.event_id);
  const { data: projections } = await supabase
    .from('projections')
    .select('event_id')
    .in('event_id', eventIds);

  const projectionsSet = new Set((projections || []).map(p => p.event_id));

  console.log('=== Stale Edges Analysis (model=55) ===');
  for (const e of staleEdges || []) {
    const event = Array.isArray(e.events) ? e.events[0] : e.events;
    const isPast = event?.commence_time && new Date(event.commence_time) < now;
    const hasProjection = projectionsSet.has(e.event_id);

    if (isPast) pastEvents++;
    else futureEvents++;
    if (!hasProjection) noProjection++;

    console.log({
      event_id: e.event_id,
      commence: event?.commence_time,
      status: event?.status,
      isPast,
      hasProjection
    });
  }

  console.log('\n=== Summary ===');
  console.log('Past events (already happened):', pastEvents);
  console.log('Future events:', futureEvents);
  console.log('Missing projection:', noProjection);
  console.log('');
  console.log('Recommendation: Past events with model=55 are fine to leave.');
  console.log('Future events without projections need runModel to generate projections.');
}

check();

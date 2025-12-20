/**
 * Check current odds data in database
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  // Check existing odds data
  const { count: ticksCount } = await supabase.from('odds_ticks').select('*', { count: 'exact', head: true });
  const { count: closeCount } = await supabase.from('closing_lines').select('*', { count: 'exact', head: true });

  // Sample odds_ticks to see structure
  const { data: sample } = await supabase.from('odds_ticks').select('*').limit(3);

  // Check how many have tick_type set
  const { data: tickTypes } = await supabase.from('odds_ticks').select('tick_type').limit(1000);
  const typeCounts: Record<string, number> = {};
  for (const t of tickTypes || []) {
    const type = t.tick_type || 'null';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  // Check what columns exist in odds_ticks
  const { data: colSample } = await supabase.from('odds_ticks').select('*').limit(1);

  console.log('Current odds data:');
  console.log('  odds_ticks:', ticksCount);
  console.log('  closing_lines:', closeCount);
  console.log('  tick_type distribution (sample of 1000):', typeCounts);
  console.log('\nSample tick columns:', colSample ? Object.keys(colSample[0] || {}) : 'none');
  console.log('\nSample tick:', JSON.stringify(sample?.[0], null, 2));

  // Check events with cfbd_game_id
  const { count: eventsWithCfbd } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .not('cfbd_game_id', 'is', null);

  console.log('\nEvents with cfbd_game_id:', eventsWithCfbd);
}

check().catch(console.error);

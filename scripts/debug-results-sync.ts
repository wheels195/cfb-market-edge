/**
 * Debug results sync - why do we have 1,397 final events but only 337 results?
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function debug() {
  console.log('=== Debug Results Sync ===\n');

  // Count final events by season
  console.log('1. Final events by season:');
  for (const season of [2022, 2023, 2024]) {
    const startDate = `${season}-08-01`;
    const endDate = `${season + 1}-02-01`;

    const { count } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'final')
      .gte('commence_time', startDate)
      .lt('commence_time', endDate);

    console.log(`  ${season}: ${count} final events`);
  }

  // Count results
  console.log('\n2. Results in results table:');
  const { count: totalResults } = await supabase
    .from('results')
    .select('*', { count: 'exact', head: true });
  console.log(`  Total results: ${totalResults}`);

  // Check final events WITHOUT results
  console.log('\n3. Final events missing results:');

  // Get sample of final events
  const { data: finalEvents } = await supabase
    .from('events')
    .select('id, commence_time, status, cfbd_game_id, home_team:home_team_id(name), away_team:away_team_id(name)')
    .eq('status', 'final')
    .order('commence_time')
    .limit(100);

  // Get all result event_ids
  const { data: results } = await supabase
    .from('results')
    .select('event_id');
  const resultEventIds = new Set(results?.map(r => r.event_id) || []);

  let withResult = 0;
  let withoutResult = 0;
  const missingResults: any[] = [];

  for (const event of finalEvents || []) {
    if (resultEventIds.has(event.id)) {
      withResult++;
    } else {
      withoutResult++;
      if (missingResults.length < 10) {
        missingResults.push(event);
      }
    }
  }

  console.log(`  Sample of 100 final events: ${withResult} have results, ${withoutResult} missing`);

  console.log('\n  Sample events MISSING results:');
  for (const e of missingResults) {
    const home = (e.home_team as any)?.name || 'Unknown';
    const away = (e.away_team as any)?.name || 'Unknown';
    console.log(`    ${e.commence_time.split('T')[0]}: ${away} @ ${home}`);
    console.log(`      cfbd_game_id: ${e.cfbd_game_id || 'NULL'}`);
  }

  // Check if cfbd_game_id is populated
  console.log('\n4. Events with cfbd_game_id populated:');
  const { count: withCfbd } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'final')
    .not('cfbd_game_id', 'is', null);

  const { count: withoutCfbd } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'final')
    .is('cfbd_game_id', null);

  console.log(`  With cfbd_game_id: ${withCfbd}`);
  console.log(`  Without cfbd_game_id: ${withoutCfbd}`);

  // Check results table schema
  console.log('\n5. Sample results:');
  const { data: sampleResults } = await supabase
    .from('results')
    .select('*')
    .limit(5);

  for (const r of sampleResults || []) {
    console.log(`  event_id: ${r.event_id}, home: ${r.home_score}, away: ${r.away_score}`);
  }
}

debug().catch(console.error);

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('Checking events table...\n');

  // Get total count
  const { count: total } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });

  console.log(`Total events: ${total}`);

  // Count by status
  const { data: statusData } = await supabase
    .from('events')
    .select('status');

  const statusCounts: Record<string, number> = {};
  for (const e of statusData || []) {
    statusCounts[e.status || 'null'] = (statusCounts[e.status || 'null'] || 0) + 1;
  }
  console.log('\nBy status:');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  // Check if season column exists
  const { data: sample } = await supabase
    .from('events')
    .select('id, commence_time, status, season, home_team_id, away_team_id')
    .limit(5);

  console.log('\nSample events:');
  console.log(sample);

  // Check closing_lines
  const { count: clCount } = await supabase
    .from('closing_lines')
    .select('*', { count: 'exact', head: true });

  console.log(`\nClosing lines: ${clCount}`);

  // Check results
  const { count: resultsCount } = await supabase
    .from('results')
    .select('*', { count: 'exact', head: true });

  console.log(`Results: ${resultsCount}`);
}

main().catch(console.error);

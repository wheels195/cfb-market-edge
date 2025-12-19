import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Check game_advanced_stats coverage
  const { data: gameStats } = await supabase
    .from('game_advanced_stats')
    .select('season, week');

  const coverage: Record<number, Set<number>> = {};
  for (const row of gameStats || []) {
    const season = row.season;
    if (coverage[season] === undefined) {
      coverage[season] = new Set();
    }
    coverage[season].add(row.week);
  }

  console.log('Game Advanced Stats - Week Coverage:');
  for (const season of Object.keys(coverage).sort()) {
    const weeks = Array.from(coverage[Number(season)]).sort((a, b) => a - b);
    console.log(`  ${season}: Weeks ${weeks.join(', ')}`);
  }

  // Count records
  const counts: Record<number, number> = {};
  for (const row of gameStats || []) {
    counts[row.season] = (counts[row.season] || 0) + 1;
  }
  console.log('\nRecords per season:');
  for (const [season, count] of Object.entries(counts).sort()) {
    console.log(`  ${season}: ${count} team-games`);
  }

  // Check events with closing lines
  const { data: events } = await supabase
    .from('events')
    .select('id, season')
    .eq('status', 'completed');

  const { data: closingLines } = await supabase
    .from('closing_lines')
    .select('event_id');

  const eventIds = new Set((closingLines || []).map(c => c.event_id));

  const eventsBySeason: Record<number, { total: number; withClosing: number }> = {};
  for (const e of events || []) {
    if (eventsBySeason[e.season] === undefined) {
      eventsBySeason[e.season] = { total: 0, withClosing: 0 };
    }
    eventsBySeason[e.season].total++;
    if (eventIds.has(e.id)) {
      eventsBySeason[e.season].withClosing++;
    }
  }

  console.log('\nCompleted Events with Closing Lines:');
  for (const [season, data] of Object.entries(eventsBySeason).sort()) {
    console.log(`  ${season}: ${data.withClosing}/${data.total} have closing lines`);
  }
}

main().catch(console.error);

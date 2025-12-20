/**
 * Audit database for backtest readiness
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function audit() {
  console.log('=== DATABASE AUDIT FOR BACKTEST ===\n');

  // 1. Events by status
  const { data: events } = await supabase.from('events').select('status');
  const statusCounts: Record<string, number> = {};
  for (const e of events || []) {
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
  }
  console.log('EVENTS BY STATUS:');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`  Total: ${events?.length || 0}`);

  // 2. Results count
  const { count: resultsCount } = await supabase
    .from('results')
    .select('*', { count: 'exact', head: true });
  console.log(`\nRESULTS: ${resultsCount}`);

  // 3. Odds ticks
  const { count: ticksCount } = await supabase
    .from('odds_ticks')
    .select('*', { count: 'exact', head: true });
  console.log(`ODDS TICKS: ${ticksCount}`);

  // 4. Closing lines
  const { count: closingCount } = await supabase
    .from('closing_lines')
    .select('*', { count: 'exact', head: true });
  console.log(`CLOSING LINES: ${closingCount}`);

  // 5. Projections
  const { count: projCount } = await supabase
    .from('projections')
    .select('*', { count: 'exact', head: true });
  console.log(`PROJECTIONS: ${projCount}`);

  // 6. Current edges
  const { count: edgesCount } = await supabase
    .from('edges')
    .select('*', { count: 'exact', head: true });
  console.log(`CURRENT EDGES: ${edgesCount}`);

  // 7. Team ratings (Elo)
  const { count: eloCount } = await supabase
    .from('team_ratings')
    .select('*', { count: 'exact', head: true });
  console.log(`TEAM RATINGS (ELO): ${eloCount}`);

  // 8. Advanced stats
  const { count: advStats } = await supabase
    .from('team_advanced_stats')
    .select('*', { count: 'exact', head: true });
  console.log(`TEAM ADVANCED STATS: ${advStats}`);

  // 9. SP+ ratings
  const { count: spCount } = await supabase
    .from('advanced_team_ratings')
    .select('*', { count: 'exact', head: true });
  console.log(`SP+ RATINGS: ${spCount}`);

  // 10. Date range of events
  const { data: dateRange } = await supabase
    .from('events')
    .select('commence_time')
    .order('commence_time', { ascending: true })
    .limit(1);
  const { data: dateRangeEnd } = await supabase
    .from('events')
    .select('commence_time')
    .order('commence_time', { ascending: false })
    .limit(1);

  console.log('\nEVENT DATE RANGE:');
  console.log(`  Earliest: ${dateRange?.[0]?.commence_time || 'none'}`);
  console.log(`  Latest: ${dateRangeEnd?.[0]?.commence_time || 'none'}`);

  // 11. Check how many final events have all required data for backtest
  const { data: finalEvents } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'final');

  let eventsWithResults = 0;
  let eventsWithProjections = 0;
  let eventsWithOddsTicks = 0;
  let eventsWithClosingLines = 0;
  let eventsReadyForBacktest = 0;

  for (const event of finalEvents || []) {
    const [resultCheck, projCheck, ticksCheck, closeCheck] = await Promise.all([
      supabase.from('results').select('event_id').eq('event_id', event.id).limit(1),
      supabase.from('projections').select('event_id').eq('event_id', event.id).limit(1),
      supabase.from('odds_ticks').select('event_id').eq('event_id', event.id).limit(1),
      supabase.from('closing_lines').select('event_id').eq('event_id', event.id).limit(1),
    ]);

    const hasResult = (resultCheck.data?.length || 0) > 0;
    const hasProj = (projCheck.data?.length || 0) > 0;
    const hasTicks = (ticksCheck.data?.length || 0) > 0;
    const hasClose = (closeCheck.data?.length || 0) > 0;

    if (hasResult) eventsWithResults++;
    if (hasProj) eventsWithProjections++;
    if (hasTicks) eventsWithOddsTicks++;
    if (hasClose) eventsWithClosingLines++;
    if (hasResult && hasProj && hasTicks) eventsReadyForBacktest++;
  }

  console.log('\nFINAL EVENTS DATA COVERAGE:');
  console.log(`  Total final events: ${finalEvents?.length || 0}`);
  console.log(`  With results: ${eventsWithResults}`);
  console.log(`  With projections: ${eventsWithProjections}`);
  console.log(`  With odds ticks: ${eventsWithOddsTicks}`);
  console.log(`  With closing lines: ${eventsWithClosingLines}`);
  console.log(`  READY FOR BACKTEST (result + projection + ticks): ${eventsReadyForBacktest}`);

  // Verdict
  console.log('\n=== BACKTEST READINESS ===');
  if (eventsReadyForBacktest >= 50) {
    console.log('✓ Sufficient data for backtesting');
  } else if (eventsReadyForBacktest >= 10) {
    console.log('⚠ Limited data - backtest possible but not statistically significant');
  } else {
    console.log('✗ Insufficient data - need to sync historical data first');
  }
}

audit().catch(console.error);

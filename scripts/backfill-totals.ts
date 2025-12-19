/**
 * Backfill Totals Script
 *
 * Run this AFTER migration 009 has been applied to Supabase.
 * This will re-run materialize-edges to populate:
 * - baseline_total_points
 * - adjustment_points
 * - model_total_points (properly calculated)
 *
 * Usage:
 *   SUPABASE_URL="..." SUPABASE_ANON_KEY="..." npx tsx scripts/backfill-totals.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyMigration(): Promise<boolean> {
  console.log('\n=== Step 1: Verifying migration 009 was applied ===\n');

  // Check if new columns exist by trying to select them
  const { data, error } = await supabase
    .from('edges')
    .select('id, baseline_total_points, adjustment_points')
    .limit(1);

  if (error) {
    if (error.message.includes('baseline_total_points') || error.message.includes('adjustment_points')) {
      console.error('❌ Migration 009 has NOT been applied yet.');
      console.error('\nPlease run the following SQL in Supabase Dashboard > SQL Editor:');
      console.error('\n' + '='.repeat(60));
      console.error(`
-- Migration 009: Complete totals setup with constraints and indexes

ALTER TABLE edges ADD COLUMN IF NOT EXISTS baseline_total_points NUMERIC;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS adjustment_points NUMERIC DEFAULT 0;

ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_adjustment_points_check;
ALTER TABLE edges ADD CONSTRAINT edges_adjustment_points_check
  CHECK (adjustment_points IS NULL OR abs(adjustment_points) <= 30);

CREATE INDEX IF NOT EXISTS idx_edges_adjustment_points ON edges(adjustment_points)
WHERE market_type = 'total';

CREATE INDEX IF NOT EXISTS idx_events_commence_time ON events(commence_time);
CREATE INDEX IF NOT EXISTS idx_events_status_commence_time ON events(status, commence_time);
`);
      console.error('='.repeat(60));
      return false;
    }
    console.error('Error checking migration:', error.message);
    return false;
  }

  console.log('✓ Migration 009 columns exist (baseline_total_points, adjustment_points)');
  return true;
}

async function getUpcomingEvents(): Promise<number> {
  const now = new Date();
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('events')
    .select('id', { count: 'exact' })
    .eq('status', 'scheduled')
    .gte('commence_time', now.toISOString())
    .lte('commence_time', twoWeeksFromNow.toISOString());

  if (error) {
    console.error('Error fetching upcoming events:', error.message);
    return 0;
  }

  return data?.length || 0;
}

async function getCurrentTotalsStatus(): Promise<void> {
  console.log('\n=== Step 2: Current totals edge status ===\n');

  const now = new Date();

  // Get total edges for upcoming events
  const { data: edges, error } = await supabase
    .from('edges')
    .select(`
      id,
      event_id,
      market_total_points,
      model_total_points,
      baseline_total_points,
      adjustment_points,
      edge_points,
      recommended_side,
      events!inner(commence_time, status)
    `)
    .eq('market_type', 'total')
    .eq('events.status', 'scheduled')
    .gte('events.commence_time', now.toISOString())
    .order('events(commence_time)', { ascending: true });

  if (error) {
    console.error('Error fetching edges:', error.message);
    return;
  }

  if (!edges || edges.length === 0) {
    console.log('No total edges found for upcoming events');
    return;
  }

  // Analyze status
  let withBaseline = 0;
  let withAdjustment = 0;
  let needsBackfill = 0;

  for (const edge of edges) {
    if (edge.baseline_total_points !== null) withBaseline++;
    if (edge.adjustment_points !== null) withAdjustment++;
    if (edge.baseline_total_points === null || edge.adjustment_points === null) {
      needsBackfill++;
    }
  }

  console.log(`Total edges for upcoming events: ${edges.length}`);
  console.log(`  - With baseline_total_points: ${withBaseline}`);
  console.log(`  - With adjustment_points: ${withAdjustment}`);
  console.log(`  - Needs backfill: ${needsBackfill}`);

  // Show sample
  console.log('\nSample edges (first 5):');
  for (const edge of edges.slice(0, 5)) {
    console.log(`  Event ${edge.event_id}:`);
    console.log(`    market: ${edge.market_total_points}`);
    console.log(`    model: ${edge.model_total_points}`);
    console.log(`    baseline: ${edge.baseline_total_points}`);
    console.log(`    adjustment: ${edge.adjustment_points}`);
    console.log(`    edge: ${edge.edge_points}`);
    console.log(`    side: ${edge.recommended_side}`);
  }
}

async function triggerBackfill(): Promise<void> {
  console.log('\n=== Step 3: Triggering backfill ===\n');
  console.log('To backfill totals, you need to run materialize-edges.');
  console.log('\nOption 1: Call the API endpoint:');
  console.log('  curl -X GET https://your-app.vercel.app/api/cron/materialize-edges');
  console.log('\nOption 2: Run the job directly (local development):');
  console.log('  Import and call materializeEdges() from src/lib/jobs/materialize-edges.ts');
  console.log('\nThe materialize-edges job will:');
  console.log('  1. Find all upcoming events with projections');
  console.log('  2. Calculate market-calibrated totals');
  console.log('  3. Populate baseline_total_points, adjustment_points, model_total_points');
  console.log('  4. Apply sanity gate (|adjustment| > 14 → excluded)');
}

async function main() {
  console.log('='.repeat(60));
  console.log('  TOTALS BACKFILL VERIFICATION');
  console.log('='.repeat(60));

  // Step 1: Verify migration
  const migrationApplied = await verifyMigration();
  if (!migrationApplied) {
    console.log('\n⚠️  Run migration first, then re-run this script.');
    process.exit(1);
  }

  // Step 2: Check current status
  await getCurrentTotalsStatus();

  // Step 3: Instructions for backfill
  await triggerBackfill();

  // Summary
  const upcomingEvents = await getUpcomingEvents();
  console.log('\n=== Summary ===\n');
  console.log(`Upcoming events (next 14 days): ${upcomingEvents}`);
  console.log('\nTo complete the backfill:');
  console.log('  1. Ensure migration 009 is applied ✓');
  console.log('  2. Run materialize-edges to recalculate all total edges');
  console.log('  3. Verify with this script again');
}

main().catch(console.error);

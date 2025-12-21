/**
 * Run the dual model to generate projections for upcoming events
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Import the run model function dynamically to use the correct environment
async function main() {
  console.log('=== RUNNING DUAL MODEL ===\n');

  // First, check what we're working with
  console.log('Checking upcoming events and existing projections...');

  const now = new Date();
  const lookaheadEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'scheduled')
    .gt('commence_time', now.toISOString())
    .lt('commence_time', lookaheadEnd.toISOString());

  console.log(`Found ${events?.length || 0} upcoming events\n`);

  // Import and run the model
  const { runModel } = await import('../src/lib/jobs/run-model');

  console.log('Running dual projection model...\n');
  const result = await runModel();

  console.log('\n=== RESULT ===');
  console.log(`Ratings updated: ${result.ratingsUpdated}`);
  console.log(`Projections generated: ${result.projectionsGenerated}`);
  console.log(`Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  - ${err}`);
    }
  }

  console.log('\nTiming:');
  console.log(`  Ratings: ${result.timing.ratingsMs}ms`);
  console.log(`  Projections: ${result.timing.projectionsMs}ms`);

  // Verify projections
  console.log('\nVerifying dual projections...');
  const { data: versions } = await supabase
    .from('model_versions')
    .select('id, name')
    .in('name', ['SPREADS_MARKET_ANCHORED_V1', 'SPREADS_ELO_RAW_V1']);

  const marketAnchoredId = versions?.find(v => v.name === 'SPREADS_MARKET_ANCHORED_V1')?.id;
  const eloRawId = versions?.find(v => v.name === 'SPREADS_ELO_RAW_V1')?.id;

  const eventIds = events?.map(e => e.id) || [];

  const { count: marketCount } = await supabase
    .from('projections')
    .select('id', { count: 'exact', head: true })
    .in('event_id', eventIds)
    .eq('model_version_id', marketAnchoredId);

  const { count: eloCount } = await supabase
    .from('projections')
    .select('id', { count: 'exact', head: true })
    .in('event_id', eventIds)
    .eq('model_version_id', eloRawId);

  console.log(`  MARKET_ANCHORED: ${marketCount}/${eventIds.length}`);
  console.log(`  ELO_RAW: ${eloCount}/${eventIds.length}`);
}

main().catch(console.error);

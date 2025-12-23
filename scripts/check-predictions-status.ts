/**
 * Check prediction grading status
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function run() {
  console.log('=== Checking prediction grading status ===\n');

  // Check CFB game_predictions
  const { data: cfbPreds, count: cfbCount } = await supabase
    .from('game_predictions')
    .select('id, bet_result, event_id', { count: 'exact' });

  const cfbGraded = cfbPreds?.filter(p => p.bet_result !== null) || [];
  const cfbWins = cfbPreds?.filter(p => p.bet_result === 'win').length || 0;
  const cfbLosses = cfbPreds?.filter(p => p.bet_result === 'loss').length || 0;

  console.log('CFB game_predictions:');
  console.log(`  Total predictions: ${cfbCount}`);
  console.log(`  Graded: ${cfbGraded.length}`);
  console.log(`  Record: ${cfbWins}-${cfbLosses}`);

  // Check CBB game_predictions
  const { data: cbbPreds, count: cbbCount } = await supabase
    .from('cbb_game_predictions')
    .select('id, bet_result, qualifies_for_bet', { count: 'exact' });

  const cbbGraded = cbbPreds?.filter(p => p.bet_result !== null) || [];
  const cbbWins = cbbPreds?.filter(p => p.bet_result === 'win').length || 0;
  const cbbLosses = cbbPreds?.filter(p => p.bet_result === 'loss').length || 0;
  const cbbQualifying = cbbPreds?.filter(p => p.qualifies_for_bet) || [];

  console.log('\nCBB cbb_game_predictions:');
  console.log(`  Total predictions: ${cbbCount}`);
  console.log(`  Qualifying bets: ${cbbQualifying.length}`);
  console.log(`  Graded: ${cbbGraded.length}`);
  console.log(`  Record: ${cbbWins}-${cbbLosses}`);

  // Check results table for CFB
  const { count: resultsCount } = await supabase
    .from('results')
    .select('id', { count: 'exact' });

  console.log(`\nResults table: ${resultsCount} entries`);
}

run().catch(console.error);

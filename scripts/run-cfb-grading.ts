/**
 * Run CFB game predictions grading manually
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

function gradePrediction(
  side: string,
  spreadAtClose: number,
  homeScore: number,
  awayScore: number
): 'win' | 'loss' | 'push' {
  const actualMargin = homeScore - awayScore;

  if (side === 'home') {
    const cover = actualMargin + spreadAtClose;
    if (cover > 0) return 'win';
    if (cover < 0) return 'loss';
    return 'push';
  } else {
    const cover = -actualMargin - spreadAtClose;
    if (cover > 0) return 'win';
    if (cover < 0) return 'loss';
    return 'push';
  }
}

async function run() {
  console.log('=== Running CFB game predictions grading ===\n');

  // Get ungraded game_predictions
  const { data: ungraded, error: fetchError } = await supabase
    .from('game_predictions')
    .select('id, event_id, closing_spread_home, recommended_side')
    .is('bet_result', null)
    .not('closing_spread_home', 'is', null)
    .not('recommended_side', 'is', null);

  if (fetchError) {
    console.error('Fetch error:', fetchError.message);
    return;
  }

  console.log(`Found ${ungraded?.length || 0} ungraded predictions`);

  if (!ungraded || ungraded.length === 0) {
    console.log('No predictions to grade.');
    return;
  }

  // Get results for these events
  const eventIds = ungraded.map(p => p.event_id);
  console.log('Event IDs:', eventIds);

  const { data: results, error: resultError } = await supabase
    .from('results')
    .select('event_id, home_score, away_score')
    .in('event_id', eventIds);

  if (resultError) {
    console.error('Results fetch error:', resultError.message);
    return;
  }

  console.log(`Found ${results?.length || 0} results`);

  if (!results || results.length === 0) {
    console.log('No results available for these predictions.');
    console.log('CFB results may not be synced yet.');
    return;
  }

  // Create lookup map
  const resultMap = new Map<string, { home_score: number; away_score: number }>();
  for (const r of results) {
    resultMap.set(r.event_id, { home_score: r.home_score, away_score: r.away_score });
  }

  // Grade each prediction
  let graded = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const pred of ungraded) {
    const gameResult = resultMap.get(pred.event_id);
    if (!gameResult || gameResult.home_score === null) {
      console.log(`  No result for event ${pred.event_id}`);
      continue;
    }

    const betResult = gradePrediction(
      pred.recommended_side,
      pred.closing_spread_home,
      gameResult.home_score,
      gameResult.away_score
    );

    console.log(`  ${pred.event_id}: ${pred.recommended_side} at ${pred.closing_spread_home} → ${gameResult.home_score}-${gameResult.away_score} = ${betResult}`);

    const { error: updateError } = await supabase
      .from('game_predictions')
      .update({ bet_result: betResult })
      .eq('id', pred.id);

    if (updateError) {
      console.error(`  Update error for ${pred.id}: ${updateError.message}`);
    } else {
      graded++;
      if (betResult === 'win') wins++;
      else if (betResult === 'loss') losses++;
      else pushes++;
    }
  }

  console.log(`\nGraded ${graded} predictions: ${wins}W-${losses}L-${pushes}P`);
}

run().catch(console.error);

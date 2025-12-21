import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  // Get the JMU game event
  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', '716ecd2b-bd6a-4c82-9d53-016afa956121')
    .single();

  console.log('JMU @ Oregon Event:', event);

  // Get the result
  const { data: result } = await supabase
    .from('results')
    .select('*')
    .eq('event_id', '716ecd2b-bd6a-4c82-9d53-016afa956121')
    .single();

  console.log('\nResult:', result);

  // Get team names
  if (event) {
    const { data: homeTeam } = await supabase
      .from('teams')
      .select('name')
      .eq('id', event.home_team_id)
      .single();

    const { data: awayTeam } = await supabase
      .from('teams')
      .select('name')
      .eq('id', event.away_team_id)
      .single();

    console.log('\nHome Team:', homeTeam?.name);
    console.log('Away Team:', awayTeam?.name);
  }

  // Get the prediction again
  const { data: prediction } = await supabase
    .from('game_predictions')
    .select('*')
    .eq('event_id', '716ecd2b-bd6a-4c82-9d53-016afa956121')
    .single();

  console.log('\nPrediction:', prediction);

  // Summary
  console.log('\n=== ANALYSIS ===');
  console.log('Market spread (home): Oregon -20.5 (JMU +20.5)');
  console.log('Model spread (home): Oregon -18 (JMU +18)');
  console.log('Edge: 2.5 points (model thinks Oregon will win by LESS than market says)');
  console.log('Recommended bet: JMU +20.5 (take the underdog getting more points than model predicts)');
  console.log('');
  console.log('Result: Oregon 51 - JMU 34 (Oregon won by 17)');
  console.log('JMU +20.5 COVERED - WIN!');
}

main();

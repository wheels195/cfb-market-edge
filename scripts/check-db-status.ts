import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  console.log('Checking database...\n');

  // Check events
  const { data: eventsData, error: eventsErr } = await supabase
    .from('events')
    .select('id, status')
    .limit(5);

  if (eventsErr) {
    console.log('Events error:', eventsErr.message);
  } else {
    console.log(`Events sample: ${eventsData?.length} rows`);
    console.log(eventsData?.slice(0, 2));
  }

  // Check advanced_team_ratings
  const { data: spData, error: spErr } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, season, sp_overall')
    .limit(5);

  if (spErr) {
    console.log('\nSP+ ratings error:', spErr.message);
  } else {
    console.log(`\nSP+ ratings sample: ${spData?.length} rows`);
    console.log(spData?.slice(0, 2));
  }

  // Check results
  const { data: resultsData, error: resultsErr } = await supabase
    .from('results')
    .select('event_id, home_score, away_score')
    .limit(5);

  if (resultsErr) {
    console.log('\nResults error:', resultsErr.message);
  } else {
    console.log(`\nResults sample: ${resultsData?.length} rows`);
  }

  // Check closing_lines
  const { data: closingData, error: closingErr } = await supabase
    .from('closing_lines')
    .select('event_id, market_type, spread_points_home')
    .limit(5);

  if (closingErr) {
    console.log('\nClosing lines error:', closingErr.message);
  } else {
    console.log(`\nClosing lines sample: ${closingData?.length} rows`);
  }
}

check();

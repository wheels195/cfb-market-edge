import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Get raw sample
  const { data, error } = await supabase
    .from('cbb_betting_lines')
    .select('*')
    .limit(3);

  console.log('Error:', error);
  console.log('Sample data:');
  console.log(JSON.stringify(data, null, 2));

  if (data && data.length > 0) {
    console.log('\nColumns:', Object.keys(data[0]));
  }

  // Try a different approach - join with games
  const { data: gamesWithLines, error: joinError } = await supabase
    .from('cbb_games')
    .select(`
      id,
      season,
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      cbb_betting_lines (
        spread_home_open,
        spread_home_close,
        total_open,
        total_close
      )
    `)
    .eq('season', 2024)
    .not('home_score', 'is', null)
    .limit(5);

  console.log('\nJoin Error:', joinError);
  console.log('Games with lines:');
  console.log(JSON.stringify(gamesWithLines, null, 2));
}

main().catch(console.error);

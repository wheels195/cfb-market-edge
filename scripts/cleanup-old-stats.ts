/**
 * Cleanup old stats with wrong plays_per_game formula
 * Old formula: plays/drives (~5)
 * New formula: plays/12.5 (~60-70)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('Deleting stats with old formula (plays_per_game < 30)...');

  // Delete records with plays_per_game < 30 (the old formula)
  const { error, count } = await supabase
    .from('team_advanced_stats')
    .delete()
    .lt('plays_per_game', 30);

  if (error) {
    console.error('Delete failed:', error.message);
  } else {
    console.log(`Deleted ${count || 'unknown number of'} old stats records`);
  }

  // Check remaining stats
  const { data: remaining } = await supabase
    .from('team_advanced_stats')
    .select('plays_per_game')
    .limit(5);

  console.log('\nSample remaining stats:', remaining);
}

main().catch(console.error);

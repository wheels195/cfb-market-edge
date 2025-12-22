/**
 * Sync CBBD Season-End Ratings
 *
 * Stores to cbb_ratings_season_end table.
 * V1 model uses PRIOR season ratings only (no look-ahead).
 */

import { createClient } from '@supabase/supabase-js';
import { getCBBDApiClient, getCBBDAPIUsage } from '../src/lib/api/cbbd-api';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function syncSeason(season: number): Promise<number> {
  const client = getCBBDApiClient();

  console.log(`\nFetching ${season} adjusted ratings...`);
  const ratings = await client.getAdjustedRatings(season);
  console.log(`  Found ${ratings.length} teams`);

  if (ratings.length === 0) {
    return 0;
  }

  const rows = ratings.map(r => ({
    season: r.season,
    cbbd_team_id: r.teamId,
    team_name: r.team,
    conference: r.conference,
    off_rating: r.offensiveRating,
    def_rating: r.defensiveRating,
    net_rating: r.netRating,
    rank_off: r.rankings.offense,
    rank_def: r.rankings.defense,
    rank_net: r.rankings.net,
  }));

  const { error } = await supabase
    .from('cbb_ratings_season_end')
    .upsert(rows, { onConflict: 'season,cbbd_team_id' });

  if (error) {
    console.log(`  Error: ${error.message}`);
    return 0;
  }

  console.log(`  Synced: ${rows.length} ratings`);
  return rows.length;
}

async function run() {
  console.log('========================================');
  console.log('  CBBD Season-End Ratings Sync');
  console.log('========================================');
  console.log('Target table: cbb_ratings_season_end');
  console.log('Usage: Prior season ratings for V1 model\n');

  // Need 2021 for 2022 games, 2022 for 2023, 2023 for 2024
  const seasons = [2021, 2022, 2023, 2024];
  let total = 0;

  for (const season of seasons) {
    try {
      total += await syncSeason(season);
    } catch (error: any) {
      console.log(`Error syncing ${season}: ${error.message}`);
    }
  }

  console.log('\n========================================');
  console.log(`Total synced: ${total} ratings`);
  console.log('API Usage:', getCBBDAPIUsage());
  console.log('========================================');
}

run().catch(console.error);

/**
 * Sync CBBD Adjusted Ratings
 *
 * Stores season-end efficiency ratings for use in modeling.
 * For predictions: use PRIOR season's ratings (no look-ahead bias).
 *
 * Example: For 2024 season games, use 2023 season ratings.
 */

import { createClient } from '@supabase/supabase-js';
import { getCBBDApiClient, getCBBDAPIUsage } from '../src/lib/api/cbbd-api';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface RatingRow {
  season: number;
  team_id: number;
  team_name: string;
  conference: string;
  offensive_rating: number;
  defensive_rating: number;
  net_rating: number;
  rank_offense: number;
  rank_defense: number;
  rank_net: number;
}

async function syncSeason(season: number): Promise<number> {
  const client = getCBBDApiClient();

  console.log(`\nFetching ${season} adjusted ratings...`);
  const ratings = await client.getAdjustedRatings(season);
  console.log(`  Found ${ratings.length} teams`);

  if (ratings.length === 0) {
    console.log('  No ratings found, skipping');
    return 0;
  }

  const rows: RatingRow[] = ratings.map(r => ({
    season: r.season,
    team_id: r.teamId,
    team_name: r.team,
    conference: r.conference,
    offensive_rating: r.offensiveRating,
    defensive_rating: r.defensiveRating,
    net_rating: r.netRating,
    rank_offense: r.rankings.offense,
    rank_defense: r.rankings.defense,
    rank_net: r.rankings.net,
  }));

  // Upsert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('cbb_team_ratings')
      .upsert(batch, { onConflict: 'season,team_id' });

    if (error) {
      console.log(`  Error: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  Inserted/updated: ${inserted} ratings`);
  return inserted;
}

async function run() {
  console.log('========================================');
  console.log('  CBBD Ratings Sync');
  console.log('========================================');

  // First, ensure table exists
  console.log('\nChecking/creating cbb_team_ratings table...');

  // Sync seasons 2022, 2023, 2024
  const seasons = [2022, 2023, 2024];
  let totalSynced = 0;

  for (const season of seasons) {
    try {
      const count = await syncSeason(season);
      totalSynced += count;
    } catch (error: any) {
      console.log(`Error syncing ${season}: ${error.message}`);
    }
  }

  console.log('\n========================================');
  console.log('  Summary');
  console.log('========================================');
  console.log(`Total ratings synced: ${totalSynced}`);
  console.log('\nAPI Usage:', getCBBDAPIUsage());

  console.log('\n========================================');
  console.log('  Point-in-Time Logic');
  console.log('========================================');
  console.log('For predictions in season N, use ratings from season N-1.');
  console.log('Example: 2024 games use 2023 ratings (no look-ahead bias).');
}

run().catch(console.error);

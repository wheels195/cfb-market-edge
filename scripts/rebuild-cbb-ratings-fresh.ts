/**
 * Rebuild CBB Ratings FRESH (No prior season carryover)
 *
 * This script rebuilds ratings starting from 0 for ALL teams,
 * processing games chronologically to build up ratings.
 *
 * This fixes the issue where old Elo-scale ratings (1500 base) were
 * being used instead of our new conference-aware ratings (0 base).
 */

import { createClient } from '@supabase/supabase-js';
import { CbbRatingSystem, CBB_RATING_CONSTANTS, CBB_CONFERENCE_RATINGS, getConferenceRating } from '../src/lib/models/cbb-elo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CBB Rating Rebuild FRESH (No Carryover) ===\n');
  console.log('Model Configuration:');
  console.log(`  HOME_ADVANTAGE: ${CBB_RATING_CONSTANTS.HOME_ADVANTAGE}`);
  console.log(`  LEARNING_RATE: ${CBB_RATING_CONSTANTS.LEARNING_RATE}`);
  console.log(`  Starting all team ratings at 0\n`);

  // Get current season
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const currentSeason = month >= 11 ? year + 1 : (month <= 4 ? year : year + 1);
  console.log(`Current season: ${currentSeason}\n`);

  // Load team conferences
  console.log('Loading team conferences...');
  const { data: teams } = await supabase.from('cbb_teams').select('id, name, conference');
  const teamConf = new Map<string, string>();
  const teamNames = new Map<string, string>();
  for (const t of teams || []) {
    if (t.conference) {
      teamConf.set(t.id, t.conference);
    }
    teamNames.set(t.id, t.name);
  }
  console.log(`  Loaded ${teamConf.size} team conferences`);

  // Initialize rating system FRESH (no prior season)
  const ratingSystem = new CbbRatingSystem();

  // Set team conferences
  for (const [teamId, conf] of teamConf) {
    ratingSystem.setTeamConference(teamId, conf);
  }

  // Load all completed games for current season
  console.log(`\nLoading ${currentSeason} games...`);
  const { data: games, error } = await supabase
    .from('cbb_games')
    .select('id, start_date, home_team_id, away_team_id, home_score, away_score')
    .eq('season', currentSeason)
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true });

  if (error) {
    console.error('Error loading games:', error);
    return;
  }

  console.log(`  Found ${games?.length || 0} completed games\n`);

  // Process all games
  console.log('Processing games...');
  let processed = 0;
  for (const game of games || []) {
    ratingSystem.update(
      game.home_team_id,
      game.away_team_id,
      game.home_score,
      game.away_score
    );
    processed++;
    if (processed % 500 === 0) {
      console.log(`  Processed ${processed} games...`);
    }
  }
  console.log(`  Processed ${processed} total games\n`);

  // Get all ratings
  const allRatings = ratingSystem.getAllRatings();

  // Show rating distribution
  const ratingValues = allRatings.map(r => r.rating);
  console.log('=== Rating Distribution ===');
  console.log(`  Min: ${Math.min(...ratingValues).toFixed(1)}`);
  console.log(`  Max: ${Math.max(...ratingValues).toFixed(1)}`);
  console.log(`  Range: ${(Math.max(...ratingValues) - Math.min(...ratingValues)).toFixed(1)}`);
  console.log(`  Avg: ${(ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length).toFixed(1)}`);

  // Check spread range
  const sortedRatings = allRatings
    .map(r => ({
      ...r,
      totalRating: r.rating + getConferenceRating(r.conference),
    }))
    .sort((a, b) => b.totalRating - a.totalRating);

  const best = sortedRatings[0];
  const worst = sortedRatings[sortedRatings.length - 1];
  const maxSpread = best.totalRating - worst.totalRating + CBB_RATING_CONSTANTS.HOME_ADVANTAGE;

  console.log(`\n=== Spread Check ===`);
  console.log(`  Best team total: ${best.totalRating.toFixed(1)} (${teamNames.get(best.teamId)})`);
  console.log(`  Worst team total: ${worst.totalRating.toFixed(1)} (${teamNames.get(worst.teamId)})`);
  console.log(`  Max possible spread: ${maxSpread.toFixed(1)} points`);
  console.log(`  (Should be ~30-40 max for realistic CBB spreads)`);

  // Save ratings
  console.log('\nSaving ratings to database...');

  const snapshots = allRatings.map(r => ({
    team_id: r.teamId,
    season: currentSeason,
    games_played: r.gamesPlayed,
    elo: r.rating, // DB column is 'elo' but stores rating value
    updated_at: new Date().toISOString(),
  }));

  // Delete existing ratings for this season
  await supabase
    .from('cbb_elo_snapshots')
    .delete()
    .eq('season', currentSeason);

  // Insert new ratings in batches
  const BATCH_SIZE = 500;
  let saved = 0;
  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('cbb_elo_snapshots').insert(batch);
    if (error) {
      console.error(`Error saving batch:`, error);
    } else {
      saved += batch.length;
    }
  }
  console.log(`  Saved ${saved} team ratings\n`);

  // Show top teams
  console.log('=== Top 10 Teams by Total Rating ===\n');
  for (let i = 0; i < Math.min(10, sortedRatings.length); i++) {
    const r = sortedRatings[i];
    const name = teamNames.get(r.teamId) || r.teamId;
    const confBonus = getConferenceRating(r.conference);
    console.log(
      `${(i + 1).toString().padStart(2)}. ${name.padEnd(20)} ` +
      `Total: ${r.totalRating.toFixed(1).padStart(6)} ` +
      `(Team: ${r.rating.toFixed(1).padStart(5)}, Conf: ${confBonus >= 0 ? '+' : ''}${confBonus})`
    );
  }

  console.log('\n=== Rebuild Complete ===');
}

main().catch(console.error);

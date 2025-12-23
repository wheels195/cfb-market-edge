/**
 * Rebuild CBB Ratings with Conference-Aware Model v2
 *
 * This script rebuilds all team ratings for the current season
 * using the validated conference-aware rating model.
 *
 * Run this once to migrate from the old Elo model to the new model.
 */

import { createClient } from '@supabase/supabase-js';
import { CbbRatingSystem, CBB_RATING_CONSTANTS, CBB_CONFERENCE_RATINGS } from '../src/lib/models/cbb-elo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CBB Rating Rebuild (Conference-Aware Model v2) ===\n');
  console.log('Model Configuration:');
  console.log(`  HOME_ADVANTAGE: ${CBB_RATING_CONSTANTS.HOME_ADVANTAGE}`);
  console.log(`  LEARNING_RATE: ${CBB_RATING_CONSTANTS.LEARNING_RATE}`);
  console.log(`  SEASON_DECAY: ${CBB_RATING_CONSTANTS.SEASON_DECAY}`);
  console.log(`  Conference tiers: ${Object.keys(CBB_CONFERENCE_RATINGS).length} conferences\n`);

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
  for (const t of teams || []) {
    if (t.conference) {
      teamConf.set(t.id, t.conference);
    }
  }
  console.log(`  Loaded ${teamConf.size} team conferences`);

  // Initialize rating system
  const ratingSystem = new CbbRatingSystem();

  // Set team conferences
  for (const [teamId, conf] of teamConf) {
    ratingSystem.setTeamConference(teamId, conf);
  }

  // Load prior season ratings for carryover (if available)
  const priorSeason = currentSeason - 1;
  const { data: priorRatings } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', priorSeason);

  if (priorRatings && priorRatings.length > 0) {
    console.log(`\nLoading ${priorSeason} ratings for carryover...`);
    for (const row of priorRatings) {
      ratingSystem.setRating(row.team_id, row.elo, row.games_played);
    }
    console.log(`  Loaded ${priorRatings.length} prior season ratings`);

    // Apply season decay
    ratingSystem.resetSeason();
    console.log(`  Applied ${CBB_RATING_CONSTANTS.SEASON_DECAY * 100}% carryover\n`);
  } else {
    console.log(`\nNo prior season (${priorSeason}) ratings found - starting fresh\n`);
  }

  // Load all completed games for current season
  console.log(`Loading ${currentSeason} games...`);
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

  // Save ratings
  console.log('Saving ratings to database...');
  const allRatings = ratingSystem.getAllRatings();

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
  console.log('=== Top 20 Teams by Total Rating ===\n');
  const sortedRatings = allRatings
    .map(r => ({
      ...r,
      totalRating: r.rating + (CBB_CONFERENCE_RATINGS[r.conference || ''] ?? 0),
    }))
    .sort((a, b) => b.totalRating - a.totalRating)
    .slice(0, 20);

  const teamNames = new Map<string, string>();
  for (const t of teams || []) {
    teamNames.set(t.id, t.name);
  }

  for (let i = 0; i < sortedRatings.length; i++) {
    const r = sortedRatings[i];
    const name = teamNames.get(r.teamId) || r.teamId;
    const confBonus = CBB_CONFERENCE_RATINGS[r.conference || ''] ?? 0;
    console.log(
      `${(i + 1).toString().padStart(2)}. ${name.padEnd(20)} ` +
      `Total: ${r.totalRating.toFixed(1).padStart(6)} ` +
      `(Team: ${r.rating.toFixed(1).padStart(5)}, Conf: ${confBonus >= 0 ? '+' : ''}${confBonus}, ` +
      `Games: ${r.gamesPlayed})`
    );
  }

  console.log('\n=== Rebuild Complete ===');
  console.log(`Season ${currentSeason}: ${processed} games processed, ${saved} ratings saved`);
}

main().catch(console.error);

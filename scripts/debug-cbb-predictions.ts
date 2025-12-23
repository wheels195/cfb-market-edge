/**
 * Debug CBB predictions to understand the edge calculation
 */

import { createClient } from '@supabase/supabase-js';
import { CbbRatingSystem, CBB_CONFERENCE_RATINGS, CBB_RATING_CONSTANTS } from '../src/lib/models/cbb-elo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CBB Prediction Debug ===\n');
  console.log('Model Config:', CBB_RATING_CONSTANTS);

  // Load team conferences
  const { data: teams } = await supabase.from('cbb_teams').select('id, name, conference');
  const teamConf = new Map<string, string>();
  const teamNames = new Map<string, string>();
  for (const t of teams || []) {
    if (t.conference) teamConf.set(t.id, t.conference);
    teamNames.set(t.id, t.name);
  }

  // Load ratings
  const { data: ratings } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', 2026);

  const ratingSystem = new CbbRatingSystem();
  for (const [teamId, conf] of teamConf) {
    ratingSystem.setTeamConference(teamId, conf);
  }
  for (const r of ratings || []) {
    ratingSystem.setRating(r.team_id, r.elo, r.games_played);
  }

  // Get Kansas vs Davidson game
  const { data: games } = await supabase
    .from('cbb_games')
    .select(`
      id,
      home_team_id,
      away_team_id,
      home_team_name,
      away_team_name,
      cbb_betting_lines (spread_home)
    `)
    .eq('home_score', 0)
    .eq('away_score', 0)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .limit(10);

  console.log('\n=== Sample Game Analysis ===\n');

  for (const game of (games || []).slice(0, 5)) {
    const lines = game.cbb_betting_lines as any;
    const line = Array.isArray(lines) ? lines[0] : lines;
    const marketSpread = line?.spread_home;

    const homeConf = teamConf.get(game.home_team_id);
    const awayConf = teamConf.get(game.away_team_id);
    const homeTeamRating = ratingSystem.getTeamRating(game.home_team_id);
    const awayTeamRating = ratingSystem.getTeamRating(game.away_team_id);
    const homeConfBonus = CBB_CONFERENCE_RATINGS[homeConf || ''] ?? 0;
    const awayConfBonus = CBB_CONFERENCE_RATINGS[awayConf || ''] ?? 0;
    const homeTotalRating = ratingSystem.getTotalRating(game.home_team_id);
    const awayTotalRating = ratingSystem.getTotalRating(game.away_team_id);
    const modelSpread = ratingSystem.getSpread(game.home_team_id, game.away_team_id);

    console.log(`${game.away_team_name} @ ${game.home_team_name}`);
    console.log(`  Home: ${game.home_team_name} (${homeConf})`);
    console.log(`    Team Rating: ${homeTeamRating.toFixed(1)}, Conf Bonus: ${homeConfBonus >= 0 ? '+' : ''}${homeConfBonus}, Total: ${homeTotalRating.toFixed(1)}`);
    console.log(`  Away: ${game.away_team_name} (${awayConf})`);
    console.log(`    Team Rating: ${awayTeamRating.toFixed(1)}, Conf Bonus: ${awayConfBonus >= 0 ? '+' : ''}${awayConfBonus}, Total: ${awayTotalRating.toFixed(1)}`);
    console.log(`  Model Spread: ${modelSpread.toFixed(1)} (away - home - ${CBB_RATING_CONSTANTS.HOME_ADVANTAGE} HFA)`);
    console.log(`  Market Spread: ${marketSpread}`);
    console.log(`  Edge: ${marketSpread !== null ? (marketSpread - modelSpread).toFixed(1) : 'N/A'}`);
    console.log('');
  }

  // Check the range of ratings
  const allRatings = (ratings || []).map(r => r.elo);
  console.log('=== Rating Distribution ===');
  console.log(`  Min: ${Math.min(...allRatings).toFixed(1)}`);
  console.log(`  Max: ${Math.max(...allRatings).toFixed(1)}`);
  console.log(`  Range: ${(Math.max(...allRatings) - Math.min(...allRatings)).toFixed(1)}`);
  console.log(`  Avg: ${(allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(1)}`);

  // The issue: our ratings are in a range like 1050-1170 (120 point range)
  // But for spreads, that means the max spread diff is only 120 points
  // In Elo, you divide by 25 to get spread, so 120/25 = 4.8 points max spread
  // But the market has spreads up to 30-40 points!

  console.log('\n=== THE ISSUE ===');
  console.log('Our team ratings are ~1050-1170 (range of ~120 points)');
  console.log('Spread = (awayTotal - homeTotal) which maxes out at ~120 point diff');
  console.log('But market spreads go up to 30-40 points!');
  console.log('\nThe old Elo model divided by 25 to convert Elo to spread.');
  console.log('But our new model just uses raw rating differences.');
  console.log('\nFor Kansas (-12 conf) vs SWAC team (+16 conf) = 28 point swing');
  console.log('Plus team ratings might add another 50-100 points');
  console.log('Total could be 78-128 point difference -> but we see max ~60\n');
}

main().catch(console.error);

/**
 * Internal Rating System
 *
 * NO SP+ as anchor. Build ratings from:
 * 1. Prior season's final INTERNAL rating (regressed to mean)
 * 2. Returning production adjustment
 * 3. Recruiting adjustment
 * 4. In-season PPA updates
 *
 * Bootstrap initial ratings from historical game margins.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  regressionToMean: 0.50,       // Regress 50% to mean each offseason
  returningProdWeight: 3.0,     // Points per 10% above/below avg returning prod
  recruitingWeight: 0.5,        // Points per recruiting rank tier
  ppaUpdateK: 0.08,             // K-factor for in-season PPA updates
  meanRating: 0,                // League average rating
  bootstrapK: 32,               // K-factor for bootstrap from margins
};

interface TeamRating {
  rating: number;
  gamesPlayed: number;
}

// =============================================================================
// BOOTSTRAP: Build initial ratings from historical margins
// =============================================================================

async function bootstrapRatings(startSeason: number): Promise<Map<string, number>> {
  console.log(`Bootstrapping ratings from ${startSeason - 2} to ${startSeason - 1}...`);

  const ratings = new Map<string, number>();

  // Get all teams
  const { data: teams } = await supabase.from('teams').select('id, name');
  for (const team of teams || []) {
    ratings.set(team.id, CONFIG.meanRating);
  }

  // Process games from prior 2 seasons to establish base ratings
  for (const season of [startSeason - 2, startSeason - 1]) {
    const seasonStart = `${season}-08-01`;
    const seasonEnd = `${season + 1}-02-15`;

    const { data: events } = await supabase
      .from('events')
      .select(`
        id,
        home_team_id,
        away_team_id,
        results(home_score, away_score)
      `)
      .eq('status', 'final')
      .gte('commence_time', seasonStart)
      .lte('commence_time', seasonEnd)
      .order('commence_time', { ascending: true });

    let gamesProcessed = 0;
    for (const event of events || []) {
      const results = event.results as any;
      if (!results?.home_score || !results?.away_score) continue;

      const homeId = event.home_team_id;
      const awayId = event.away_team_id;
      const homeRating = ratings.get(homeId) ?? CONFIG.meanRating;
      const awayRating = ratings.get(awayId) ?? CONFIG.meanRating;

      // Actual margin
      const margin = results.home_score - results.away_score;

      // Expected margin from ratings (including HFA)
      const expectedMargin = homeRating - awayRating + 2.5;

      // Update ratings based on surprise
      const surprise = margin - expectedMargin;
      const k = CONFIG.bootstrapK;

      ratings.set(homeId, homeRating + k * (surprise / 40));
      ratings.set(awayId, awayRating - k * (surprise / 40));

      gamesProcessed++;
    }

    console.log(`  ${season}: ${gamesProcessed} games processed`);

    // Regress at end of each bootstrap season
    for (const [teamId, rating] of ratings) {
      const regressed = rating * (1 - CONFIG.regressionToMean);
      ratings.set(teamId, regressed);
    }
  }

  return ratings;
}

// =============================================================================
// PRESEASON ADJUSTMENTS
// =============================================================================

async function applyPreseasonAdjustments(
  ratings: Map<string, number>,
  season: number
): Promise<Map<string, number>> {
  console.log(`\nApplying preseason adjustments for ${season}...`);

  // Regress to mean
  for (const [teamId, rating] of ratings) {
    const regressed = rating * (1 - CONFIG.regressionToMean);
    ratings.set(teamId, regressed);
  }

  // Get returning production
  const { data: prodData } = await supabase
    .from('returning_production')
    .select('team_id, percent_ppa')
    .eq('season', season)
    .not('percent_ppa', 'is', null);

  const avgRetProd = 0.50; // Average is ~50%
  let prodAdjustments = 0;

  for (const row of prodData || []) {
    const current = ratings.get(row.team_id) ?? CONFIG.meanRating;
    const prodDiff = row.percent_ppa - avgRetProd; // e.g., 0.65 - 0.50 = +0.15
    const adjustment = prodDiff * 10 * CONFIG.returningProdWeight; // 0.15 * 10 * 3 = +4.5 points
    ratings.set(row.team_id, current + adjustment);
    prodAdjustments++;
  }

  console.log(`  Applied returning production to ${prodAdjustments} teams`);

  // Get recruiting (use recruiting_classes if available)
  const { data: recruitData } = await supabase
    .from('recruiting_classes')
    .select('team_id, rank, points')
    .eq('season', season);

  let recruitAdjustments = 0;
  for (const row of recruitData || []) {
    const current = ratings.get(row.team_id) ?? CONFIG.meanRating;
    // Top 25 = positive, below = negative
    // Rank 1 = +12.5 pts, Rank 25 = 0, Rank 65 = -10 pts
    const rankAdjust = (25 - (row.rank || 65)) * CONFIG.recruitingWeight;
    ratings.set(row.team_id, current + rankAdjust);
    recruitAdjustments++;
  }

  console.log(`  Applied recruiting to ${recruitAdjustments} teams`);

  return ratings;
}

// =============================================================================
// IN-SEASON UPDATES
// =============================================================================

async function buildSeasonRatings(
  startRatings: Map<string, number>,
  season: number
): Promise<Map<number, Map<string, TeamRating>>> {
  console.log(`\nBuilding week-by-week ratings for ${season}...`);

  // Copy start ratings
  const currentRatings = new Map<string, TeamRating>();
  for (const [teamId, rating] of startRatings) {
    currentRatings.set(teamId, { rating, gamesPlayed: 0 });
  }

  // Get game PPA data
  const allPPA: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('game_advanced_stats')
      .select('team_id, week, off_ppa, def_ppa')
      .eq('season', season)
      .order('week', { ascending: true })
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    allPPA.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Group by week
  const byWeek = new Map<number, any[]>();
  for (const row of allPPA) {
    if (!byWeek.has(row.week)) byWeek.set(row.week, []);
    byWeek.get(row.week)!.push(row);
  }

  const weeks = Array.from(byWeek.keys()).sort((a, b) => a - b);

  // Store snapshots
  const ratingsByWeek = new Map<number, Map<string, TeamRating>>();

  // Week 0 = preseason
  ratingsByWeek.set(0, new Map(currentRatings));

  for (const week of weeks) {
    const games = byWeek.get(week) || [];

    for (const game of games) {
      const teamId = game.team_id;
      const current = currentRatings.get(teamId);
      if (!current) continue;

      // Net PPA for this game
      const netPPA = (game.off_ppa || 0) - (game.def_ppa || 0);

      // Expected net PPA based on rating (roughly rating/100)
      const expectedPPA = current.rating / 100;

      // Surprise
      const surprise = netPPA - expectedPPA;

      // K decreases with games played
      const k = CONFIG.ppaUpdateK * Math.max(0.3, 1 - current.gamesPlayed / 12);

      // Update
      currentRatings.set(teamId, {
        rating: current.rating + k * surprise * 100,
        gamesPlayed: current.gamesPlayed + 1,
      });
    }

    // Snapshot
    ratingsByWeek.set(week, new Map(
      Array.from(currentRatings.entries()).map(([id, r]) => [id, { ...r }])
    ));
  }

  console.log(`  Processed ${weeks.length} weeks, ${allPPA.length} game records`);

  return ratingsByWeek;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('=== INTERNAL RATING SYSTEM ===');
  console.log('No SP+ anchor. Building from game results + adjustments.\n');

  // Bootstrap from 2021-2022 to start 2023
  const baseRatings = await bootstrapRatings(2023);

  // Build 2023 ratings
  const ratings2023Start = await applyPreseasonAdjustments(new Map(baseRatings), 2023);
  const ratings2023 = await buildSeasonRatings(ratings2023Start, 2023);

  // Get final 2023 ratings for 2024 carryover
  const maxWeek2023 = Math.max(...Array.from(ratings2023.keys()));
  const final2023 = ratings2023.get(maxWeek2023);

  // Build 2024 ratings
  const carryover = new Map<string, number>();
  for (const [teamId, data] of final2023 || []) {
    carryover.set(teamId, data.rating);
  }

  const ratings2024Start = await applyPreseasonAdjustments(carryover, 2024);
  const ratings2024 = await buildSeasonRatings(ratings2024Start, 2024);

  // Show top teams at end of each season
  for (const [season, ratings] of [[2023, ratings2023], [2024, ratings2024]] as [number, Map<number, Map<string, TeamRating>>][]) {
    const maxWeek = Math.max(...Array.from(ratings.keys()));
    const final = ratings.get(maxWeek);

    if (!final) continue;

    // Get team names
    const { data: teams } = await supabase.from('teams').select('id, name');
    const nameMap = new Map((teams || []).map(t => [t.id, t.name]));

    const sorted = Array.from(final.entries())
      .map(([id, r]) => ({ id, name: nameMap.get(id) || id, ...r }))
      .filter(t => t.gamesPlayed > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 15);

    console.log(`\n=== TOP 15 INTERNAL RATINGS - ${season} (Week ${maxWeek}) ===`);
    console.log('Rank | Team                     | Rating | Games');
    console.log('-----|--------------------------|--------|------');

    sorted.forEach((team, i) => {
      console.log(
        `${(i + 1).toString().padStart(4)} | ${team.name.padEnd(24)} | ${team.rating.toFixed(1).padStart(6)} | ${team.gamesPlayed}`
      );
    });
  }

  // Save to database
  console.log('\n=== SAVING INTERNAL RATINGS ===');

  // Clear existing
  await supabase.from('team_ratings_history').delete().gte('season', 2023);

  const rows: any[] = [];

  for (const [season, ratings] of [[2023, ratings2023], [2024, ratings2024]] as [number, Map<number, Map<string, TeamRating>>][]) {
    for (const [week, weekRatings] of ratings) {
      for (const [teamId, data] of weekRatings) {
        rows.push({
          team_id: teamId,
          season,
          week,
          overall_rating: data.rating,
          off_rating: data.rating / 2,
          def_rating: data.rating / 2,
          games_played: data.gamesPlayed,
        });
      }
    }
  }

  // Insert in batches
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await supabase.from('team_ratings_history').insert(batch);
  }

  console.log(`Saved ${rows.length} rating records`);
  console.log('\n=== INTERNAL RATINGS COMPLETE ===');
}

main().catch(console.error);

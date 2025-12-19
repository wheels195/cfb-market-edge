/**
 * Team Rating Engine
 *
 * Implements the rating system from PLAN-v2.md:
 * - Preseason ratings using prior season + returning production + recruiting
 * - Weekly updates using game-level PPA
 * - Point-in-time snapshots for walk-forward validation
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// =============================================================================
// CONFIGURATION
// =============================================================================
interface RatingParams {
  // Preseason weights (should sum to ~1.0)
  priorWeight: number;          // Weight on prior season final rating
  returningProdWeight: number;  // Weight on returning production
  recruitingWeight: number;     // Weight on 4-year recruiting composite
  coachingWeight: number;       // Weight on coaching stability

  // Regression
  regressionToMean: number;     // How much to regress to league average (0.4 = 40%)

  // In-season update
  kBase: number;                // Base K factor for rating updates

  // Baselines
  leagueAvgRating: number;      // League average rating (baseline)
}

const DEFAULT_PARAMS: RatingParams = {
  priorWeight: 0.50,
  returningProdWeight: 0.25,
  recruitingWeight: 0.20,
  coachingWeight: 0.05,
  regressionToMean: 0.40,
  kBase: 0.20,
  leagueAvgRating: 0,
};

interface TeamRating {
  teamId: string;
  teamName: string;
  season: number;
  week: number;
  overallRating: number;
  offRating: number;
  defRating: number;
  gamesPlayed: number;
  returningProductionFactor: number;
  recruitingFactor: number;
}

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getTeams(): Promise<Map<string, { id: string; name: string }>> {
  const { data } = await supabase
    .from('teams')
    .select('id, name');

  const map = new Map();
  for (const team of data || []) {
    map.set(team.id, team);
  }
  return map;
}

async function getPriorSeasonRatings(season: number): Promise<Map<string, TeamRating>> {
  // Get final ratings from prior season (week 15 or highest week)
  const priorSeason = season - 1;

  const { data } = await supabase
    .from('team_ratings_history')
    .select('*')
    .eq('season', priorSeason)
    .order('week', { ascending: false });

  const map = new Map<string, TeamRating>();

  if (data) {
    for (const row of data) {
      if (!map.has(row.team_id)) {
        map.set(row.team_id, {
          teamId: row.team_id,
          teamName: '',
          season: row.season,
          week: row.week,
          overallRating: row.overall_rating || 0,
          offRating: row.off_rating || 0,
          defRating: row.def_rating || 0,
          gamesPlayed: row.games_played || 0,
          returningProductionFactor: row.returning_production_factor || 0,
          recruitingFactor: row.recruiting_factor || 0,
        });
      }
    }
  }

  return map;
}

async function getReturningProduction(season: number): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('returning_production')
    .select('team_id, percent_ppa')
    .eq('season', season);

  const map = new Map<string, number>();
  for (const row of data || []) {
    if (row.percent_ppa !== null) {
      map.set(row.team_id, row.percent_ppa);
    }
  }
  return map;
}

async function getRecruitingComposite(season: number): Promise<Map<string, number>> {
  // Get 4-year weighted recruiting composite
  // Weight: current year 40%, -1 year 30%, -2 year 20%, -3 year 10%
  const weights = [0.40, 0.30, 0.20, 0.10];
  const seasons = [season, season - 1, season - 2, season - 3];

  const { data } = await supabase
    .from('recruiting_classes')
    .select('team_id, season, points')
    .in('season', seasons);

  // Group by team
  const teamData = new Map<string, Map<number, number>>();
  for (const row of data || []) {
    if (!teamData.has(row.team_id)) {
      teamData.set(row.team_id, new Map());
    }
    teamData.get(row.team_id)!.set(row.season, row.points || 0);
  }

  // Calculate weighted composite
  const result = new Map<string, number>();
  for (const [teamId, seasonPoints] of teamData) {
    let composite = 0;
    let totalWeight = 0;

    for (let i = 0; i < seasons.length; i++) {
      const points = seasonPoints.get(seasons[i]);
      if (points !== undefined) {
        composite += points * weights[i];
        totalWeight += weights[i];
      }
    }

    if (totalWeight > 0) {
      result.set(teamId, composite / totalWeight);
    }
  }

  return result;
}

async function getGameAdvancedStats(season: number): Promise<Map<string, any[]>> {
  // Supabase has a hard limit, so we need to paginate
  const allData: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('game_advanced_stats')
      .select('*')
      .eq('season', season)
      .order('week', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`Error fetching game stats: ${error.message}`);
      break;
    }

    if (!data || data.length === 0) break;

    allData.push(...data);
    offset += pageSize;

    // If we got less than a full page, we're done
    if (data.length < pageSize) break;
  }

  console.log(`    Fetched ${allData.length} game stats records`);

  // Group by team
  const map = new Map<string, any[]>();
  for (const row of allData) {
    if (!map.has(row.team_id)) {
      map.set(row.team_id, []);
    }
    map.get(row.team_id)!.push(row);
  }

  return map;
}

// =============================================================================
// RATING CALCULATIONS
// =============================================================================

function normalizeReturningProduction(percentPpa: number): number {
  // Normalize percent_ppa (typically 0-100%) to a factor
  // Higher returning production = better
  // Map to approximately -10 to +10 scale
  const baseline = 50; // Average is about 50%
  return (percentPpa - baseline) / 5;
}

function normalizeRecruiting(points: number, allPoints: number[]): number {
  // Normalize recruiting points relative to other teams
  // Map to approximately -10 to +10 scale
  const mean = allPoints.reduce((a, b) => a + b, 0) / allPoints.length;
  const std = Math.sqrt(
    allPoints.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / allPoints.length
  );

  if (std === 0) return 0;
  return ((points - mean) / std) * 5; // Scale to roughly -10 to +10
}

function initializePreseasonRating(
  priorRating: TeamRating | undefined,
  returningProd: number | undefined,
  recruitingComposite: number | undefined,
  allRecruitingPoints: number[],
  params: RatingParams
): { overall: number; off: number; def: number; retProdFactor: number; recruitFactor: number } {

  // 1. Prior season component (regressed to mean)
  let priorComponent = params.leagueAvgRating;
  if (priorRating) {
    priorComponent = priorRating.overallRating * (1 - params.regressionToMean) +
                     params.leagueAvgRating * params.regressionToMean;
  }

  // 2. Returning production component
  let retProdFactor = 0;
  if (returningProd !== undefined) {
    retProdFactor = normalizeReturningProduction(returningProd);
  }

  // 3. Recruiting component
  let recruitFactor = 0;
  if (recruitingComposite !== undefined && allRecruitingPoints.length > 0) {
    recruitFactor = normalizeRecruiting(recruitingComposite, allRecruitingPoints);
  }

  // 4. Combine with weights
  const overall =
    params.priorWeight * priorComponent +
    params.returningProdWeight * retProdFactor * 2 + // Scale factors
    params.recruitingWeight * recruitFactor * 2;

  // For now, assume offense and defense split evenly
  // This will be refined once we have game data
  const off = overall / 2;
  const def = overall / 2;

  return { overall, off, def, retProdFactor, recruitFactor };
}

function updateRatingAfterGame(
  currentOff: number,
  currentDef: number,
  gameStats: any,
  gamesPlayed: number,
  params: RatingParams
): { off: number; def: number; overall: number } {

  // K factor decreases through season (more games = more confident)
  const k = params.kBase * (1 - gamesPlayed / 15);

  // Game PPA (already opponent-adjusted by CFBD)
  const gameOffPpa = gameStats.off_ppa || 0;
  const gameDefPpa = gameStats.def_ppa || 0;

  // Update ratings (exponential moving average)
  const newOff = currentOff + k * (gameOffPpa - currentOff);
  const newDef = currentDef + k * (gameDefPpa - currentDef);

  // Overall = off - def (higher off is better, lower def is better)
  // But CFBD's def_ppa is "points allowed per play", so higher = worse defense
  // So overall = off - def makes sense (good offense, bad defense for opponent)
  const overall = newOff - newDef;

  return { off: newOff, def: newDef, overall };
}

// =============================================================================
// MAIN ENGINE
// =============================================================================

async function initializeSeasonRatings(
  season: number,
  params: RatingParams = DEFAULT_PARAMS
): Promise<Map<string, TeamRating>> {

  console.log(`\nInitializing preseason ratings for ${season}...`);

  const teams = await getTeams();
  const priorRatings = await getPriorSeasonRatings(season);
  const returningProd = await getReturningProduction(season);
  const recruitingComposite = await getRecruitingComposite(season);

  // Get all recruiting points for normalization
  const allRecruitingPoints = Array.from(recruitingComposite.values());

  console.log(`  Teams: ${teams.size}`);
  console.log(`  Prior ratings: ${priorRatings.size}`);
  console.log(`  Returning production: ${returningProd.size}`);
  console.log(`  Recruiting data: ${recruitingComposite.size}`);

  const ratings = new Map<string, TeamRating>();

  for (const [teamId, team] of teams) {
    const prior = priorRatings.get(teamId);
    const retProd = returningProd.get(teamId);
    const recruit = recruitingComposite.get(teamId);

    const initialized = initializePreseasonRating(
      prior,
      retProd,
      recruit,
      allRecruitingPoints,
      params
    );

    ratings.set(teamId, {
      teamId,
      teamName: team.name,
      season,
      week: 0,
      overallRating: initialized.overall,
      offRating: initialized.off,
      defRating: initialized.def,
      gamesPlayed: 0,
      returningProductionFactor: initialized.retProdFactor,
      recruitingFactor: initialized.recruitFactor,
    });
  }

  return ratings;
}

async function processSeasonWeekByWeek(
  season: number,
  initialRatings: Map<string, TeamRating>,
  params: RatingParams = DEFAULT_PARAMS
): Promise<Map<number, Map<string, TeamRating>>> {

  console.log(`\nProcessing ${season} week by week...`);

  const gameStats = await getGameAdvancedStats(season);

  // Track ratings by week
  const ratingsByWeek = new Map<number, Map<string, TeamRating>>();

  // Week 0 = preseason
  ratingsByWeek.set(0, new Map(initialRatings));

  // Get all weeks
  const allWeeks = new Set<number>();
  for (const games of gameStats.values()) {
    for (const game of games) {
      if (game.week) allWeeks.add(game.week);
    }
  }
  const weeks = Array.from(allWeeks).sort((a, b) => a - b);

  console.log(`  Weeks: ${weeks.join(', ')}`);

  // Current ratings (will be updated as we go)
  const currentRatings = new Map(initialRatings);

  for (const week of weeks) {
    // Find all games in this week
    for (const [teamId, games] of gameStats) {
      const weekGames = games.filter(g => g.week === week);

      for (const game of weekGames) {
        const current = currentRatings.get(teamId);
        if (!current) continue;

        const updated = updateRatingAfterGame(
          current.offRating,
          current.defRating,
          game,
          current.gamesPlayed,
          params
        );

        currentRatings.set(teamId, {
          ...current,
          offRating: updated.off,
          defRating: updated.def,
          overallRating: updated.overall,
          gamesPlayed: current.gamesPlayed + 1,
          week,
        });
      }
    }

    // Snapshot ratings at end of week
    ratingsByWeek.set(week, new Map(currentRatings));
  }

  return ratingsByWeek;
}

async function saveRatingsToDatabase(
  ratingsByWeek: Map<number, Map<string, TeamRating>>,
  season: number
): Promise<void> {

  console.log(`\nSaving ratings to database for ${season}...`);

  // Delete existing ratings for this season
  await supabase
    .from('team_ratings_history')
    .delete()
    .eq('season', season);

  // Prepare batch insert
  const rows: any[] = [];

  for (const [week, ratings] of ratingsByWeek) {
    for (const [teamId, rating] of ratings) {
      rows.push({
        team_id: teamId,
        season,
        week,
        overall_rating: rating.overallRating,
        off_rating: rating.offRating,
        def_rating: rating.defRating,
        returning_production_factor: rating.returningProductionFactor,
        recruiting_factor: rating.recruitingFactor,
        games_played: rating.gamesPlayed,
      });
    }
  }

  // Insert in batches
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('team_ratings_history')
      .insert(batch);

    if (error) {
      console.error(`Error inserting batch: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  Inserted ${inserted} rating snapshots`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const seasons = args.length > 0
    ? args.map(Number)
    : [2022, 2023, 2024];

  console.log('=== TEAM RATING ENGINE ===');
  console.log(`Seasons: ${seasons.join(', ')}`);
  console.log('\nParameters:');
  console.log(JSON.stringify(DEFAULT_PARAMS, null, 2));

  for (const season of seasons) {
    // 1. Initialize preseason ratings
    const initialRatings = await initializeSeasonRatings(season, DEFAULT_PARAMS);

    // 2. Process week by week
    const ratingsByWeek = await processSeasonWeekByWeek(season, initialRatings, DEFAULT_PARAMS);

    // 3. Save to database
    await saveRatingsToDatabase(ratingsByWeek, season);

    // 4. Show top teams at end of season
    const maxWeek = Math.max(...Array.from(ratingsByWeek.keys()));
    const finalRatings = ratingsByWeek.get(maxWeek);

    if (finalRatings) {
      const sorted = Array.from(finalRatings.values())
        .sort((a, b) => b.overallRating - a.overallRating)
        .slice(0, 10);

      console.log(`\nTop 10 teams at end of ${season} (Week ${maxWeek}):`);
      console.log('Rank | Team                     | Overall | Off    | Def    | Games');
      console.log('-----|--------------------------|---------|--------|--------|------');

      sorted.forEach((team, i) => {
        console.log(
          `${(i + 1).toString().padStart(4)} | ${team.teamName.padEnd(24)} | ${team.overallRating.toFixed(2).padStart(7)} | ${team.offRating.toFixed(2).padStart(6)} | ${team.defRating.toFixed(2).padStart(6)} | ${team.gamesPlayed}`
        );
      });
    }
  }

  console.log('\n=== RATING ENGINE COMPLETE ===');
}

main().catch(console.error);

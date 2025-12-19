/**
 * Team Rating Engine v2
 *
 * Uses CFBD's SP+ as the baseline rating, adjusted by:
 * 1. Returning production (preseason adjustment)
 * 2. Weekly game PPA (in-season updates)
 *
 * This avoids look-ahead bias by:
 * - Using prior-season SP+ at the start of each season
 * - Only updating after games have been completed
 * - Snapshotting ratings week-by-week for point-in-time analysis
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
  regressionToMean: number;     // How much to regress prior SP+ toward mean (0.3 = 30%)
  returningProdWeight: number;  // How much returning production affects preseason
  kFactor: number;              // Base learning rate for in-season updates
  leagueAvgSP: number;          // League average SP+ (to regress toward)
}

const DEFAULT_PARAMS: RatingParams = {
  regressionToMean: 0.30,       // Regress 30% toward mean
  returningProdWeight: 0.15,    // Returning production has 15% impact
  kFactor: 0.10,                // Update ratings by 10% of the difference per game
  leagueAvgSP: 0,               // League average SP+ is ~0
};

interface TeamRating {
  teamId: string;
  teamName: string;
  rating: number;               // In SP+ scale
  gamesPlayed: number;
}

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getPriorSeasonSP(season: number): Promise<Map<string, number>> {
  const priorSeason = season - 1;

  const { data } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_overall')
    .eq('season', priorSeason)
    .not('sp_overall', 'is', null);

  const map = new Map<string, number>();
  for (const row of data || []) {
    map.set(row.team_id, row.sp_overall);
  }

  return map;
}

async function getReturningProduction(season: number): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('returning_production')
    .select('team_id, percent_ppa')
    .eq('season', season)
    .not('percent_ppa', 'is', null);

  const map = new Map<string, number>();
  for (const row of data || []) {
    map.set(row.team_id, row.percent_ppa);
  }

  return map;
}

async function getGamePPA(season: number): Promise<Map<string, { week: number; offPPA: number; defPPA: number }[]>> {
  // Paginate to get all records
  const allData: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data } = await supabase
      .from('game_advanced_stats')
      .select('team_id, week, off_ppa, def_ppa')
      .eq('season', season)
      .order('week', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (!data || data.length === 0) break;
    allData.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  const map = new Map<string, { week: number; offPPA: number; defPPA: number }[]>();
  for (const row of allData) {
    if (!map.has(row.team_id)) {
      map.set(row.team_id, []);
    }
    map.get(row.team_id)!.push({
      week: row.week,
      offPPA: row.off_ppa || 0,
      defPPA: row.def_ppa || 0,
    });
  }

  return map;
}

async function getTeams(): Promise<Map<string, string>> {
  const { data } = await supabase.from('teams').select('id, name');
  const map = new Map<string, string>();
  for (const team of data || []) {
    map.set(team.id, team.name);
  }
  return map;
}

// =============================================================================
// RATING CALCULATIONS
// =============================================================================

function initializePreseasonRating(
  priorSP: number | undefined,
  returningProdPct: number | undefined,
  params: RatingParams
): number {
  // Start with league average if no prior SP+
  let baseRating = priorSP !== undefined ? priorSP : params.leagueAvgSP;

  // Regress toward mean
  baseRating = baseRating * (1 - params.regressionToMean) +
               params.leagueAvgSP * params.regressionToMean;

  // Adjust for returning production
  // Higher returning production (>50%) = positive adjustment
  // Lower returning production (<50%) = negative adjustment
  if (returningProdPct !== undefined) {
    const prodAdjustment = (returningProdPct - 50) / 100 * params.returningProdWeight * 10;
    baseRating += prodAdjustment;
  }

  return baseRating;
}

function updateRatingAfterGame(
  currentRating: number,
  gamePPA: { offPPA: number; defPPA: number },
  gamesPlayed: number,
  params: RatingParams
): number {
  // Game performance in SP+ scale:
  // Net PPA = off_ppa - def_ppa (higher is better)
  // Multiply by ~30 to scale PPA (~0.1-0.3) to SP+ (~0-35)
  const gamePerformance = (gamePPA.offPPA - gamePPA.defPPA) * 30;

  // K factor decreases with games played (more confident in rating)
  const k = params.kFactor * (1 - gamesPlayed / 15);

  // Update rating
  return currentRating + k * (gamePerformance - currentRating);
}

// =============================================================================
// MAIN ENGINE
// =============================================================================

async function buildSeasonRatings(
  season: number,
  params: RatingParams = DEFAULT_PARAMS
): Promise<Map<number, Map<string, TeamRating>>> {

  console.log(`\n=== Building ratings for ${season} ===`);

  const teams = await getTeams();
  const priorSP = await getPriorSeasonSP(season);
  const returningProd = await getReturningProduction(season);
  const gamePPA = await getGamePPA(season);

  console.log(`  Teams: ${teams.size}`);
  console.log(`  Prior SP+ ratings: ${priorSP.size}`);
  console.log(`  Returning production: ${returningProd.size}`);
  console.log(`  Game PPA records: ${Array.from(gamePPA.values()).flat().length}`);

  // Get all weeks from game data
  const allWeeks = new Set<number>();
  for (const games of gamePPA.values()) {
    for (const g of games) {
      allWeeks.add(g.week);
    }
  }
  const weeks = Array.from(allWeeks).sort((a, b) => a - b);
  console.log(`  Weeks: ${weeks.join(', ')}`);

  // Initialize ratings
  // Only for teams that have BOTH SP+ data AND game PPA data (active FBS teams)
  const ratings = new Map<string, TeamRating>();
  const teamsWithGames = new Set(gamePPA.keys());

  for (const [teamId, teamName] of teams) {
    const sp = priorSP.get(teamId);
    const retProd = returningProd.get(teamId);

    // Only initialize if we have prior SP+ AND this team has game data
    // This filters out duplicate entries and FCS teams
    if (sp !== undefined && teamsWithGames.has(teamId)) {
      ratings.set(teamId, {
        teamId,
        teamName,
        rating: initializePreseasonRating(sp, retProd, params),
        gamesPlayed: 0,
      });
    }
  }

  console.log(`  Teams with ratings: ${ratings.size}`);

  // Track ratings by week
  const ratingsByWeek = new Map<number, Map<string, TeamRating>>();

  // Week 0 = preseason
  ratingsByWeek.set(0, new Map(ratings));

  // Process each week
  for (const week of weeks) {
    // Update ratings after games in this week
    for (const [teamId, games] of gamePPA) {
      const weekGames = games.filter(g => g.week === week);

      for (const game of weekGames) {
        const current = ratings.get(teamId);
        if (!current) continue;

        const newRating = updateRatingAfterGame(
          current.rating,
          game,
          current.gamesPlayed,
          params
        );

        ratings.set(teamId, {
          ...current,
          rating: newRating,
          gamesPlayed: current.gamesPlayed + 1,
        });
      }
    }

    // Snapshot end-of-week ratings
    ratingsByWeek.set(week, new Map(
      Array.from(ratings.entries()).map(([id, r]) => [id, { ...r }])
    ));
  }

  return ratingsByWeek;
}

async function saveRatings(
  ratingsByWeek: Map<number, Map<string, TeamRating>>,
  season: number
): Promise<void> {
  console.log(`\n  Saving ratings...`);

  // Delete existing
  await supabase
    .from('team_ratings_history')
    .delete()
    .eq('season', season);

  // Prepare rows
  const rows: any[] = [];
  for (const [week, ratings] of ratingsByWeek) {
    for (const [teamId, rating] of ratings) {
      rows.push({
        team_id: teamId,
        season,
        week,
        overall_rating: rating.rating,
        off_rating: rating.rating / 2, // Placeholder split
        def_rating: rating.rating / 2,
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
      console.log(`    Error: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`    Saved ${inserted} rating snapshots`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const seasons = args.length > 0 ? args.map(Number) : [2023, 2024];

  console.log('=== TEAM RATING ENGINE V2 ===');
  console.log(`Seasons: ${seasons.join(', ')}`);
  console.log('\nParameters:');
  console.log(JSON.stringify(DEFAULT_PARAMS, null, 2));

  for (const season of seasons) {
    const ratingsByWeek = await buildSeasonRatings(season, DEFAULT_PARAMS);
    await saveRatings(ratingsByWeek, season);

    // Show top teams at end of season
    const maxWeek = Math.max(...Array.from(ratingsByWeek.keys()));
    const finalRatings = ratingsByWeek.get(maxWeek);

    if (finalRatings) {
      const sorted = Array.from(finalRatings.values())
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 15);

      console.log(`\n  Top 15 at end of ${season} (Week ${maxWeek}):`);
      console.log('  Rank | Team                     | Rating | Games');
      console.log('  -----|--------------------------|--------|------');

      sorted.forEach((team, i) => {
        console.log(
          `  ${(i + 1).toString().padStart(4)} | ${team.teamName.padEnd(24)} | ${team.rating.toFixed(1).padStart(6)} | ${team.gamesPlayed}`
        );
      });
    }
  }

  console.log('\n=== RATING ENGINE V2 COMPLETE ===');
}

main().catch(console.error);

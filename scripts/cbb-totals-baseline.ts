/**
 * CBB Totals Baseline Backtest
 *
 * Phase 1: Baseline efficiency check + structural signals
 * - Rest days (days since last game for each team)
 * - Season phase (early Nov, mid-season, March)
 * - Schedule compression (back-to-back games)
 *
 * Hypothesis: Under-rested teams may underperform pace expectations
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface GameData {
  id: string;
  game_id: string;
  cbbd_game_id: number;
  total: number;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  actual_total: number;
  start_date: string;
  season: number;
}

interface TeamSchedule {
  teamId: string;
  games: { date: Date; gameId: string }[];
}

interface EnrichedGame extends GameData {
  homeRestDays: number | null;
  awayRestDays: number | null;
  minRestDays: number | null;
  month: number;
  seasonPhase: 'early' | 'mid' | 'late';
}

/**
 * Fetch all games with totals and scores
 */
async function fetchGamesWithTotals(): Promise<GameData[]> {
  const games: GameData[] = [];
  let offset = 0;
  const pageSize = 1000;

  console.log('Fetching games with totals...');

  while (true) {
    const { data, error } = await supabase
      .from('cbb_betting_lines')
      .select(`
        id,
        game_id,
        cbbd_game_id,
        total,
        cbb_games!inner(
          home_team_id,
          away_team_id,
          home_score,
          away_score,
          start_date,
          season
        )
      `)
      .not('total', 'is', null)
      .order('cbbd_game_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error:', error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const g = row.cbb_games as any;
      if (g.home_score === null || g.away_score === null) continue;
      if (!g.home_team_id || !g.away_team_id) continue;

      games.push({
        id: row.id,
        game_id: row.game_id,
        cbbd_game_id: row.cbbd_game_id,
        total: row.total,
        home_team_id: g.home_team_id,
        away_team_id: g.away_team_id,
        home_score: g.home_score,
        away_score: g.away_score,
        actual_total: g.home_score + g.away_score,
        start_date: g.start_date,
        season: g.season,
      });
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return games;
}

/**
 * Build schedule lookup for rest day calculation
 */
function buildScheduleLookup(games: GameData[]): Map<string, TeamSchedule> {
  const schedules = new Map<string, TeamSchedule>();

  for (const game of games) {
    const gameDate = new Date(game.start_date);

    // Add to home team
    if (!schedules.has(game.home_team_id)) {
      schedules.set(game.home_team_id, { teamId: game.home_team_id, games: [] });
    }
    schedules.get(game.home_team_id)!.games.push({ date: gameDate, gameId: game.game_id });

    // Add to away team
    if (!schedules.has(game.away_team_id)) {
      schedules.set(game.away_team_id, { teamId: game.away_team_id, games: [] });
    }
    schedules.get(game.away_team_id)!.games.push({ date: gameDate, gameId: game.game_id });
  }

  // Sort each team's games by date
  for (const schedule of schedules.values()) {
    schedule.games.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  return schedules;
}

/**
 * Calculate rest days for a team before a specific game
 */
function getRestDays(
  teamId: string,
  gameDate: Date,
  gameId: string,
  schedules: Map<string, TeamSchedule>
): number | null {
  const schedule = schedules.get(teamId);
  if (!schedule) return null;

  // Find this game in the schedule
  const gameIndex = schedule.games.findIndex(g => g.gameId === gameId);
  if (gameIndex <= 0) return null; // First game or not found

  const prevGame = schedule.games[gameIndex - 1];
  const daysDiff = (gameDate.getTime() - prevGame.date.getTime()) / (1000 * 60 * 60 * 24);

  return Math.floor(daysDiff);
}

/**
 * Determine season phase based on month
 */
function getSeasonPhase(date: Date): 'early' | 'mid' | 'late' {
  const month = date.getMonth() + 1; // 1-12

  if (month === 11 || month === 12) return 'early';
  if (month === 3) return 'late';
  return 'mid';
}

/**
 * Enrich games with structural features
 */
function enrichGames(games: GameData[], schedules: Map<string, TeamSchedule>): EnrichedGame[] {
  return games.map(game => {
    const gameDate = new Date(game.start_date);
    const homeRest = getRestDays(game.home_team_id, gameDate, game.game_id, schedules);
    const awayRest = getRestDays(game.away_team_id, gameDate, game.game_id, schedules);

    let minRest: number | null = null;
    if (homeRest !== null && awayRest !== null) {
      minRest = Math.min(homeRest, awayRest);
    } else if (homeRest !== null) {
      minRest = homeRest;
    } else if (awayRest !== null) {
      minRest = awayRest;
    }

    return {
      ...game,
      homeRestDays: homeRest,
      awayRestDays: awayRest,
      minRestDays: minRest,
      month: gameDate.getMonth() + 1,
      seasonPhase: getSeasonPhase(gameDate),
    };
  });
}

interface BacktestResult {
  label: string;
  games: number;
  overs: number;
  unders: number;
  pushes: number;
  overRate: number;
  avgActual: number;
  avgMarket: number;
  avgDiff: number;
}

/**
 * Run baseline backtest on a subset of games
 */
function runBacktest(games: EnrichedGame[], label: string): BacktestResult {
  let overs = 0;
  let unders = 0;
  let pushes = 0;
  let totalActual = 0;
  let totalMarket = 0;

  for (const game of games) {
    totalActual += game.actual_total;
    totalMarket += game.total;

    if (game.actual_total > game.total) {
      overs++;
    } else if (game.actual_total < game.total) {
      unders++;
    } else {
      pushes++;
    }
  }

  const decisioned = overs + unders;

  return {
    label,
    games: games.length,
    overs,
    unders,
    pushes,
    overRate: decisioned > 0 ? overs / decisioned : 0,
    avgActual: games.length > 0 ? totalActual / games.length : 0,
    avgMarket: games.length > 0 ? totalMarket / games.length : 0,
    avgDiff: games.length > 0 ? (totalActual - totalMarket) / games.length : 0,
  };
}

/**
 * Calculate ROI for betting a specific side
 */
function calculateROI(result: BacktestResult, betSide: 'over' | 'under'): number {
  const wins = betSide === 'over' ? result.overs : result.unders;
  const losses = betSide === 'over' ? result.unders : result.overs;
  const bets = wins + losses;

  if (bets === 0) return 0;

  const profit = (wins * (100 / 1.1)) - (losses * 100);
  return (profit / (bets * 100)) * 100;
}

async function main() {
  console.log('========================================');
  console.log('  CBB Totals Baseline Backtest');
  console.log('========================================\n');

  const games = await fetchGamesWithTotals();
  console.log(`Total games with totals: ${games.length}\n`);

  // Build schedule lookup
  console.log('Building schedule lookup for rest days...');
  const schedules = buildScheduleLookup(games);
  console.log(`Teams tracked: ${schedules.size}\n`);

  // Enrich with structural features
  const enrichedGames = enrichGames(games, schedules);

  // Filter to games where we have rest data
  const gamesWithRest = enrichedGames.filter(g => g.minRestDays !== null);
  console.log(`Games with rest data: ${gamesWithRest.length}\n`);

  // === BASELINE: Overall market efficiency ===
  console.log('=== BASELINE: Market Efficiency ===\n');

  const overall = runBacktest(enrichedGames, 'All Games');
  console.log(`Total games: ${overall.games}`);
  console.log(`Over rate: ${(overall.overRate * 100).toFixed(1)}%`);
  console.log(`Avg actual: ${overall.avgActual.toFixed(1)}`);
  console.log(`Avg market: ${overall.avgMarket.toFixed(1)}`);
  console.log(`Avg diff (actual - market): ${overall.avgDiff.toFixed(2)}`);
  console.log(`Over ROI: ${calculateROI(overall, 'over').toFixed(1)}%`);
  console.log(`Under ROI: ${calculateROI(overall, 'under').toFixed(1)}%`);

  // === BY SEASON ===
  console.log('\n\n=== BY SEASON ===\n');
  console.log('| Season | Games | Over% | Avg Diff | Over ROI | Under ROI |');
  console.log('|--------|-------|-------|----------|----------|-----------|');

  for (const season of [2022, 2023, 2024, 2025]) {
    const seasonGames = enrichedGames.filter(g => g.season === season);
    if (seasonGames.length === 0) continue;

    const result = runBacktest(seasonGames, `Season ${season}`);
    console.log(
      `| ${season}   | ${String(result.games).padEnd(5)} | ${(result.overRate * 100).toFixed(1).padStart(5)}% | ${result.avgDiff >= 0 ? '+' : ''}${result.avgDiff.toFixed(1).padStart(6)} | ${calculateROI(result, 'over') >= 0 ? '+' : ''}${calculateROI(result, 'over').toFixed(1).padStart(5)}% | ${calculateROI(result, 'under') >= 0 ? '+' : ''}${calculateROI(result, 'under').toFixed(1).padStart(6)}% |`
    );
  }

  // === BY SEASON PHASE ===
  console.log('\n\n=== BY SEASON PHASE ===\n');
  console.log('| Phase | Games | Over% | Avg Diff | Over ROI | Under ROI |');
  console.log('|-------|-------|-------|----------|----------|-----------|');

  for (const phase of ['early', 'mid', 'late'] as const) {
    const phaseGames = enrichedGames.filter(g => g.seasonPhase === phase);
    if (phaseGames.length === 0) continue;

    const result = runBacktest(phaseGames, phase);
    console.log(
      `| ${phase.padEnd(5)} | ${String(result.games).padEnd(5)} | ${(result.overRate * 100).toFixed(1).padStart(5)}% | ${result.avgDiff >= 0 ? '+' : ''}${result.avgDiff.toFixed(1).padStart(6)} | ${calculateROI(result, 'over') >= 0 ? '+' : ''}${calculateROI(result, 'over').toFixed(1).padStart(5)}% | ${calculateROI(result, 'under') >= 0 ? '+' : ''}${calculateROI(result, 'under').toFixed(1).padStart(6)}% |`
    );
  }

  // === BY REST DAYS ===
  console.log('\n\n=== BY MIN REST DAYS (Either Team) ===\n');
  console.log('| Rest | Games | Over% | Avg Diff | Over ROI | Under ROI |');
  console.log('|------|-------|-------|----------|----------|-----------|');

  const restBuckets = [
    { min: 0, max: 1, label: '0-1d' },
    { min: 1, max: 2, label: '1-2d' },
    { min: 2, max: 3, label: '2-3d' },
    { min: 3, max: 5, label: '3-5d' },
    { min: 5, max: 8, label: '5-8d' },
    { min: 8, max: 100, label: '8d+' },
  ];

  for (const bucket of restBuckets) {
    const bucketGames = gamesWithRest.filter(
      g => g.minRestDays! >= bucket.min && g.minRestDays! < bucket.max
    );
    if (bucketGames.length < 50) continue;

    const result = runBacktest(bucketGames, bucket.label);
    console.log(
      `| ${bucket.label.padEnd(4)} | ${String(result.games).padEnd(5)} | ${(result.overRate * 100).toFixed(1).padStart(5)}% | ${result.avgDiff >= 0 ? '+' : ''}${result.avgDiff.toFixed(1).padStart(6)} | ${calculateROI(result, 'over') >= 0 ? '+' : ''}${calculateROI(result, 'over').toFixed(1).padStart(5)}% | ${calculateROI(result, 'under') >= 0 ? '+' : ''}${calculateROI(result, 'under').toFixed(1).padStart(6)}% |`
    );
  }

  // === BACK-TO-BACK GAMES ===
  console.log('\n\n=== BACK-TO-BACK (Both Teams 0-1 Days Rest) ===\n');

  const backToBack = enrichedGames.filter(
    g => g.homeRestDays !== null && g.awayRestDays !== null &&
         g.homeRestDays <= 1 && g.awayRestDays <= 1
  );

  if (backToBack.length > 20) {
    const b2bResult = runBacktest(backToBack, 'Back-to-back');
    console.log(`Games: ${b2bResult.games}`);
    console.log(`Over rate: ${(b2bResult.overRate * 100).toFixed(1)}%`);
    console.log(`Avg diff: ${b2bResult.avgDiff >= 0 ? '+' : ''}${b2bResult.avgDiff.toFixed(1)}`);
    console.log(`Over ROI: ${calculateROI(b2bResult, 'over') >= 0 ? '+' : ''}${calculateROI(b2bResult, 'over').toFixed(1)}%`);
    console.log(`Under ROI: ${calculateROI(b2bResult, 'under') >= 0 ? '+' : ''}${calculateROI(b2bResult, 'under').toFixed(1)}%`);
  } else {
    console.log('Insufficient back-to-back games for analysis');
  }

  // === REST MISMATCH ===
  console.log('\n\n=== REST MISMATCH (3+ day difference) ===\n');

  const restMismatch = enrichedGames.filter(
    g => g.homeRestDays !== null && g.awayRestDays !== null &&
         Math.abs(g.homeRestDays - g.awayRestDays) >= 3
  );

  if (restMismatch.length > 20) {
    const mismatchResult = runBacktest(restMismatch, 'Rest mismatch');
    console.log(`Games: ${mismatchResult.games}`);
    console.log(`Over rate: ${(mismatchResult.overRate * 100).toFixed(1)}%`);
    console.log(`Avg diff: ${mismatchResult.avgDiff >= 0 ? '+' : ''}${mismatchResult.avgDiff.toFixed(1)}`);
    console.log(`Over ROI: ${calculateROI(mismatchResult, 'over') >= 0 ? '+' : ''}${calculateROI(mismatchResult, 'over').toFixed(1)}%`);
    console.log(`Under ROI: ${calculateROI(mismatchResult, 'under') >= 0 ? '+' : ''}${calculateROI(mismatchResult, 'under').toFixed(1)}%`);
  } else {
    console.log('Insufficient rest mismatch games for analysis');
  }

  // === SUMMARY ===
  console.log('\n\n=== KEY FINDINGS ===\n');
  console.log('1. Market bias: Avg actual vs market = ' + (overall.avgDiff >= 0 ? '+' : '') + overall.avgDiff.toFixed(2) + ' pts');
  console.log('2. Overall over rate: ' + (overall.overRate * 100).toFixed(1) + '%');
  console.log('3. Baseline ROI: Over=' + calculateROI(overall, 'over').toFixed(1) + '%, Under=' + calculateROI(overall, 'under').toFixed(1) + '%');
}

main().catch(console.error);

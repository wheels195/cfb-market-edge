/**
 * CFB T-60 Execution Backtest (v2 - Fixed Pagination)
 *
 * FIXES:
 * 1. All Supabase queries paginated to handle >1000 rows
 * 2. Proper team name → team_id mapping
 * 3. Robust fallback for missing ratings
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Frozen production model weights
const MODEL_WEIGHTS = { elo: 0.50, sp: 0.30, ppa: 0.20 };
const HOME_FIELD_ADVANTAGE = 2.0;
const ELO_TO_SPREAD_DIVISOR = 25;

interface T60Result {
  cfbd_game_id: number;
  spread_t60: number | null;
  spread_close: number | null;
  matched: boolean;
}

interface GameData {
  cfbd_game_id: number;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  spread_close: number;
  spread_t60: number | null;
}

interface TeamRatings {
  elo: number;
  sp_overall: number;
  sp_offense: number;
  sp_defense: number;
  ppa_offense: number;
  ppa_defense: number;
}

// Helper: Paginated fetch from Supabase (handles >1000 rows)
async function fetchAllRows<T>(
  tableName: string,
  selectColumns: string,
  filters?: (query: any) => any
): Promise<T[]> {
  const allRows: T[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase
      .from(tableName)
      .select(selectColumns)
      .range(offset, offset + pageSize - 1);

    if (filters) {
      query = filters(query);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`Error fetching ${tableName}:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allRows.push(...(data as T[]));

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}

// Load T-60 spreads from JSON
function loadT60Spreads(): Map<number, T60Result> {
  const data = JSON.parse(fs.readFileSync('/home/wheel/cfb-market-edge/data/t60-spreads.json', 'utf-8'));
  const map = new Map<number, T60Result>();
  for (const item of data) {
    map.set(item.cfbd_game_id, item);
  }
  return map;
}

// Compute ensemble projection
function computeProjection(homeRatings: TeamRatings, awayRatings: TeamRatings): { spread: number; confidence: 'high' | 'medium' | 'low' } {
  const eloDiff = homeRatings.elo - awayRatings.elo;
  const eloSpread = -(eloDiff / ELO_TO_SPREAD_DIVISOR) - HOME_FIELD_ADVANTAGE;

  const spDiff = homeRatings.sp_overall - awayRatings.sp_overall;
  const spSpread = -spDiff - HOME_FIELD_ADVANTAGE;

  const ppaDiff = (homeRatings.ppa_offense - awayRatings.ppa_defense) -
                  (awayRatings.ppa_offense - homeRatings.ppa_defense);
  const ppaSpread = -(ppaDiff * 35) - HOME_FIELD_ADVANTAGE;

  const projectedSpread = (eloSpread * MODEL_WEIGHTS.elo) +
                          (spSpread * MODEL_WEIGHTS.sp) +
                          (ppaSpread * MODEL_WEIGHTS.ppa);

  const spreads = [eloSpread, spSpread, ppaSpread];
  const maxDiff = Math.max(...spreads) - Math.min(...spreads);
  const confidence = maxDiff <= 5 ? 'high' : maxDiff <= 8 ? 'medium' : 'low';

  return { spread: projectedSpread, confidence };
}

// Evaluate a spread bet
function evaluateBet(
  marketSpread: number,
  modelSpread: number,
  actualMargin: number,
  minEdge: number,
  maxEdge: number
): { won: boolean; profit: number; side: string } | null {
  const edge = marketSpread - modelSpread;

  if (Math.abs(edge) < minEdge || Math.abs(edge) >= maxEdge) {
    return null;
  }

  const betHome = edge > 0;
  const side = betHome ? 'home' : 'away';

  const adjustedMargin = betHome
    ? actualMargin + marketSpread
    : -(actualMargin + marketSpread);

  if (adjustedMargin === 0) {
    return { won: false, profit: 0, side };
  }

  const won = adjustedMargin > 0;
  return { won, profit: won ? 100 / 1.1 : -100, side };
}

async function main() {
  console.log('========================================');
  console.log('  CFB T-60 Execution Backtest (v2)');
  console.log('  Model: Elo 50% + SP+ 30% + PPA 20%');
  console.log('========================================\n');

  // Load T-60 spreads
  const t60Map = loadT60Spreads();
  console.log(`T-60 spreads loaded: ${t60Map.size}`);

  // ========== STEP 1: Load teams table (name → ID mapping) ==========
  console.log('\nLoading team mappings...');
  const teamsData = await fetchAllRows<{ id: string; name: string }>('teams', 'id, name');

  const teamNameToId = new Map<string, string>();
  const teamIdToName = new Map<string, string>();
  for (const team of teamsData) {
    teamNameToId.set(team.name, team.id);
    teamIdToName.set(team.id, team.name);
  }
  console.log(`  Teams: ${teamNameToId.size}`);

  // ========== STEP 2: Load ALL Elo snapshots with pagination ==========
  console.log('\nLoading Elo snapshots (paginated)...');
  const eloData = await fetchAllRows<{ team_id: string; season: number; week: number; elo: number }>(
    'team_elo_snapshots',
    'team_id, season, week, elo',
    (q) => q.in('season', [2022, 2023, 2024])
  );

  const eloMap = new Map<string, number>();
  for (const row of eloData) {
    const teamName = teamIdToName.get(row.team_id);
    if (teamName) {
      eloMap.set(`${teamName}_${row.season}_${row.week}`, row.elo);
    }
  }
  console.log(`  Elo snapshots: ${eloMap.size}`);

  // ========== STEP 3: Load ALL SP+ and PPA ratings with pagination ==========
  console.log('\nLoading SP+/PPA ratings (paginated)...');
  const ratingsData = await fetchAllRows<{
    team_id: string;
    season: number;
    sp_overall: number | null;
    sp_offense: number | null;
    sp_defense: number | null;
    off_ppa: number | null;
    def_ppa: number | null;
  }>(
    'advanced_team_ratings',
    'team_id, season, sp_overall, sp_offense, sp_defense, off_ppa, def_ppa',
    (q) => q.in('season', [2022, 2023, 2024])
  );

  const spMap = new Map<string, { overall: number; offense: number; defense: number }>();
  const ppaMap = new Map<string, { offense: number; defense: number }>();

  for (const row of ratingsData) {
    const teamName = teamIdToName.get(row.team_id);
    if (!teamName) continue;

    const key = `${teamName}_${row.season}`;

    if (row.sp_overall !== null) {
      spMap.set(key, {
        overall: row.sp_overall,
        offense: row.sp_offense || 0,
        defense: row.sp_defense || 0,
      });
    }

    if (row.off_ppa !== null && row.def_ppa !== null) {
      ppaMap.set(key, {
        offense: row.off_ppa,
        defense: row.def_ppa,
      });
    }
  }
  console.log(`  SP+ ratings: ${spMap.size}`);
  console.log(`  PPA ratings: ${ppaMap.size}`);

  // ========== STEP 4: Load ALL games with pagination ==========
  console.log('\nLoading games (paginated)...');
  const gamesData = await fetchAllRows<{
    cfbd_game_id: number;
    season: number;
    week: number;
    home_team: string;
    away_team: string;
    home_score: number | null;
    away_score: number | null;
    spread_close: number | null;
  }>(
    'cfbd_betting_lines',
    'cfbd_game_id, season, week, home_team, away_team, home_score, away_score, spread_close',
    (q) => q.in('season', [2022, 2023, 2024])
      .not('home_score', 'is', null)
      .not('spread_close', 'is', null)
  );

  // Filter to games with T-60 data
  const allGames: GameData[] = [];
  for (const row of gamesData) {
    const t60 = t60Map.get(row.cfbd_game_id);
    if (t60?.matched && t60.spread_t60 !== null) {
      allGames.push({
        cfbd_game_id: row.cfbd_game_id,
        season: row.season,
        week: row.week,
        home_team: row.home_team,
        away_team: row.away_team,
        home_score: row.home_score!,
        away_score: row.away_score!,
        spread_close: row.spread_close!,
        spread_t60: t60.spread_t60,
      });
    }
  }
  console.log(`  Total games loaded: ${gamesData.length}`);
  console.log(`  Games with T-60 spreads: ${allGames.length}`);

  // ========== STEP 5: Run backtest ==========
  const edgeFilters = [
    { minEdge: 2.5, maxEdge: 5.0, label: 'Production (2.5-5)' },
    { minEdge: 0, maxEdge: 10, label: 'All edges' },
    { minEdge: 1, maxEdge: 3, label: 'Small (1-3)' },
    { minEdge: 3, maxEdge: 5, label: 'Medium (3-5)' },
  ];

  for (const filter of edgeFilters) {
    console.log(`\n=== ${filter.label} (Edge ${filter.minEdge}-${filter.maxEdge} pts) ===\n`);

    const resultsBySeason: Record<number, {
      bets: number; wins: number; losses: number; pushes: number; profit: number;
    }> = {};

    let gamesWithRatings = 0;
    let gamesNoRatings = 0;

    for (const game of allGames) {
      const preGameWeek = Math.max(1, game.week - 1);

      // Elo lookup with fallbacks
      const homeElo = eloMap.get(`${game.home_team}_${game.season}_${preGameWeek}`) ||
                      eloMap.get(`${game.home_team}_${game.season}_1`) ||
                      eloMap.get(`${game.home_team}_${game.season - 1}_15`) || 1500;
      const awayElo = eloMap.get(`${game.away_team}_${game.season}_${preGameWeek}`) ||
                      eloMap.get(`${game.away_team}_${game.season}_1`) ||
                      eloMap.get(`${game.away_team}_${game.season - 1}_15`) || 1500;

      // SP+ lookup with prior season fallback
      const homeSP = spMap.get(`${game.home_team}_${game.season}`) ||
                     spMap.get(`${game.home_team}_${game.season - 1}`) ||
                     { overall: 0, offense: 0, defense: 0 };
      const awaySP = spMap.get(`${game.away_team}_${game.season}`) ||
                     spMap.get(`${game.away_team}_${game.season - 1}`) ||
                     { overall: 0, offense: 0, defense: 0 };

      // PPA lookup with prior season fallback
      const homePPA = ppaMap.get(`${game.home_team}_${game.season}`) ||
                      ppaMap.get(`${game.home_team}_${game.season - 1}`) ||
                      { offense: 0, defense: 0 };
      const awayPPA = ppaMap.get(`${game.away_team}_${game.season}`) ||
                      ppaMap.get(`${game.away_team}_${game.season - 1}`) ||
                      { offense: 0, defense: 0 };

      // Check if we have actual ratings (not defaults)
      const hasRatings = (homeElo !== 1500 || awayElo !== 1500) &&
                         (homeSP.overall !== 0 || awaySP.overall !== 0);
      if (hasRatings) gamesWithRatings++;
      else gamesNoRatings++;

      const homeRatings: TeamRatings = {
        elo: homeElo,
        sp_overall: homeSP.overall,
        sp_offense: homeSP.offense,
        sp_defense: homeSP.defense,
        ppa_offense: homePPA.offense,
        ppa_defense: homePPA.defense,
      };

      const awayRatings: TeamRatings = {
        elo: awayElo,
        sp_overall: awaySP.overall,
        sp_offense: awaySP.offense,
        sp_defense: awaySP.defense,
        ppa_offense: awayPPA.offense,
        ppa_defense: awayPPA.defense,
      };

      const { spread: modelSpread, confidence } = computeProjection(homeRatings, awayRatings);

      // Only bet on high confidence
      if (confidence !== 'high') continue;

      const actualMargin = game.home_score - game.away_score;

      const betResult = evaluateBet(
        game.spread_t60!,
        modelSpread,
        actualMargin,
        filter.minEdge,
        filter.maxEdge
      );

      if (!betResult) continue;

      if (!resultsBySeason[game.season]) {
        resultsBySeason[game.season] = { bets: 0, wins: 0, losses: 0, pushes: 0, profit: 0 };
      }

      const r = resultsBySeason[game.season];
      r.bets++;

      if (betResult.profit === 0) {
        r.pushes++;
      } else if (betResult.won) {
        r.wins++;
        r.profit += betResult.profit;
      } else {
        r.losses++;
        r.profit += betResult.profit;
      }
    }

    // Print results
    console.log('| Season | Bets | Wins | Losses | Win% | ROI | Profit |');
    console.log('|--------|------|------|--------|------|-----|--------|');

    let totalBets = 0, totalWins = 0, totalLosses = 0, totalProfit = 0;

    for (const season of [2022, 2023, 2024]) {
      const r = resultsBySeason[season];
      if (!r || r.bets === 0) continue;

      const decisioned = r.wins + r.losses;
      const winRate = decisioned > 0 ? r.wins / decisioned : 0;
      const roi = r.bets > 0 ? (r.profit / (r.bets * 100)) * 100 : 0;

      console.log(
        `| ${season}   | ${r.bets.toString().padStart(4)} | ${r.wins.toString().padStart(4)} | ${r.losses.toString().padStart(6)} | ${(winRate * 100).toFixed(1).padStart(4)}% | ${roi >= 0 ? '+' : ''}${roi.toFixed(1).padStart(4)}% | ${r.profit >= 0 ? '+' : ''}${r.profit.toFixed(0).padStart(5)} |`
      );

      totalBets += r.bets;
      totalWins += r.wins;
      totalLosses += r.losses;
      totalProfit += r.profit;
    }

    const totalWinRate = totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0;
    const totalROI = totalBets > 0 ? (totalProfit / (totalBets * 100)) * 100 : 0;

    console.log(
      `| TOTAL  | ${totalBets.toString().padStart(4)} | ${totalWins.toString().padStart(4)} | ${totalLosses.toString().padStart(6)} | ${(totalWinRate * 100).toFixed(1).padStart(4)}% | ${totalROI >= 0 ? '+' : ''}${totalROI.toFixed(1).padStart(4)}% | ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(0).padStart(5)} |`
    );

    // Chronological holdout for production filter
    if (filter.label === 'Production (2.5-5)') {
      console.log('\n--- Chronological Holdout ---');
      const train = [2022, 2023].map(s => resultsBySeason[s]).filter(r => r && r.bets > 0);
      const test = resultsBySeason[2024];

      if (train.length > 0) {
        const trainBets = train.reduce((a, b) => a + b.bets, 0);
        const trainWins = train.reduce((a, b) => a + b.wins, 0);
        const trainLosses = train.reduce((a, b) => a + b.losses, 0);
        const trainProfit = train.reduce((a, b) => a + b.profit, 0);
        const trainWR = trainWins + trainLosses > 0 ? trainWins / (trainWins + trainLosses) : 0;
        const trainROI = trainBets > 0 ? (trainProfit / (trainBets * 100)) * 100 : 0;

        console.log(`Train (2022-2023): ${trainBets} bets, ${(trainWR * 100).toFixed(1)}% win, ${trainROI >= 0 ? '+' : ''}${trainROI.toFixed(1)}% ROI`);
      }

      if (test && test.bets > 0) {
        const testWR = test.wins + test.losses > 0 ? test.wins / (test.wins + test.losses) : 0;
        const testROI = test.bets > 0 ? (test.profit / (test.bets * 100)) * 100 : 0;
        console.log(`Test (2024): ${test.bets} bets, ${(testWR * 100).toFixed(1)}% win, ${testROI >= 0 ? '+' : ''}${testROI.toFixed(1)}% ROI`);
      }

      console.log(`\n--- Data Coverage ---`);
      console.log(`Games with ratings: ${gamesWithRatings}`);
      console.log(`Games missing ratings (using defaults): ${gamesNoRatings}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log('T-60 execution validation complete.');
  console.log('Check year-by-year ROI and ensure no losing years before deployment.');
}

main().catch(console.error);

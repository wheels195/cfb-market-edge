/**
 * CFB T-60 Backtest - FBS Only
 *
 * Uses the frozen T-60 ensemble model with FBS filtering.
 * NO confidence filter (all model disagreement levels included).
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { isFBSGame } from '../src/lib/fbs-teams';
import { computeT60Projection, T60_EDGE_FILTER } from '../src/lib/models/t60-ensemble-v1';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface T60Entry {
  cfbd_game_id: number;
  spread_t60: number | null;
  matched: boolean;
}

async function fetchAllRows<T>(
  tableName: string,
  selectColumns: string,
  filters?: (query: any) => any
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from(tableName).select(selectColumns).range(offset, offset + 999);
    if (filters) query = filters(query);
    const { data, error } = await query;
    if (error || !data || data.length === 0) break;
    allRows.push(...(data as T[]));
    if (data.length < 1000) break;
    offset += 1000;
  }
  return allRows;
}

async function main() {
  console.log('==========================================');
  console.log('  CFB T-60 Backtest - FBS Only');
  console.log('  Model: Elo 50% + SP+ 30% + PPA 20%');
  console.log('  Confidence Filter: NONE');
  console.log('==========================================\n');

  // Load T-60 spreads
  const t60Data: T60Entry[] = JSON.parse(
    fs.readFileSync('/home/wheel/cfb-market-edge/data/t60-spreads.json', 'utf-8')
  );
  const t60Map = new Map(t60Data.filter(t => t.matched && t.spread_t60 !== null)
    .map(t => [t.cfbd_game_id, t.spread_t60!]));

  // Load teams
  const teams = await fetchAllRows<{ id: string; name: string }>('teams', 'id, name');
  const teamNameToId = new Map(teams.map(t => [t.name, t.id]));
  const teamIdToName = new Map(teams.map(t => [t.id, t.name]));

  // Load Elo
  const elos = await fetchAllRows<{ team_id: string; season: number; week: number; elo: number }>(
    'team_elo_snapshots', 'team_id, season, week, elo',
    q => q.in('season', [2022, 2023, 2024])
  );
  const eloMap = new Map<string, number>();
  for (const e of elos) {
    const name = teamIdToName.get(e.team_id);
    if (name) eloMap.set(`${name}_${e.season}_${e.week}`, e.elo);
  }

  // Load ratings
  const ratings = await fetchAllRows<{
    team_id: string; season: number;
    sp_overall: number | null; off_ppa: number | null; def_ppa: number | null;
  }>(
    'advanced_team_ratings', 'team_id, season, sp_overall, off_ppa, def_ppa',
    q => q.in('season', [2022, 2023, 2024])
  );
  const ratingMap = new Map<string, { sp: number; offPPA: number; defPPA: number }>();
  for (const r of ratings) {
    const name = teamIdToName.get(r.team_id);
    if (name) {
      ratingMap.set(`${name}_${r.season}`, {
        sp: r.sp_overall || 0,
        offPPA: r.off_ppa || 0,
        defPPA: r.def_ppa || 0,
      });
    }
  }

  // Load games
  const games = await fetchAllRows<{
    cfbd_game_id: number; season: number; week: number;
    home_team: string; away_team: string;
    home_score: number | null; away_score: number | null;
  }>(
    'cfbd_betting_lines',
    'cfbd_game_id, season, week, home_team, away_team, home_score, away_score',
    q => q.in('season', [2022, 2023, 2024]).not('home_score', 'is', null)
  );

  // Filter to FBS games with T-60
  const fbsGames = games.filter(g =>
    isFBSGame(g.home_team, g.away_team) && t60Map.has(g.cfbd_game_id)
  );

  console.log(`Total games: ${games.length}`);
  console.log(`FBS games with T-60: ${fbsGames.length}\n`);

  // Run backtest
  const results: Record<number, { bets: number; wins: number; losses: number; profit: number }> = {
    2022: { bets: 0, wins: 0, losses: 0, profit: 0 },
    2023: { bets: 0, wins: 0, losses: 0, profit: 0 },
    2024: { bets: 0, wins: 0, losses: 0, profit: 0 },
  };

  for (const g of fbsGames) {
    const t60Spread = t60Map.get(g.cfbd_game_id)!;
    const preWeek = Math.max(1, g.week - 1);

    // Get ratings
    const homeElo = eloMap.get(`${g.home_team}_${g.season}_${preWeek}`) ||
                    eloMap.get(`${g.home_team}_${g.season}_1`) || 1500;
    const awayElo = eloMap.get(`${g.away_team}_${g.season}_${preWeek}`) ||
                    eloMap.get(`${g.away_team}_${g.season}_1`) || 1500;
    const homeR = ratingMap.get(`${g.home_team}_${g.season}`) || { sp: 0, offPPA: 0, defPPA: 0 };
    const awayR = ratingMap.get(`${g.away_team}_${g.season}`) || { sp: 0, offPPA: 0, defPPA: 0 };

    // Compute projection
    const proj = computeT60Projection(
      homeElo, awayElo,
      homeR.sp, awayR.sp,
      homeR.offPPA, homeR.defPPA,
      awayR.offPPA, awayR.defPPA
    );

    // Edge calculation
    const edge = t60Spread - proj.modelSpread;
    const absEdge = Math.abs(edge);

    // Edge filter only (no confidence filter)
    if (absEdge < T60_EDGE_FILTER.MIN_EDGE || absEdge >= T60_EDGE_FILTER.MAX_EDGE) continue;

    // Bet side
    const betHome = edge > 0;
    const margin = g.home_score! - g.away_score!;
    const adjusted = betHome ? margin + t60Spread : -(margin + t60Spread);

    if (adjusted === 0) continue; // push

    const won = adjusted > 0;
    const profit = won ? 90.91 : -100;

    results[g.season].bets++;
    if (won) results[g.season].wins++;
    else results[g.season].losses++;
    results[g.season].profit += profit;
  }

  // Print results
  console.log('=== FBS-Only Results (Edge 2.5-5 pts, No Confidence Filter) ===\n');
  console.log('| Season | Bets | Wins | Losses | Win% | ROI | Profit |');
  console.log('|--------|------|------|--------|------|-----|--------|');

  let totalBets = 0, totalWins = 0, totalLosses = 0, totalProfit = 0;

  for (const s of [2022, 2023, 2024] as const) {
    const r = results[s];
    const winRate = r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0;
    const roi = r.bets > 0 ? (r.profit / (r.bets * 100)) * 100 : 0;

    console.log(
      `| ${s}   | ${r.bets.toString().padStart(4)} | ${r.wins.toString().padStart(4)} | ${r.losses.toString().padStart(6)} | ${(winRate * 100).toFixed(1).padStart(4)}% | ${roi >= 0 ? '+' : ''}${roi.toFixed(1).padStart(4)}% | ${r.profit >= 0 ? '+' : ''}${r.profit.toFixed(0).padStart(5)} |`
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

  console.log('\n--- Chronological Holdout ---');
  const train = [results[2022], results[2023]];
  const trainBets = train.reduce((a, b) => a + b.bets, 0);
  const trainWins = train.reduce((a, b) => a + b.wins, 0);
  const trainLosses = train.reduce((a, b) => a + b.losses, 0);
  const trainProfit = train.reduce((a, b) => a + b.profit, 0);
  const trainWR = trainWins + trainLosses > 0 ? trainWins / (trainWins + trainLosses) : 0;
  const trainROI = trainBets > 0 ? (trainProfit / (trainBets * 100)) * 100 : 0;

  console.log(`Train (2022-2023): ${trainBets} bets, ${(trainWR * 100).toFixed(1)}% win, ${trainROI >= 0 ? '+' : ''}${trainROI.toFixed(1)}% ROI`);

  const test = results[2024];
  const testWR = test.wins + test.losses > 0 ? test.wins / (test.wins + test.losses) : 0;
  const testROI = test.bets > 0 ? (test.profit / (test.bets * 100)) * 100 : 0;
  console.log(`Test (2024): ${test.bets} bets, ${(testWR * 100).toFixed(1)}% win, ${testROI >= 0 ? '+' : ''}${testROI.toFixed(1)}% ROI`);
}

main().catch(console.error);

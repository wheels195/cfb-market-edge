/**
 * Totals V1 SP+ Feature Backtest
 *
 * Model: delta = w_sp * (sp_implied_total - market_total)
 * where sp_implied_total = f(SP+ offense, SP+ defense)
 *
 * Train: 2022-2023 seasons
 * Test: 2024 (holdout - touch ONCE at end)
 *
 * Grid search on train to find optimal w_sp
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface TotalsGame {
  cfbd_game_id: number;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  total_open: number;
  total_close: number;
  actual_total: number;
  home_sp_off: number | null;
  home_sp_def: number | null;
  away_sp_off: number | null;
  away_sp_def: number | null;
}

interface BacktestParams {
  w_sp: number;        // Weight for SP+ feature
  baseline: number;    // Baseline points to add (league average scoring)
}

interface BacktestResult {
  params: BacktestParams;
  totalGames: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  avgEdge: number;
  avgActualDelta: number;
}

async function getTeamMap(): Promise<Map<string, string>> {
  const teamMap = new Map<string, string>();
  let offset = 0;

  while (true) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name')
      .range(offset, offset + 999);

    if (!teams || teams.length === 0) break;
    for (const t of teams) {
      teamMap.set(t.name, t.id);
    }
    offset += teams.length;
    if (teams.length < 1000) break;
  }

  return teamMap;
}

async function getSPRatings(season: number): Promise<Map<string, { sp_off: number; sp_def: number }>> {
  const spMap = new Map<string, { sp_off: number; sp_def: number }>();

  const { data } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_offense, sp_defense')
    .eq('season', season)
    .not('sp_overall', 'is', null);

  for (const row of data || []) {
    spMap.set(row.team_id, {
      sp_off: row.sp_offense || 0,
      sp_def: row.sp_defense || 0,
    });
  }

  return spMap;
}

async function getTotalsDataset(seasons: number[]): Promise<TotalsGame[]> {
  const teamMap = await getTeamMap();

  const spBySeason = new Map<number, Map<string, { sp_off: number; sp_def: number }>>();
  for (const season of [2021, 2022, 2023]) {
    const sp = await getSPRatings(season);
    spBySeason.set(season, sp);
  }

  const games: TotalsGame[] = [];

  for (const season of seasons) {
    const { data: lines } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .eq('season', season)
      .not('total_open', 'is', null)
      .not('home_score', 'is', null)
      .not('away_score', 'is', null);

    const priorSP = spBySeason.get(season - 1);

    for (const line of lines || []) {
      const homeTeamId = teamMap.get(line.home_team);
      const awayTeamId = teamMap.get(line.away_team);

      const homeSP = homeTeamId && priorSP ? priorSP.get(homeTeamId) : null;
      const awaySP = awayTeamId && priorSP ? priorSP.get(awayTeamId) : null;

      // Only include games where we have SP+ for BOTH teams
      if (!homeSP || !awaySP) continue;

      games.push({
        cfbd_game_id: line.cfbd_game_id,
        season: line.season,
        week: line.week,
        home_team: line.home_team,
        away_team: line.away_team,
        total_open: line.total_open,
        total_close: line.total_close || line.total_open,
        actual_total: line.home_score + line.away_score,
        home_sp_off: homeSP.sp_off,
        home_sp_def: homeSP.sp_def,
        away_sp_off: awaySP.sp_off,
        away_sp_def: awaySP.sp_def,
      });
    }
  }

  return games;
}

/**
 * Compute SP+ implied total
 *
 * SP+ Offense = points scored ABOVE average (positive = better offense)
 * SP+ Defense = points allowed ABOVE average (positive = WORSE defense)
 *
 * Therefore for game totals, ALL four values ADD to the total:
 * - High offense → more points scored
 * - High (bad) defense → more points allowed by that team
 *
 * Total = baseline + sum(all four SP+ values) / scaling_factor
 */
function computeSPImpliedTotal(
  homeSPOff: number,
  homeSPDef: number,
  awaySPOff: number,
  awaySPDef: number,
  baseline: number
): number {
  // All four SP+ values contribute to higher totals:
  // - home_sp_off: home team scores more
  // - home_sp_def: home team allows more (worse defense)
  // - away_sp_off: away team scores more
  // - away_sp_def: away team allows more (worse defense)

  const spSum = homeSPOff + homeSPDef + awaySPOff + awaySPDef;

  // SP+ values are on a points scale, but may need scaling
  // since they're relative to league average
  // Typical FBS totals are around 50-55
  return baseline + spSum / 2; // Scale by 2 since we're double-counting effect
}

function runBacktest(games: TotalsGame[], params: BacktestParams): BacktestResult {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let totalEdge = 0;
  let totalActualDelta = 0;

  for (const g of games) {
    // Compute SP+ implied total
    const spImplied = computeSPImpliedTotal(
      g.home_sp_off!,
      g.home_sp_def!,
      g.away_sp_off!,
      g.away_sp_def!,
      params.baseline
    );

    // Delta = model prediction - market
    const rawDelta = spImplied - g.total_open;
    const delta = params.w_sp * rawDelta;

    // Bet based on delta sign (bet ALL games for now)
    const betOver = delta > 0;
    const actualDelta = g.actual_total - g.total_open;

    totalEdge += Math.abs(delta);
    totalActualDelta += actualDelta;

    if (betOver) {
      // Bet OVER
      if (g.actual_total > g.total_open) {
        wins++;
      } else if (g.actual_total < g.total_open) {
        losses++;
      } else {
        pushes++;
      }
    } else {
      // Bet UNDER
      if (g.actual_total < g.total_open) {
        wins++;
      } else if (g.actual_total > g.total_open) {
        losses++;
      } else {
        pushes++;
      }
    }
  }

  const totalBets = wins + losses;
  const units = wins * 1.0 - losses * 1.1; // -110 juice

  return {
    params,
    totalGames: games.length,
    bets: totalBets,
    wins,
    losses,
    pushes,
    winRate: totalBets > 0 ? (wins / totalBets) * 100 : 0,
    roi: totalBets > 0 ? (units / (totalBets * 1.1)) * 100 : 0,
    avgEdge: games.length > 0 ? totalEdge / games.length : 0,
    avgActualDelta: games.length > 0 ? totalActualDelta / games.length : 0,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  TOTALS V1 SP+ FEATURE BACKTEST            ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Load train data (2022-2023)
  console.log('Loading TRAIN data (2022-2023)...');
  const trainGames = await getTotalsDataset([2022, 2023]);
  console.log(`  ${trainGames.length} games with SP+ data\n`);

  // Load test data (2024) - DON'T USE FOR TUNING
  console.log('Loading TEST data (2024)...');
  const testGames = await getTotalsDataset([2024]);
  console.log(`  ${testGames.length} games with SP+ data\n`);

  // Grid search on TRAIN data
  console.log('=== GRID SEARCH ON TRAIN (2022-2023) ===\n');

  const baselines = [48, 50, 52, 54]; // Different baseline assumptions
  const weights = [0.5, 0.75, 1.0, 1.25, 1.5]; // Weight for SP+ signal

  const results: BacktestResult[] = [];

  console.log('Baseline | w_sp  | Games | Wins | Win%  | ROI    | Avg Edge');
  console.log('---------|-------|-------|------|-------|--------|----------');

  for (const baseline of baselines) {
    for (const w_sp of weights) {
      const result = runBacktest(trainGames, { w_sp, baseline });
      results.push(result);

      console.log(
        `${baseline.toString().padStart(8)} | ${w_sp.toFixed(2).padStart(5)} | ` +
        `${result.bets.toString().padStart(5)} | ${result.wins.toString().padStart(4)} | ` +
        `${result.winRate.toFixed(1).padStart(5)}% | ${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1).padStart(5)}% | ` +
        `${result.avgEdge.toFixed(2)}`
      );
    }
  }

  // Find best parameters
  const best = results.reduce((a, b) => a.roi > b.roi ? a : b);

  console.log('\n=== BEST PARAMETERS (TRAIN) ===');
  console.log(`  Baseline: ${best.params.baseline}`);
  console.log(`  w_sp: ${best.params.w_sp}`);
  console.log(`  Win Rate: ${best.winRate.toFixed(1)}%`);
  console.log(`  ROI: ${best.roi >= 0 ? '+' : ''}${best.roi.toFixed(1)}%`);

  // Evaluate on 2024 holdout (ONE TIME)
  console.log('\n=== 2024 HOLDOUT EVALUATION ===');
  console.log('(Using best parameters from train)\n');

  const holdoutResult = runBacktest(testGames, best.params);

  console.log(`  Games: ${holdoutResult.bets}`);
  console.log(`  Wins: ${holdoutResult.wins}`);
  console.log(`  Win Rate: ${holdoutResult.winRate.toFixed(1)}%`);
  console.log(`  ROI: ${holdoutResult.roi >= 0 ? '+' : ''}${holdoutResult.roi.toFixed(1)}%`);

  // Compare to baseline (no model)
  console.log('\n=== COMPARISON TO BASELINE ===');
  const baselineResult = runBacktest(trainGames, { w_sp: 0, baseline: 0 });
  console.log(`  Baseline (random) ROI: ${baselineResult.roi.toFixed(1)}%`);
  console.log(`  SP+ Model ROI: ${best.roi.toFixed(1)}%`);
  console.log(`  Improvement: ${(best.roi - baselineResult.roi).toFixed(1)}%`);

  // Show sample predictions
  console.log('\n=== SAMPLE PREDICTIONS (2023) ===');
  const samples = trainGames.filter(g => g.season === 2023).slice(0, 5);

  for (const g of samples) {
    const spImplied = computeSPImpliedTotal(
      g.home_sp_off!, g.home_sp_def!,
      g.away_sp_off!, g.away_sp_def!,
      best.params.baseline
    );
    const delta = best.params.w_sp * (spImplied - g.total_open);
    const bet = delta > 0 ? 'OVER' : 'UNDER';
    const result = (delta > 0 && g.actual_total > g.total_open) ||
                   (delta < 0 && g.actual_total < g.total_open) ? '✓' : '✗';

    console.log(`  ${g.away_team} @ ${g.home_team}`);
    console.log(`    Market: ${g.total_open}, SP+ Implied: ${spImplied.toFixed(1)}, Delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`);
    console.log(`    Bet: ${bet}, Actual: ${g.actual_total} → ${result}`);
  }
}

main().catch(console.error);

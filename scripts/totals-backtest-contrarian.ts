/**
 * Totals V1 Contrarian SP+ Model
 *
 * Key insight from correlation analysis:
 * - High SP+ games go UNDER more often (42.8% OVER)
 * - Market over-estimates high-scoring matchups
 *
 * Strategy: Bet UNDER on high SP+ games, OVER on low SP+ games
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface TotalsGame {
  season: number;
  total_open: number;
  actual_total: number;
  sp_sum: number; // home_sp_off + home_sp_def + away_sp_off + away_sp_def
}

async function getGames(seasons: number[]): Promise<TotalsGame[]> {
  const teamMap = new Map<string, string>();
  const { data: teams } = await supabase.from('teams').select('id, name');
  for (const t of teams || []) teamMap.set(t.name, t.id);

  const games: TotalsGame[] = [];

  for (const season of seasons) {
    const { data: sp } = await supabase
      .from('advanced_team_ratings')
      .select('team_id, sp_offense, sp_defense')
      .eq('season', season - 1)
      .not('sp_overall', 'is', null);

    const spMap = new Map<string, { off: number; def: number }>();
    for (const r of sp || []) {
      spMap.set(r.team_id, { off: r.sp_offense || 0, def: r.sp_defense || 0 });
    }

    const { data: lines } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .eq('season', season)
      .not('total_open', 'is', null)
      .not('home_score', 'is', null);

    for (const l of lines || []) {
      const homeId = teamMap.get(l.home_team);
      const awayId = teamMap.get(l.away_team);
      const homeSP = homeId ? spMap.get(homeId) : null;
      const awaySP = awayId ? spMap.get(awayId) : null;

      if (!homeSP || !awaySP) continue;

      games.push({
        season: l.season,
        total_open: l.total_open,
        actual_total: l.home_score + l.away_score,
        sp_sum: homeSP.off + homeSP.def + awaySP.off + awaySP.def,
      });
    }
  }

  return games;
}

interface BacktestResult {
  label: string;
  games: number;
  bets: number;
  wins: number;
  winRate: number;
  roi: number;
}

function runBacktest(games: TotalsGame[], threshold: number, direction: 'high_under' | 'low_over'): BacktestResult {
  const mean = games.reduce((a, g) => a + g.sp_sum, 0) / games.length;
  const std = Math.sqrt(games.reduce((a, g) => a + (g.sp_sum - mean) ** 2, 0) / games.length);

  let eligible: TotalsGame[];
  let label: string;

  if (direction === 'high_under') {
    eligible = games.filter(g => g.sp_sum > mean + threshold * std);
    label = `UNDER when SP+ > ${(mean + threshold * std).toFixed(0)}`;
  } else {
    eligible = games.filter(g => g.sp_sum < mean - threshold * std);
    label = `OVER when SP+ < ${(mean - threshold * std).toFixed(0)}`;
  }

  let wins = 0;
  let losses = 0;

  for (const g of eligible) {
    if (direction === 'high_under') {
      // Bet UNDER
      if (g.actual_total < g.total_open) wins++;
      else if (g.actual_total > g.total_open) losses++;
    } else {
      // Bet OVER
      if (g.actual_total > g.total_open) wins++;
      else if (g.actual_total < g.total_open) losses++;
    }
  }

  const totalBets = wins + losses;
  const units = wins * 1.0 - losses * 1.1;

  return {
    label,
    games: games.length,
    bets: totalBets,
    wins,
    winRate: totalBets > 0 ? (wins / totalBets) * 100 : 0,
    roi: totalBets > 0 ? (units / (totalBets * 1.1)) * 100 : 0,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  TOTALS V1 CONTRARIAN SP+ MODEL            ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Train data
  const trainGames = await getGames([2022, 2023]);
  console.log(`Train games: ${trainGames.length}\n`);

  // Test data
  const testGames = await getGames([2024]);
  console.log(`Test games: ${testGames.length}\n`);

  // Grid search on train
  console.log('=== GRID SEARCH ON TRAIN (2022-2023) ===\n');
  console.log('Strategy                        | Bets | Wins | Win%  | ROI');
  console.log('--------------------------------|------|------|-------|-------');

  const thresholds = [0.5, 0.75, 1.0, 1.25, 1.5];
  const trainResults: BacktestResult[] = [];

  for (const t of thresholds) {
    const highUnder = runBacktest(trainGames, t, 'high_under');
    const lowOver = runBacktest(trainGames, t, 'low_over');

    trainResults.push(highUnder, lowOver);

    console.log(
      `${highUnder.label.padEnd(32)}| ${highUnder.bets.toString().padStart(4)} | ${highUnder.wins.toString().padStart(4)} | ${highUnder.winRate.toFixed(1).padStart(5)}% | ${highUnder.roi >= 0 ? '+' : ''}${highUnder.roi.toFixed(1)}%`
    );
    console.log(
      `${lowOver.label.padEnd(32)}| ${lowOver.bets.toString().padStart(4)} | ${lowOver.wins.toString().padStart(4)} | ${lowOver.winRate.toFixed(1).padStart(5)}% | ${lowOver.roi >= 0 ? '+' : ''}${lowOver.roi.toFixed(1)}%`
    );
  }

  // Find best
  const best = trainResults.reduce((a, b) => a.roi > b.roi ? a : b);
  console.log(`\nBest Train Strategy: ${best.label}`);
  console.log(`  Win Rate: ${best.winRate.toFixed(1)}%, ROI: ${best.roi >= 0 ? '+' : ''}${best.roi.toFixed(1)}%`);

  // Combined strategy: both high_under and low_over
  console.log('\n=== COMBINED STRATEGY (TRAIN) ===');
  const combinedThreshold = 1.0;
  const highUnder = runBacktest(trainGames, combinedThreshold, 'high_under');
  const lowOver = runBacktest(trainGames, combinedThreshold, 'low_over');

  const combinedBets = highUnder.bets + lowOver.bets;
  const combinedWins = highUnder.wins + lowOver.wins;
  const combinedUnits = highUnder.wins + lowOver.wins - (combinedBets - combinedWins) * 1.1;
  const combinedROI = (combinedUnits / (combinedBets * 1.1)) * 100;

  console.log(`Combined (threshold=1.0 std):`);
  console.log(`  Total bets: ${combinedBets}`);
  console.log(`  Wins: ${combinedWins} (${((combinedWins / combinedBets) * 100).toFixed(1)}%)`);
  console.log(`  ROI: ${combinedROI >= 0 ? '+' : ''}${combinedROI.toFixed(1)}%`);

  // 2024 Holdout
  console.log('\n=== 2024 HOLDOUT ===');
  const testHighUnder = runBacktest(testGames, combinedThreshold, 'high_under');
  const testLowOver = runBacktest(testGames, combinedThreshold, 'low_over');

  console.log(`UNDER on high SP+ (>1 std):`);
  console.log(`  Bets: ${testHighUnder.bets}, Wins: ${testHighUnder.wins}, Win%: ${testHighUnder.winRate.toFixed(1)}%, ROI: ${testHighUnder.roi >= 0 ? '+' : ''}${testHighUnder.roi.toFixed(1)}%`);

  console.log(`OVER on low SP+ (<1 std):`);
  console.log(`  Bets: ${testLowOver.bets}, Wins: ${testLowOver.wins}, Win%: ${testLowOver.winRate.toFixed(1)}%, ROI: ${testLowOver.roi >= 0 ? '+' : ''}${testLowOver.roi.toFixed(1)}%`);

  const testCombinedBets = testHighUnder.bets + testLowOver.bets;
  const testCombinedWins = testHighUnder.wins + testLowOver.wins;
  const testCombinedROI = testCombinedBets > 0
    ? ((testCombinedWins - (testCombinedBets - testCombinedWins) * 1.1) / (testCombinedBets * 1.1)) * 100
    : 0;

  console.log(`\n2024 Combined:`);
  console.log(`  Total bets: ${testCombinedBets}`);
  console.log(`  Wins: ${testCombinedWins} (${testCombinedBets > 0 ? ((testCombinedWins / testCombinedBets) * 100).toFixed(1) : 0}%)`);
  console.log(`  ROI: ${testCombinedROI >= 0 ? '+' : ''}${testCombinedROI.toFixed(1)}%`);
}

main().catch(console.error);

/**
 * Totals V1 Baseline Backtest
 *
 * Step 1: Baseline (delta=0) - betting ALL games at market open
 * Expected: ~50% win rate, ~-4.5% ROI (vig)
 *
 * Point-in-time: Season N games use Season N-1 SP+ data
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
  home_score: number;
  away_score: number;
  total_open: number;
  total_close: number;
  actual_total: number;
  // SP+ data (from prior season)
  home_sp_off: number | null;
  home_sp_def: number | null;
  away_sp_off: number | null;
  away_sp_def: number | null;
}

interface BacktestResult {
  season: number;
  totalGames: number;
  gamesWithSP: number;
  overWins: number;
  underWins: number;
  pushes: number;
  overROI: number;
  underROI: number;
  avgActualVsOpen: number;
  avgActualVsClose: number;
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
  console.log('Loading team mappings...');
  const teamMap = await getTeamMap();
  console.log(`  ${teamMap.size} teams loaded`);

  // Load SP+ for prior seasons (point-in-time)
  console.log('Loading SP+ ratings (prior seasons)...');
  const spBySeason = new Map<number, Map<string, { sp_off: number; sp_def: number }>>();
  for (const season of [2021, 2022, 2023]) {
    const sp = await getSPRatings(season);
    spBySeason.set(season, sp);
    console.log(`  ${season}: ${sp.size} teams`);
  }

  // Load betting lines
  console.log('Loading betting lines...');
  const games: TotalsGame[] = [];

  for (const season of seasons) {
    const { data: lines } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .eq('season', season)
      .not('total_open', 'is', null)
      .not('home_score', 'is', null)
      .not('away_score', 'is', null);

    console.log(`  ${season}: ${lines?.length || 0} games with totals`);

    // Get SP+ from prior season for point-in-time
    const priorSP = spBySeason.get(season - 1);

    for (const line of lines || []) {
      const homeTeamId = teamMap.get(line.home_team);
      const awayTeamId = teamMap.get(line.away_team);

      const homeSP = homeTeamId && priorSP ? priorSP.get(homeTeamId) : null;
      const awaySP = awayTeamId && priorSP ? priorSP.get(awayTeamId) : null;

      games.push({
        cfbd_game_id: line.cfbd_game_id,
        season: line.season,
        week: line.week,
        home_team: line.home_team,
        away_team: line.away_team,
        home_score: line.home_score,
        away_score: line.away_score,
        total_open: line.total_open,
        total_close: line.total_close || line.total_open,
        actual_total: line.home_score + line.away_score,
        home_sp_off: homeSP?.sp_off ?? null,
        home_sp_def: homeSP?.sp_def ?? null,
        away_sp_off: awaySP?.sp_off ?? null,
        away_sp_def: awaySP?.sp_def ?? null,
      });
    }
  }

  return games;
}

function runBaselineBacktest(games: TotalsGame[]): BacktestResult[] {
  const results: BacktestResult[] = [];

  // Group by season
  const bySeason = new Map<number, TotalsGame[]>();
  for (const g of games) {
    if (!bySeason.has(g.season)) bySeason.set(g.season, []);
    bySeason.get(g.season)!.push(g);
  }

  for (const [season, seasonGames] of Array.from(bySeason.entries()).sort()) {
    let overWins = 0;
    let underWins = 0;
    let pushes = 0;
    let overUnits = 0;  // Track P/L for betting OVER
    let underUnits = 0; // Track P/L for betting UNDER
    let totalDiffOpen = 0;
    let totalDiffClose = 0;
    let gamesWithSP = 0;

    for (const g of seasonGames) {
      const diff = g.actual_total - g.total_open;
      totalDiffOpen += diff;
      totalDiffClose += (g.actual_total - g.total_close);

      if (g.home_sp_off !== null && g.away_sp_off !== null) {
        gamesWithSP++;
      }

      // Baseline: bet OVER on all games
      if (g.actual_total > g.total_open) {
        overWins++;
        overUnits += 1.0; // Win at -110 pays ~0.91, simplified to 1.0
      } else if (g.actual_total < g.total_open) {
        overUnits -= 1.1; // Lose at -110 costs 1.1
      } else {
        pushes++;
        // Push - no change
      }

      // Baseline: bet UNDER on all games
      if (g.actual_total < g.total_open) {
        underWins++;
        underUnits += 1.0;
      } else if (g.actual_total > g.total_open) {
        underUnits -= 1.1;
      }
      // Pushes don't affect underUnits
    }

    const totalBetsOver = overWins + (seasonGames.length - overWins - pushes);
    const totalBetsUnder = underWins + (seasonGames.length - underWins - pushes);

    results.push({
      season,
      totalGames: seasonGames.length,
      gamesWithSP,
      overWins,
      underWins,
      pushes,
      overROI: (overUnits / (totalBetsOver * 1.1)) * 100,  // ROI as percentage of risk
      underROI: (underUnits / (totalBetsUnder * 1.1)) * 100,
      avgActualVsOpen: totalDiffOpen / seasonGames.length,
      avgActualVsClose: totalDiffClose / seasonGames.length,
    });
  }

  return results;
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  TOTALS V1 BASELINE BACKTEST               ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Load dataset for 2022-2024
  const games = await getTotalsDataset([2022, 2023, 2024]);

  console.log(`\nTotal games loaded: ${games.length}`);
  console.log(`Games with SP+ data: ${games.filter(g => g.home_sp_off !== null).length}`);

  // Run baseline backtest
  console.log('\n=== BASELINE BACKTEST (Delta=0, Bet ALL Games) ===\n');
  const results = runBaselineBacktest(games);

  console.log('Season | Games | w/SP+ | Over W | Under W | Push | Over ROI | Under ROI | Avg vs Open');
  console.log('-------|-------|-------|--------|---------|------|----------|-----------|------------');

  let totalGames = 0;
  let totalWithSP = 0;
  let totalOverWins = 0;
  let totalUnderWins = 0;
  let totalPushes = 0;

  for (const r of results) {
    const overWinPct = ((r.overWins / (r.totalGames - r.pushes)) * 100).toFixed(1);
    const underWinPct = ((r.underWins / (r.totalGames - r.pushes)) * 100).toFixed(1);

    console.log(
      `${r.season}   | ${r.totalGames.toString().padStart(5)} | ${r.gamesWithSP.toString().padStart(5)} | ` +
      `${r.overWins.toString().padStart(6)} | ${r.underWins.toString().padStart(7)} | ${r.pushes.toString().padStart(4)} | ` +
      `${r.overROI.toFixed(1).padStart(8)}% | ${r.underROI.toFixed(1).padStart(9)}% | ` +
      `${r.avgActualVsOpen >= 0 ? '+' : ''}${r.avgActualVsOpen.toFixed(2)}`
    );

    totalGames += r.totalGames;
    totalWithSP += r.gamesWithSP;
    totalOverWins += r.overWins;
    totalUnderWins += r.underWins;
    totalPushes += r.pushes;
  }

  console.log('-------|-------|-------|--------|---------|------|----------|-----------|------------');

  const totalDecided = totalGames - totalPushes;
  console.log(`\nOverall Statistics:`);
  console.log(`  Total games: ${totalGames}`);
  console.log(`  Games with SP+: ${totalWithSP} (${((totalWithSP / totalGames) * 100).toFixed(1)}%)`);
  console.log(`  Over win rate: ${totalOverWins}/${totalDecided} = ${((totalOverWins / totalDecided) * 100).toFixed(1)}%`);
  console.log(`  Under win rate: ${totalUnderWins}/${totalDecided} = ${((totalUnderWins / totalDecided) * 100).toFixed(1)}%`);
  console.log(`  Pushes: ${totalPushes}`);

  // Expected: ~50% win rate, ~-4.5% ROI
  console.log(`\n=== EXPECTED BASELINE ===`);
  console.log(`  Win rate: ~50%`);
  console.log(`  ROI: ~-4.5% (vig)`);

  // Sample games to verify data
  console.log('\n=== SAMPLE GAMES (2023) ===');
  const sample2023 = games.filter(g => g.season === 2023 && g.home_sp_off !== null).slice(0, 5);
  for (const g of sample2023) {
    const modelTotal = (g.home_sp_off! + g.away_sp_def! + g.away_sp_off! + g.home_sp_def!) / 2;
    console.log(`  ${g.away_team} @ ${g.home_team}`);
    console.log(`    Open: ${g.total_open}, Actual: ${g.actual_total}, Model SP+ sum: ${modelTotal.toFixed(1)}`);
    console.log(`    Home SP: Off=${g.home_sp_off?.toFixed(1)}, Def=${g.home_sp_def?.toFixed(1)}`);
    console.log(`    Away SP: Off=${g.away_sp_off?.toFixed(1)}, Def=${g.away_sp_def?.toFixed(1)}`);
  }
}

main().catch(console.error);

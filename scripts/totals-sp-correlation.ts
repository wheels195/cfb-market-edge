/**
 * Analyze correlation between SP+ metrics and totals outcomes
 *
 * Goal: Find what SP+ features (if any) predict over/under outcomes
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface TotalsGame {
  total_open: number;
  actual_total: number;
  home_sp_off: number;
  home_sp_def: number;
  away_sp_off: number;
  away_sp_def: number;
}

async function getTeamMap(): Promise<Map<string, string>> {
  const teamMap = new Map<string, string>();
  const { data: teams } = await supabase.from('teams').select('id, name');
  for (const t of teams || []) {
    teamMap.set(t.name, t.id);
  }
  return teamMap;
}

async function getSPRatings(season: number): Promise<Map<string, { sp_off: number; sp_def: number }>> {
  const { data } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_offense, sp_defense')
    .eq('season', season)
    .not('sp_overall', 'is', null);

  const spMap = new Map<string, { sp_off: number; sp_def: number }>();
  for (const row of data || []) {
    spMap.set(row.team_id, { sp_off: row.sp_offense || 0, sp_def: row.sp_defense || 0 });
  }
  return spMap;
}

async function getGames(seasons: number[]): Promise<TotalsGame[]> {
  const teamMap = await getTeamMap();
  const games: TotalsGame[] = [];

  for (const season of seasons) {
    const priorSP = await getSPRatings(season - 1);

    const { data: lines } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .eq('season', season)
      .not('total_open', 'is', null)
      .not('home_score', 'is', null);

    for (const l of lines || []) {
      const homeId = teamMap.get(l.home_team);
      const awayId = teamMap.get(l.away_team);
      const homeSP = homeId ? priorSP.get(homeId) : null;
      const awaySP = awayId ? priorSP.get(awayId) : null;

      if (!homeSP || !awaySP) continue;

      games.push({
        total_open: l.total_open,
        actual_total: l.home_score + l.away_score,
        home_sp_off: homeSP.sp_off,
        home_sp_def: homeSP.sp_def,
        away_sp_off: awaySP.sp_off,
        away_sp_def: awaySP.sp_def,
      });
    }
  }

  return games;
}

function computeCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  return den === 0 ? 0 : num / den;
}

async function main() {
  console.log('=== SP+ vs TOTALS CORRELATION ANALYSIS ===\n');

  const games = await getGames([2022, 2023]);
  console.log(`Loaded ${games.length} games with SP+ data\n`);

  // Compute various SP+ features
  const features = games.map(g => ({
    // Different ways to combine SP+
    spSum: g.home_sp_off + g.home_sp_def + g.away_sp_off + g.away_sp_def,
    offSum: g.home_sp_off + g.away_sp_off,
    defSum: g.home_sp_def + g.away_sp_def,
    offMinusDef: (g.home_sp_off + g.away_sp_off) - (g.home_sp_def + g.away_sp_def),

    // Target variables
    actualTotal: g.actual_total,
    marketTotal: g.total_open,
    delta: g.actual_total - g.total_open, // Positive = went OVER
  }));

  // Check correlations
  console.log('Correlation: SP+ Feature vs Actual-Market Delta');
  console.log('(Positive correlation = higher SP+ → more likely OVER)\n');

  const spSum = features.map(f => f.spSum);
  const offSum = features.map(f => f.offSum);
  const defSum = features.map(f => f.defSum);
  const offMinusDef = features.map(f => f.offMinusDef);
  const delta = features.map(f => f.delta);
  const actualTotal = features.map(f => f.actualTotal);
  const marketTotal = features.map(f => f.marketTotal);

  console.log(`SP+ Sum (all 4) vs Delta:      r = ${computeCorrelation(spSum, delta).toFixed(4)}`);
  console.log(`Offense Sum vs Delta:          r = ${computeCorrelation(offSum, delta).toFixed(4)}`);
  console.log(`Defense Sum vs Delta:          r = ${computeCorrelation(defSum, delta).toFixed(4)}`);
  console.log(`Offense-Defense vs Delta:      r = ${computeCorrelation(offMinusDef, delta).toFixed(4)}`);

  console.log('\nCorrelation: SP+ Feature vs Actual Total');
  console.log(`SP+ Sum vs Actual Total:       r = ${computeCorrelation(spSum, actualTotal).toFixed(4)}`);
  console.log(`Offense Sum vs Actual Total:   r = ${computeCorrelation(offSum, actualTotal).toFixed(4)}`);

  console.log('\nCorrelation: Market vs Actual');
  console.log(`Market Total vs Actual Total:  r = ${computeCorrelation(marketTotal, actualTotal).toFixed(4)}`);

  // Basic stats
  console.log('\n=== BASIC STATISTICS ===');
  const avgDelta = delta.reduce((a, b) => a + b, 0) / delta.length;
  const overCount = delta.filter(d => d > 0).length;
  const underCount = delta.filter(d => d < 0).length;

  console.log(`Average (Actual - Market): ${avgDelta.toFixed(2)}`);
  console.log(`Overs: ${overCount} (${((overCount / games.length) * 100).toFixed(1)}%)`);
  console.log(`Unders: ${underCount} (${((underCount / games.length) * 100).toFixed(1)}%)`);

  // Bucket analysis
  console.log('\n=== BUCKET ANALYSIS ===');
  console.log('Do high-SP+ games go OVER more often?\n');

  const sorted = [...features].sort((a, b) => a.spSum - b.spSum);
  const quartileSize = Math.floor(sorted.length / 4);

  const quartiles = [
    sorted.slice(0, quartileSize),
    sorted.slice(quartileSize, quartileSize * 2),
    sorted.slice(quartileSize * 2, quartileSize * 3),
    sorted.slice(quartileSize * 3),
  ];

  console.log('Quartile | Avg SP+ Sum | Overs | Unders | Over%');
  console.log('---------|-------------|-------|--------|------');

  quartiles.forEach((q, i) => {
    const avgSP = q.reduce((a, b) => a + b.spSum, 0) / q.length;
    const overs = q.filter(g => g.delta > 0).length;
    const unders = q.filter(g => g.delta < 0).length;
    const overPct = (overs / (overs + unders)) * 100;

    console.log(
      `Q${i + 1}       | ${avgSP.toFixed(1).padStart(11)} | ${overs.toString().padStart(5)} | ${unders.toString().padStart(6)} | ${overPct.toFixed(1)}%`
    );
  });

  // What if we only bet when SP+ sum is extreme?
  console.log('\n=== EXTREME SP+ ANALYSIS ===');
  console.log('What if we only bet on extreme SP+ matchups?\n');

  const mean = spSum.reduce((a, b) => a + b, 0) / spSum.length;
  const std = Math.sqrt(spSum.reduce((a, b) => a + (b - mean) ** 2, 0) / spSum.length);

  const highSP = features.filter(f => f.spSum > mean + std);
  const lowSP = features.filter(f => f.spSum < mean - std);

  console.log(`Mean SP+ sum: ${mean.toFixed(1)}, Std: ${std.toFixed(1)}`);
  console.log(`High SP+ (>${(mean + std).toFixed(1)}): ${highSP.length} games`);
  console.log(`  Overs: ${highSP.filter(g => g.delta > 0).length}, Unders: ${highSP.filter(g => g.delta < 0).length}`);
  console.log(`  Over%: ${((highSP.filter(g => g.delta > 0).length / highSP.length) * 100).toFixed(1)}%`);

  console.log(`Low SP+ (<${(mean - std).toFixed(1)}): ${lowSP.length} games`);
  console.log(`  Overs: ${lowSP.filter(g => g.delta > 0).length}, Unders: ${lowSP.filter(g => g.delta < 0).length}`);
  console.log(`  Under%: ${((lowSP.filter(g => g.delta < 0).length / lowSP.length) * 100).toFixed(1)}%`);
}

main().catch(console.error);

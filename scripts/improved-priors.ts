/**
 * Improved Priors for Transfer Portal Era
 *
 * Problem: Elo from prior season is stale due to transfer portal
 *
 * Approach:
 * 1. Use in-season Elo updates (we have weekly data)
 * 2. Regress harder toward mean early in season
 * 3. Weight recent games more heavily
 * 4. Compare performance vs baseline
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const HFA = 3.0;
const ELO_TO_SPREAD = 25;
const MEAN_ELO = 1500;

async function loadData() {
  const eloMap = new Map<string, Map<string, number>>();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('cfbd_elo_ratings')
      .select('season, week, team_name, elo')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const teamKey = row.team_name.toLowerCase();
      if (!eloMap.has(teamKey)) eloMap.set(teamKey, new Map());
      eloMap.get(teamKey)!.set(`${row.season}-${row.week}`, row.elo);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  const lines: any[] = [];
  offset = 0;
  while (true) {
    const { data } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .not('spread_open', 'is', null)
      .not('spread_close', 'is', null)
      .not('home_score', 'is', null)
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    lines.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  return { eloMap, lines };
}

// Original: use prior week's Elo
function getEloOriginal(eloMap: Map<string, Map<string, number>>, team: string, season: number, week: number): number | null {
  const teamKey = team.toLowerCase();
  const ratings = eloMap.get(teamKey);
  if (!ratings) return null;

  const priorWeek = week - 1;
  if (priorWeek >= 1) {
    const key = `${season}-${priorWeek}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }

  // Prior season final
  for (let w = 16; w >= 1; w--) {
    const key = `${season - 1}-${w}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }

  return null;
}

// Improved: regress toward mean more for early-season games
function getEloRegressed(
  eloMap: Map<string, Map<string, number>>,
  team: string,
  season: number,
  week: number,
  regressionFactor: number  // 0 = pure Elo, 1 = pure mean
): number | null {
  const rawElo = getEloOriginal(eloMap, team, season, week);
  if (rawElo === null) return null;

  // Regress based on week (more regression early in season)
  let weekRegression = 0;
  if (week <= 4) {
    weekRegression = 0.5 - (week - 1) * 0.1;  // Week 1: 0.5, Week 4: 0.2
  }

  const totalRegression = Math.min(1, regressionFactor + weekRegression);
  return rawElo * (1 - totalRegression) + MEAN_ELO * totalRegression;
}

// Compare current-season Elo to prior-season Elo
function getEloDelta(
  eloMap: Map<string, Map<string, number>>,
  team: string,
  season: number,
  week: number
): number | null {
  const teamKey = team.toLowerCase();
  const ratings = eloMap.get(teamKey);
  if (!ratings) return null;

  // Current season current week
  let currentElo: number | null = null;
  for (let w = week; w >= 1; w--) {
    const key = `${season}-${w}`;
    if (ratings.has(key)) {
      currentElo = ratings.get(key)!;
      break;
    }
  }

  // Prior season final
  let priorElo: number | null = null;
  for (let w = 16; w >= 1; w--) {
    const key = `${season - 1}-${w}`;
    if (ratings.has(key)) {
      priorElo = ratings.get(key)!;
      break;
    }
  }

  if (currentElo === null || priorElo === null) return null;
  return currentElo - priorElo;
}

function gradeBet(margin: number, spreadClose: number, side: 'home' | 'away'): 'win' | 'loss' | 'push' {
  const homeResult = margin + spreadClose;
  if (Math.abs(homeResult) < 0.001) return 'push';
  const homeCovered = homeResult > 0;
  if (side === 'home') return homeCovered ? 'win' : 'loss';
  return homeCovered ? 'loss' : 'win';
}

function calcROI(wins: number, losses: number): number {
  if (wins + losses === 0) return 0;
  const profit = wins * 100 - losses * 110;
  const totalRisked = (wins + losses) * 110;
  return profit / totalRisked;
}

async function main() {
  console.log('=== IMPROVED PRIORS FOR TRANSFER PORTAL ERA ===\n');

  const { eloMap, lines } = await loadData();
  console.log(`Games: ${lines.length}\n`);

  // Test different regression factors
  const regressionLevels = [0, 0.2, 0.4, 0.6];

  for (const regression of regressionLevels) {
    console.log(`=== REGRESSION FACTOR: ${regression} ===\n`);

    let mae = 0, n = 0;
    let origWins = 0, origLosses = 0;
    let highEdgeOrigWins = 0, highEdgeOrigLosses = 0;

    for (const line of lines) {
      const homeElo = getEloRegressed(eloMap, line.home_team, line.season, line.week, regression);
      const awayElo = getEloRegressed(eloMap, line.away_team, line.season, line.week, regression);
      if (!homeElo || !awayElo) continue;

      const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
      const modelSpread = -eloDiff / ELO_TO_SPREAD;
      const predictedMargin = -modelSpread;
      const actualMargin = line.home_score - line.away_score;

      mae += Math.abs(predictedMargin - actualMargin);
      n++;

      const edgeAtOpen = modelSpread - line.spread_open;
      const modelSide: 'home' | 'away' = edgeAtOpen < 0 ? 'home' : 'away';
      const result = gradeBet(actualMargin, line.spread_close, modelSide);

      if (result === 'win') origWins++;
      else if (result === 'loss') origLosses++;

      if (Math.abs(edgeAtOpen) >= 10) {
        if (result === 'win') highEdgeOrigWins++;
        else if (result === 'loss') highEdgeOrigLosses++;
      }
    }

    const avgMAE = mae / n;
    const allWinRate = origWins / (origWins + origLosses);
    const highEdgeWinRate = (highEdgeOrigWins + highEdgeOrigLosses) > 0
      ? highEdgeOrigWins / (highEdgeOrigWins + highEdgeOrigLosses)
      : 0;

    console.log(`MAE: ${avgMAE.toFixed(2)} points`);
    console.log(`All games win rate: ${(allWinRate * 100).toFixed(1)}%`);
    console.log(`High-edge (>=10) win rate: ${(highEdgeWinRate * 100).toFixed(1)}% (N=${highEdgeOrigWins + highEdgeOrigLosses})`);
    console.log('');
  }

  // ==========================================================================
  // ANALYSIS: Early vs Late Season
  // ==========================================================================

  console.log('=== EARLY vs LATE SEASON PERFORMANCE ===\n');

  for (const [label, weekFilter] of [
    ['Weeks 1-4', (w: number) => w <= 4],
    ['Weeks 5-8', (w: number) => w >= 5 && w <= 8],
    ['Weeks 9+', (w: number) => w >= 9],
  ] as const) {
    const filtered = lines.filter(l => weekFilter(l.week));

    let wins = 0, losses = 0;
    let highEdgeWins = 0, highEdgeLosses = 0;

    for (const line of filtered) {
      const homeElo = getEloOriginal(eloMap, line.home_team, line.season, line.week);
      const awayElo = getEloOriginal(eloMap, line.away_team, line.season, line.week);
      if (!homeElo || !awayElo) continue;

      const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
      const modelSpread = -eloDiff / ELO_TO_SPREAD;
      const edgeAtOpen = modelSpread - line.spread_open;
      const modelSide: 'home' | 'away' = edgeAtOpen < 0 ? 'home' : 'away';
      const margin = line.home_score - line.away_score;
      const result = gradeBet(margin, line.spread_close, modelSide);

      if (result === 'win') wins++;
      else if (result === 'loss') losses++;

      if (Math.abs(edgeAtOpen) >= 10) {
        if (result === 'win') highEdgeWins++;
        else if (result === 'loss') highEdgeLosses++;
      }
    }

    const winRate = wins / (wins + losses);
    const highEdgeWinRate = (highEdgeWins + highEdgeLosses) > 0
      ? highEdgeWins / (highEdgeWins + highEdgeLosses)
      : 0;

    console.log(`${label}:`);
    console.log(`  All games: ${(winRate * 100).toFixed(1)}% (N=${wins + losses})`);
    console.log(`  High-edge: ${(highEdgeWinRate * 100).toFixed(1)}% (N=${highEdgeWins + highEdgeLosses})`);
    console.log('');
  }

  // ==========================================================================
  // ANALYSIS: Teams with Big Elo Deltas
  // ==========================================================================

  console.log('=== ANALYSIS: TEAMS WITH BIG ELO CHANGES ===\n');
  console.log('Teams whose current Elo differs significantly from prior season\n');

  // Find games where team has big delta from prior season
  const bigDeltaGames: any[] = [];

  for (const line of lines.filter(l => l.week >= 5)) {
    const homeDelta = getEloDelta(eloMap, line.home_team, line.season, line.week);
    const awayDelta = getEloDelta(eloMap, line.away_team, line.season, line.week);

    if (homeDelta !== null && awayDelta !== null) {
      bigDeltaGames.push({
        ...line,
        homeDelta,
        awayDelta,
        maxDelta: Math.max(Math.abs(homeDelta), Math.abs(awayDelta)),
      });
    }
  }

  // Sort by max delta
  bigDeltaGames.sort((a, b) => b.maxDelta - a.maxDelta);

  console.log('Top 10 games by team Elo change from prior season:\n');
  console.log('Matchup                    | Home Δ | Away Δ | Margin');
  console.log('---------------------------|--------|--------|-------');

  for (const g of bigDeltaGames.slice(0, 10)) {
    const matchup = `${g.away_team.slice(0, 12)} @ ${g.home_team.slice(0, 12)}`.padEnd(26);
    const hd = g.homeDelta >= 0 ? `+${g.homeDelta.toFixed(0)}` : g.homeDelta.toFixed(0);
    const ad = g.awayDelta >= 0 ? `+${g.awayDelta.toFixed(0)}` : g.awayDelta.toFixed(0);
    const margin = g.home_score - g.away_score;
    const m = margin >= 0 ? `+${margin}` : margin.toString();

    console.log(`${matchup} | ${hd.padStart(6)} | ${ad.padStart(6)} | ${m.padStart(5)}`);
  }

  // Performance on big-delta games
  console.log('\n--- Big Delta Games Performance ---\n');

  const bigDeltaThresholds = [50, 100, 150];

  for (const thresh of bigDeltaThresholds) {
    const subset = bigDeltaGames.filter(g => g.maxDelta >= thresh);

    let wins = 0, losses = 0;
    for (const g of subset) {
      const homeElo = getEloOriginal(eloMap, g.home_team, g.season, g.week);
      const awayElo = getEloOriginal(eloMap, g.away_team, g.season, g.week);
      if (!homeElo || !awayElo) continue;

      const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
      const modelSpread = -eloDiff / ELO_TO_SPREAD;
      const edgeAtOpen = modelSpread - g.spread_open;
      const modelSide: 'home' | 'away' = edgeAtOpen < 0 ? 'home' : 'away';
      const margin = g.home_score - g.away_score;
      const result = gradeBet(margin, g.spread_close, modelSide);

      if (result === 'win') wins++;
      else if (result === 'loss') losses++;
    }

    const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
    console.log(`Delta >= ${thresh}: ${subset.length} games, ${(winRate * 100).toFixed(1)}% win betting WITH model`);
  }

  console.log('\n=== ANALYSIS COMPLETE ===');
}

main().catch(console.error);

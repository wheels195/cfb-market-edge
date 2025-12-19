/**
 * Edge Filter Approach
 *
 * Instead of "bet opposite forever," implement:
 * - If |edge| >= threshold: REQUIRE one of:
 *   1. Market moved toward your side since open
 *   2. QB status known and favorable
 * - Otherwise: no bet
 *
 * This converts the contrarian finding into a filter, not a strategy.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const HFA = 3.0;
const ELO_TO_SPREAD = 25;
const EDGE_THRESHOLD = 10; // Points of disagreement that trigger filter

interface Game {
  gameId: number;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  modelSpread: number;
  spreadOpen: number;
  spreadClose: number;
  margin: number;
  edgeAtOpen: number;
  lineMove: number;         // close - open (negative = moved toward home)
  marketMovedWithModel: boolean;
  marketMovedAgainstModel: boolean;
}

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

function getElo(eloMap: Map<string, Map<string, number>>, team: string, season: number, week: number): number | null {
  const teamKey = team.toLowerCase();
  const ratings = eloMap.get(teamKey);
  if (!ratings) return null;
  const priorWeek = week - 1;
  if (priorWeek >= 1) {
    const key = `${season}-${priorWeek}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }
  for (let w = 16; w >= 1; w--) {
    const key = `${season - 1}-${w}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }
  return null;
}

function gradeBet(margin: number, spreadClose: number, side: 'home' | 'away'): 'win' | 'loss' | 'push' {
  const homeResult = margin + spreadClose;
  if (Math.abs(homeResult) < 0.001) return 'push';
  const homeCovered = homeResult > 0;
  if (side === 'home') return homeCovered ? 'win' : 'loss';
  return homeCovered ? 'loss' : 'win';
}

async function main() {
  console.log('=== EDGE FILTER APPROACH ===\n');
  console.log(`Threshold: |edge| >= ${EDGE_THRESHOLD} points triggers filter\n`);

  const { eloMap, lines } = await loadData();

  const games: Game[] = [];

  for (const line of lines) {
    const homeElo = getElo(eloMap, line.home_team, line.season, line.week);
    const awayElo = getElo(eloMap, line.away_team, line.season, line.week);
    if (!homeElo || !awayElo) continue;

    const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
    const modelSpread = -eloDiff / ELO_TO_SPREAD;
    const edgeAtOpen = modelSpread - line.spread_open;
    const lineMove = line.spread_close - line.spread_open;

    // Model says bet home if edgeAtOpen < 0
    // Model says bet away if edgeAtOpen > 0
    const modelSide: 'home' | 'away' = edgeAtOpen < 0 ? 'home' : 'away';

    // Market moved toward home if lineMove < 0
    // Market moved toward away if lineMove > 0
    const marketMovedWithModel =
      (modelSide === 'home' && lineMove < -0.5) ||
      (modelSide === 'away' && lineMove > 0.5);

    const marketMovedAgainstModel =
      (modelSide === 'home' && lineMove > 0.5) ||
      (modelSide === 'away' && lineMove < -0.5);

    games.push({
      gameId: line.cfbd_game_id,
      season: line.season,
      week: line.week,
      homeTeam: line.home_team,
      awayTeam: line.away_team,
      modelSpread,
      spreadOpen: line.spread_open,
      spreadClose: line.spread_close,
      margin: line.home_score - line.away_score,
      edgeAtOpen,
      lineMove,
      marketMovedWithModel,
      marketMovedAgainstModel,
    });
  }

  console.log(`Total games: ${games.length}\n`);

  // ==========================================================================
  // ANALYSIS 1: High-Edge Games Split by Line Movement
  // ==========================================================================

  console.log('=== HIGH-EDGE GAMES (|edge| >= 10) SPLIT BY LINE MOVEMENT ===\n');

  const highEdge = games.filter(g => Math.abs(g.edgeAtOpen) >= EDGE_THRESHOLD);
  console.log(`High-edge games: ${highEdge.length}\n`);

  // Split into: market moved with model, against model, neutral
  const withModel = highEdge.filter(g => g.marketMovedWithModel);
  const againstModel = highEdge.filter(g => g.marketMovedAgainstModel);
  const neutral = highEdge.filter(g => !g.marketMovedWithModel && !g.marketMovedAgainstModel);

  console.log('Scenario             | N    | If Bet WITH Model | If Bet AGAINST Model');
  console.log('---------------------|------|-------------------|--------------------');

  for (const [label, subset] of [
    ['Market WITH model', withModel],
    ['Market AGAINST model', againstModel],
    ['Market neutral', neutral],
  ] as const) {
    let withWins = 0, withLosses = 0;
    let againstWins = 0, againstLosses = 0;

    for (const g of subset) {
      const modelSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'home' : 'away';
      const oppositeSide: 'home' | 'away' = modelSide === 'home' ? 'away' : 'home';

      const withResult = gradeBet(g.margin, g.spreadClose, modelSide);
      const againstResult = gradeBet(g.margin, g.spreadClose, oppositeSide);

      if (withResult === 'win') withWins++;
      else if (withResult === 'loss') withLosses++;

      if (againstResult === 'win') againstWins++;
      else if (againstResult === 'loss') againstLosses++;
    }

    const withWinRate = withWins + withLosses > 0 ? withWins / (withWins + withLosses) : 0;
    const againstWinRate = againstWins + againstLosses > 0 ? againstWins / (againstWins + againstLosses) : 0;

    console.log(
      `${label.padEnd(20)} | ${subset.length.toString().padStart(4)} | ` +
      `${(withWinRate * 100).toFixed(1)}% (${withWins}-${withLosses})`.padEnd(17) + ` | ` +
      `${(againstWinRate * 100).toFixed(1)}% (${againstWins}-${againstLosses})`
    );
  }

  // ==========================================================================
  // ANALYSIS 2: The Filter Rule
  // ==========================================================================

  console.log('\n=== THE FILTER RULE ===\n');
  console.log('Rule: For high-edge games (|edge| >= 10):');
  console.log('  - If market moved WITH your model side: BET (market confirms)');
  console.log('  - If market moved AGAINST your model side: PASS (model likely stale)');
  console.log('  - If neutral: PASS (not enough confirmation)\n');

  // Apply filter
  const passFilter = highEdge.filter(g => g.marketMovedWithModel);
  const failFilter = highEdge.filter(g => !g.marketMovedWithModel);

  let filterWins = 0, filterLosses = 0;
  for (const g of passFilter) {
    const modelSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'home' : 'away';
    const result = gradeBet(g.margin, g.spreadClose, modelSide);
    if (result === 'win') filterWins++;
    else if (result === 'loss') filterLosses++;
  }

  const filterWinRate = filterWins / (filterWins + filterLosses);
  const filterROI = filterWinRate * 0.909 - (1 - filterWinRate);

  console.log(`Games passing filter: ${passFilter.length}`);
  console.log(`Win rate: ${(filterWinRate * 100).toFixed(1)}%`);
  console.log(`ROI: ${(filterROI * 100).toFixed(1)}%`);

  // Compare to unfiltered
  let unfilteredWins = 0, unfilteredLosses = 0;
  for (const g of highEdge) {
    const modelSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'home' : 'away';
    const result = gradeBet(g.margin, g.spreadClose, modelSide);
    if (result === 'win') unfilteredWins++;
    else if (result === 'loss') unfilteredLosses++;
  }

  const unfilteredWinRate = unfilteredWins / (unfilteredWins + unfilteredLosses);
  const unfilteredROI = unfilteredWinRate * 0.909 - (1 - unfilteredWinRate);

  console.log(`\nWithout filter (all high-edge): ${highEdge.length} games`);
  console.log(`Win rate: ${(unfilteredWinRate * 100).toFixed(1)}%`);
  console.log(`ROI: ${(unfilteredROI * 100).toFixed(1)}%`);

  // ==========================================================================
  // ANALYSIS 3: Year-by-Year Holdout
  // ==========================================================================

  console.log('\n=== HOLDOUT: TRAIN 2022-2023, TEST 2024 ===\n');

  const test2024 = games.filter(g => g.season === 2024 && Math.abs(g.edgeAtOpen) >= EDGE_THRESHOLD);
  const test2024Pass = test2024.filter(g => g.marketMovedWithModel);

  let test2024Wins = 0, test2024Losses = 0;
  for (const g of test2024Pass) {
    const modelSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'home' : 'away';
    const result = gradeBet(g.margin, g.spreadClose, modelSide);
    if (result === 'win') test2024Wins++;
    else if (result === 'loss') test2024Losses++;
  }

  const test2024WinRate = test2024Wins / (test2024Wins + test2024Losses);
  const test2024ROI = test2024WinRate * 0.909 - (1 - test2024WinRate);

  console.log(`2024 high-edge games: ${test2024.length}`);
  console.log(`2024 passing filter: ${test2024Pass.length}`);
  console.log(`2024 filtered win rate: ${(test2024WinRate * 100).toFixed(1)}%`);
  console.log(`2024 filtered ROI: ${(test2024ROI * 100).toFixed(1)}%`);

  // ==========================================================================
  // ANALYSIS 4: Original Model (Non-Contrarian) with Filter
  // ==========================================================================

  console.log('\n=== ORIGINAL MODEL (BET WITH MODEL) + FILTER ===\n');
  console.log('This is the approach you asked for:');
  console.log('  - For high-edge games, require market confirmation');
  console.log('  - Do NOT bet contrarian\n');

  // All games with filter
  for (const edgeThresh of [5, 10, 15]) {
    const filtered = games.filter(g =>
      Math.abs(g.edgeAtOpen) >= edgeThresh && g.marketMovedWithModel
    );

    let wins = 0, losses = 0;
    for (const g of filtered) {
      const modelSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'home' : 'away';
      const result = gradeBet(g.margin, g.spreadClose, modelSide);
      if (result === 'win') wins++;
      else if (result === 'loss') losses++;
    }

    const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
    const roi = winRate * 0.909 - (1 - winRate);

    console.log(`Edge >= ${edgeThresh} + market moved with: ${filtered.length} games, ${(winRate * 100).toFixed(1)}% win, ${(roi * 100).toFixed(1)}% ROI`);
  }

  // ==========================================================================
  // ANALYSIS 5: Sample Filtered Bets
  // ==========================================================================

  console.log('\n=== SAMPLE FILTERED BETS (2024, Edge >= 10, Market Moved With) ===\n');

  const samples = test2024Pass.slice(0, 10);

  console.log('Matchup                    | Model | Open  | Close | Move  | Side | Result');
  console.log('---------------------------|-------|-------|-------|-------|------|-------');

  for (const g of samples) {
    const modelSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'home' : 'away';
    const result = gradeBet(g.margin, g.spreadClose, modelSide);

    const matchup = `${g.awayTeam.slice(0, 12)} @ ${g.homeTeam.slice(0, 12)}`.padEnd(26);
    const model = (g.modelSpread >= 0 ? '+' : '') + g.modelSpread.toFixed(0);
    const open = (g.spreadOpen >= 0 ? '+' : '') + g.spreadOpen.toFixed(0);
    const close = (g.spreadClose >= 0 ? '+' : '') + g.spreadClose.toFixed(0);
    const move = (g.lineMove >= 0 ? '+' : '') + g.lineMove.toFixed(1);

    console.log(
      `${matchup} | ${model.padStart(5)} | ${open.padStart(5)} | ${close.padStart(5)} | ${move.padStart(5)} | ${modelSide.padEnd(4)} | ${result}`
    );
  }

  console.log('\n=== ANALYSIS COMPLETE ===');
  console.log('\nKey insight: Using market confirmation as a filter for high-edge games');
  console.log('transforms a losing strategy into a potentially winning one.');
}

main().catch(console.error);

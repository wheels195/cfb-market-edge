/**
 * CLV Analysis with Line Movement Patterns
 *
 * Since CFBD only provides open/close, we analyze:
 * 1. Opening vs Closing edge - where do we have edge?
 * 2. Line movement magnitude - does larger movement correlate with outcome?
 * 3. Steam direction - following vs fading line movement
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const HFA = 3.0;
const ELO_TO_SPREAD = 25;

interface Game {
  homeTeam: string;
  awayTeam: string;
  season: number;
  week: number;
  modelSpread: number;
  spreadOpen: number;
  spreadClose: number;
  margin: number;
  lineMove: number;
  edgeAtOpen: number;   // model - open
  edgeAtClose: number;  // model - close
  sideAtOpen: 'home' | 'away';
  sideAtClose: 'home' | 'away';
  wonBetAtOpen: boolean;
  wonBetAtClose: boolean;
  clvFromOpen: number;
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

function calcROI(winRate: number, price: number = -110): number {
  // Standard -110 pricing
  const payout = price < 0 ? 100 / Math.abs(price) : price / 100;
  return winRate * payout - (1 - winRate);
}

function calcEV(edge: number, stdDev: number = 14): number {
  // Convert edge points to expected value
  // Approximate: each point of edge = ~2.5% probability shift
  // More precise: use normal CDF
  const z = edge / stdDev;
  // Approximate normal CDF
  const prob = 1 / (1 + Math.exp(-1.7 * z));
  return prob * 0.909 - (1 - prob); // At -110 odds
}

async function main() {
  console.log('=== CLV & LINE MOVEMENT ANALYSIS ===\n');

  const { eloMap, lines } = await loadData();
  console.log(`Loaded ${eloMap.size} teams, ${lines.length} games\n`);

  const games: Game[] = [];

  for (const line of lines) {
    const homeElo = getElo(eloMap, line.home_team, line.season, line.week);
    const awayElo = getElo(eloMap, line.away_team, line.season, line.week);
    if (!homeElo || !awayElo) continue;

    const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
    const modelSpread = -eloDiff / ELO_TO_SPREAD;

    const spreadOpen = line.spread_open;
    const spreadClose = line.spread_close;
    const margin = line.home_score - line.away_score;
    const lineMove = spreadClose - spreadOpen;

    const edgeAtOpen = modelSpread - spreadOpen;
    const edgeAtClose = modelSpread - spreadClose;

    const sideAtOpen: 'home' | 'away' = edgeAtOpen < 0 ? 'home' : 'away';
    const sideAtClose: 'home' | 'away' = edgeAtClose < 0 ? 'home' : 'away';

    const homeCoveredClose = margin > -spreadClose;
    const wonBetAtOpen = (sideAtOpen === 'home' && homeCoveredClose) ||
                         (sideAtOpen === 'away' && !homeCoveredClose);
    const wonBetAtClose = (sideAtClose === 'home' && homeCoveredClose) ||
                          (sideAtClose === 'away' && !homeCoveredClose);

    const clvFromOpen = sideAtOpen === 'home'
      ? spreadOpen - spreadClose
      : spreadClose - spreadOpen;

    games.push({
      homeTeam: line.home_team,
      awayTeam: line.away_team,
      season: line.season,
      week: line.week,
      modelSpread,
      spreadOpen,
      spreadClose,
      margin,
      lineMove,
      edgeAtOpen,
      edgeAtClose,
      sideAtOpen,
      sideAtClose,
      wonBetAtOpen,
      wonBetAtClose,
      clvFromOpen,
    });
  }

  console.log(`Total games with Elo: ${games.length}\n`);

  // ==========================================================================
  // ANALYSIS 1: Betting at Open vs Close
  // ==========================================================================

  console.log('=== BETTING TIME COMPARISON ===\n');
  console.log('Concept: If betting at open is better, we should see higher win% there\n');

  const winAtOpen = games.filter(g => g.wonBetAtOpen).length / games.length;
  const winAtClose = games.filter(g => g.wonBetAtClose).length / games.length;

  console.log(`Bet at OPEN (use open spread):  ${(winAtOpen * 100).toFixed(1)}% win rate, ROI: ${(calcROI(winAtOpen) * 100).toFixed(1)}%`);
  console.log(`Bet at CLOSE (use close spread): ${(winAtClose * 100).toFixed(1)}% win rate, ROI: ${(calcROI(winAtClose) * 100).toFixed(1)}%`);

  // ==========================================================================
  // ANALYSIS 2: By Edge Size at Open
  // ==========================================================================

  console.log('\n=== PERFORMANCE BY EDGE SIZE (AT OPEN) ===\n');

  games.sort((a, b) => Math.abs(b.edgeAtOpen) - Math.abs(a.edgeAtOpen));

  const buckets = [
    { name: 'Top 5%', pct: 0.05 },
    { name: 'Top 10%', pct: 0.10 },
    { name: 'Top 20%', pct: 0.20 },
    { name: 'Bottom 80%', pct: 1.0, skip: 0.20 },
  ];

  console.log('Bucket     | N    | Avg Edge | Win%  | ROI    | Avg CLV | Est EV');
  console.log('-----------|------|----------|-------|--------|---------|-------');

  for (const bucket of buckets) {
    const startIdx = bucket.skip ? Math.floor(games.length * bucket.skip) : 0;
    const endIdx = Math.floor(games.length * bucket.pct);
    const slice = games.slice(startIdx, endIdx);

    const avgEdge = slice.reduce((s, g) => s + Math.abs(g.edgeAtOpen), 0) / slice.length;
    const winRate = slice.filter(g => g.wonBetAtOpen).length / slice.length;
    const roi = calcROI(winRate);
    const avgCLV = slice.reduce((s, g) => s + g.clvFromOpen, 0) / slice.length;
    const estEV = calcEV(avgEdge);

    console.log(
      `${bucket.name.padEnd(10)} | ${slice.length.toString().padStart(4)} | ` +
      `${avgEdge.toFixed(2).padStart(8)} | ${(winRate * 100).toFixed(1).padStart(4)}% | ` +
      `${(roi * 100).toFixed(1).padStart(5)}% | ${avgCLV.toFixed(2).padStart(7)} | ` +
      `${(estEV * 100).toFixed(1).padStart(5)}%`
    );
  }

  // ==========================================================================
  // ANALYSIS 3: Line Movement Magnitude Buckets
  // ==========================================================================

  console.log('\n=== PERFORMANCE BY LINE MOVEMENT SIZE ===\n');

  const moveBuckets = [
    { name: 'Move > 3', filter: (g: Game) => Math.abs(g.lineMove) > 3 },
    { name: 'Move 2-3', filter: (g: Game) => Math.abs(g.lineMove) >= 2 && Math.abs(g.lineMove) <= 3 },
    { name: 'Move 1-2', filter: (g: Game) => Math.abs(g.lineMove) >= 1 && Math.abs(g.lineMove) < 2 },
    { name: 'Move 0.5-1', filter: (g: Game) => Math.abs(g.lineMove) >= 0.5 && Math.abs(g.lineMove) < 1 },
    { name: 'Move < 0.5', filter: (g: Game) => Math.abs(g.lineMove) < 0.5 },
  ];

  console.log('Move Size  | N    | Avg Edge | Win%  | ROI    | Avg CLV');
  console.log('-----------|------|----------|-------|--------|--------');

  for (const bucket of moveBuckets) {
    const slice = games.filter(bucket.filter);
    if (slice.length === 0) continue;

    const avgEdge = slice.reduce((s, g) => s + Math.abs(g.edgeAtOpen), 0) / slice.length;
    const winRate = slice.filter(g => g.wonBetAtOpen).length / slice.length;
    const roi = calcROI(winRate);
    const avgCLV = slice.reduce((s, g) => s + g.clvFromOpen, 0) / slice.length;

    console.log(
      `${bucket.name.padEnd(10)} | ${slice.length.toString().padStart(4)} | ` +
      `${avgEdge.toFixed(2).padStart(8)} | ${(winRate * 100).toFixed(1).padStart(4)}% | ` +
      `${(roi * 100).toFixed(1).padStart(5)}% | ${avgCLV.toFixed(2).padStart(7)}`
    );
  }

  // ==========================================================================
  // ANALYSIS 4: Following vs Fading Steam
  // ==========================================================================

  console.log('\n=== STEAM ANALYSIS: FOLLOW vs FADE ===\n');

  // When line moves significantly (>1 pt), should we follow or fade?
  const bigMoves = games.filter(g => Math.abs(g.lineMove) >= 1);

  // "Follow steam" = bet in direction of line movement
  // "Fade steam" = bet opposite of line movement

  let followWins = 0;
  let fadeWins = 0;

  for (const g of bigMoves) {
    const moveTowardHome = g.lineMove < 0;
    const homeCovered = g.margin > -g.spreadClose;

    // Follow steam: if line moved toward home, bet home
    const followResult = (moveTowardHome && homeCovered) || (!moveTowardHome && !homeCovered);
    // Fade steam: if line moved toward home, bet away
    const fadeResult = (moveTowardHome && !homeCovered) || (!moveTowardHome && homeCovered);

    if (followResult) followWins++;
    if (fadeResult) fadeWins++;
  }

  console.log(`Games with line move >= 1 point: ${bigMoves.length}`);
  console.log(`Follow steam win rate: ${(followWins / bigMoves.length * 100).toFixed(1)}%`);
  console.log(`Fade steam win rate: ${(fadeWins / bigMoves.length * 100).toFixed(1)}%`);

  // ==========================================================================
  // ANALYSIS 5: Model Edge + Line Direction Combined
  // ==========================================================================

  console.log('\n=== MODEL EDGE + LINE DIRECTION ===\n');

  // Sort by edge
  games.sort((a, b) => Math.abs(b.edgeAtOpen) - Math.abs(a.edgeAtOpen));
  const topEdges = games.slice(0, Math.floor(games.length * 0.2));

  // Split by whether line moved with or against our model
  const lineMoveWithModel = topEdges.filter(g => {
    // If we bet home (edgeAtOpen < 0) and line moved toward home (lineMove < 0) = WITH
    // If we bet away (edgeAtOpen > 0) and line moved toward away (lineMove > 0) = WITH
    return (g.sideAtOpen === 'home' && g.lineMove <= 0) ||
           (g.sideAtOpen === 'away' && g.lineMove >= 0);
  });

  const lineMoveAgainstModel = topEdges.filter(g => {
    return (g.sideAtOpen === 'home' && g.lineMove > 0) ||
           (g.sideAtOpen === 'away' && g.lineMove < 0);
  });

  console.log('Top 20% model edges, split by line movement direction:');
  console.log();

  const withWinRate = lineMoveWithModel.filter(g => g.wonBetAtOpen).length / lineMoveWithModel.length;
  const withCLV = lineMoveWithModel.reduce((s, g) => s + g.clvFromOpen, 0) / lineMoveWithModel.length;

  const againstWinRate = lineMoveAgainstModel.filter(g => g.wonBetAtOpen).length / lineMoveAgainstModel.length;
  const againstCLV = lineMoveAgainstModel.reduce((s, g) => s + g.clvFromOpen, 0) / lineMoveAgainstModel.length;

  console.log(`Line moved WITH model:    N=${lineMoveWithModel.length}, Win=${(withWinRate * 100).toFixed(1)}%, CLV=${withCLV.toFixed(2)}`);
  console.log(`Line moved AGAINST model: N=${lineMoveAgainstModel.length}, Win=${(againstWinRate * 100).toFixed(1)}%, CLV=${againstCLV.toFixed(2)}`);

  // ==========================================================================
  // ANALYSIS 6: Key Insight - What predicts winning?
  // ==========================================================================

  console.log('\n=== WHAT PREDICTS WINNING? ===\n');

  // Correlation analysis
  const wins = games.map(g => g.wonBetAtOpen ? 1 : 0);
  const edges = games.map(g => Math.abs(g.edgeAtOpen));
  const clvs = games.map(g => g.clvFromOpen);
  const moves = games.map(g => Math.abs(g.lineMove));

  function corr(x: number[], y: number[]): number {
    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      num += (x[i] - meanX) * (y[i] - meanY);
      denX += (x[i] - meanX) ** 2;
      denY += (y[i] - meanY) ** 2;
    }
    return num / Math.sqrt(denX * denY);
  }

  console.log('Correlation with winning (1=win, 0=loss):');
  console.log(`  Model edge size:     ${corr(edges, wins).toFixed(4)}`);
  console.log(`  CLV from open:       ${corr(clvs, wins).toFixed(4)}`);
  console.log(`  Line move magnitude: ${corr(moves, wins).toFixed(4)}`);

  console.log('\n=== ANALYSIS COMPLETE ===');
}

main().catch(console.error);

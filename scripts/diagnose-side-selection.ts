/**
 * Diagnose Side Selection Issue
 *
 * The backtest shows positive CLV but terrible win rate.
 * This means we're getting good numbers but picking the wrong side.
 * Let's understand why.
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
  homeElo: number;
  awayElo: number;
  modelSpread: number;
  spreadOpen: number;
  spreadClose: number;
  margin: number;
  side: 'home' | 'away';
  modelVsOpen: number;
  won: boolean;
  clvFromOpen: number;
}

async function loadData() {
  // Load Elo ratings
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

  // Load betting lines
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

  // Prior week
  const priorWeek = week - 1;
  if (priorWeek >= 1) {
    const key = `${season}-${priorWeek}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }

  // Prior season week 16
  for (let w = 16; w >= 1; w--) {
    const key = `${season - 1}-${w}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }

  return null;
}

async function main() {
  console.log('=== DIAGNOSING SIDE SELECTION ===\n');

  const { eloMap, lines } = await loadData();
  console.log(`Loaded ${eloMap.size} teams, ${lines.length} games\n`);

  const games: Game[] = [];

  for (const line of lines) {
    const homeElo = getElo(eloMap, line.home_team, line.season, line.week);
    const awayElo = getElo(eloMap, line.away_team, line.season, line.week);
    if (!homeElo || !awayElo) continue;

    // Project spread: negative = home favored
    const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
    const modelSpread = -eloDiff / ELO_TO_SPREAD;

    const spreadOpen = line.spread_open;
    const spreadClose = line.spread_close;
    const margin = line.home_score - line.away_score;

    // Model vs Open
    // If modelSpread < spreadOpen, model thinks home is stronger than market
    // Example: model = -10, open = -7 → model says home is 3 points better than market thinks
    const modelVsOpen = modelSpread - spreadOpen;

    // Which side should we bet?
    // If modelVsOpen < 0 → model has home as bigger favorite → bet home
    // If modelVsOpen > 0 → model has away as bigger favorite → bet away
    const side: 'home' | 'away' = modelVsOpen < 0 ? 'home' : 'away';

    // Did we win?
    // If we bet home: we win if margin > -spreadClose (home covers)
    // If we bet away: we win if margin < -spreadClose (away covers)
    const homeCovered = margin > -spreadClose;
    const awayCovered = margin < -spreadClose;
    const won = (side === 'home' && homeCovered) || (side === 'away' && awayCovered);

    // CLV from betting at open
    // If we bet HOME at spreadOpen: CLV = spreadOpen - spreadClose
    //   (positive if close moved in our favor, i.e., became more negative)
    // If we bet AWAY at -spreadOpen: CLV = -(spreadOpen - spreadClose) = spreadClose - spreadOpen
    //   (positive if close moved toward home, i.e., became more negative)
    const clvFromOpen = side === 'home'
      ? spreadOpen - spreadClose
      : -(spreadOpen - spreadClose);

    games.push({
      homeTeam: line.home_team,
      awayTeam: line.away_team,
      homeElo,
      awayElo,
      modelSpread,
      spreadOpen,
      spreadClose,
      margin,
      side,
      modelVsOpen,
      won,
      clvFromOpen,
    });
  }

  console.log(`Total games with Elo: ${games.length}\n`);

  // Sort by absolute edge
  games.sort((a, b) => Math.abs(b.modelVsOpen) - Math.abs(a.modelVsOpen));

  // Check top 20 games
  console.log('=== TOP 20 EDGES (by |model - open|) ===\n');
  console.log('Matchup                      | Model | Open  | Edge  | Side | Margin | Won | CLV');
  console.log('-----------------------------|-------|-------|-------|------|--------|-----|-----');

  for (const g of games.slice(0, 20)) {
    const matchup = `${g.awayTeam.slice(0, 12)} @ ${g.homeTeam.slice(0, 12)}`.padEnd(28);
    const model = (g.modelSpread >= 0 ? '+' : '') + g.modelSpread.toFixed(1);
    const open = (g.spreadOpen >= 0 ? '+' : '') + g.spreadOpen.toFixed(1);
    const edge = (g.modelVsOpen >= 0 ? '+' : '') + g.modelVsOpen.toFixed(1);
    const mar = (g.margin >= 0 ? '+' : '') + g.margin.toString();
    const clv = (g.clvFromOpen >= 0 ? '+' : '') + g.clvFromOpen.toFixed(1);

    console.log(
      `${matchup} | ${model.padStart(5)} | ${open.padStart(5)} | ${edge.padStart(5)} | ${g.side.padEnd(4)} | ${mar.padStart(6)} | ${g.won ? 'Y' : 'N'}   | ${clv.padStart(4)}`
    );
  }

  // Analysis: When model is wrong, which direction?
  console.log('\n=== SYSTEMATIC BIAS ANALYSIS ===\n');

  // Model says bet home (modelVsOpen < 0)
  const betHome = games.filter(g => g.side === 'home');
  const betAway = games.filter(g => g.side === 'away');

  console.log(`Bet Home (model has home stronger): ${betHome.length} games`);
  console.log(`  Win rate: ${(betHome.filter(g => g.won).length / betHome.length * 100).toFixed(1)}%`);
  console.log(`  Avg CLV: ${(betHome.reduce((s, g) => s + g.clvFromOpen, 0) / betHome.length).toFixed(2)}`);

  console.log(`\nBet Away (model has away stronger): ${betAway.length} games`);
  console.log(`  Win rate: ${(betAway.filter(g => g.won).length / betAway.length * 100).toFixed(1)}%`);
  console.log(`  Avg CLV: ${(betAway.reduce((s, g) => s + g.clvFromOpen, 0) / betAway.length).toFixed(2)}`);

  // Extreme analysis: what if we REVERSED our bet?
  console.log('\n=== WHAT IF WE REVERSED THE BET? ===\n');

  const top20pct = games.slice(0, Math.floor(games.length * 0.2));

  const originalWin = top20pct.filter(g => g.won).length / top20pct.length;

  // Reversed: bet the OPPOSITE of what model says
  const reversedWin = top20pct.filter(g => {
    const reversedSide = g.side === 'home' ? 'away' : 'home';
    const margin = g.margin;
    const spreadClose = g.spreadClose;
    const homeCovered = margin > -spreadClose;
    return (reversedSide === 'home' && homeCovered) || (reversedSide === 'away' && !homeCovered);
  }).length / top20pct.length;

  console.log(`Top 20% edges (N=${top20pct.length}):`);
  console.log(`  Original side win rate: ${(originalWin * 100).toFixed(1)}%`);
  console.log(`  REVERSED side win rate: ${(reversedWin * 100).toFixed(1)}%`);

  // Check if model systematically overrates home or away
  console.log('\n=== MODEL BIAS CHECK ===\n');

  // Average model spread
  const avgModelSpread = games.reduce((s, g) => s + g.modelSpread, 0) / games.length;
  const avgOpenSpread = games.reduce((s, g) => s + g.spreadOpen, 0) / games.length;

  console.log(`Average model spread: ${avgModelSpread.toFixed(2)}`);
  console.log(`Average open spread: ${avgOpenSpread.toFixed(2)}`);
  console.log(`Model bias vs market: ${(avgModelSpread - avgOpenSpread).toFixed(2)} (negative = more home-favorable)`);

  // Elo distribution check
  const homeEloAvg = games.reduce((s, g) => s + g.homeElo, 0) / games.length;
  const awayEloAvg = games.reduce((s, g) => s + g.awayElo, 0) / games.length;

  console.log(`\nAverage home Elo: ${homeEloAvg.toFixed(0)}`);
  console.log(`Average away Elo: ${awayEloAvg.toFixed(0)}`);
  console.log(`Home advantage in data: ${(homeEloAvg - awayEloAvg).toFixed(0)} Elo points`);

  // What about just comparing Elo to actual margin?
  console.log('\n=== ELO PREDICTIVE POWER ===\n');

  const errors: number[] = [];
  for (const g of games) {
    // Predicted margin from Elo (positive = home wins)
    const predictedMargin = (g.homeElo - g.awayElo + HFA * ELO_TO_SPREAD) / ELO_TO_SPREAD;
    const actualMargin = g.margin;
    errors.push(predictedMargin - actualMargin);
  }

  const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
  const bias = errors.reduce((s, e) => s + e, 0) / errors.length;

  console.log(`Elo prediction MAE: ${mae.toFixed(2)} points`);
  console.log(`Elo prediction bias: ${bias.toFixed(2)} (positive = overestimates home)`);

  // Key insight: compare our edge direction to line movement direction
  console.log('\n=== EDGE VS LINE MOVEMENT ===\n');

  const topEdges = games.slice(0, Math.floor(games.length * 0.1)); // Top 10%

  let sameDirection = 0;
  let oppositeDirection = 0;

  for (const g of topEdges) {
    const lineMove = g.spreadClose - g.spreadOpen;
    // Our edge says bet home if modelVsOpen < 0
    // Line moved toward home if lineMove < 0 (close more negative than open)
    const ourDirection = g.modelVsOpen < 0 ? 'home' : 'away';
    const moveDirection = lineMove < 0 ? 'home' : lineMove > 0 ? 'away' : 'neutral';

    if ((ourDirection === 'home' && moveDirection === 'home') ||
        (ourDirection === 'away' && moveDirection === 'away')) {
      sameDirection++;
    } else if ((ourDirection === 'home' && moveDirection === 'away') ||
               (ourDirection === 'away' && moveDirection === 'home')) {
      oppositeDirection++;
    }
  }

  console.log(`Top 10% edges (N=${topEdges.length}):`);
  console.log(`  Line moved WITH our edge: ${sameDirection} (${(sameDirection/topEdges.length*100).toFixed(1)}%)`);
  console.log(`  Line moved AGAINST our edge: ${oppositeDirection} (${(oppositeDirection/topEdges.length*100).toFixed(1)}%)`);
  console.log(`  (If >50% against, market is disagreeing with us)`);

  // Final check: what's happening with our CLV calculation?
  console.log('\n=== CLV CALCULATION VERIFICATION ===\n');

  // Pick a specific game to trace through
  const sample = topEdges[0];
  console.log(`Sample game: ${sample.awayTeam} @ ${sample.homeTeam}`);
  console.log(`  Home Elo: ${sample.homeElo}, Away Elo: ${sample.awayElo}`);
  console.log(`  Model spread: ${sample.modelSpread.toFixed(1)} (negative = home favored)`);
  console.log(`  Open spread: ${sample.spreadOpen}`);
  console.log(`  Close spread: ${sample.spreadClose}`);
  console.log(`  Model vs Open: ${sample.modelVsOpen.toFixed(1)}`);
  console.log(`  Our side: ${sample.side}`);
  console.log(`  Actual margin: ${sample.margin} (positive = home won)`);
  console.log(`  Won bet: ${sample.won}`);
  console.log(`  CLV: ${sample.clvFromOpen.toFixed(2)}`);

  console.log('\n=== DIAGNOSIS COMPLETE ===');
}

main().catch(console.error);

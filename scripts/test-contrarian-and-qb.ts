/**
 * Test Contrarian Approach + QB Analysis
 *
 * 1. Test betting OPPOSITE of model on high-edge games
 * 2. Analyze QB availability impact (using post-game data)
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
  edgeAtOpen: number;
  side: 'home' | 'away';
  reverseSide: 'home' | 'away';
  won: boolean;
  reverseWon: boolean;
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

async function main() {
  console.log('=== CONTRARIAN APPROACH TEST ===\n');

  const { eloMap, lines } = await loadData();
  console.log(`Loaded ${lines.length} games\n`);

  const games: Game[] = [];

  for (const line of lines) {
    const homeElo = getElo(eloMap, line.home_team, line.season, line.week);
    const awayElo = getElo(eloMap, line.away_team, line.season, line.week);
    if (!homeElo || !awayElo) continue;

    const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
    const modelSpread = -eloDiff / ELO_TO_SPREAD;
    const edgeAtOpen = modelSpread - line.spread_open;
    const margin = line.home_score - line.away_score;

    const side: 'home' | 'away' = edgeAtOpen < 0 ? 'home' : 'away';
    const reverseSide: 'home' | 'away' = edgeAtOpen < 0 ? 'away' : 'home';

    const homeCovered = margin > -line.spread_close;
    const won = (side === 'home' && homeCovered) || (side === 'away' && !homeCovered);
    const reverseWon = (reverseSide === 'home' && homeCovered) || (reverseSide === 'away' && !homeCovered);

    games.push({
      homeTeam: line.home_team,
      awayTeam: line.away_team,
      season: line.season,
      week: line.week,
      modelSpread,
      spreadOpen: line.spread_open,
      spreadClose: line.spread_close,
      margin,
      edgeAtOpen,
      side,
      reverseSide,
      won,
      reverseWon,
    });
  }

  console.log(`Games with Elo: ${games.length}\n`);

  // Sort by edge size
  games.sort((a, b) => Math.abs(b.edgeAtOpen) - Math.abs(a.edgeAtOpen));

  // ==========================================================================
  // CONTRARIAN BACKTEST
  // ==========================================================================

  console.log('=== CONTRARIAN VS ORIGINAL BY BUCKET ===\n');
  console.log('Strategy: Bet OPPOSITE of what Elo model suggests\n');

  const buckets = [
    { name: 'Top 5%', pct: 0.05 },
    { name: 'Top 10%', pct: 0.10 },
    { name: 'Top 20%', pct: 0.20 },
    { name: 'Top 30%', pct: 0.30 },
  ];

  console.log('Bucket   | N    | Original Win% | Reverse Win% | Orig ROI | Rev ROI');
  console.log('---------|------|---------------|--------------|----------|--------');

  for (const bucket of buckets) {
    const n = Math.floor(games.length * bucket.pct);
    const slice = games.slice(0, n);

    const origWin = slice.filter(g => g.won).length / slice.length;
    const revWin = slice.filter(g => g.reverseWon).length / slice.length;
    const origROI = origWin * 0.909 - (1 - origWin);
    const revROI = revWin * 0.909 - (1 - revWin);

    console.log(
      `${bucket.name.padEnd(8)} | ${n.toString().padStart(4)} | ` +
      `${(origWin * 100).toFixed(1).padStart(12)}% | ` +
      `${(revWin * 100).toFixed(1).padStart(11)}% | ` +
      `${(origROI * 100).toFixed(1).padStart(7)}% | ` +
      `${(revROI * 100).toFixed(1).padStart(6)}%`
    );
  }

  // ==========================================================================
  // STATISTICAL SIGNIFICANCE
  // ==========================================================================

  console.log('\n=== STATISTICAL SIGNIFICANCE (Top 20%) ===\n');

  const top20 = games.slice(0, Math.floor(games.length * 0.2));
  const revWinRate = top20.filter(g => g.reverseWon).length / top20.length;
  const n = top20.length;

  // Z-test against 50%
  const p0 = 0.50;
  const se = Math.sqrt(p0 * (1 - p0) / n);
  const z = (revWinRate - p0) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  console.log(`Sample size: ${n}`);
  console.log(`Reverse win rate: ${(revWinRate * 100).toFixed(1)}%`);
  console.log(`Z-score: ${z.toFixed(2)}`);
  console.log(`P-value: ${pValue.toFixed(4)}`);
  console.log(`Significant at 5%: ${pValue < 0.05 ? 'YES' : 'NO'}`);
  console.log(`Significant at 10%: ${pValue < 0.10 ? 'YES' : 'NO'}`);

  // ==========================================================================
  // YEAR-BY-YEAR BREAKDOWN
  // ==========================================================================

  console.log('\n=== YEAR-BY-YEAR (TOP 20% CONTRARIAN) ===\n');

  const seasons = [2021, 2022, 2023, 2024];
  console.log('Season | N    | Orig Win% | Rev Win%  | Rev ROI');
  console.log('-------|------|-----------|-----------|--------');

  for (const season of seasons) {
    const seasonGames = games.filter(g => g.season === season);
    seasonGames.sort((a, b) => Math.abs(b.edgeAtOpen) - Math.abs(a.edgeAtOpen));
    const top20Season = seasonGames.slice(0, Math.floor(seasonGames.length * 0.2));

    if (top20Season.length === 0) continue;

    const origWin = top20Season.filter(g => g.won).length / top20Season.length;
    const revWin = top20Season.filter(g => g.reverseWon).length / top20Season.length;
    const revROI = revWin * 0.909 - (1 - revWin);

    console.log(
      `${season}   | ${top20Season.length.toString().padStart(4)} | ` +
      `${(origWin * 100).toFixed(1).padStart(8)}% | ` +
      `${(revWin * 100).toFixed(1).padStart(8)}% | ` +
      `${(revROI * 100).toFixed(1).padStart(6)}%`
    );
  }

  // ==========================================================================
  // COMBINED FILTERS
  // ==========================================================================

  console.log('\n=== CONTRARIAN + LINE MOVEMENT FILTER ===\n');
  console.log('Only bet contrarian when line moves AGAINST our original side\n');

  // Line moved against our original side means:
  // If we originally bet home (edgeAtOpen < 0) and line moved toward away (lineMove > 0)
  // If we originally bet away (edgeAtOpen > 0) and line moved toward home (lineMove < 0)

  const contrWithFilter = games.slice(0, Math.floor(games.length * 0.2)).filter(g => {
    const lineMove = g.spreadClose - g.spreadOpen;
    // Original side was g.side
    // Filter: line moved AGAINST original side
    return (g.side === 'home' && lineMove > 0.5) ||
           (g.side === 'away' && lineMove < -0.5);
  });

  if (contrWithFilter.length > 0) {
    const filteredRevWin = contrWithFilter.filter(g => g.reverseWon).length / contrWithFilter.length;
    const filteredRevROI = filteredRevWin * 0.909 - (1 - filteredRevWin);

    console.log(`Games passing filter: ${contrWithFilter.length}`);
    console.log(`Contrarian win rate: ${(filteredRevWin * 100).toFixed(1)}%`);
    console.log(`Contrarian ROI: ${(filteredRevROI * 100).toFixed(1)}%`);
  }

  // ==========================================================================
  // SAMPLE GAMES
  // ==========================================================================

  console.log('\n=== SAMPLE CONTRARIAN BETS (TOP 10 EDGES) ===\n');
  console.log('Matchup                    | Model | Open  | Orig | Rev  | Result');
  console.log('---------------------------|-------|-------|------|------|-------');

  for (const g of games.slice(0, 10)) {
    const matchup = `${g.awayTeam.slice(0, 12)} @ ${g.homeTeam.slice(0, 12)}`.padEnd(26);
    const model = (g.modelSpread >= 0 ? '+' : '') + g.modelSpread.toFixed(0);
    const open = (g.spreadOpen >= 0 ? '+' : '') + g.spreadOpen.toFixed(0);
    const origResult = g.won ? 'W' : 'L';
    const revResult = g.reverseWon ? 'W' : 'L';
    const margin = (g.margin >= 0 ? '+' : '') + g.margin.toString();

    console.log(
      `${matchup} | ${model.padStart(5)} | ${open.padStart(5)} | ${g.side.padEnd(4)} | ${g.reverseSide.padEnd(4)} | Orig:${origResult} Rev:${revResult} Mar:${margin}`
    );
  }

  console.log('\n=== ANALYSIS COMPLETE ===');
}

function normalCDF(x: number): number {
  // Approximation of standard normal CDF
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

main().catch(console.error);

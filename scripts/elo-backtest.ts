/**
 * Elo-Based Backtest with Opening-Line Filter
 *
 * Following the correct methodology:
 * 1. Use CFBD Elo ratings (not SP+) as internal rating
 * 2. Compare model projection to OPENING line
 * 3. Filter: discard if market moved AGAINST model
 * 4. Evaluate on top 5/10/20% edge buckets only
 * 5. Measure CLV from opening to close
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface Projection {
  gameId: number;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  modelSpread: number;      // Our projection
  spreadOpen: number;       // Opening line
  spreadClose: number;      // Closing line
  lineMove: number;         // close - open
  modelVsOpen: number;      // model - open (edge at open)
  marketMovedWithUs: boolean;
  homeScore: number;
  awayScore: number;
  margin: number;
  side: 'home' | 'away';
  won: boolean;
  clvFromOpen: number;      // open - close (if we bet at open)
}

// =============================================================================
// CONFIG
// =============================================================================

const HFA = 3.0; // Home field advantage in Elo points (translates to ~3 spread points)
const ELO_TO_SPREAD = 25; // ~25 Elo points = 1 spread point

// =============================================================================
// LOAD DATA
// =============================================================================

async function loadEloRatings(): Promise<Map<string, Map<string, number>>> {
  // Load all weekly Elo ratings
  const allData: any[] = [];
  let offset = 0;

  while (true) {
    const { data } = await supabase
      .from('cfbd_elo_ratings')
      .select('season, week, team_name, elo')
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    allData.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Map: team -> "season-week" -> elo
  const ratings = new Map<string, Map<string, number>>();
  for (const row of allData) {
    const teamKey = row.team_name.toLowerCase();
    if (!ratings.has(teamKey)) ratings.set(teamKey, new Map());
    const weekKey = `${row.season}-${row.week}`;
    ratings.get(teamKey)!.set(weekKey, row.elo);
  }

  return ratings;
}

function getEloForGame(
  ratings: Map<string, Map<string, number>>,
  teamName: string,
  season: number,
  week: number
): number | null {
  const teamKey = teamName.toLowerCase();
  const teamRatings = ratings.get(teamKey);
  if (!teamRatings) return null;

  // Use PRIOR week's Elo (point-in-time)
  const priorWeek = week - 1;

  // Try prior week in same season
  if (priorWeek >= 1) {
    const key = `${season}-${priorWeek}`;
    if (teamRatings.has(key)) return teamRatings.get(key)!;
  }

  // For week 1, use last week of prior season
  const priorSeasonKey = `${season - 1}-16`;
  if (teamRatings.has(priorSeasonKey)) return teamRatings.get(priorSeasonKey)!;

  // Fallback to any available prior season rating
  for (let w = 16; w >= 1; w--) {
    const key = `${season - 1}-${w}`;
    if (teamRatings.has(key)) return teamRatings.get(key)!;
  }

  return null;
}

async function loadBettingLines(): Promise<any[]> {
  const allLines: any[] = [];
  let offset = 0;

  while (true) {
    const { data } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .not('spread_open', 'is', null)
      .not('spread_close', 'is', null)
      .not('home_score', 'is', null)
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    allLines.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  return allLines;
}

// =============================================================================
// PROJECTION
// =============================================================================

function projectSpread(homeElo: number, awayElo: number): number {
  // Elo difference -> spread
  // Higher home Elo = more negative spread (home favored)
  const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
  return -eloDiff / ELO_TO_SPREAD;
}

// =============================================================================
// ANALYSIS
// =============================================================================

async function runAnalysis() {
  console.log('=== ELO-BASED BACKTEST ===\n');

  const eloRatings = await loadEloRatings();
  console.log(`Loaded Elo ratings for ${eloRatings.size} teams`);

  const lines = await loadBettingLines();
  console.log(`Loaded ${lines.length} games with open & close spreads\n`);

  const projections: Projection[] = [];

  for (const game of lines) {
    // Use prior WEEK's Elo for projection (point-in-time)
    const homeElo = getEloForGame(eloRatings, game.home_team, game.season, game.week);
    const awayElo = getEloForGame(eloRatings, game.away_team, game.season, game.week);

    if (!homeElo || !awayElo) continue;

    const modelSpread = projectSpread(homeElo, awayElo);
    const spreadOpen = game.spread_open;
    const spreadClose = game.spread_close;
    const lineMove = spreadClose - spreadOpen;
    const modelVsOpen = modelSpread - spreadOpen;

    // Determine if market moved WITH or AGAINST our model
    // If model says bet home (modelVsOpen < 0) and line moved toward home (lineMove < 0) = WITH us
    // If model says bet away (modelVsOpen > 0) and line moved toward away (lineMove > 0) = WITH us
    const side: 'home' | 'away' = modelVsOpen < 0 ? 'home' : 'away';
    const marketMovedWithUs = (side === 'home' && lineMove <= 0) || (side === 'away' && lineMove >= 0);

    // Result
    const margin = game.home_score - game.away_score;
    const homeCovered = margin > -spreadClose;
    const won = (side === 'home' && homeCovered) || (side === 'away' && !homeCovered);

    // CLV if we bet at open
    // If we bet home at spreadOpen and close is spreadClose:
    // CLV = spreadOpen - spreadClose (positive if close moved in our favor)
    // Wait, if we bet HOME at -7 (open) and close is -10:
    //   The close is MORE favorable to home bettors who bet early
    //   CLV = openSpread - closeSpread = -7 - (-10) = +3 (good)
    // If close moved to -5: CLV = -7 - (-5) = -2 (bad, we could have gotten better number)
    const clvFromOpen = side === 'home'
      ? spreadOpen - spreadClose
      : -(spreadOpen - spreadClose);

    projections.push({
      gameId: game.cfbd_game_id,
      season: game.season,
      week: game.week,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      homeElo,
      awayElo,
      modelSpread,
      spreadOpen,
      spreadClose,
      lineMove,
      modelVsOpen,
      marketMovedWithUs,
      homeScore: game.home_score,
      awayScore: game.away_score,
      margin,
      side,
      won,
      clvFromOpen,
    });
  }

  console.log(`Total projections: ${projections.length}\n`);

  // ==========================================================================
  // ANALYSIS 1: Performance by edge bucket (ALL games)
  // ==========================================================================

  console.log('=== PERFORMANCE BY EDGE BUCKET (ALL GAMES) ===\n');

  projections.sort((a, b) => Math.abs(b.modelVsOpen) - Math.abs(a.modelVsOpen));

  const buckets = [
    { name: 'Top 5%', pct: 0.05 },
    { name: 'Top 10%', pct: 0.10 },
    { name: 'Top 20%', pct: 0.20 },
    { name: 'Top 50%', pct: 0.50 },
    { name: 'All', pct: 1.0 },
  ];

  console.log('Bucket   | N    | Avg Edge | Win%  | ROI    | Avg CLV');
  console.log('---------|------|----------|-------|--------|--------');

  for (const bucket of buckets) {
    const n = Math.floor(projections.length * bucket.pct);
    const slice = projections.slice(0, n);

    const avgEdge = slice.reduce((s, p) => s + Math.abs(p.modelVsOpen), 0) / slice.length;
    const winRate = slice.filter(p => p.won).length / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    const avgCLV = slice.reduce((s, p) => s + p.clvFromOpen, 0) / slice.length;

    console.log(
      `${bucket.name.padEnd(8)} | ${n.toString().padStart(4)} | ` +
      `${avgEdge.toFixed(2).padStart(8)} | ${(winRate * 100).toFixed(1).padStart(4)}% | ` +
      `${(roi * 100).toFixed(1).padStart(5)}% | ${avgCLV.toFixed(2).padStart(6)}`
    );
  }

  // ==========================================================================
  // ANALYSIS 2: Performance WITH opening-line filter
  // ==========================================================================

  console.log('\n=== PERFORMANCE WITH OPENING-LINE FILTER ===');
  console.log('(Only games where market moved WITH or stayed neutral)\n');

  const filtered = projections.filter(p => p.marketMovedWithUs || Math.abs(p.lineMove) < 0.5);
  filtered.sort((a, b) => Math.abs(b.modelVsOpen) - Math.abs(a.modelVsOpen));

  console.log(`Filtered games: ${filtered.length} (${(filtered.length / projections.length * 100).toFixed(0)}% of total)\n`);

  console.log('Bucket   | N    | Avg Edge | Win%  | ROI    | Avg CLV');
  console.log('---------|------|----------|-------|--------|--------');

  for (const bucket of buckets) {
    const n = Math.floor(filtered.length * bucket.pct);
    if (n === 0) continue;
    const slice = filtered.slice(0, n);

    const avgEdge = slice.reduce((s, p) => s + Math.abs(p.modelVsOpen), 0) / slice.length;
    const winRate = slice.filter(p => p.won).length / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    const avgCLV = slice.reduce((s, p) => s + p.clvFromOpen, 0) / slice.length;

    console.log(
      `${bucket.name.padEnd(8)} | ${n.toString().padStart(4)} | ` +
      `${avgEdge.toFixed(2).padStart(8)} | ${(winRate * 100).toFixed(1).padStart(4)}% | ` +
      `${(roi * 100).toFixed(1).padStart(5)}% | ${avgCLV.toFixed(2).padStart(6)}`
    );
  }

  // ==========================================================================
  // ANALYSIS 3: CLV distribution
  // ==========================================================================

  console.log('\n=== CLV DISTRIBUTION ===\n');

  const clvBuckets = [
    { name: 'CLV > 2', filter: (p: Projection) => p.clvFromOpen > 2 },
    { name: 'CLV 1-2', filter: (p: Projection) => p.clvFromOpen >= 1 && p.clvFromOpen <= 2 },
    { name: 'CLV 0-1', filter: (p: Projection) => p.clvFromOpen >= 0 && p.clvFromOpen < 1 },
    { name: 'CLV -1-0', filter: (p: Projection) => p.clvFromOpen >= -1 && p.clvFromOpen < 0 },
    { name: 'CLV < -1', filter: (p: Projection) => p.clvFromOpen < -1 },
  ];

  console.log('CLV Range | N    | % Total | Avg CLV');
  console.log('----------|------|---------|--------');

  for (const bucket of clvBuckets) {
    const matches = projections.filter(bucket.filter);
    const avgCLV = matches.length > 0
      ? matches.reduce((s, p) => s + p.clvFromOpen, 0) / matches.length
      : 0;

    console.log(
      `${bucket.name.padEnd(9)} | ${matches.length.toString().padStart(4)} | ` +
      `${(matches.length / projections.length * 100).toFixed(1).padStart(6)}% | ` +
      `${avgCLV.toFixed(2).padStart(6)}`
    );
  }

  // ==========================================================================
  // ANALYSIS 4: Top 10 edges
  // ==========================================================================

  console.log('\n=== TOP 10 EDGES (with filter) ===\n');
  console.log('Matchup                              | Model | Open  | Move  | CLV   | Won');
  console.log('-------------------------------------|-------|-------|-------|-------|----');

  for (const p of filtered.slice(0, 10)) {
    const matchup = `${p.awayTeam} @ ${p.homeTeam}`.substring(0, 36).padEnd(36);
    const model = p.modelSpread >= 0 ? `+${p.modelSpread.toFixed(1)}` : p.modelSpread.toFixed(1);
    const open = p.spreadOpen >= 0 ? `+${p.spreadOpen.toFixed(1)}` : p.spreadOpen.toFixed(1);
    const move = p.lineMove >= 0 ? `+${p.lineMove.toFixed(1)}` : p.lineMove.toFixed(1);
    const clv = p.clvFromOpen >= 0 ? `+${p.clvFromOpen.toFixed(1)}` : p.clvFromOpen.toFixed(1);

    console.log(
      `${matchup} | ${model.padStart(5)} | ${open.padStart(5)} | ${move.padStart(5)} | ${clv.padStart(5)} | ${p.won ? 'Y' : 'N'}`
    );
  }

  console.log('\n=== ANALYSIS COMPLETE ===');
}

runAnalysis().catch(console.error);

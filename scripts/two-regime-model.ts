/**
 * Two-Regime Model
 *
 * Regime 1 (Weeks 0-4): 70% prior, 30% in-season
 * Regime 2 (Weeks 5+): 30% prior, 70% in-season
 *
 * Uses:
 * - Week 0 composite priors (returning production, recruiting, etc.)
 * - In-season: Weekly Elo updates + PPA differential
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const CFBD_API_KEY = process.env.CFBD_API_KEY || '';

const HFA = 3.0;
const ELO_TO_SPREAD = 25;
const MEAN_RATING = 1500;

async function cfbdFetch(endpoint: string) {
  const response = await fetch(`https://apinext.collegefootballdata.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${CFBD_API_KEY}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) return null;
  return response.json();
}

interface Week0Rating {
  season: number;
  team: string;
  week0_rating: number;
  uncertainty_score: number;
}

interface TeamPPA {
  team: string;
  offensePPA: number;
  defensePPA: number;
  netPPA: number;  // offense - defense (positive is good)
}

async function loadWeek0Ratings(): Promise<Map<string, Map<number, Week0Rating>>> {
  const data = JSON.parse(fs.readFileSync('/tmp/week0_ratings.json', 'utf-8'));
  const map = new Map<string, Map<number, Week0Rating>>();
  for (const r of data) {
    const teamKey = r.team.toLowerCase();
    if (!map.has(teamKey)) map.set(teamKey, new Map());
    map.get(teamKey)!.set(r.season, r);
  }
  return map;
}

async function loadEloRatings(): Promise<Map<string, Map<string, number>>> {
  const allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('cfbd_elo_ratings')
      .select('*')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allData.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  const map = new Map<string, Map<string, number>>();
  for (const row of allData) {
    const teamKey = row.team_name.toLowerCase();
    if (!map.has(teamKey)) map.set(teamKey, new Map());
    map.get(teamKey)!.set(`${row.season}-${row.week}`, row.elo);
  }
  return map;
}

async function loadSeasonPPA(season: number): Promise<Map<string, TeamPPA>> {
  const data = await cfbdFetch(`/ppa/teams?year=${season}`);
  const map = new Map<string, TeamPPA>();

  if (data) {
    for (const team of data) {
      const teamKey = team.team.toLowerCase();
      map.set(teamKey, {
        team: team.team,
        offensePPA: team.offense?.overall || 0,
        defensePPA: team.defense?.overall || 0,
        netPPA: (team.offense?.overall || 0) - (team.defense?.overall || 0),
      });
    }
  }

  return map;
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

function getTwoRegimeRating(
  week0Map: Map<string, Map<number, Week0Rating>>,
  eloMap: Map<string, Map<string, number>>,
  ppaMap: Map<string, TeamPPA>,
  team: string,
  season: number,
  week: number
): { rating: number; uncertainty: number } {
  const teamKey = team.toLowerCase();

  // Get Week 0 prior
  const week0 = week0Map.get(teamKey)?.get(season);
  const priorRating = week0?.week0_rating || 1500;
  const baseUncertainty = week0?.uncertainty_score || 0.3;

  // Get in-season Elo
  let inSeasonRating: number | null = null;
  for (let w = week - 1; w >= 1; w--) {
    const key = `${season}-${w}`;
    const elo = eloMap.get(teamKey)?.get(key);
    if (elo) {
      inSeasonRating = elo;
      break;
    }
  }

  // Get PPA adjustment (convert to Elo-like scale)
  const ppa = ppaMap.get(teamKey);
  let ppaAdjustment = 0;
  if (ppa) {
    // Net PPA ranges roughly -0.3 to +0.3
    // Convert to Elo-like scale: multiply by ~500
    ppaAdjustment = ppa.netPPA * 500;
  }

  // Determine regime weights
  let priorWeight: number;
  let inSeasonWeight: number;

  if (week <= 4) {
    // Regime 1: priors-heavy
    priorWeight = 0.70 - (week - 1) * 0.10;  // Week 1: 0.70, Week 4: 0.40
    inSeasonWeight = 1 - priorWeight;
  } else {
    // Regime 2: performance-heavy
    priorWeight = 0.30;
    inSeasonWeight = 0.70;
  }

  // Calculate blended rating
  let rating: number;
  if (inSeasonRating !== null) {
    // Blend in-season Elo with PPA adjustment
    const inSeasonWithPPA = inSeasonRating + ppaAdjustment * 0.3;  // PPA is supplementary
    rating = priorWeight * priorRating + inSeasonWeight * inSeasonWithPPA;
  } else {
    // No in-season data yet, use prior only
    rating = priorRating;
  }

  // Adjust uncertainty based on week and data availability
  let uncertainty = baseUncertainty;
  if (week <= 2) uncertainty = Math.min(1, uncertainty + 0.2);
  else if (week <= 4) uncertainty = Math.min(1, uncertainty + 0.1);
  else if (week >= 8) uncertainty = Math.max(0, uncertainty - 0.1);

  return { rating: Math.round(rating), uncertainty };
}

function gradeBet(margin: number, spread: number, side: 'home' | 'away'): 'win' | 'loss' | 'push' {
  const homeResult = margin + spread;
  if (Math.abs(homeResult) < 0.001) return 'push';
  const homeCovered = homeResult > 0;
  if (side === 'home') return homeCovered ? 'win' : 'loss';
  return homeCovered ? 'loss' : 'win';
}

async function main() {
  console.log('=== TWO-REGIME MODEL TEST ===\n');

  const week0Map = await loadWeek0Ratings();
  const eloMap = await loadEloRatings();
  const lines = await loadBettingLines();

  // Load PPA for each season
  const ppa2022 = await loadSeasonPPA(2022);
  const ppa2023 = await loadSeasonPPA(2023);
  const ppa2024 = await loadSeasonPPA(2024);
  const ppaByYear = new Map<number, Map<string, TeamPPA>>([
    [2022, ppa2022],
    [2023, ppa2023],
    [2024, ppa2024],
  ]);

  console.log(`Lines: ${lines.length}`);
  console.log(`PPA 2022: ${ppa2022.size}, 2023: ${ppa2023.size}, 2024: ${ppa2024.size}\n`);

  interface Result {
    season: number;
    week: number;
    homeTeam: string;
    awayTeam: string;
    spreadOpen: number;
    spreadClose: number;
    margin: number;
    modelSpread: number;
    edge: number;
    effectiveEdge: number;
    uncertainty: number;
    side: 'home' | 'away';
    won: boolean;
  }

  const results: Result[] = [];

  for (const line of lines) {
    const ppaMap = ppaByYear.get(line.season) || new Map();

    const home = getTwoRegimeRating(week0Map, eloMap, ppaMap, line.home_team, line.season, line.week);
    const away = getTwoRegimeRating(week0Map, eloMap, ppaMap, line.away_team, line.season, line.week);

    if (!home || !away) continue;

    // Calculate spread
    const diff = home.rating - away.rating + HFA * ELO_TO_SPREAD;
    const modelSpread = -diff / ELO_TO_SPREAD;

    // Edge vs opening line
    const edge = modelSpread - line.spread_open;

    // Combined uncertainty
    const uncertainty = Math.min(1, (home.uncertainty + away.uncertainty) / 2);

    // Effective edge (shrunk by uncertainty)
    const effectiveEdge = edge * (1 - uncertainty);

    // Side selection
    const side: 'home' | 'away' = edge < 0 ? 'home' : 'away';

    // Grade
    const margin = line.home_score - line.away_score;
    const result = gradeBet(margin, line.spread_close, side);

    if (result !== 'push') {
      results.push({
        season: line.season,
        week: line.week,
        homeTeam: line.home_team,
        awayTeam: line.away_team,
        spreadOpen: line.spread_open,
        spreadClose: line.spread_close,
        margin,
        modelSpread,
        edge,
        effectiveEdge,
        uncertainty,
        side,
        won: result === 'win',
      });
    }
  }

  console.log(`Total results: ${results.length}\n`);

  // ==========================================================================
  // ANALYSIS BY RAW EDGE
  // ==========================================================================

  console.log('=== PERFORMANCE BY RAW EDGE ===\n');
  results.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  console.log('Bucket     | N    | Win%  | ROI    | Avg Unc');
  console.log('-----------|------|-------|--------|--------');

  for (const [name, pct] of [['Top 10%', 0.1], ['Top 20%', 0.2], ['Top 50%', 0.5], ['All', 1.0]] as const) {
    const n = Math.floor(results.length * pct);
    const slice = results.slice(0, n);
    const wins = slice.filter(r => r.won).length;
    const winRate = wins / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    const avgUnc = slice.reduce((s, r) => s + r.uncertainty, 0) / slice.length;
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1).padStart(5)}% | ${avgUnc.toFixed(2)}`);
  }

  // ==========================================================================
  // ANALYSIS BY EFFECTIVE EDGE (UNCERTAINTY-ADJUSTED)
  // ==========================================================================

  console.log('\n=== PERFORMANCE BY EFFECTIVE EDGE (UNCERTAINTY-ADJUSTED) ===\n');
  results.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));

  console.log('Bucket     | N    | Win%  | ROI    | Avg Raw | Avg Eff');
  console.log('-----------|------|-------|--------|---------|--------');

  for (const [name, pct] of [['Top 10%', 0.1], ['Top 20%', 0.2], ['Top 50%', 0.5], ['All', 1.0]] as const) {
    const n = Math.floor(results.length * pct);
    const slice = results.slice(0, n);
    const wins = slice.filter(r => r.won).length;
    const winRate = wins / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    const avgRaw = slice.reduce((s, r) => s + Math.abs(r.edge), 0) / slice.length;
    const avgEff = slice.reduce((s, r) => s + Math.abs(r.effectiveEdge), 0) / slice.length;
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1).padStart(5)}% | ${avgRaw.toFixed(1).padStart(7)} | ${avgEff.toFixed(1).padStart(6)}`);
  }

  // ==========================================================================
  // BY WEEK BUCKET
  // ==========================================================================

  console.log('\n=== PERFORMANCE BY WEEK (TOP 20% EDGES) ===\n');

  const weekBuckets = [
    { name: 'Weeks 1-4', filter: (r: Result) => r.week <= 4 },
    { name: 'Weeks 5-8', filter: (r: Result) => r.week >= 5 && r.week <= 8 },
    { name: 'Weeks 9+', filter: (r: Result) => r.week >= 9 },
  ];

  console.log('Week Range | N High | Win%  | ROI');
  console.log('-----------|--------|-------|-------');

  for (const bucket of weekBuckets) {
    const weekGames = results.filter(bucket.filter);
    weekGames.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    const top20 = weekGames.slice(0, Math.floor(weekGames.length * 0.2));

    if (top20.length === 0) continue;

    const wins = top20.filter(r => r.won).length;
    const winRate = wins / top20.length;
    const roi = winRate * 0.909 - (1 - winRate);

    console.log(`${bucket.name.padEnd(10)} | ${top20.length.toString().padStart(6)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1)}%`);
  }

  // ==========================================================================
  // 2024 HOLDOUT
  // ==========================================================================

  console.log('\n=== 2024 HOLDOUT ===\n');

  const test2024 = results.filter(r => r.season === 2024);
  test2024.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  const top10_2024 = test2024.slice(0, Math.floor(test2024.length * 0.1));
  const top20_2024 = test2024.slice(0, Math.floor(test2024.length * 0.2));

  const wins10 = top10_2024.filter(r => r.won).length;
  const wins20 = top20_2024.filter(r => r.won).length;

  console.log(`2024 Top 10%: ${(wins10 / top10_2024.length * 100).toFixed(1)}% win (N=${top10_2024.length})`);
  console.log(`2024 Top 20%: ${(wins20 / top20_2024.length * 100).toFixed(1)}% win (N=${top20_2024.length})`);

  // Compare to baseline (prior Elo only)
  console.log('\n--- Comparison Summary ---');
  console.log('Old (prior Elo only):  Top 20% = 36.5% win');
  console.log('Week 0 priors:         Top 20% = 44.8% win');
  console.log(`Two-regime model:      Top 20% = ${(wins20 / top20_2024.length * 100).toFixed(1)}% win`);

  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);

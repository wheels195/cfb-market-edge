/**
 * Test Week 0 Priors
 *
 * Compare:
 * 1. Old approach: prior season Elo
 * 2. New approach: Week 0 composite rating
 *
 * Goal: High-edge games should no longer be anti-predictive
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const HFA = 3.0;
const ELO_TO_SPREAD = 25;

interface Week0Rating {
  season: number;
  team: string;
  prior_elo: number;
  week0_rating: number;
  uncertainty_score: number;
  coaching_change: boolean;
  qb_transfers_out: number;
  percent_returning_ppa: number;
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

function getElo(
  eloMap: Map<string, Map<string, number>>,
  week0Map: Map<string, Map<number, Week0Rating>>,
  team: string,
  season: number,
  week: number,
  useWeek0: boolean
): number | null {
  const teamKey = team.toLowerCase();

  if (useWeek0 && week <= 4) {
    // For early season, use Week 0 rating as base
    const week0Rating = week0Map.get(teamKey)?.get(season);
    if (week0Rating) {
      // If we have in-season Elo updates, blend them
      const inSeasonElo = eloMap.get(teamKey)?.get(`${season}-${week - 1}`);
      if (inSeasonElo && week > 1) {
        // Gradually shift from Week0 to in-season
        const week0Weight = Math.max(0, 0.7 - (week - 1) * 0.15);  // Week 1: 0.7, Week 4: 0.25
        return Math.round(week0Weight * week0Rating.week0_rating + (1 - week0Weight) * inSeasonElo);
      }
      return week0Rating.week0_rating;
    }
  }

  // For later weeks or if no Week 0, use standard Elo lookup
  const ratings = eloMap.get(teamKey);
  if (!ratings) return null;

  const priorWeek = week - 1;
  if (priorWeek >= 1) {
    const key = `${season}-${priorWeek}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }

  // Prior season
  for (let w = 16; w >= 1; w--) {
    const key = `${season - 1}-${w}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }

  return null;
}

function getUncertainty(
  week0Map: Map<string, Map<number, Week0Rating>>,
  homeTeam: string,
  awayTeam: string,
  season: number,
  week: number
): number {
  const homeKey = homeTeam.toLowerCase();
  const awayKey = awayTeam.toLowerCase();

  const homeW0 = week0Map.get(homeKey)?.get(season);
  const awayW0 = week0Map.get(awayKey)?.get(season);

  let uncertainty = 0;

  // Week-based uncertainty
  if (week <= 2) uncertainty += 0.3;
  else if (week <= 4) uncertainty += 0.15;

  // Team-specific uncertainty
  if (homeW0) uncertainty += homeW0.uncertainty_score * 0.5;
  if (awayW0) uncertainty += awayW0.uncertainty_score * 0.5;

  return Math.min(1, uncertainty);
}

function gradeBet(margin: number, spread: number, side: 'home' | 'away'): 'win' | 'loss' | 'push' {
  const homeResult = margin + spread;
  if (Math.abs(homeResult) < 0.001) return 'push';
  const homeCovered = homeResult > 0;
  if (side === 'home') return homeCovered ? 'win' : 'loss';
  return homeCovered ? 'loss' : 'win';
}

async function main() {
  console.log('=== TEST WEEK 0 PRIORS ===\n');

  const week0Map = await loadWeek0Ratings();
  const eloMap = await loadEloRatings();
  const lines = await loadBettingLines();

  console.log(`Week 0 ratings: ${week0Map.size} teams`);
  console.log(`Betting lines: ${lines.length} games\n`);

  // Compare old vs new approach
  interface Result {
    game: any;
    oldSpread: number;
    newSpread: number;
    oldEdge: number;
    newEdge: number;
    uncertainty: number;
    oldSide: 'home' | 'away';
    newSide: 'home' | 'away';
    oldWon: boolean;
    newWon: boolean;
  }

  const results: Result[] = [];

  for (const line of lines) {
    // Old approach: prior season Elo
    const oldHomeElo = getElo(eloMap, week0Map, line.home_team, line.season, line.week, false);
    const oldAwayElo = getElo(eloMap, week0Map, line.away_team, line.season, line.week, false);

    // New approach: Week 0 priors
    const newHomeElo = getElo(eloMap, week0Map, line.home_team, line.season, line.week, true);
    const newAwayElo = getElo(eloMap, week0Map, line.away_team, line.season, line.week, true);

    if (!oldHomeElo || !oldAwayElo || !newHomeElo || !newAwayElo) continue;

    // Calculate spreads
    const oldDiff = oldHomeElo - oldAwayElo + HFA * ELO_TO_SPREAD;
    const oldSpread = -oldDiff / ELO_TO_SPREAD;

    const newDiff = newHomeElo - newAwayElo + HFA * ELO_TO_SPREAD;
    const newSpread = -newDiff / ELO_TO_SPREAD;

    // Edges
    const oldEdge = oldSpread - line.spread_open;
    const newEdge = newSpread - line.spread_open;

    // Uncertainty
    const uncertainty = getUncertainty(week0Map, line.home_team, line.away_team, line.season, line.week);

    // Sides
    const oldSide: 'home' | 'away' = oldEdge < 0 ? 'home' : 'away';
    const newSide: 'home' | 'away' = newEdge < 0 ? 'home' : 'away';

    // Results
    const margin = line.home_score - line.away_score;
    const oldResult = gradeBet(margin, line.spread_close, oldSide);
    const newResult = gradeBet(margin, line.spread_close, newSide);

    results.push({
      game: line,
      oldSpread,
      newSpread,
      oldEdge,
      newEdge,
      uncertainty,
      oldSide,
      newSide,
      oldWon: oldResult === 'win',
      newWon: newResult === 'win',
    });
  }

  console.log(`Total games analyzed: ${results.length}\n`);

  // ==========================================================================
  // COMPARISON BY EDGE BUCKET
  // ==========================================================================

  console.log('=== OLD vs NEW: BY EDGE BUCKET ===\n');

  // Sort by old edge
  results.sort((a, b) => Math.abs(b.oldEdge) - Math.abs(a.oldEdge));

  console.log('OLD APPROACH (Prior Season Elo):');
  console.log('Bucket     | N    | Win%  | ROI');
  console.log('-----------|------|-------|-------');

  for (const [name, pct] of [['Top 10%', 0.1], ['Top 20%', 0.2], ['All', 1.0]] as const) {
    const n = Math.floor(results.length * pct);
    const slice = results.slice(0, n);
    const wins = slice.filter(r => r.oldWon).length;
    const losses = slice.filter(r => !r.oldWon).length;
    const winRate = wins / (wins + losses);
    const roi = winRate * 0.909 - (1 - winRate);
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1)}%`);
  }

  // Sort by new edge
  results.sort((a, b) => Math.abs(b.newEdge) - Math.abs(a.newEdge));

  console.log('\nNEW APPROACH (Week 0 Priors):');
  console.log('Bucket     | N    | Win%  | ROI');
  console.log('-----------|------|-------|-------');

  for (const [name, pct] of [['Top 10%', 0.1], ['Top 20%', 0.2], ['All', 1.0]] as const) {
    const n = Math.floor(results.length * pct);
    const slice = results.slice(0, n);
    const wins = slice.filter(r => r.newWon).length;
    const losses = slice.filter(r => !r.newWon).length;
    const winRate = wins / (wins + losses);
    const roi = winRate * 0.909 - (1 - winRate);
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1)}%`);
  }

  // ==========================================================================
  // EDGE SIZE COMPARISON
  // ==========================================================================

  console.log('\n=== EDGE SIZE DISTRIBUTION ===\n');

  const oldHighEdge = results.filter(r => Math.abs(r.oldEdge) >= 10).length;
  const newHighEdge = results.filter(r => Math.abs(r.newEdge) >= 10).length;

  console.log(`Games with |edge| >= 10 pts:`);
  console.log(`  Old approach: ${oldHighEdge} (${(oldHighEdge / results.length * 100).toFixed(1)}%)`);
  console.log(`  New approach: ${newHighEdge} (${(newHighEdge / results.length * 100).toFixed(1)}%)`);

  if (newHighEdge < oldHighEdge) {
    console.log(`  → Reduced by ${oldHighEdge - newHighEdge} games (${((oldHighEdge - newHighEdge) / oldHighEdge * 100).toFixed(0)}%)`);
  }

  // ==========================================================================
  // EARLY SEASON SPECIFIC
  // ==========================================================================

  console.log('\n=== WEEKS 1-4 PERFORMANCE ===\n');

  const earlySeason = results.filter(r => r.game.week <= 4);

  // Old approach
  const oldEarlyHighEdge = earlySeason.filter(r => Math.abs(r.oldEdge) >= 10);
  const oldEarlyWins = oldEarlyHighEdge.filter(r => r.oldWon).length;
  const oldEarlyWinRate = oldEarlyWins / oldEarlyHighEdge.length;

  // New approach
  const newEarlyHighEdge = earlySeason.filter(r => Math.abs(r.newEdge) >= 10);
  const newEarlyWins = newEarlyHighEdge.filter(r => r.newWon).length;
  const newEarlyWinRate = newEarlyHighEdge.length > 0 ? newEarlyWins / newEarlyHighEdge.length : 0;

  console.log('High-edge games (|edge| >= 10) in Weeks 1-4:');
  console.log(`  Old: ${oldEarlyHighEdge.length} games, ${(oldEarlyWinRate * 100).toFixed(1)}% win`);
  console.log(`  New: ${newEarlyHighEdge.length} games, ${(newEarlyWinRate * 100).toFixed(1)}% win`);

  // ==========================================================================
  // UNCERTAINTY-ADJUSTED PERFORMANCE
  // ==========================================================================

  console.log('\n=== UNCERTAINTY-ADJUSTED BETTING ===\n');
  console.log('Rule: Shrink effective edge by uncertainty');
  console.log('effective_edge = raw_edge * (1 - uncertainty)\n');

  // Calculate effective edges
  const withEffectiveEdge = results.map(r => ({
    ...r,
    effectiveEdge: r.newEdge * (1 - r.uncertainty),
  }));

  // Sort by effective edge
  withEffectiveEdge.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));

  console.log('UNCERTAINTY-ADJUSTED:');
  console.log('Bucket     | N    | Win%  | ROI');
  console.log('-----------|------|-------|-------');

  for (const [name, pct] of [['Top 10%', 0.1], ['Top 20%', 0.2], ['All', 1.0]] as const) {
    const n = Math.floor(withEffectiveEdge.length * pct);
    const slice = withEffectiveEdge.slice(0, n);
    const wins = slice.filter(r => r.newWon).length;
    const losses = slice.filter(r => !r.newWon).length;
    const winRate = wins / (wins + losses);
    const roi = winRate * 0.909 - (1 - winRate);
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1)}%`);
  }

  // ==========================================================================
  // 2024 HOLDOUT
  // ==========================================================================

  console.log('\n=== 2024 HOLDOUT TEST ===\n');

  const test2024 = results.filter(r => r.game.season === 2024);

  // Old approach
  test2024.sort((a, b) => Math.abs(b.oldEdge) - Math.abs(a.oldEdge));
  const oldTop20_2024 = test2024.slice(0, Math.floor(test2024.length * 0.2));
  const oldWins2024 = oldTop20_2024.filter(r => r.oldWon).length;
  const oldWinRate2024 = oldWins2024 / oldTop20_2024.length;

  // New approach
  test2024.sort((a, b) => Math.abs(b.newEdge) - Math.abs(a.newEdge));
  const newTop20_2024 = test2024.slice(0, Math.floor(test2024.length * 0.2));
  const newWins2024 = newTop20_2024.filter(r => r.newWon).length;
  const newWinRate2024 = newWins2024 / newTop20_2024.length;

  console.log('2024 Top 20% edges:');
  console.log(`  Old approach: ${(oldWinRate2024 * 100).toFixed(1)}% win (N=${oldTop20_2024.length})`);
  console.log(`  New approach: ${(newWinRate2024 * 100).toFixed(1)}% win (N=${newTop20_2024.length})`);

  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);

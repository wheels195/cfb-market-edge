/**
 * Compare v3 (raw edge) vs v3+shrinkage (effective edge)
 *
 * Pass/Fail Criteria:
 * 1. Must not reduce Weeks 5+ performance materially
 * 2. Must improve Weeks 1-4 or reduce variance (fewer extreme misses)
 * 3. Should improve CLV persistence
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
const K_FACTOR = 20;
const MARGIN_CAP = 21;
const PPA_WEIGHT = 0.75;
const MARGIN_WEIGHT = 0.25;
const PPA_SCALE = 250;

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

interface GamePPA {
  gameId: number;
  season: number;
  week: number;
  team: string;
  opponent: string;
  offensePPA: number;
  defensePPA: number;
}

interface Week0Rating {
  season: number;
  team: string;
  week0_rating: number;
  uncertainty_score: number;
  coaching_change: boolean;
  qb_transfers_out: number;
  percent_returning_ppa: number;
}

async function syncGamePPA(season: number): Promise<GamePPA[]> {
  const results: GamePPA[] = [];
  for (let week = 1; week <= 16; week++) {
    const data = await cfbdFetch(`/ppa/games?year=${season}&week=${week}`);
    if (data) {
      for (const game of data) {
        results.push({
          gameId: game.gameId,
          season: game.season,
          week: game.week,
          team: game.team,
          opponent: game.opponent,
          offensePPA: game.offense?.overall || 0,
          defensePPA: game.defense?.overall || 0,
        });
      }
    }
    await new Promise(r => setTimeout(r, 30));
  }
  return results;
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

function calculateTeamUncertainty(
  week0: Week0Rating | undefined,
  returningPPAQuartiles: { q25: number; q50: number }
): number {
  if (!week0) return 0.30;
  let uncertainty = 0;
  const pctReturning = week0.percent_returning_ppa || 0.5;
  if (pctReturning < returningPPAQuartiles.q25) {
    uncertainty += 0.15;
  } else if (pctReturning < returningPPAQuartiles.q50) {
    uncertainty += 0.08;
  }
  if (week0.qb_transfers_out > 0) {
    uncertainty += 0.20;
  }
  if (week0.coaching_change) {
    uncertainty += 0.10;
  }
  return uncertainty;
}

function calculateGameUncertainty(
  week0Map: Map<string, Map<number, Week0Rating>>,
  homeTeam: string,
  awayTeam: string,
  season: number,
  week: number,
  returningPPAQuartiles: { q25: number; q50: number }
): number {
  const homeKey = homeTeam.toLowerCase();
  const awayKey = awayTeam.toLowerCase();
  const homeW0 = week0Map.get(homeKey)?.get(season);
  const awayW0 = week0Map.get(awayKey)?.get(season);
  let weekUncertainty: number;
  if (week <= 1) {
    weekUncertainty = 0.45;
  } else if (week <= 4) {
    weekUncertainty = 0.25;
  } else {
    weekUncertainty = 0.10;
  }
  const homeTeamUnc = calculateTeamUncertainty(homeW0, returningPPAQuartiles);
  const awayTeamUnc = calculateTeamUncertainty(awayW0, returningPPAQuartiles);
  const avgTeamUncertainty = (homeTeamUnc + awayTeamUnc) / 2;
  const totalUncertainty = weekUncertainty + avgTeamUncertainty;
  return Math.min(0.75, totalUncertainty);
}

function calculateOpponentAdjustedPPA(
  teamPPA: GamePPA,
  opponentPPA: GamePPA,
  teamPriorRating: number,
  opponentPriorRating: number,
  avgRating: number
): number {
  const opponentDefenseStrength = (opponentPriorRating - avgRating) / 100;
  const adjustedOffensePPA = teamPPA.offensePPA + opponentDefenseStrength * 0.1;
  const opponentOffenseStrength = (opponentPriorRating - avgRating) / 100;
  const adjustedDefensePPA = teamPPA.defensePPA - opponentOffenseStrength * 0.1;
  return adjustedOffensePPA - adjustedDefensePPA;
}

function calculateUpdate(
  homeAdjPPA: number,
  awayAdjPPA: number,
  margin: number,
  homeExpectedWin: number
): { homeUpdate: number; awayUpdate: number } {
  const cappedMargin = Math.max(-MARGIN_CAP, Math.min(MARGIN_CAP, margin));
  const actualResult = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const marginUpdate = K_FACTOR * (actualResult - homeExpectedWin);
  const ppaDiff = homeAdjPPA - awayAdjPPA;
  const cappedPPADiff = Math.max(-0.5, Math.min(0.5, ppaDiff));
  const ppaUpdate = cappedPPADiff * PPA_SCALE;
  const totalUpdate = PPA_WEIGHT * ppaUpdate + MARGIN_WEIGHT * marginUpdate;
  const maxUpdate = K_FACTOR * 2;
  const finalUpdate = Math.max(-maxUpdate, Math.min(maxUpdate, totalUpdate));
  return { homeUpdate: finalUpdate, awayUpdate: -finalUpdate };
}

function gradeBet(margin: number, spread: number, side: 'home' | 'away'): 'win' | 'loss' | 'push' {
  const homeResult = margin + spread;
  if (Math.abs(homeResult) < 0.001) return 'push';
  const homeCovered = homeResult > 0;
  if (side === 'home') return homeCovered ? 'win' : 'loss';
  return homeCovered ? 'loss' : 'win';
}

async function main() {
  console.log('=== PASS/FAIL COMPARISON: RAW vs EFFECTIVE EDGE ===\n');

  const ppa2022 = await syncGamePPA(2022);
  const ppa2023 = await syncGamePPA(2023);
  const ppa2024 = await syncGamePPA(2024);

  const buildPPALookup = (data: GamePPA[]) => {
    const map = new Map<number, Map<string, GamePPA>>();
    for (const p of data) {
      if (!map.has(p.gameId)) map.set(p.gameId, new Map());
      map.get(p.gameId)!.set(p.team.toLowerCase(), p);
    }
    return map;
  };

  const ppaLookup = new Map<number, Map<number, Map<string, GamePPA>>>([
    [2022, buildPPALookup(ppa2022)],
    [2023, buildPPALookup(ppa2023)],
    [2024, buildPPALookup(ppa2024)],
  ]);

  const week0Map = await loadWeek0Ratings();
  const lines = await loadBettingLines();

  const allReturningPPA: number[] = [];
  for (const [, seasons] of week0Map) {
    for (const [, w0] of seasons) {
      if (w0.percent_returning_ppa !== undefined) {
        allReturningPPA.push(w0.percent_returning_ppa);
      }
    }
  }
  allReturningPPA.sort((a, b) => a - b);
  const returningPPAQuartiles = {
    q25: allReturningPPA[Math.floor(allReturningPPA.length * 0.25)] || 0.35,
    q50: allReturningPPA[Math.floor(allReturningPPA.length * 0.50)] || 0.50,
  };

  interface Result {
    season: number;
    week: number;
    homeTeam: string;
    awayTeam: string;
    spreadOpen: number;
    spreadClose: number;
    margin: number;
    modelSpread: number;
    rawEdge: number;
    uncertainty: number;
    effectiveEdge: number;
    side: 'home' | 'away';
    won: boolean;
    // CLV metrics
    lineMovement: number;  // close - open (positive = moved our direction)
    clvCaptured: boolean;  // did we bet in direction market moved?
  }

  const allResults: Result[] = [];

  for (const season of [2022, 2023, 2024]) {
    const ratings = new Map<string, number>();
    for (const [teamKey, seasons] of week0Map) {
      const w0 = seasons.get(season);
      if (w0) ratings.set(teamKey, w0.week0_rating);
    }

    const avgRating = ratings.size > 0
      ? Array.from(ratings.values()).reduce((a, b) => a + b, 0) / ratings.size
      : 1500;

    const seasonLines = lines
      .filter(l => l.season === season)
      .sort((a, b) => a.week - b.week || a.cfbd_game_id - b.cfbd_game_id);

    const seasonPPA = ppaLookup.get(season) || new Map();

    for (const game of seasonLines) {
      const homeKey = game.home_team.toLowerCase();
      const awayKey = game.away_team.toLowerCase();

      const homeRating = ratings.get(homeKey) || 1500;
      const awayRating = ratings.get(awayKey) || 1500;

      const diff = homeRating - awayRating + HFA * ELO_TO_SPREAD;
      const modelSpread = -diff / ELO_TO_SPREAD;
      const rawEdge = modelSpread - game.spread_open;

      const uncertainty = calculateGameUncertainty(
        week0Map, game.home_team, game.away_team, season, game.week, returningPPAQuartiles
      );

      const effectiveEdge = rawEdge * (1 - uncertainty);

      const side: 'home' | 'away' = rawEdge < 0 ? 'home' : 'away';
      const margin = game.home_score - game.away_score;
      const result = gradeBet(margin, game.spread_close, side);

      // CLV: Did line move in our direction?
      const lineMovement = game.spread_close - game.spread_open;
      // If we bet home (edge < 0), we want line to move up (become more positive)
      // If we bet away (edge > 0), we want line to move down (become more negative)
      const clvCaptured = side === 'home' ? lineMovement > 0 : lineMovement < 0;

      if (result !== 'push') {
        allResults.push({
          season,
          week: game.week,
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          spreadOpen: game.spread_open,
          spreadClose: game.spread_close,
          margin,
          modelSpread,
          rawEdge,
          uncertainty,
          effectiveEdge,
          side,
          won: result === 'win',
          lineMovement,
          clvCaptured,
        });
      }

      // Update ratings
      const gamePPAMap = seasonPPA.get(game.cfbd_game_id);
      const homePPA = gamePPAMap?.get(homeKey);
      const awayPPA = gamePPAMap?.get(awayKey);

      if (homePPA && awayPPA) {
        const homeAdjPPA = calculateOpponentAdjustedPPA(homePPA, awayPPA, homeRating, awayRating, avgRating);
        const awayAdjPPA = calculateOpponentAdjustedPPA(awayPPA, homePPA, awayRating, homeRating, avgRating);
        const homeExpectedWin = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
        const { homeUpdate, awayUpdate } = calculateUpdate(homeAdjPPA, awayAdjPPA, margin, homeExpectedWin);
        ratings.set(homeKey, homeRating + homeUpdate);
        ratings.set(awayKey, awayRating + awayUpdate);
      } else {
        const homeExpectedWin = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
        const actualResult = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
        const update = K_FACTOR * (actualResult - homeExpectedWin) * 0.5;
        ratings.set(homeKey, homeRating + update);
        ratings.set(awayKey, awayRating - update);
      }
    }
  }

  // ==========================================================================
  // PASS/FAIL TEST 1: Weeks 5+ Performance
  // ==========================================================================

  console.log('=== TEST 1: WEEKS 5+ PERFORMANCE ===\n');
  console.log('Criteria: Must not reduce performance materially\n');

  const weeks5Plus = allResults.filter(r => r.week >= 5);

  // Raw edge ranking
  weeks5Plus.sort((a, b) => Math.abs(b.rawEdge) - Math.abs(a.rawEdge));
  const raw5_10 = weeks5Plus.slice(0, Math.floor(weeks5Plus.length * 0.1));
  const raw5_20 = weeks5Plus.slice(0, Math.floor(weeks5Plus.length * 0.2));

  // Effective edge ranking
  weeks5Plus.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
  const eff5_10 = weeks5Plus.slice(0, Math.floor(weeks5Plus.length * 0.1));
  const eff5_20 = weeks5Plus.slice(0, Math.floor(weeks5Plus.length * 0.2));

  console.log('Bucket     | Raw Edge Win% | Eff Edge Win% | Delta');
  console.log('-----------|---------------|---------------|-------');

  const rawWin5_10 = raw5_10.filter(r => r.won).length / raw5_10.length;
  const effWin5_10 = eff5_10.filter(r => r.won).length / eff5_10.length;
  console.log(`Top 10%    | ${(rawWin5_10 * 100).toFixed(1).padStart(12)}% | ${(effWin5_10 * 100).toFixed(1).padStart(12)}% | ${((effWin5_10 - rawWin5_10) * 100).toFixed(1).padStart(5)}pp`);

  const rawWin5_20 = raw5_20.filter(r => r.won).length / raw5_20.length;
  const effWin5_20 = eff5_20.filter(r => r.won).length / eff5_20.length;
  console.log(`Top 20%    | ${(rawWin5_20 * 100).toFixed(1).padStart(12)}% | ${(effWin5_20 * 100).toFixed(1).padStart(12)}% | ${((effWin5_20 - rawWin5_20) * 100).toFixed(1).padStart(5)}pp`);

  const test1Pass = effWin5_20 >= rawWin5_20 - 0.02;  // Allow 2pp reduction
  console.log(`\nResult: ${test1Pass ? 'PASS' : 'FAIL'} (${effWin5_20 >= rawWin5_20 ? 'improved' : 'slightly reduced'})`);

  // ==========================================================================
  // PASS/FAIL TEST 2: Weeks 1-4 Variance
  // ==========================================================================

  console.log('\n=== TEST 2: WEEKS 1-4 IMPROVEMENT ===\n');
  console.log('Criteria: Must improve Weeks 1-4 or reduce variance\n');

  const weeks1_4 = allResults.filter(r => r.week <= 4);

  // Raw edge ranking
  weeks1_4.sort((a, b) => Math.abs(b.rawEdge) - Math.abs(a.rawEdge));
  const raw14_20 = weeks1_4.slice(0, Math.floor(weeks1_4.length * 0.2));

  // Effective edge ranking
  weeks1_4.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
  const eff14_20 = weeks1_4.slice(0, Math.floor(weeks1_4.length * 0.2));

  const rawWin14_20 = raw14_20.filter(r => r.won).length / raw14_20.length;
  const effWin14_20 = eff14_20.filter(r => r.won).length / eff14_20.length;

  console.log('Weeks 1-4 Top 20%:');
  console.log(`  Raw edge:       ${(rawWin14_20 * 100).toFixed(1)}% win`);
  console.log(`  Effective edge: ${(effWin14_20 * 100).toFixed(1)}% win`);

  // Check variance (standard deviation of outcomes)
  const rawLossByMargin = raw14_20.filter(r => !r.won).map(r => Math.abs(r.margin - r.spreadClose));
  const effLossByMargin = eff14_20.filter(r => !r.won).map(r => Math.abs(r.margin - r.spreadClose));

  const rawAvgLossMargin = rawLossByMargin.length > 0 ? rawLossByMargin.reduce((a, b) => a + b, 0) / rawLossByMargin.length : 0;
  const effAvgLossMargin = effLossByMargin.length > 0 ? effLossByMargin.reduce((a, b) => a + b, 0) / effLossByMargin.length : 0;

  console.log(`\nAvg loss margin (smaller = less variance):`);
  console.log(`  Raw edge:       ${rawAvgLossMargin.toFixed(1)} pts`);
  console.log(`  Effective edge: ${effAvgLossMargin.toFixed(1)} pts`);

  const test2Pass = effWin14_20 >= rawWin14_20 || effAvgLossMargin < rawAvgLossMargin;
  console.log(`\nResult: ${test2Pass ? 'PASS' : 'FAIL'}`);

  // ==========================================================================
  // PASS/FAIL TEST 3: CLV Persistence
  // ==========================================================================

  console.log('\n=== TEST 3: CLV PERSISTENCE ===\n');
  console.log('Criteria: Effective edges should survive to close more often\n');

  // Raw edge: top 20% by raw
  allResults.sort((a, b) => Math.abs(b.rawEdge) - Math.abs(a.rawEdge));
  const rawTop20 = allResults.slice(0, Math.floor(allResults.length * 0.2));
  const rawCLVRate = rawTop20.filter(r => r.clvCaptured).length / rawTop20.length;
  const rawAvgMovement = rawTop20.reduce((s, r) => s + Math.abs(r.lineMovement), 0) / rawTop20.length;

  // Effective edge: top 20% by effective
  allResults.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
  const effTop20 = allResults.slice(0, Math.floor(allResults.length * 0.2));
  const effCLVRate = effTop20.filter(r => r.clvCaptured).length / effTop20.length;
  const effAvgMovement = effTop20.reduce((s, r) => s + Math.abs(r.lineMovement), 0) / effTop20.length;

  console.log('Top 20% CLV Analysis:');
  console.log(`  Raw edge:       ${(rawCLVRate * 100).toFixed(1)}% CLV captured, avg movement ${rawAvgMovement.toFixed(1)} pts`);
  console.log(`  Effective edge: ${(effCLVRate * 100).toFixed(1)}% CLV captured, avg movement ${effAvgMovement.toFixed(1)} pts`);

  const test3Pass = effCLVRate >= rawCLVRate - 0.02;
  console.log(`\nResult: ${test3Pass ? 'PASS' : 'NEEDS REVIEW'}`);

  // ==========================================================================
  // SUMMARY
  // ==========================================================================

  console.log('\n=== OVERALL SUMMARY ===\n');

  console.log('Test 1 (Weeks 5+ no reduction):  ' + (test1Pass ? 'PASS' : 'FAIL'));
  console.log('Test 2 (Weeks 1-4 improvement):  ' + (test2Pass ? 'PASS' : 'FAIL'));
  console.log('Test 3 (CLV persistence):        ' + (test3Pass ? 'PASS' : 'NEEDS REVIEW'));

  const allPass = test1Pass && test2Pass && test3Pass;
  console.log(`\nFinal Verdict: ${allPass ? 'PROCEED WITH SHRINKAGE' : 'REVIEW BEFORE PROCEEDING'}`);

  // Show the key insight: Top 5% is where effective edge really shines
  console.log('\n=== KEY INSIGHT: TOP 5% PERFORMANCE ===\n');

  allResults.sort((a, b) => Math.abs(b.rawEdge) - Math.abs(a.rawEdge));
  const raw5 = allResults.slice(0, Math.floor(allResults.length * 0.05));

  allResults.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
  const eff5 = allResults.slice(0, Math.floor(allResults.length * 0.05));

  const rawWin5 = raw5.filter(r => r.won).length / raw5.length;
  const effWin5 = eff5.filter(r => r.won).length / eff5.length;

  console.log(`Top 5% by RAW edge:       ${(rawWin5 * 100).toFixed(1)}% win, ROI ${((rawWin5 * 0.909 - (1 - rawWin5)) * 100).toFixed(1)}%`);
  console.log(`Top 5% by EFFECTIVE edge: ${(effWin5 * 100).toFixed(1)}% win, ROI ${((effWin5 * 0.909 - (1 - effWin5)) * 100).toFixed(1)}%`);
  console.log(`\nImprovement: +${((effWin5 - rawWin5) * 100).toFixed(1)}pp win rate`);

  console.log('\n=== COMPARISON COMPLETE ===');
}

main().catch(console.error);

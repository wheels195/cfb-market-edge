/**
 * CBB Smart Filter Backtest
 *
 * Tests four scenarios:
 * A) Baseline: Flat betting all games
 * B) Confirmation Filter: Only bet when model and market agree on direction
 * C) Tiered Sizing: Variable sizing based on confidence level
 * D) Fade Strong Disagree: Bet WITH market when model strongly disagrees
 *
 * Goal: Reduce losses from -6.5% baseline by filtering bad bets
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// ============ TYPES ============

interface BacktestGame {
  game_id: string;
  season: number;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  spread_t60: number;
  home_net_rating: number;
  away_net_rating: number;
}

type BetConfidence =
  | 'high_confirm'
  | 'medium_confirm'
  | 'low_confirm'
  | 'neutral'
  | 'disagree'
  | 'strong_disagree';

interface ClassifiedBet {
  game: BacktestGame;
  modelSpread: number;
  marketSpread: number;
  confidence: BetConfidence;
  modelSide: 'home' | 'away';
  marketSide: 'home' | 'away';
  edge: number; // absolute difference
}

interface BetResult {
  won: boolean;
  units: number;
  profit: number;
  confidence: BetConfidence;
  betSide: 'home' | 'away';
}

interface ScenarioResult {
  name: string;
  totalBets: number;
  totalUnits: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  roi: number;
  breakdown: Map<BetConfidence, { bets: number; wins: number; profit: number }>;
}

// ============ MODEL CONFIG ============

const MODEL_CONFIG = {
  K: 3.5,        // Rating divisor (from prior testing)
  HFA: 3.5,      // Home field advantage
};

// ============ DATA LOADING ============

async function fetchAllRows<T>(
  table: string,
  select: string,
  filters?: { column: string; op: string; value: any }[]
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);

    if (filters) {
      for (const f of filters) {
        if (f.op === 'not.is') {
          query = query.not(f.column, 'is', f.value);
        } else if (f.op === 'in') {
          query = query.in(f.column, f.value);
        } else if (f.op === 'eq') {
          query = query.eq(f.column, f.value);
        }
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allData = allData.concat(data as T[]);
      offset += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMore = false;
    }
  }

  return allData;
}

async function buildDataset(): Promise<BacktestGame[]> {
  console.log('\n=== Loading Data ===\n');

  // Get betting lines with T-60 spreads
  const bettingLines = await fetchAllRows<any>(
    'cbb_betting_lines',
    'game_id, spread_t60',
    [{ column: 'spread_t60', op: 'not.is', value: null }]
  );
  console.log(`Found ${bettingLines.length} games with T-60 spreads`);

  const linesByGame = new Map<string, number>();
  for (const line of bettingLines) {
    linesByGame.set(line.game_id, line.spread_t60);
  }

  // Get completed games
  const gameData = await fetchAllRows<any>(
    'cbb_games',
    'id, season, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );
  console.log(`Found ${gameData.length} completed games`);

  // Get team ratings
  const ratings = await fetchAllRows<any>('cbb_team_ratings', 'team_id, season, net_rating');
  const ratingsMap = new Map<string, Map<number, number>>();
  for (const r of ratings) {
    if (!ratingsMap.has(r.team_id)) {
      ratingsMap.set(r.team_id, new Map());
    }
    ratingsMap.get(r.team_id)!.set(r.season, r.net_rating);
  }
  console.log(`Loaded ${ratings.length} team ratings`);

  // Build dataset
  const games: BacktestGame[] = [];

  for (const game of gameData) {
    if (game.season !== 2023 && game.season !== 2024) continue;
    if (!game.away_team_id) continue;

    const line = linesByGame.get(game.id);
    if (line === undefined) continue;

    const priorSeason = game.season - 1;
    const homeRating = ratingsMap.get(game.home_team_id)?.get(priorSeason);
    const awayRating = ratingsMap.get(game.away_team_id)?.get(priorSeason);

    if (homeRating === undefined || awayRating === undefined) continue;

    games.push({
      game_id: game.id,
      season: game.season,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
      home_score: game.home_score,
      away_score: game.away_score,
      spread_t60: line,
      home_net_rating: homeRating,
      away_net_rating: awayRating,
    });
  }

  console.log(`Final dataset: ${games.length} games\n`);
  return games;
}

// ============ MODEL LOGIC ============

function calculateModelSpread(homeNet: number, awayNet: number): number {
  // Positive spread = home is underdog (away favored)
  // Negative spread = home is favorite
  return (awayNet - homeNet) / MODEL_CONFIG.K - MODEL_CONFIG.HFA;
}

function classifyBet(modelSpread: number, marketSpread: number): ClassifiedBet['confidence'] {
  // Determine which side each prefers
  // Negative spread = home favored, Positive spread = away favored
  const modelSide: 'home' | 'away' = modelSpread < 0 ? 'home' : 'away';
  const marketSide: 'home' | 'away' = marketSpread < 0 ? 'home' : 'away';

  const diff = Math.abs(marketSpread - modelSpread);
  const sameDirection = modelSide === marketSide;

  if (!sameDirection) {
    return diff > 5 ? 'strong_disagree' : 'disagree';
  }

  // Same direction - classify by how much MORE the market likes the side
  if (diff < 1) return 'neutral';
  if (diff < 2.5) return 'low_confirm';
  if (diff < 4) return 'medium_confirm';
  return 'high_confirm';
}

function classifyAllBets(games: BacktestGame[]): ClassifiedBet[] {
  return games.map(game => {
    const modelSpread = calculateModelSpread(game.home_net_rating, game.away_net_rating);
    const marketSpread = game.spread_t60;
    const confidence = classifyBet(modelSpread, marketSpread);

    const modelSide: 'home' | 'away' = modelSpread < 0 ? 'home' : 'away';
    const marketSide: 'home' | 'away' = marketSpread < 0 ? 'home' : 'away';

    return {
      game,
      modelSpread,
      marketSpread,
      confidence,
      modelSide,
      marketSide,
      edge: Math.abs(marketSpread - modelSpread),
    };
  });
}

// ============ BETTING SCENARIOS ============

function determineBetOutcome(game: BacktestGame, betSide: 'home' | 'away'): boolean {
  const actualMargin = game.home_score - game.away_score;
  const spread = game.spread_t60;

  // Push handling
  if (actualMargin === -spread) return false; // Treat as loss for simplicity

  if (betSide === 'home') {
    // Betting home: home needs to cover (beat by more than spread)
    return actualMargin > -spread;
  } else {
    // Betting away: away needs to cover
    return actualMargin < -spread;
  }
}

// Scenario A: Baseline - Bet all games flat (1 unit each, with model direction)
function runScenarioA(classified: ClassifiedBet[]): ScenarioResult {
  const results: BetResult[] = [];
  const breakdown = new Map<BetConfidence, { bets: number; wins: number; profit: number }>();

  for (const bet of classified) {
    // Bet the model's side
    const betSide = bet.modelSide;
    const won = determineBetOutcome(bet.game, betSide);
    const profit = won ? 0.91 : -1.0;

    results.push({
      won,
      units: 1,
      profit,
      confidence: bet.confidence,
      betSide,
    });

    // Track breakdown
    if (!breakdown.has(bet.confidence)) {
      breakdown.set(bet.confidence, { bets: 0, wins: 0, profit: 0 });
    }
    const b = breakdown.get(bet.confidence)!;
    b.bets++;
    if (won) b.wins++;
    b.profit += profit;
  }

  const wins = results.filter(r => r.won).length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);

  return {
    name: 'A) Baseline (flat, all games)',
    totalBets: results.length,
    totalUnits: results.length,
    wins,
    losses: results.length - wins,
    winRate: wins / results.length,
    totalProfit,
    roi: totalProfit / results.length,
    breakdown,
  };
}

// Scenario B: Confirmation Filter - Only bet when model and market agree
function runScenarioB(classified: ClassifiedBet[]): ScenarioResult {
  const results: BetResult[] = [];
  const breakdown = new Map<BetConfidence, { bets: number; wins: number; profit: number }>();

  const bettableConfidences: BetConfidence[] = ['high_confirm', 'medium_confirm', 'low_confirm'];

  for (const bet of classified) {
    if (!bettableConfidences.includes(bet.confidence)) continue;

    // Bet the market's side (which agrees with model)
    const betSide = bet.marketSide;
    const won = determineBetOutcome(bet.game, betSide);
    const profit = won ? 0.91 : -1.0;

    results.push({
      won,
      units: 1,
      profit,
      confidence: bet.confidence,
      betSide,
    });

    if (!breakdown.has(bet.confidence)) {
      breakdown.set(bet.confidence, { bets: 0, wins: 0, profit: 0 });
    }
    const b = breakdown.get(bet.confidence)!;
    b.bets++;
    if (won) b.wins++;
    b.profit += profit;
  }

  const wins = results.filter(r => r.won).length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);

  return {
    name: 'B) Confirmation Filter (skip disagree)',
    totalBets: results.length,
    totalUnits: results.length,
    wins,
    losses: results.length - wins,
    winRate: results.length > 0 ? wins / results.length : 0,
    totalProfit,
    roi: results.length > 0 ? totalProfit / results.length : 0,
    breakdown,
  };
}

// Scenario C: Tiered Sizing
function runScenarioC(classified: ClassifiedBet[]): ScenarioResult {
  const results: BetResult[] = [];
  const breakdown = new Map<BetConfidence, { bets: number; wins: number; profit: number }>();

  const sizing: Record<BetConfidence, number> = {
    'high_confirm': 2.0,
    'medium_confirm': 1.0,
    'low_confirm': 0.5,
    'neutral': 0,
    'disagree': 0,
    'strong_disagree': 0,
  };

  for (const bet of classified) {
    const units = sizing[bet.confidence];
    if (units === 0) continue;

    // Bet the market's side (which agrees with model)
    const betSide = bet.marketSide;
    const won = determineBetOutcome(bet.game, betSide);
    const profit = won ? 0.91 * units : -1.0 * units;

    results.push({
      won,
      units,
      profit,
      confidence: bet.confidence,
      betSide,
    });

    if (!breakdown.has(bet.confidence)) {
      breakdown.set(bet.confidence, { bets: 0, wins: 0, profit: 0 });
    }
    const b = breakdown.get(bet.confidence)!;
    b.bets++;
    if (won) b.wins++;
    b.profit += profit;
  }

  const wins = results.filter(r => r.won).length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const totalUnits = results.reduce((sum, r) => sum + r.units, 0);

  return {
    name: 'C) Tiered Sizing (2x/1x/0.5x)',
    totalBets: results.length,
    totalUnits,
    wins,
    losses: results.length - wins,
    winRate: results.length > 0 ? wins / results.length : 0,
    totalProfit,
    roi: totalUnits > 0 ? totalProfit / totalUnits : 0,
    breakdown,
  };
}

// Scenario D: Fade Strong Disagree
function runScenarioD(classified: ClassifiedBet[]): ScenarioResult {
  const results: BetResult[] = [];
  const breakdown = new Map<BetConfidence, { bets: number; wins: number; profit: number }>();

  // Only bet when model STRONGLY disagrees - but bet WITH market (against model)
  for (const bet of classified) {
    if (bet.confidence !== 'strong_disagree') continue;

    // Bet WITH market (AGAINST model)
    const betSide = bet.marketSide;
    const won = determineBetOutcome(bet.game, betSide);
    const profit = won ? 0.91 : -1.0;

    results.push({
      won,
      units: 1,
      profit,
      confidence: bet.confidence,
      betSide,
    });

    if (!breakdown.has(bet.confidence)) {
      breakdown.set(bet.confidence, { bets: 0, wins: 0, profit: 0 });
    }
    const b = breakdown.get(bet.confidence)!;
    b.bets++;
    if (won) b.wins++;
    b.profit += profit;
  }

  const wins = results.filter(r => r.won).length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);

  return {
    name: 'D) Fade Strong Disagree',
    totalBets: results.length,
    totalUnits: results.length,
    wins,
    losses: results.length - wins,
    winRate: results.length > 0 ? wins / results.length : 0,
    totalProfit,
    roi: results.length > 0 ? totalProfit / results.length : 0,
    breakdown,
  };
}

// ============ REPORTING ============

function printScenarioResult(result: ScenarioResult) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${result.name}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`Bets: ${result.totalBets} | Units: ${result.totalUnits.toFixed(1)}`);
  console.log(`Record: ${result.wins}-${result.losses} (${(result.winRate * 100).toFixed(1)}%)`);
  console.log(`Profit: ${result.totalProfit > 0 ? '+' : ''}${result.totalProfit.toFixed(2)} units`);
  console.log(`ROI: ${(result.roi * 100).toFixed(2)}%`);

  if (result.breakdown.size > 0) {
    console.log('\n  By Confidence:');
    const order: BetConfidence[] = ['high_confirm', 'medium_confirm', 'low_confirm', 'neutral', 'disagree', 'strong_disagree'];
    for (const conf of order) {
      const b = result.breakdown.get(conf);
      if (b && b.bets > 0) {
        const winRate = b.wins / b.bets;
        const roi = b.profit / b.bets;
        console.log(`    ${conf.padEnd(16)}: ${b.bets.toString().padStart(4)} bets | ${b.wins}-${b.bets - b.wins} (${(winRate * 100).toFixed(1)}%) | ROI: ${(roi * 100).toFixed(1)}%`);
      }
    }
  }
}

function printConfidenceDistribution(classified: ClassifiedBet[]) {
  console.log('\n=== Confidence Distribution ===\n');

  const counts = new Map<BetConfidence, number>();
  for (const bet of classified) {
    counts.set(bet.confidence, (counts.get(bet.confidence) || 0) + 1);
  }

  const order: BetConfidence[] = ['high_confirm', 'medium_confirm', 'low_confirm', 'neutral', 'disagree', 'strong_disagree'];
  for (const conf of order) {
    const count = counts.get(conf) || 0;
    const pct = (count / classified.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / classified.length * 40));
    console.log(`${conf.padEnd(16)}: ${count.toString().padStart(5)} (${pct.padStart(5)}%) ${bar}`);
  }
}

function printComparison(results: ScenarioResult[]) {
  console.log('\n' + '═'.repeat(70));
  console.log('                    SCENARIO COMPARISON');
  console.log('═'.repeat(70));

  console.log('\n  Scenario                          Bets    Units   Win%    ROI');
  console.log('  ' + '─'.repeat(64));

  for (const r of results) {
    const name = r.name.substring(0, 32).padEnd(32);
    const bets = r.totalBets.toString().padStart(5);
    const units = r.totalUnits.toFixed(1).padStart(7);
    const winRate = (r.winRate * 100).toFixed(1).padStart(5) + '%';
    const roi = (r.roi >= 0 ? '+' : '') + (r.roi * 100).toFixed(1) + '%';
    console.log(`  ${name}  ${bets}  ${units}  ${winRate}  ${roi.padStart(7)}`);
  }

  // Find best
  const bestByRoi = results.reduce((best, r) => r.roi > best.roi ? r : best);
  console.log('\n  Best by ROI: ' + bestByRoi.name);

  // Compare to baseline
  const baseline = results.find(r => r.name.includes('Baseline'));
  if (baseline) {
    console.log('\n  Comparison to Baseline:');
    for (const r of results) {
      if (r === baseline) continue;
      const roiDiff = (r.roi - baseline.roi) * 100;
      const betReduction = ((baseline.totalBets - r.totalBets) / baseline.totalBets * 100);
      console.log(`    ${r.name.substring(0, 30)}: ROI ${roiDiff >= 0 ? '+' : ''}${roiDiff.toFixed(1)}pp, ${betReduction.toFixed(0)}% fewer bets`);
    }
  }
}

// ============ MAIN ============

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║            CBB SMART FILTER BACKTEST                               ║');
  console.log('║  Testing: Confirmation Filters & Tiered Sizing                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  console.log('\nModel Config:');
  console.log(`  K (rating divisor): ${MODEL_CONFIG.K}`);
  console.log(`  HFA (home advantage): ${MODEL_CONFIG.HFA}`);

  // Load data
  const games = await buildDataset();
  if (games.length === 0) {
    console.log('No games found. Exiting.');
    return;
  }

  // Classify all bets
  const classified = classifyAllBets(games);

  // Show distribution
  printConfidenceDistribution(classified);

  // Run all scenarios
  const results: ScenarioResult[] = [];

  console.log('\n' + '═'.repeat(70));
  console.log('                      SCENARIO RESULTS');
  console.log('═'.repeat(70));

  const scenarioA = runScenarioA(classified);
  printScenarioResult(scenarioA);
  results.push(scenarioA);

  const scenarioB = runScenarioB(classified);
  printScenarioResult(scenarioB);
  results.push(scenarioB);

  const scenarioC = runScenarioC(classified);
  printScenarioResult(scenarioC);
  results.push(scenarioC);

  const scenarioD = runScenarioD(classified);
  printScenarioResult(scenarioD);
  results.push(scenarioD);

  // Print comparison
  printComparison(results);

  // Assessment
  console.log('\n' + '═'.repeat(70));
  console.log('                        ASSESSMENT');
  console.log('═'.repeat(70));

  const bestRoi = Math.max(...results.map(r => r.roi));

  if (bestRoi > 0.02) {
    console.log('\n✅ PROMISING: Best scenario shows > +2% ROI');
    console.log('   Further investigation warranted.');
  } else if (bestRoi > -0.02) {
    console.log('\n⚠️ MARGINAL: Best scenario near break-even');
    console.log('   May reduce losses but unlikely to be profitable.');
  } else if (bestRoi > -0.045) {
    console.log('\n⚠️ IMPROVED: Better than random (-4.5%) but still losing');
    console.log('   Filtering helps but market is efficient.');
  } else {
    console.log('\n❌ NO IMPROVEMENT: All scenarios worse than random');
    console.log('   Smart filtering does not help in CBB.');
  }

  // Check if confirmation beats baseline
  const baselineRoi = scenarioA.roi;
  const confirmRoi = scenarioB.roi;
  const tieredRoi = scenarioC.roi;

  console.log('\nKey Findings:');
  console.log(`  • Baseline ROI: ${(baselineRoi * 100).toFixed(1)}%`);
  console.log(`  • Confirmation Filter ROI: ${(confirmRoi * 100).toFixed(1)}% (${confirmRoi > baselineRoi ? 'BETTER' : 'WORSE'})`);
  console.log(`  • Tiered Sizing ROI: ${(tieredRoi * 100).toFixed(1)}% (${tieredRoi > baselineRoi ? 'BETTER' : 'WORSE'})`);

  if (confirmRoi > baselineRoi) {
    console.log('\n→ Confirmation filter DOES improve results by filtering bad bets.');
  } else {
    console.log('\n→ Confirmation filter does NOT help. Model disagreement is not predictive.');
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);

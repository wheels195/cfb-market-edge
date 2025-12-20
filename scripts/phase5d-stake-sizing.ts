/**
 * Phase 5D: Stake Sizing
 *
 * PROD_BASELINE_V1: Top 10/week, exclude spreads 3-7
 *
 * Test stake sizing strategies:
 * 1. Flat staking (1 unit per bet) - baseline
 * 2. 0.25 Kelly
 * 3. Max weekly exposure cap (≤5 units)
 *
 * Goal: Survivability > Growth
 */

import { createClient } from '@supabase/supabase-js';
import {
  projectSpread as v1ProjectSpread,
  calculateEdge,
  didCover,
  impliedProbability,
} from '../src/lib/models/v1-elo-model';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface BacktestGame {
  eventId: string;
  week: number;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeMargin: number;
  modelSpreadHome: number;
  edge: number;
  absEdge: number;
  side: 'home' | 'away';
}

async function loadData(): Promise<BacktestGame[]> {
  console.log('Loading test data (2024)...');

  let allEvents: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('events')
      .select(`id, commence_time, home_team_id, away_team_id`)
      .eq('status', 'final')
      .order('commence_time')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allEvents = allEvents.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  const resultMap = new Map<string, { homeScore: number; awayScore: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('results').select('event_id, home_score, away_score').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) resultMap.set(r.event_id, { homeScore: r.home_score, awayScore: r.away_score });
    offset += 1000;
    if (data.length < 1000) break;
  }

  const eloMap = new Map<string, number>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('team_elo_snapshots').select('team_id, season, week, elo').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) eloMap.set(`${s.team_id}-${s.season}-${s.week}`, s.elo);
    offset += 1000;
    if (data.length < 1000) break;
  }

  const closingMap = new Map<string, { spreadHome: number; priceHome: number; priceAway: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('odds_ticks').select('event_id, side, spread_points_home, price_american')
      .eq('tick_type', 'close').eq('market_type', 'spread').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const t of data) {
      const existing = closingMap.get(t.event_id) || { spreadHome: 0, priceHome: -110, priceAway: -110 };
      existing.spreadHome = t.spread_points_home;
      if (t.side === 'home') existing.priceHome = t.price_american;
      else existing.priceAway = t.price_american;
      closingMap.set(t.event_id, existing);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  const getSeason = (date: string): number => {
    const d = new Date(date);
    return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  };

  const getWeek = (date: string, season: number): number => {
    const d = new Date(date);
    const month = d.getMonth();
    if (month === 0) return 16;
    if (month === 7) return d.getDate() < 25 ? 0 : 1;
    const sept1 = new Date(season, 8, 1).getTime();
    const daysSince = Math.floor((d.getTime() - sept1) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(16, 1 + Math.floor(daysSince / 7)));
  };

  const games: BacktestGame[] = [];

  for (const event of allEvents) {
    const season = getSeason(event.commence_time);
    if (season !== 2024) continue;

    const week = getWeek(event.commence_time, season);
    const homeTeamId = event.home_team_id;
    const awayTeamId = event.away_team_id;

    const result = resultMap.get(event.id);
    const closing = closingMap.get(event.id);
    if (!result || !closing) continue;

    const eloWeek = Math.max(0, week - 1);
    const homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`) || eloMap.get(`${homeTeamId}-${season}-0`);
    const awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`) || eloMap.get(`${awayTeamId}-${season}-0`);
    if (!homeElo || !awayElo) continue;

    const { modelSpreadHome } = v1ProjectSpread(homeElo, awayElo);
    const { edge, side } = calculateEdge(closing.spreadHome, modelSpreadHome);

    games.push({
      eventId: event.id,
      week,
      marketSpreadHome: closing.spreadHome,
      spreadPriceHome: closing.priceHome,
      spreadPriceAway: closing.priceAway,
      homeMargin: result.homeScore - result.awayScore,
      modelSpreadHome,
      edge,
      absEdge: Math.abs(edge),
      side,
    });
  }

  console.log(`  Loaded ${games.length} games\n`);
  return games;
}

// Apply PROD_BASELINE_V1 filter
function applyBaselineFilter(game: BacktestGame): boolean {
  const absSpread = Math.abs(game.marketSpreadHome);
  return absSpread <= 3 || absSpread >= 7;
}

// Calculate decimal odds from American odds
function americanToDecimal(american: number): number {
  if (american > 0) {
    return 1 + american / 100;
  } else {
    return 1 + 100 / Math.abs(american);
  }
}

// Calculate Kelly stake (fraction of bankroll)
// Kelly = (p * b - q) / b where p = win prob, q = 1-p, b = decimal odds - 1
function kellyStake(winProb: number, decimalOdds: number, fraction: number = 1): number {
  const b = decimalOdds - 1;
  const q = 1 - winProb;
  const kelly = (winProb * b - q) / b;

  // Cap at 0 (never bet negative Kelly) and apply fraction
  return Math.max(0, kelly * fraction);
}

// Estimate win probability from edge (rough approximation)
// Using logistic function: prob = 1 / (1 + exp(-edge * k))
// Calibrated so 0 edge = 50%, larger edges increase probability
function edgeToWinProb(absEdge: number): number {
  // Simple linear approximation: base 50% + edge contribution
  // Each point of edge adds ~2% win probability (capped at 70%)
  const prob = 0.50 + absEdge * 0.02;
  return Math.min(0.70, Math.max(0.50, prob));
}

interface StakeResult {
  label: string;
  bets: number;
  wins: number;
  losses: number;
  totalStaked: number;
  totalProfit: number;
  roi: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  finalBankroll: number;
  weeklyReturns: number[];
}

type StakeStrategy = 'flat' | 'kelly25' | 'capped5';

function runStakingBacktest(
  games: BacktestGame[],
  strategy: StakeStrategy,
  startingBankroll: number = 10000
): StakeResult {
  const byWeek = new Map<number, BacktestGame[]>();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week)!.push(g);
  }

  let bankroll = startingBankroll;
  let wins = 0, losses = 0;
  let totalStaked = 0;
  let totalProfit = 0;
  let peak = startingBankroll;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const weeklyReturns: number[] = [];

  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  const UNIT_SIZE = 100; // $100 per unit for flat betting

  for (const week of weeks) {
    let weekGames = byWeek.get(week)!;

    // Sort by absolute edge descending
    weekGames.sort((a, b) => b.absEdge - a.absEdge);

    // Take top 10
    weekGames = weekGames.slice(0, 10);

    // Apply baseline filter (exclude spreads 3-7)
    weekGames = weekGames.filter(applyBaselineFilter);

    let weekStaked = 0;
    let weekProfit = 0;
    const weekStartBankroll = bankroll;

    // For capped strategy, calculate stakes first then scale if needed
    let stakes: number[] = [];

    for (const game of weekGames) {
      const priceAmerican = game.side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
      const decimalOdds = americanToDecimal(priceAmerican);
      const estWinProb = edgeToWinProb(game.absEdge);

      let stake: number;

      switch (strategy) {
        case 'flat':
          stake = UNIT_SIZE; // 1 unit = $100
          break;
        case 'kelly25':
          const kellyFrac = kellyStake(estWinProb, decimalOdds, 0.25);
          stake = Math.max(UNIT_SIZE * 0.5, bankroll * kellyFrac); // Min 0.5 units
          stake = Math.min(stake, bankroll * 0.05); // Max 5% of bankroll per bet
          break;
        case 'capped5':
          stake = UNIT_SIZE; // Start with 1 unit each
          break;
        default:
          stake = UNIT_SIZE;
      }

      stakes.push(stake);
    }

    // For capped strategy, scale down if total > 5 units
    if (strategy === 'capped5') {
      const totalUnits = stakes.reduce((a, b) => a + b, 0) / UNIT_SIZE;
      if (totalUnits > 5) {
        const scale = 5 / totalUnits;
        stakes = stakes.map(s => s * scale);
      }
    }

    // Execute bets
    for (let i = 0; i < weekGames.length; i++) {
      const game = weekGames[i];
      const stake = stakes[i];
      const priceAmerican = game.side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;

      const covered = didCover(game.homeMargin, game.marketSpreadHome, game.side);

      if (covered === true) {
        wins++;
        // Calculate winnings based on American odds
        let profit: number;
        if (priceAmerican > 0) {
          profit = stake * (priceAmerican / 100);
        } else {
          profit = stake * (100 / Math.abs(priceAmerican));
        }
        bankroll += profit;
        weekProfit += profit;
        totalProfit += profit;
      } else if (covered === false) {
        losses++;
        bankroll -= stake;
        weekProfit -= stake;
        totalProfit -= stake;
      }
      // Push = no change

      if (covered !== null) {
        totalStaked += stake;
        weekStaked += stake;
      }
    }

    // Track weekly return
    if (weekStartBankroll > 0) {
      weeklyReturns.push((bankroll - weekStartBankroll) / weekStartBankroll);
    }

    // Track drawdown
    if (bankroll > peak) peak = bankroll;
    const dd = peak - bankroll;
    if (dd > maxDrawdown) maxDrawdown = dd;
    const ddPct = dd / peak;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;

  let label: string;
  switch (strategy) {
    case 'flat': label = 'Flat (1 unit)'; break;
    case 'kelly25': label = '0.25 Kelly'; break;
    case 'capped5': label = 'Capped 5u/week'; break;
    default: label = strategy;
  }

  return {
    label,
    bets: wins + losses,
    wins,
    losses,
    totalStaked,
    totalProfit,
    roi,
    maxDrawdown,
    maxDrawdownPct,
    finalBankroll: bankroll,
    weeklyReturns,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              PHASE 5D: STAKE SIZING                            ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ PROD_BASELINE_V1: Top 10/week, exclude spreads 3-7             ║');
  console.log('║ Starting bankroll: $10,000                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const games = await loadData();

  const STARTING_BANKROLL = 10000;

  // Run all strategies
  const flat = runStakingBacktest(games, 'flat', STARTING_BANKROLL);
  const kelly25 = runStakingBacktest(games, 'kelly25', STARTING_BANKROLL);
  const capped5 = runStakingBacktest(games, 'capped5', STARTING_BANKROLL);

  const results = [flat, kelly25, capped5];

  console.log('=== STAKE SIZING COMPARISON ===\n');
  console.log('Strategy         Bets   Staked      Profit     ROI       MaxDD      MaxDD%    Final');
  console.log('─'.repeat(90));

  for (const r of results) {
    console.log(
      `${r.label.padEnd(17)}` +
      `${r.bets.toString().padEnd(7)}` +
      `$${r.totalStaked.toFixed(0).padEnd(10)}` +
      `$${r.totalProfit.toFixed(0).padEnd(11)}` +
      `${r.roi.toFixed(2)}%`.padEnd(10) +
      `$${r.maxDrawdown.toFixed(0).padEnd(11)}` +
      `${(r.maxDrawdownPct * 100).toFixed(1)}%`.padEnd(10) +
      `$${r.finalBankroll.toFixed(0)}`
    );
  }

  // Weekly equity curves
  console.log('\n=== WEEKLY EQUITY CURVE ===\n');
  console.log('Week    Flat        Kelly25     Capped5');
  console.log('─'.repeat(50));

  let flatEquity = STARTING_BANKROLL;
  let kellyEquity = STARTING_BANKROLL;
  let cappedEquity = STARTING_BANKROLL;

  const weeks = [...new Set(games.map(g => g.week))].sort((a, b) => a - b);

  for (let i = 0; i < flat.weeklyReturns.length; i++) {
    flatEquity *= (1 + flat.weeklyReturns[i]);
    kellyEquity *= (1 + kelly25.weeklyReturns[i]);
    cappedEquity *= (1 + capped5.weeklyReturns[i]);

    console.log(
      `W${weeks[i].toString().padEnd(6)}` +
      `$${flatEquity.toFixed(0).padEnd(12)}` +
      `$${kellyEquity.toFixed(0).padEnd(12)}` +
      `$${cappedEquity.toFixed(0)}`
    );
  }

  // Risk metrics
  console.log('\n=== RISK METRICS ===\n');

  for (const r of results) {
    const avgWeeklyReturn = r.weeklyReturns.reduce((a, b) => a + b, 0) / r.weeklyReturns.length;
    const variance = r.weeklyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgWeeklyReturn, 2), 0) / r.weeklyReturns.length;
    const volatility = Math.sqrt(variance);
    const sharpe = volatility > 0 ? avgWeeklyReturn / volatility : 0;

    console.log(`${r.label}:`);
    console.log(`  Avg weekly return: ${(avgWeeklyReturn * 100).toFixed(2)}%`);
    console.log(`  Weekly volatility: ${(volatility * 100).toFixed(2)}%`);
    console.log(`  Sharpe ratio: ${sharpe.toFixed(2)}`);
    console.log(`  Max drawdown: ${(r.maxDrawdownPct * 100).toFixed(1)}%`);
    console.log('');
  }

  // Verdict
  console.log('═'.repeat(60));
  console.log('RECOMMENDATION');
  console.log('═'.repeat(60));

  console.log('\nFor survivability and simplicity:');
  console.log('→ USE: Flat staking (1 unit = $100 per bet)');
  console.log('→ Max weekly exposure: ~10 units ($1,000)');
  console.log('');
  console.log('Flat staking is recommended because:');
  console.log('  1. Simple and consistent');
  console.log('  2. No Kelly estimation errors');
  console.log('  3. Predictable risk exposure');
  console.log('  4. Easier to track and audit');
}

main().catch(console.error);

/**
 * Backtest: Elo vs Market-Anchored Model Comparison
 *
 * Compares two approaches:
 * 1. Pure Elo - Uses Elo ratings only (current production)
 * 2. Market-Anchored - Market line + adjustments (conference, situational, line movement)
 *
 * Uses historical data from 2022-2024 to determine which model performs better.
 */

import { createClient } from '@supabase/supabase-js';
import { calculateConferenceAdjustment, getBowlGameAdjustment } from '../src/lib/models/conference-strength';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Model coefficients (same as dual-projections.ts)
const COEFFICIENTS = {
  conferenceStrengthWeight: 0.4,
  maxReasonableEdge: 5.0,
};

interface GameResult {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  actualMargin: number; // positive = home won by X
  marketSpread: number; // home spread from market
  eloSpread: number; // home spread from Elo
  anchoredSpread: number; // home spread from market-anchored
  adjustments: {
    conference: number;
    bowlGame: number;
    total: number;
  };
}

interface BetResult {
  model: 'elo' | 'anchored';
  gameId: string;
  betSide: 'home' | 'away';
  spreadBet: number;
  edge: number;
  covered: boolean;
  profit: number; // assuming -110 odds
}

async function getHistoricalGames(seasons: number[]): Promise<GameResult[]> {
  const results: GameResult[] = [];

  for (const season of seasons) {
    console.log(`\nFetching ${season} season data...`);

    // Get games with results and betting lines
    const { data: games } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .eq('season', season)
      .not('spread_open', 'is', null)
      .not('home_score', 'is', null);

    if (!games || games.length === 0) {
      console.log(`  No games found for ${season}`);
      continue;
    }

    console.log(`  Found ${games.length} games with spreads and results`);

    // Get Elo snapshots for this season
    const { data: eloSnapshots } = await supabase
      .from('team_elo_snapshots')
      .select('team_id, elo, week, season')
      .eq('season', season);

    // Build Elo lookup: team_id -> week -> elo
    const eloByTeamWeek = new Map<string, Map<number, number>>();
    for (const snap of eloSnapshots || []) {
      if (!eloByTeamWeek.has(snap.team_id)) {
        eloByTeamWeek.set(snap.team_id, new Map());
      }
      eloByTeamWeek.get(snap.team_id)!.set(snap.week, snap.elo);
    }

    // Get team ID mapping
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name');

    const teamNameToId = new Map<string, string>();
    for (const team of teams || []) {
      teamNameToId.set(team.name.toLowerCase(), team.id);
    }

    for (const game of games) {
      const homeTeamId = teamNameToId.get(game.home_team?.toLowerCase() || '');
      const awayTeamId = teamNameToId.get(game.away_team?.toLowerCase() || '');

      // Get Elo for week before game (point-in-time)
      const priorWeek = Math.max(1, (game.week || 1) - 1);
      const homeElo = homeTeamId ? (eloByTeamWeek.get(homeTeamId)?.get(priorWeek) || 1500) : 1500;
      const awayElo = awayTeamId ? (eloByTeamWeek.get(awayTeamId)?.get(priorWeek) || 1500) : 1500;

      // Calculate Elo spread
      const eloDiff = homeElo - awayElo;
      const eloSpread = -(eloDiff / 25 + 2.5); // negative means home favored

      // Market spread (from opening line)
      const marketSpread = game.spread_open;

      // Calculate market-anchored adjustments
      let confAdj = 0;
      let bowlAdj = 0;

      try {
        const confResult = calculateConferenceAdjustment(game.home_team || '', game.away_team || '');
        confAdj = confResult.adjustment * COEFFICIENTS.conferenceStrengthWeight;
      } catch (e) {
        // Skip conference adjustment on error
      }

      // Bowl game check (December/January games after week 13)
      const gameDate = new Date(game.start_date || `${season}-09-01`);
      const isBowl = (game.week || 0) > 13 || gameDate.getMonth() === 11 || gameDate.getMonth() === 0;
      if (isBowl) {
        bowlAdj = -2.0; // Reduce home field advantage
      }

      const totalAdj = Math.max(-COEFFICIENTS.maxReasonableEdge,
                        Math.min(COEFFICIENTS.maxReasonableEdge, confAdj + bowlAdj));
      const anchoredSpread = marketSpread + totalAdj;

      const actualMargin = (game.home_score || 0) - (game.away_score || 0);

      results.push({
        gameId: game.cfbd_game_id,
        season: game.season,
        week: game.week || 0,
        homeTeam: game.home_team || '',
        awayTeam: game.away_team || '',
        homeScore: game.home_score || 0,
        awayScore: game.away_score || 0,
        actualMargin,
        marketSpread,
        eloSpread: Math.round(eloSpread * 2) / 2,
        anchoredSpread: Math.round(anchoredSpread * 2) / 2,
        adjustments: {
          conference: confAdj,
          bowlGame: bowlAdj,
          total: totalAdj,
        },
      });
    }
  }

  return results;
}

function simulateBets(games: GameResult[], model: 'elo' | 'anchored', edgeThreshold: number): BetResult[] {
  const bets: BetResult[] = [];

  for (const game of games) {
    const modelSpread = model === 'elo' ? game.eloSpread : game.anchoredSpread;
    const edge = game.marketSpread - modelSpread;

    // Only bet if edge exceeds threshold
    if (Math.abs(edge) < edgeThreshold) continue;

    // Determine bet side
    // If edge > 0: market spread is higher than model → bet home
    // If edge < 0: market spread is lower than model → bet away
    const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
    const spreadBet = betSide === 'home' ? game.marketSpread : -game.marketSpread;

    // Did the bet cover?
    // Home bet: actual margin > -spreadBet (or actualMargin + spreadBet > 0)
    // Away bet: actual margin < spreadBet (or spreadBet - actualMargin > 0)
    let covered: boolean;
    if (betSide === 'home') {
      covered = game.actualMargin + game.marketSpread > 0;
    } else {
      covered = -game.actualMargin - game.marketSpread > 0;
    }

    // Handle push
    const pushMargin = betSide === 'home'
      ? game.actualMargin + game.marketSpread
      : -game.actualMargin - game.marketSpread;

    let profit: number;
    if (Math.abs(pushMargin) < 0.01) {
      profit = 0; // Push
    } else if (covered) {
      profit = 100 / 1.1; // Win at -110
    } else {
      profit = -100; // Loss
    }

    bets.push({
      model,
      gameId: game.gameId,
      betSide,
      spreadBet,
      edge: Math.abs(edge),
      covered,
      profit,
    });
  }

  return bets;
}

function analyzeResults(bets: BetResult[], label: string) {
  const wins = bets.filter(b => b.profit > 0).length;
  const losses = bets.filter(b => b.profit < 0).length;
  const pushes = bets.filter(b => b.profit === 0).length;
  const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0);
  const totalStaked = bets.filter(b => b.profit !== 0).length * 100;
  const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

  console.log(`\n${label}`);
  console.log('='.repeat(50));
  console.log(`Total bets: ${bets.length}`);
  console.log(`Record: ${wins}-${losses}-${pushes}`);
  console.log(`Win rate: ${winRate.toFixed(1)}%`);
  console.log(`Profit: $${totalProfit.toFixed(2)}`);
  console.log(`ROI: ${roi.toFixed(2)}%`);
  console.log(`Avg edge: ${(bets.reduce((sum, b) => sum + b.edge, 0) / bets.length).toFixed(2)} pts`);

  return { wins, losses, pushes, totalProfit, roi, winRate, bets: bets.length };
}

async function main() {
  console.log('='.repeat(60));
  console.log('BACKTEST: Elo vs Market-Anchored Model');
  console.log('='.repeat(60));

  // Get historical games (2022-2024)
  const games = await getHistoricalGames([2022, 2023, 2024]);
  console.log(`\nTotal games loaded: ${games.length}`);

  // Show adjustment distribution
  const adjustments = games.map(g => g.adjustments.total);
  const avgAdj = adjustments.reduce((a, b) => a + b, 0) / adjustments.length;
  const nonZeroAdj = adjustments.filter(a => Math.abs(a) > 0.01).length;
  console.log(`\nAdjustment stats:`);
  console.log(`  Non-zero adjustments: ${nonZeroAdj} / ${games.length} (${(nonZeroAdj/games.length*100).toFixed(1)}%)`);
  console.log(`  Avg adjustment: ${avgAdj.toFixed(2)} pts`);

  // Test different edge thresholds
  const thresholds = [0, 1, 2, 2.5, 3, 4, 5];

  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON BY EDGE THRESHOLD');
  console.log('='.repeat(60));

  const comparison: { threshold: number; elo: any; anchored: any }[] = [];

  for (const threshold of thresholds) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`THRESHOLD: ${threshold}+ pts edge`);
    console.log('─'.repeat(60));

    const eloBets = simulateBets(games, 'elo', threshold);
    const anchoredBets = simulateBets(games, 'anchored', threshold);

    const eloResults = analyzeResults(eloBets, 'Pure Elo Model');
    const anchoredResults = analyzeResults(anchoredBets, 'Market-Anchored Model');

    comparison.push({ threshold, elo: eloResults, anchored: anchoredResults });

    // Comparison
    const roiDiff = anchoredResults.roi - eloResults.roi;
    const winRateDiff = anchoredResults.winRate - eloResults.winRate;
    console.log(`\n→ Anchored vs Elo:`);
    console.log(`  ROI diff: ${roiDiff > 0 ? '+' : ''}${roiDiff.toFixed(2)}%`);
    console.log(`  Win rate diff: ${winRateDiff > 0 ? '+' : ''}${winRateDiff.toFixed(2)}%`);
  }

  // Summary table
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(60));
  console.log('\nThreshold | Elo ROI  | Anchored ROI | Diff    | Better');
  console.log('-'.repeat(55));
  for (const c of comparison) {
    const diff = c.anchored.roi - c.elo.roi;
    const better = diff > 0.5 ? 'ANCHORED' : diff < -0.5 ? 'ELO' : 'TIE';
    console.log(
      `${c.threshold.toString().padStart(6)}+ pts | ` +
      `${c.elo.roi.toFixed(1).padStart(7)}% | ` +
      `${c.anchored.roi.toFixed(1).padStart(11)}% | ` +
      `${(diff > 0 ? '+' : '') + diff.toFixed(1).padStart(6)}% | ` +
      `${better}`
    );
  }

  // Recommendation
  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDATION');
  console.log('='.repeat(60));

  // Find threshold with best improvement
  const bestImprovement = comparison.reduce((best, c) => {
    const diff = c.anchored.roi - c.elo.roi;
    return diff > best.diff ? { threshold: c.threshold, diff } : best;
  }, { threshold: 0, diff: -Infinity });

  if (bestImprovement.diff > 1) {
    console.log(`\nMarket-Anchored model shows +${bestImprovement.diff.toFixed(1)}% ROI improvement`);
    console.log(`at ${bestImprovement.threshold}+ pts edge threshold.`);
    console.log('\n→ RECOMMEND: Switch to Market-Anchored model');
  } else if (bestImprovement.diff > 0) {
    console.log(`\nMarginal improvement (+${bestImprovement.diff.toFixed(1)}% ROI) with Market-Anchored.`);
    console.log('May not be statistically significant.');
    console.log('\n→ RECOMMEND: Stay with Elo (simpler, similar performance)');
  } else {
    console.log(`\nNo improvement from Market-Anchored adjustments.`);
    console.log(`Elo outperforms by ${(-bestImprovement.diff).toFixed(1)}% ROI.`);
    console.log('\n→ RECOMMEND: Stay with pure Elo model');
  }
}

main().catch(console.error);

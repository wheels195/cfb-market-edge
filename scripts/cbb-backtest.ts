/**
 * CBB Spread Model Backtest
 *
 * Evaluates model performance on historical games with DraftKings/Bovada lines.
 * Uses efficiency ratings and market-anchored approach.
 */

import { createClient } from '@supabase/supabase-js';
import {
  calculateSpreadProjection,
  calculateSRSSpreadProjection,
  gradePrediction,
  CBBTeamRatings,
  CBBSpreadProjection,
  CBB_MODEL_CONFIG,
} from '../src/lib/models/cbb-spread';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface BacktestResult {
  gameId: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  marketSpread: number;
  modelSpread: number;
  edge: number;
  predictedSide: 'home' | 'away';
  actualMargin: number;
  result: 'win' | 'loss' | 'push';
  provider: string;
}

interface BacktestSummary {
  totalGames: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  avgEdge: number;
  byEdgeThreshold: Record<string, { wins: number; losses: number; pushes: number; winRate: number; roi: number; count: number }>;
  byProvider: Record<string, { wins: number; losses: number; pushes: number; winRate: number; count: number }>;
  bySeason: Record<number, { wins: number; losses: number; pushes: number; winRate: number; count: number }>;
}

async function runBacktest(): Promise<void> {
  console.log('========================================');
  console.log('  CBB Spread Model Backtest');
  console.log('========================================');
  console.log(`\nModel Config:`);
  console.log(`  Home Court Advantage: ${CBB_MODEL_CONFIG.HOME_COURT_ADVANTAGE} pts`);
  console.log(`  Efficiency Scale: ${CBB_MODEL_CONFIG.EFFICIENCY_SCALE}`);
  console.log(`  Market Anchor Weight: ${CBB_MODEL_CONFIG.MARKET_ANCHOR_WEIGHT}`);
  console.log(`  Max Adjustment: ±${CBB_MODEL_CONFIG.MAX_ADJUSTMENT} pts\n`);

  // Get all games with results and betting lines (DK or Bovada preferred)
  // Fetch in batches to avoid Supabase 1000 row limit
  let allGames: any[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data: batch, error: batchError } = await supabase
      .from('cbb_games')
      .select(`
        id,
        cbbd_game_id,
        season,
        home_team_id,
        away_team_id,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        neutral_site
      `)
      .in('season', [2022, 2023, 2024])
      .eq('status', 'final')
      .not('home_score', 'is', null)
      .not('away_score', 'is', null)
      .range(offset, offset + batchSize - 1);

    if (batchError || !batch || batch.length === 0) break;
    allGames = allGames.concat(batch);
    offset += batchSize;

    if (batch.length < batchSize) break;
  }

  const games = allGames;

  console.log(`Total completed games: ${games.length}`);

  // Get betting lines (prefer DraftKings, then Bovada, then ESPN BET)
  // Also fetch in batches
  let allLines: any[] = [];
  offset = 0;

  while (true) {
    const { data: lineBatch } = await supabase
      .from('cbb_betting_lines')
      .select('game_id, cbbd_game_id, provider, spread_home')
      .not('spread_home', 'is', null)
      .range(offset, offset + batchSize - 1);

    if (!lineBatch || lineBatch.length === 0) break;
    allLines = allLines.concat(lineBatch);
    offset += batchSize;

    if (lineBatch.length < batchSize) break;
  }

  console.log(`Total betting lines fetched: ${allLines.length}`);

  // Debug: Show sample of lines
  if (allLines.length > 0) {
    console.log(`Sample line: game_id=${allLines[0].game_id}, provider=${allLines[0].provider}, spread=${allLines[0].spread_home}`);
  }
  if (games.length > 0) {
    console.log(`Sample game: id=${games[0].id}, cbbd_game_id=${games[0].cbbd_game_id}`);
  }

  // Map lines by game_id with provider priority
  const linesByGame = new Map<string, { spread: number; provider: string }>();
  const providerPriority: Record<string, number> = { 'DraftKings': 0, 'Bovada': 1, 'ESPN BET': 2 };

  for (const line of allLines) {
    const existing = linesByGame.get(line.game_id);
    const currentPriority = providerPriority[line.provider] ?? 99;
    const existingPriority = existing ? (providerPriority[existing.provider] ?? 99) : 99;

    if (!existing || currentPriority < existingPriority) {
      linesByGame.set(line.game_id, { spread: line.spread_home, provider: line.provider });
    }
  }

  console.log(`Games with betting lines (mapped): ${linesByGame.size}`);

  // Get team ratings
  const { data: ratings } = await supabase
    .from('cbb_team_ratings')
    .select('team_id, season, offensive_rating, defensive_rating, net_rating, srs_rating');

  // Map ratings by team_id and season
  const ratingsMap = new Map<string, CBBTeamRatings>();
  for (const r of ratings || []) {
    const key = `${r.team_id}-${r.season}`;
    ratingsMap.set(key, {
      offensiveRating: r.offensive_rating,
      defensiveRating: r.defensive_rating,
      netRating: r.net_rating,
      srsRating: r.srs_rating,
    });
  }

  console.log(`Team ratings loaded: ${ratingsMap.size}`);

  // Run backtest
  const results: BacktestResult[] = [];
  let skippedNoLine = 0;
  let skippedNoRatings = 0;

  for (const game of games) {
    // Get betting line
    const lineData = linesByGame.get(game.id);
    if (!lineData) {
      skippedNoLine++;
      continue;
    }

    // Get team ratings for this season
    const homeKey = `${game.home_team_id}-${game.season}`;
    const awayKey = `${game.away_team_id}-${game.season}`;
    const homeRatings = ratingsMap.get(homeKey);
    const awayRatings = ratingsMap.get(awayKey);

    if (!homeRatings || !awayRatings) {
      skippedNoRatings++;
      continue;
    }

    // Calculate projection
    let projection: CBBSpreadProjection;

    if (homeRatings.netRating !== null && awayRatings.netRating !== null) {
      projection = calculateSpreadProjection(
        homeRatings,
        awayRatings,
        lineData.spread,
        game.neutral_site || false
      );
    } else if (homeRatings.srsRating !== undefined && awayRatings.srsRating !== undefined) {
      projection = calculateSRSSpreadProjection(
        homeRatings.srsRating!,
        awayRatings.srsRating!,
        lineData.spread,
        game.neutral_site || false
      );
    } else {
      skippedNoRatings++;
      continue;
    }

    // Grade prediction
    const result = gradePrediction(projection, game.home_score, game.away_score);
    const actualMargin = game.home_score - game.away_score;

    results.push({
      gameId: game.id,
      season: game.season,
      homeTeam: game.home_team_name || 'Unknown',
      awayTeam: game.away_team_name || 'Unknown',
      marketSpread: lineData.spread,
      modelSpread: projection.modelSpreadHome,
      edge: projection.edgePoints,
      predictedSide: projection.predictedSide,
      actualMargin,
      result,
      provider: lineData.provider,
    });
  }

  console.log(`\nBacktest results:`);
  console.log(`  Games evaluated: ${results.length}`);
  console.log(`  Skipped (no line): ${skippedNoLine}`);
  console.log(`  Skipped (no ratings): ${skippedNoRatings}`);

  // Calculate summary
  const summary = calculateSummary(results);
  printSummary(summary);

  // Show sample picks
  console.log('\n=== Sample High-Edge Picks ===');
  const highEdge = results
    .filter(r => Math.abs(r.edge) >= 2.0)
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
    .slice(0, 10);

  for (const r of highEdge) {
    const betSide = r.predictedSide === 'home' ? r.homeTeam : r.awayTeam;
    const betLine = r.predictedSide === 'home' ? r.marketSpread : -r.marketSpread;
    console.log(`  ${r.awayTeam} @ ${r.homeTeam} (${r.season})`);
    console.log(`    Market: Home ${r.marketSpread > 0 ? '+' : ''}${r.marketSpread}`);
    console.log(`    Model: Home ${r.modelSpread > 0 ? '+' : ''}${r.modelSpread}`);
    console.log(`    Edge: ${r.edge > 0 ? '+' : ''}${r.edge} → Bet ${betSide} ${betLine > 0 ? '+' : ''}${betLine}`);
    console.log(`    Result: ${r.result.toUpperCase()} (actual margin: ${r.actualMargin})`);
    console.log('');
  }
}

function calculateSummary(results: BacktestResult[]): BacktestSummary {
  const wins = results.filter(r => r.result === 'win').length;
  const losses = results.filter(r => r.result === 'loss').length;
  const pushes = results.filter(r => r.result === 'push').length;
  const decided = wins + losses;

  const winRate = decided > 0 ? wins / decided : 0;
  // ROI assuming -110 odds: win pays +0.909, loss pays -1
  const profit = wins * 0.909 - losses;
  const roi = decided > 0 ? profit / decided : 0;

  const avgEdge = results.reduce((sum, r) => sum + Math.abs(r.edge), 0) / results.length;

  // By edge threshold
  const thresholds = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
  const byEdgeThreshold: Record<string, { wins: number; losses: number; pushes: number; winRate: number; roi: number; count: number }> = {};

  for (const threshold of thresholds) {
    const filtered = results.filter(r => Math.abs(r.edge) >= threshold);
    const w = filtered.filter(r => r.result === 'win').length;
    const l = filtered.filter(r => r.result === 'loss').length;
    const p = filtered.filter(r => r.result === 'push').length;
    const d = w + l;
    const wr = d > 0 ? w / d : 0;
    const pr = w * 0.909 - l;
    const r = d > 0 ? pr / d : 0;

    byEdgeThreshold[`≥${threshold}`] = { wins: w, losses: l, pushes: p, winRate: wr, roi: r, count: filtered.length };
  }

  // By provider
  const byProvider: Record<string, { wins: number; losses: number; pushes: number; winRate: number; count: number }> = {};
  const providers = [...new Set(results.map(r => r.provider))];

  for (const provider of providers) {
    const filtered = results.filter(r => r.provider === provider);
    const w = filtered.filter(r => r.result === 'win').length;
    const l = filtered.filter(r => r.result === 'loss').length;
    const p = filtered.filter(r => r.result === 'push').length;
    const d = w + l;
    const wr = d > 0 ? w / d : 0;

    byProvider[provider] = { wins: w, losses: l, pushes: p, winRate: wr, count: filtered.length };
  }

  // By season
  const bySeason: Record<number, { wins: number; losses: number; pushes: number; winRate: number; count: number }> = {};
  const seasons = [...new Set(results.map(r => r.season))];

  for (const season of seasons) {
    const filtered = results.filter(r => r.season === season);
    const w = filtered.filter(r => r.result === 'win').length;
    const l = filtered.filter(r => r.result === 'loss').length;
    const p = filtered.filter(r => r.result === 'push').length;
    const d = w + l;
    const wr = d > 0 ? w / d : 0;

    bySeason[season] = { wins: w, losses: l, pushes: p, winRate: wr, count: filtered.length };
  }

  return {
    totalGames: results.length,
    wins,
    losses,
    pushes,
    winRate,
    roi,
    avgEdge,
    byEdgeThreshold,
    byProvider,
    bySeason,
  };
}

function printSummary(summary: BacktestSummary): void {
  console.log('\n========================================');
  console.log('  Backtest Summary');
  console.log('========================================');

  console.log(`\nOverall Performance:`);
  console.log(`  Record: ${summary.wins}-${summary.losses}-${summary.pushes}`);
  console.log(`  Win Rate: ${(summary.winRate * 100).toFixed(1)}%`);
  console.log(`  ROI: ${(summary.roi * 100).toFixed(1)}%`);
  console.log(`  Avg Edge: ${summary.avgEdge.toFixed(2)} pts`);

  console.log(`\nPerformance by Edge Threshold:`);
  console.log('  Threshold | Record       | Win%   | ROI    | Games');
  console.log('  ----------|--------------|--------|--------|------');
  for (const [threshold, stats] of Object.entries(summary.byEdgeThreshold)) {
    const record = `${stats.wins}-${stats.losses}-${stats.pushes}`;
    console.log(`  ${threshold.padEnd(9)} | ${record.padEnd(12)} | ${(stats.winRate * 100).toFixed(1).padStart(5)}% | ${(stats.roi * 100).toFixed(1).padStart(5)}% | ${stats.count}`);
  }

  console.log(`\nPerformance by Provider:`);
  for (const [provider, stats] of Object.entries(summary.byProvider)) {
    console.log(`  ${provider}: ${stats.wins}-${stats.losses}-${stats.pushes} (${(stats.winRate * 100).toFixed(1)}%) - ${stats.count} games`);
  }

  console.log(`\nPerformance by Season:`);
  for (const [season, stats] of Object.entries(summary.bySeason)) {
    console.log(`  ${season}: ${stats.wins}-${stats.losses}-${stats.pushes} (${(stats.winRate * 100).toFixed(1)}%) - ${stats.count} games`);
  }
}

runBacktest().catch(console.error);

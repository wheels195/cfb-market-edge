/**
 * Backtest Engine V3
 *
 * Proper methodology:
 * 1. Fix MAE/correlation calculations (spread vs margin sign)
 * 2. Evaluate on selected edges (tail selection)
 * 3. Convert CLV to probability and expected value
 * 4. Simulate betting returns at different thresholds
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// =============================================================================
// TYPES
// =============================================================================

interface GameProjection {
  eventId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  projectedSpread: number;      // Negative = home favored
  closingSpread: number | null; // Negative = home favored
  actualMargin: number | null;  // Positive = home won
  price: number | null;         // American odds for home spread
}

interface Bet {
  eventId: string;
  matchup: string;
  side: 'home' | 'away';
  spreadAtBet: number;
  spreadAtClose: number;
  priceAtBet: number;
  actualMargin: number;
  won: boolean;
  clvPoints: number;
  payout: number; // Per $100 wagered
}

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getSPRatings(season: number): Promise<Map<string, number>> {
  const priorSeason = season - 1;
  const { data } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_overall')
    .eq('season', priorSeason)
    .not('sp_overall', 'is', null);

  const map = new Map<string, number>();
  for (const row of data || []) {
    map.set(row.team_id, row.sp_overall);
  }
  return map;
}

async function getEventsForSeason(season: number): Promise<any[]> {
  const seasonStart = `${season}-08-01`;
  const seasonEnd = `${season + 1}-02-15`;

  const allEvents: any[] = [];
  let offset = 0;
  const pageSize = 500;

  while (true) {
    const { data } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team_id,
        away_team_id,
        home_team:teams!events_home_team_id_fkey(id, name),
        away_team:teams!events_away_team_id_fkey(id, name),
        results(home_score, away_score)
      `)
      .eq('status', 'final')
      .gte('commence_time', seasonStart)
      .lte('commence_time', seasonEnd)
      .order('commence_time', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (!data || data.length === 0) break;
    allEvents.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  // Get Pinnacle sportsbook ID (sharp book, best for CLV)
  const { data: pinnacle } = await supabase
    .from('sportsbooks')
    .select('id')
    .eq('key', 'pinnacle')
    .single();

  const pinnacleId = pinnacle?.id;

  // Get closing lines - prefer Pinnacle, fallback to any
  const eventIds = allEvents.map(e => e.id);
  const closingMap = new Map<string, { spread: number; price: number }>();

  for (let i = 0; i < eventIds.length; i += 100) {
    const batchIds = eventIds.slice(i, i + 100);

    // First try Pinnacle
    if (pinnacleId) {
      const { data: pinnacleLines } = await supabase
        .from('closing_lines')
        .select('event_id, spread_points_home, price_american')
        .in('event_id', batchIds)
        .eq('market_type', 'spread')
        .eq('side', 'home')
        .eq('sportsbook_id', pinnacleId)
        .not('spread_points_home', 'is', null);

      for (const cl of pinnacleLines || []) {
        closingMap.set(cl.event_id, {
          spread: cl.spread_points_home,
          // Use standard -110 for consistency
          price: -110
        });
      }
    }

    // Fill in missing with any sportsbook (excluding Bovada outliers)
    const missing = batchIds.filter(id => !closingMap.has(id));
    if (missing.length > 0) {
      const { data: otherLines } = await supabase
        .from('closing_lines')
        .select('event_id, spread_points_home, price_american')
        .in('event_id', missing)
        .eq('market_type', 'spread')
        .eq('side', 'home')
        .not('spread_points_home', 'is', null)
        // Filter to reasonable prices only
        .gte('price_american', -150)
        .lte('price_american', -100);

      for (const cl of otherLines || []) {
        if (!closingMap.has(cl.event_id)) {
          closingMap.set(cl.event_id, {
            spread: cl.spread_points_home,
            price: -110
          });
        }
      }
    }
  }

  return allEvents.map(e => ({
    ...e,
    closing: closingMap.get(e.id) || null,
  }));
}

// =============================================================================
// PROJECTION
// =============================================================================

function projectSpread(
  homeSP: number,
  awaySP: number,
  homeFieldAdvantage: number = 2.5
): number {
  // SP+ diff: positive = home better
  const spDiff = homeSP - awaySP;
  // Convert to spread: if home better, spread is negative (home favored)
  return -spDiff - homeFieldAdvantage;
}

// =============================================================================
// METRICS
// =============================================================================

function calculateMAE(projections: GameProjection[]): number {
  const withMargin = projections.filter(p => p.actualMargin !== null);
  if (withMargin.length === 0) return 0;

  // Predicted margin = -projectedSpread (FIX: sign conversion)
  // Error = predicted - actual
  const errors = withMargin.map(p => (-p.projectedSpread) - p.actualMargin!);
  return errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
}

function calculateRMSE(projections: GameProjection[]): number {
  const withMargin = projections.filter(p => p.actualMargin !== null);
  if (withMargin.length === 0) return 0;

  const errors = withMargin.map(p => (-p.projectedSpread) - p.actualMargin!);
  return Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
}

function calculateCorrelation(projections: GameProjection[]): number {
  const withMargin = projections.filter(p => p.actualMargin !== null);
  if (withMargin.length < 2) return 0;

  // Use predicted margin (not spread) for correlation
  const predicted = withMargin.map(p => -p.projectedSpread);
  const actual = withMargin.map(p => p.actualMargin!);

  const meanPred = predicted.reduce((a, b) => a + b, 0) / predicted.length;
  const meanAct = actual.reduce((a, b) => a + b, 0) / actual.length;

  let num = 0, denomPred = 0, denomAct = 0;
  for (let i = 0; i < predicted.length; i++) {
    num += (predicted[i] - meanPred) * (actual[i] - meanAct);
    denomPred += Math.pow(predicted[i] - meanPred, 2);
    denomAct += Math.pow(actual[i] - meanAct, 2);
  }

  if (denomPred === 0 || denomAct === 0) return 0;
  return num / (Math.sqrt(denomPred) * Math.sqrt(denomAct));
}

// =============================================================================
// BETTING SIMULATION
// =============================================================================

function americanToDecimal(american: number): number {
  if (american > 0) {
    return 1 + american / 100;
  } else {
    return 1 + 100 / Math.abs(american);
  }
}

function americanToImpliedProb(american: number): number {
  if (american > 0) {
    return 100 / (american + 100);
  } else {
    return Math.abs(american) / (Math.abs(american) + 100);
  }
}

// Convert CLV points to expected profit per $100
// CLV in points translates to probability edge
// Rule of thumb: 1 point of CLV ≈ 2.8% win probability improvement
// At -110 juice, need 52.4% to break even
function clvToExpectedProfit(clvPoints: number, price: number = -110): number {
  const impliedProb = americanToImpliedProb(price);
  const probPerPoint = 0.028; // ~2.8% per point
  const edgeProb = clvPoints * probPerPoint;
  const winProb = impliedProb + edgeProb;

  // EV = winProb * winPayout - (1 - winProb) * 100
  const decimal = americanToDecimal(price);
  const winPayout = (decimal - 1) * 100; // Profit on $100
  return winProb * winPayout - (1 - winProb) * 100;
}

function simulateBetting(
  projections: GameProjection[],
  edgeThreshold: number
): { bets: Bet[]; metrics: any } {
  const bets: Bet[] = [];

  for (const p of projections) {
    if (p.closingSpread === null || p.actualMargin === null || p.price === null) continue;

    // Edge = model spread - market spread
    // If model says -10 (home favored more) and market is -7:
    //   edge = -10 - (-7) = -3 (negative = bet home)
    // If model says -5 (home favored less) and market is -7:
    //   edge = -5 - (-7) = +2 (positive = bet away)
    const edge = p.projectedSpread - p.closingSpread;
    const absEdge = Math.abs(edge);

    if (absEdge < edgeThreshold) continue;

    const side: 'home' | 'away' = edge < 0 ? 'home' : 'away';

    // Determine if bet won
    // Home covers if: actualMargin > -homeSpread
    // Example: spread -7, margin +10: 10 > 7 → home covers
    const homeCovered = p.actualMargin > -p.closingSpread;
    const won = (side === 'home' && homeCovered) || (side === 'away' && !homeCovered);

    // CLV for this bet
    // If we bet home at market spread, CLV = close - bet (but we bet at close here)
    // Since we're using closing line as bet price, CLV vs model is just the edge
    const clvPoints = Math.abs(edge);

    // Payout
    const payout = won ? (americanToDecimal(p.price) - 1) * 100 : -100;

    bets.push({
      eventId: p.eventId,
      matchup: `${p.awayTeam} @ ${p.homeTeam}`,
      side,
      spreadAtBet: p.closingSpread,
      spreadAtClose: p.closingSpread,
      priceAtBet: p.price,
      actualMargin: p.actualMargin,
      won,
      clvPoints,
      payout,
    });
  }

  // Calculate metrics
  const totalWagered = bets.length * 100;
  const totalProfit = bets.reduce((sum, b) => sum + b.payout, 0);
  const winRate = bets.filter(b => b.won).length / bets.length;
  const roi = totalProfit / totalWagered;
  const avgCLV = bets.reduce((sum, b) => sum + b.clvPoints, 0) / bets.length;
  const expectedProfit = bets.reduce((sum, b) => sum + clvToExpectedProfit(b.clvPoints, b.priceAtBet), 0);

  return {
    bets,
    metrics: {
      numBets: bets.length,
      totalWagered,
      totalProfit,
      winRate,
      roi,
      avgCLV,
      expectedProfit,
      expectedROI: expectedProfit / totalWagered,
    }
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const seasons = [2023, 2024];

  console.log('=== BACKTEST ENGINE V3 ===');
  console.log('Using prior-season SP+ with proper calculation fixes\n');

  const allProjections: GameProjection[] = [];

  for (const season of seasons) {
    console.log(`\n--- Season ${season} ---`);

    const spRatings = await getSPRatings(season);
    console.log(`Loaded ${spRatings.size} SP+ ratings from ${season - 1}`);

    const events = await getEventsForSeason(season);
    console.log(`Found ${events.length} events`);

    let projected = 0;
    let withClosing = 0;
    let skipped = 0;

    for (const event of events) {
      const homeTeam = event.home_team as { id: string; name: string };
      const awayTeam = event.away_team as { id: string; name: string };
      const results = event.results as { home_score: number; away_score: number } | null;

      if (!homeTeam?.id || !awayTeam?.id) continue;

      const homeSP = spRatings.get(event.home_team_id);
      const awaySP = spRatings.get(event.away_team_id);

      if (homeSP === undefined || awaySP === undefined) {
        skipped++;
        continue;
      }

      const projectedSpread = projectSpread(homeSP, awaySP);

      let closingSpread: number | null = null;
      let price: number | null = null;
      if (event.closing) {
        closingSpread = event.closing.spread;
        price = event.closing.price;
        withClosing++;
      }

      let actualMargin: number | null = null;
      if (results?.home_score !== undefined && results?.away_score !== undefined) {
        actualMargin = results.home_score - results.away_score;
      }

      allProjections.push({
        eventId: event.id,
        season,
        week: 0,
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        projectedSpread,
        closingSpread,
        actualMargin,
        price,
      });

      projected++;
    }

    console.log(`Projected: ${projected} | With closing: ${withClosing} | Skipped: ${skipped}`);
  }

  // Overall metrics with fixed calculations
  console.log('\n=== MODEL ACCURACY (FIXED CALCULATIONS) ===');
  const mae = calculateMAE(allProjections);
  const rmse = calculateRMSE(allProjections);
  const corr = calculateCorrelation(allProjections);

  console.log(`MAE:  ${mae.toFixed(2)} points (predicted margin vs actual)`);
  console.log(`RMSE: ${rmse.toFixed(2)} points`);
  console.log(`Correlation: ${corr.toFixed(4)}`);

  // Compare to closing line accuracy
  const withClose = allProjections.filter(p => p.closingSpread !== null && p.actualMargin !== null);
  if (withClose.length > 0) {
    const closingErrors = withClose.map(p => (-p.closingSpread!) - p.actualMargin!);
    const closingMAE = closingErrors.reduce((s, e) => s + Math.abs(e), 0) / closingErrors.length;
    const closingRMSE = Math.sqrt(closingErrors.reduce((s, e) => s + e * e, 0) / closingErrors.length);

    console.log(`\nClosing Line MAE:  ${closingMAE.toFixed(2)} points`);
    console.log(`Closing Line RMSE: ${closingRMSE.toFixed(2)} points`);
    console.log(`Model vs Close MAE diff: ${(mae - closingMAE).toFixed(2)} (negative = model better)`);
  }

  // Betting simulation at different thresholds
  console.log('\n=== BETTING SIMULATION (TAIL SELECTION) ===');
  console.log('Threshold | Bets | Win%  | ROI     | Avg CLV | Expected ROI');
  console.log('----------|------|-------|---------|---------|-------------');

  for (const threshold of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const { metrics } = simulateBetting(allProjections, threshold);
    if (metrics.numBets === 0) continue;

    console.log(
      `${threshold.toString().padStart(9)} | ${metrics.numBets.toString().padStart(4)} | ` +
      `${(metrics.winRate * 100).toFixed(1).padStart(5)}% | ` +
      `${(metrics.roi * 100).toFixed(1).padStart(6)}% | ` +
      `${metrics.avgCLV.toFixed(2).padStart(7)} | ` +
      `${(metrics.expectedROI * 100).toFixed(1).padStart(6)}%`
    );
  }

  // Show sample bets at 3+ point edge
  const { bets } = simulateBetting(allProjections, 3);
  console.log(`\n=== SAMPLE BETS (3+ PT EDGE) - First 15 ===`);
  console.log('Matchup                              | Side | Spread | Margin | Won | Payout');
  console.log('-------------------------------------|------|--------|--------|-----|-------');

  for (const bet of bets.slice(0, 15)) {
    const matchup = bet.matchup.substring(0, 36).padEnd(36);
    const spreadStr = bet.spreadAtBet >= 0 ? `+${bet.spreadAtBet.toFixed(1)}` : bet.spreadAtBet.toFixed(1);
    const marginStr = bet.actualMargin >= 0 ? `+${bet.actualMargin}` : bet.actualMargin.toString();
    const payoutStr = bet.payout >= 0 ? `+${bet.payout.toFixed(0)}` : bet.payout.toFixed(0);

    console.log(
      `${matchup} | ${bet.side.padEnd(4)} | ${spreadStr.padStart(6)} | ${marginStr.padStart(6)} | ` +
      `${bet.won ? 'Y' : 'N'}   | ${payoutStr.padStart(5)}`
    );
  }

  // CLV to EV conversion explanation
  console.log('\n=== CLV TO EXPECTED VALUE ===');
  console.log(`
Converting CLV points to expected profit:
- 1 point of spread value ≈ 2.8% win probability improvement
- At -110 odds, breakeven is 52.4% win rate
- Each point of CLV adds ~2.8% to win probability

Example calculations:
`);

  for (const clv of [1, 2, 3, 4, 5]) {
    const ev = clvToExpectedProfit(clv);
    console.log(`  ${clv} pt CLV → Expected profit: $${ev.toFixed(2)} per $100 wagered (${(ev / 100 * 100).toFixed(1)}% ROI)`);
  }

  console.log('\n=== COMPLETE ===');
}

main().catch(console.error);

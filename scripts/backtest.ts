/**
 * Backtest the trained model against historical closing lines
 * Simulates betting strategy and calculates ROI
 */
import { supabase } from '../src/lib/db/client';

interface ModelConfig {
  spread: {
    eloDiffWeight: number;
    homeFieldAdvantage: number;
  };
  total: {
    intercept: number;
  };
}

interface BacktestGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  actualMargin: number;
  actualTotal: number;
  closingSpread: number;
  closingTotal: number;
  homeElo: number;
  awayElo: number;
  modelSpread: number;
  modelTotal: number;
  spreadEdge: number;
  totalEdge: number;
}

interface Bet {
  eventId: string;
  type: 'spread' | 'total';
  side: 'home' | 'away' | 'over' | 'under';
  line: number;
  edge: number;
  odds: number;  // American odds (default -110)
  stake: number;
  won: boolean;
  profit: number;
  description: string;
}

async function getAllWithPagination<T>(
  tableName: string,
  selectQuery: string,
  filters?: { column: string; value: unknown; op?: string }[]
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from(tableName).select(selectQuery).range(offset, offset + 999);

    if (filters) {
      for (const f of filters) {
        if (f.op === 'not') {
          query = query.not(f.column, 'is', f.value);
        } else {
          query = query.eq(f.column, f.value);
        }
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error(`Error fetching ${tableName}:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;
    results.push(...(data as T[]));
    offset += data.length;
    if (data.length < 1000) break;
  }

  return results;
}

async function loadModelConfig(): Promise<ModelConfig | null> {
  const { data } = await supabase
    .from('model_versions')
    .select('config')
    .eq('name', 'regression_v1')
    .single();

  if (!data || !data.config) return null;
  return data.config as ModelConfig;
}

async function loadBacktestData(model: ModelConfig): Promise<BacktestGame[]> {
  console.log('Loading backtest data...');

  // Get events with results
  const events = await getAllWithPagination<{
    id: string;
    home_team_id: string;
    away_team_id: string;
    commence_time: string;
    home_team: { name: string };
    away_team: { name: string };
  }>('events', `
    id,
    home_team_id,
    away_team_id,
    commence_time,
    home_team:teams!events_home_team_id_fkey(name),
    away_team:teams!events_away_team_id_fkey(name)
  `, [{ column: 'status', value: 'final' }]);

  // Get results
  const results = await getAllWithPagination<{
    event_id: string;
    home_score: number;
    away_score: number;
  }>('results', 'event_id, home_score, away_score');

  const resultMap = new Map<string, { homeScore: number; awayScore: number }>();
  for (const r of results) {
    resultMap.set(r.event_id, { homeScore: r.home_score, awayScore: r.away_score });
  }

  // Get closing lines
  const closingLines = await getAllWithPagination<{
    event_id: string;
    market_type: string;
    side: string;
    spread_points_home: number | null;
    total_points: number | null;
  }>('closing_lines', 'event_id, market_type, side, spread_points_home, total_points');

  const closingSpreadMap = new Map<string, number>();
  const closingTotalMap = new Map<string, number>();
  for (const line of closingLines) {
    if (line.market_type === 'spread' && line.side === 'home' && line.spread_points_home !== null) {
      closingSpreadMap.set(line.event_id, line.spread_points_home);
    }
    if (line.market_type === 'total' && line.total_points !== null) {
      closingTotalMap.set(line.event_id, line.total_points);
    }
  }

  // Get team ratings
  const ratings = await getAllWithPagination<{
    team_id: string;
    season: number;
    rating: number;
  }>('team_ratings', 'team_id, season, rating');

  const ratingMap = new Map<string, number>();
  for (const r of ratings) {
    const key = `${r.team_id}_${r.season}`;
    ratingMap.set(key, r.rating);
  }

  // Build backtest games
  const games: BacktestGame[] = [];

  for (const event of events) {
    const result = resultMap.get(event.id);
    const closingSpread = closingSpreadMap.get(event.id);
    const closingTotal = closingTotalMap.get(event.id);

    if (!result || closingSpread === undefined || closingTotal === undefined) continue;

    const eventDate = new Date(event.commence_time);
    const season = eventDate.getMonth() >= 7 ? eventDate.getFullYear() : eventDate.getFullYear() - 1;

    const homeElo = ratingMap.get(`${event.home_team_id}_${season}`) || 1500;
    const awayElo = ratingMap.get(`${event.away_team_id}_${season}`) || 1500;
    const eloDiff = homeElo - awayElo;

    // Calculate model predictions
    const modelSpread = model.spread.eloDiffWeight * (eloDiff / 100) + model.spread.homeFieldAdvantage;
    const modelTotal = model.total.intercept;

    // Calculate edges
    // Spread edge: positive = bet home, negative = bet away
    const spreadEdge = closingSpread - modelSpread;
    // Total edge: positive = bet under, negative = bet over
    const totalEdge = closingTotal - modelTotal;

    games.push({
      eventId: event.id,
      homeTeam: event.home_team.name,
      awayTeam: event.away_team.name,
      commenceTime: event.commence_time,
      actualMargin: result.homeScore - result.awayScore,
      actualTotal: result.homeScore + result.awayScore,
      closingSpread,
      closingTotal,
      homeElo,
      awayElo,
      modelSpread,
      modelTotal,
      spreadEdge,
      totalEdge,
    });
  }

  console.log(`Loaded ${games.length} games for backtest\n`);
  return games;
}

function americanToDecimal(american: number): number {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

function calculateProfit(stake: number, american: number, won: boolean): number {
  if (!won) return -stake;
  if (american > 0) return stake * (american / 100);
  return stake * (100 / Math.abs(american));
}

function runBacktest(games: BacktestGame[], minEdge: number = 1.0): {
  bets: Bet[];
  summary: {
    totalBets: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
    totalStaked: number;
    totalProfit: number;
    roi: number;
    spreadBets: { count: number; wins: number; roi: number };
    totalsBets: { count: number; wins: number; roi: number };
  };
} {
  const bets: Bet[] = [];
  const stake = 100; // $100 per bet
  const odds = -110; // Standard juice

  for (const game of games) {
    // Spread bets
    if (Math.abs(game.spreadEdge) >= minEdge) {
      const betSide = game.spreadEdge > 0 ? 'home' : 'away';
      const line = game.closingSpread;

      // Determine if bet won
      // For home bet: home team must cover (margin > -spread)
      // For away bet: away team must cover (margin < -spread)
      let won: boolean;
      const marginNeeded = -line; // If spread is -7, home needs to win by >7

      if (betSide === 'home') {
        won = game.actualMargin > marginNeeded;
      } else {
        won = game.actualMargin < marginNeeded;
      }

      // Handle push (exact tie to spread)
      const isPush = game.actualMargin === marginNeeded;

      bets.push({
        eventId: game.eventId,
        type: 'spread',
        side: betSide,
        line,
        edge: game.spreadEdge,
        odds,
        stake,
        won: isPush ? false : won,
        profit: isPush ? 0 : calculateProfit(stake, odds, won),
        description: `${game.awayTeam} @ ${game.homeTeam}: ${betSide === 'home' ? 'Home' : 'Away'} ${line} (edge: ${game.spreadEdge.toFixed(1)})`,
      });
    }

    // Total bets
    if (Math.abs(game.totalEdge) >= minEdge) {
      const betSide = game.totalEdge > 0 ? 'under' : 'over';
      const line = game.closingTotal;

      let won: boolean;
      if (betSide === 'over') {
        won = game.actualTotal > line;
      } else {
        won = game.actualTotal < line;
      }

      const isPush = game.actualTotal === line;

      bets.push({
        eventId: game.eventId,
        type: 'total',
        side: betSide,
        line,
        edge: game.totalEdge,
        odds,
        stake,
        won: isPush ? false : won,
        profit: isPush ? 0 : calculateProfit(stake, odds, won),
        description: `${game.awayTeam} @ ${game.homeTeam}: ${betSide.toUpperCase()} ${line} (edge: ${game.totalEdge.toFixed(1)})`,
      });
    }
  }

  // Calculate summary
  const spreadBets = bets.filter(b => b.type === 'spread');
  const totalBetsList = bets.filter(b => b.type === 'total');

  const wins = bets.filter(b => b.won).length;
  const losses = bets.filter(b => !b.won && b.profit < 0).length;
  const pushes = bets.filter(b => b.profit === 0).length;
  const totalStaked = bets.reduce((sum, b) => sum + b.stake, 0);
  const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0);

  const spreadWins = spreadBets.filter(b => b.won).length;
  const spreadProfit = spreadBets.reduce((sum, b) => sum + b.profit, 0);
  const spreadStaked = spreadBets.length * stake;

  const totalWins = totalBetsList.filter(b => b.won).length;
  const totalsProfit = totalBetsList.reduce((sum, b) => sum + b.profit, 0);
  const totalsStaked = totalBetsList.length * stake;

  return {
    bets,
    summary: {
      totalBets: bets.length,
      wins,
      losses,
      pushes,
      winRate: wins / (wins + losses) * 100,
      totalStaked,
      totalProfit,
      roi: (totalProfit / totalStaked) * 100,
      spreadBets: {
        count: spreadBets.length,
        wins: spreadWins,
        roi: spreadStaked > 0 ? (spreadProfit / spreadStaked) * 100 : 0,
      },
      totalsBets: {
        count: totalBetsList.length,
        wins: totalWins,
        roi: totalsStaked > 0 ? (totalsProfit / totalsStaked) * 100 : 0,
      },
    },
  };
}

async function main() {
  console.log('=== CFB MARKET-EDGE BACKTEST ===\n');

  // Load model
  const model = await loadModelConfig();
  if (!model) {
    console.error('No trained model found. Run train-model.ts first.');
    return;
  }

  console.log('Model loaded:');
  console.log(`  Spread: ${model.spread.eloDiffWeight.toFixed(2)} per 100 Elo + ${model.spread.homeFieldAdvantage.toFixed(2)} HFA`);
  console.log(`  Total: ${model.total.intercept.toFixed(1)} league average\n`);

  // Load data
  const games = await loadBacktestData(model);

  // Run backtests at different edge thresholds
  const thresholds = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];

  console.log('=== BACKTEST RESULTS BY EDGE THRESHOLD ===\n');
  console.log('Threshold | Total Bets | Win Rate | ROI    | Spread ROI | Total ROI');
  console.log('----------|------------|----------|--------|------------|----------');

  for (const threshold of thresholds) {
    const result = runBacktest(games, threshold);
    const s = result.summary;
    const totalBetCount = s.spreadBets.count + s.totalsBets.count;

    console.log(
      `${threshold.toFixed(1).padStart(9)} | ` +
      `${totalBetCount.toString().padStart(10)} | ` +
      `${s.winRate.toFixed(1).padStart(7)}% | ` +
      `${s.roi >= 0 ? '+' : ''}${s.roi.toFixed(2).padStart(5)}% | ` +
      `${s.spreadBets.roi >= 0 ? '+' : ''}${s.spreadBets.roi.toFixed(2).padStart(9)}% | ` +
      `${s.totalsBets.roi >= 0 ? '+' : ''}${s.totalsBets.roi.toFixed(2).padStart(8)}%`
    );
  }

  // Detailed results for 1.5-point edge
  console.log('\n=== DETAILED RESULTS (1.5-pt edge threshold) ===\n');
  const detailedResult = runBacktest(games, 1.5);
  const ds = detailedResult.summary;

  const detailedBetCount = ds.spreadBets.count + ds.totalsBets.count;
  console.log(`Total Bets: ${detailedBetCount}`);
  console.log(`  Wins: ${ds.wins}`);
  console.log(`  Losses: ${ds.losses}`);
  console.log(`  Pushes: ${ds.pushes}`);
  console.log(`\nWin Rate: ${ds.winRate.toFixed(1)}%`);
  console.log(`Total Staked: $${ds.totalStaked.toLocaleString()}`);
  console.log(`Total Profit: $${ds.totalProfit.toFixed(2)}`);
  console.log(`ROI: ${ds.roi >= 0 ? '+' : ''}${ds.roi.toFixed(2)}%`);

  console.log('\nBreakdown:');
  console.log(`  Spread bets: ${ds.spreadBets.count} bets, ${ds.spreadBets.wins} wins, ${ds.spreadBets.roi >= 0 ? '+' : ''}${ds.spreadBets.roi.toFixed(2)}% ROI`);
  console.log(`  Totals bets: ${ds.totalsBets.count} bets, ${ds.totalsBets.wins} wins, ${ds.totalsBets.roi >= 0 ? '+' : ''}${ds.totalsBets.roi.toFixed(2)}% ROI`);

  // Show some sample winning and losing bets
  const winners = detailedResult.bets.filter(b => b.won).slice(0, 5);
  const losers = detailedResult.bets.filter(b => !b.won && b.profit < 0).slice(0, 5);

  console.log('\nSample Winning Bets:');
  for (const bet of winners) {
    console.log(`  ${bet.description} - WON +$${bet.profit.toFixed(2)}`);
  }

  console.log('\nSample Losing Bets:');
  for (const bet of losers) {
    console.log(`  ${bet.description} - LOST $${Math.abs(bet.profit).toFixed(2)}`);
  }

  // Calculate CLV (Closing Line Value) as a proxy for edge quality
  console.log('\n=== CLOSING LINE VALUE ANALYSIS ===\n');

  // For a good model, we should be getting value vs the closing line
  // If we bet at the closing line, we should see positive CLV on average
  const spreadBets = detailedResult.bets.filter(b => b.type === 'spread');
  let avgEdgeWon = 0, avgEdgeLost = 0, wonCount = 0, lostCount = 0;

  for (const bet of spreadBets) {
    if (bet.won) {
      avgEdgeWon += Math.abs(bet.edge);
      wonCount++;
    } else if (bet.profit < 0) {
      avgEdgeLost += Math.abs(bet.edge);
      lostCount++;
    }
  }

  if (wonCount > 0) avgEdgeWon /= wonCount;
  if (lostCount > 0) avgEdgeLost /= lostCount;

  console.log('Spread Bets Edge Analysis:');
  console.log(`  Average edge on winning bets: ${avgEdgeWon.toFixed(2)} points`);
  console.log(`  Average edge on losing bets: ${avgEdgeLost.toFixed(2)} points`);
  console.log(`  Edge differential: ${(avgEdgeWon - avgEdgeLost).toFixed(2)} points`);

  console.log('\n=== BACKTEST COMPLETE ===');
}

main().catch(console.error);

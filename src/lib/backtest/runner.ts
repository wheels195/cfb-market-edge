import { supabase } from '@/lib/db/client';

export interface BacktestConfig {
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  edgeThreshold: number;  // Minimum abs edge to bet
  betTimeMinutes: number; // Minutes before kickoff for bet snapshot
  sportsbookKey?: string; // Filter to specific book
  marketType?: 'spread' | 'total'; // Filter to specific market
}

export interface BacktestBet {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  sportsbookKey: string;
  marketType: 'spread' | 'total';
  betSide: string;
  betLabel: string;
  edgePoints: number;
  betNumber: number;  // The spread or total at bet time
  betPrice: number;
  closeNumber: number | null;  // Closing line number
  actualResult: number;  // Home margin for spreads, total for totals
  outcome: 'win' | 'loss' | 'push';
  profit: number;  // Based on $100 unit
  clvPoints: number | null;  // Closing line value
}

export interface BacktestResult {
  config: BacktestConfig;
  bets: BacktestBet[];
  metrics: {
    totalBets: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
    totalWagered: number;
    totalProfit: number;
    roi: number;
    avgEdge: number;
    avgClv: number | null;
    byMarket: {
      spread: { bets: number; winRate: number; roi: number };
      total: { bets: number; winRate: number; roi: number };
    };
    bySportsbook: Record<string, { bets: number; winRate: number; roi: number }>;
  };
}

/**
 * Run backtest on historical data
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const bets: BacktestBet[] = [];

  // Get completed events in date range
  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name),
      result:results(home_score, away_score, home_margin, final_total)
    `)
    .eq('status', 'final')
    .gte('commence_time', `${config.startDate}T00:00:00Z`)
    .lte('commence_time', `${config.endDate}T23:59:59Z`)
    .order('commence_time', { ascending: true });

  if (!events || events.length === 0) {
    return createEmptyResult(config);
  }

  // Get sportsbooks
  const { data: sportsbooks } = await supabase
    .from('sportsbooks')
    .select('id, key, name');

  const sbById = new Map<string, { key: string; name: string }>();
  const sbByKey = new Map<string, string>();
  for (const sb of sportsbooks || []) {
    sbById.set(sb.id, { key: sb.key, name: sb.name });
    sbByKey.set(sb.key, sb.id);
  }

  // Process each event
  for (const rawEvent of events) {
    const result = Array.isArray(rawEvent.result) ? rawEvent.result[0] : rawEvent.result;
    if (!result) continue;

    // Normalize the event structure (Supabase returns arrays for relations)
    const homeTeam = Array.isArray(rawEvent.home_team) ? rawEvent.home_team[0] : rawEvent.home_team;
    const awayTeam = Array.isArray(rawEvent.away_team) ? rawEvent.away_team[0] : rawEvent.away_team;

    const event = {
      id: rawEvent.id,
      commence_time: rawEvent.commence_time,
      home_team: homeTeam || null,
      away_team: awayTeam || null,
    };

    const commenceTime = new Date(event.commence_time);
    const betTime = new Date(commenceTime.getTime() - config.betTimeMinutes * 60 * 1000);

    // Get projection for this event
    const { data: projection } = await supabase
      .from('projections')
      .select('model_spread_home, model_total_points')
      .eq('event_id', event.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();

    if (!projection) continue;

    // Get odds ticks at bet time for each book/market
    for (const [sbId, sbInfo] of sbById) {
      if (config.sportsbookKey && sbInfo.key !== config.sportsbookKey) continue;

      // Process spreads
      if (!config.marketType || config.marketType === 'spread') {
        const bet = await evaluateSpreadBet(
          event,
          result,
          sbId,
          sbInfo,
          projection,
          betTime,
          commenceTime,
          config
        );
        if (bet) bets.push(bet);
      }

      // Process totals
      if (!config.marketType || config.marketType === 'total') {
        const bet = await evaluateTotalBet(
          event,
          result,
          sbId,
          sbInfo,
          projection,
          betTime,
          commenceTime,
          config
        );
        if (bet) bets.push(bet);
      }
    }
  }

  return calculateMetrics(config, bets);
}

/**
 * Evaluate a spread bet
 */
async function evaluateSpreadBet(
  event: {
    id: string;
    commence_time: string;
    home_team: { name: string } | null;
    away_team: { name: string } | null;
  },
  result: { home_margin: number },
  sbId: string,
  sbInfo: { key: string; name: string },
  projection: { model_spread_home: number },
  betTime: Date,
  commenceTime: Date,
  config: BacktestConfig
): Promise<BacktestBet | null> {
  // Get tick at bet time
  const { data: betTick } = await supabase
    .from('odds_ticks')
    .select('spread_points_home, price_american')
    .eq('event_id', event.id)
    .eq('sportsbook_id', sbId)
    .eq('market_type', 'spread')
    .eq('side', 'home')
    .lte('captured_at', betTime.toISOString())
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (!betTick || betTick.spread_points_home === null) return null;

  const marketSpread = betTick.spread_points_home;
  const modelSpread = projection.model_spread_home;
  const edgePoints = marketSpread - modelSpread;

  // Check threshold
  if (Math.abs(edgePoints) < config.edgeThreshold) return null;

  // Determine bet side
  const betHome = edgePoints > 0;
  const betSide = betHome ? 'home' : 'away';
  const betNumber = betHome ? marketSpread : -marketSpread;
  const betLabel = betHome
    ? `${event.home_team?.name} ${formatSpread(marketSpread)}`
    : `${event.away_team?.name} ${formatSpread(-marketSpread)}`;

  // Get closing line
  const { data: closingLine } = await supabase
    .from('closing_lines')
    .select('spread_points_home')
    .eq('event_id', event.id)
    .eq('sportsbook_id', sbId)
    .eq('market_type', 'spread')
    .eq('side', 'home')
    .single();

  const closeNumber = closingLine?.spread_points_home ?? null;

  // Evaluate outcome
  const homeMargin = result.home_margin;
  let outcome: 'win' | 'loss' | 'push';

  if (betHome) {
    // Bet home spread
    const adjustedMargin = homeMargin + marketSpread;
    if (adjustedMargin > 0) outcome = 'win';
    else if (adjustedMargin < 0) outcome = 'loss';
    else outcome = 'push';
  } else {
    // Bet away spread
    const adjustedMargin = -homeMargin - marketSpread;
    if (adjustedMargin > 0) outcome = 'win';
    else if (adjustedMargin < 0) outcome = 'loss';
    else outcome = 'push';
  }

  const profit = calculateProfit(outcome, betTick.price_american);

  // Calculate CLV
  let clvPoints: number | null = null;
  if (closeNumber !== null) {
    if (betHome) {
      clvPoints = closeNumber - marketSpread; // Got better number if positive
    } else {
      clvPoints = marketSpread - closeNumber; // Got better number if positive
    }
  }

  return {
    eventId: event.id,
    homeTeam: event.home_team?.name || 'Unknown',
    awayTeam: event.away_team?.name || 'Unknown',
    commenceTime: event.commence_time,
    sportsbookKey: sbInfo.key,
    marketType: 'spread',
    betSide,
    betLabel,
    edgePoints,
    betNumber,
    betPrice: betTick.price_american,
    closeNumber,
    actualResult: homeMargin,
    outcome,
    profit,
    clvPoints,
  };
}

/**
 * Evaluate a total bet
 */
async function evaluateTotalBet(
  event: {
    id: string;
    commence_time: string;
    home_team: { name: string } | null;
    away_team: { name: string } | null;
  },
  result: { final_total: number },
  sbId: string,
  sbInfo: { key: string; name: string },
  projection: { model_total_points: number },
  betTime: Date,
  commenceTime: Date,
  config: BacktestConfig
): Promise<BacktestBet | null> {
  // Get tick at bet time
  const { data: betTick } = await supabase
    .from('odds_ticks')
    .select('total_points, price_american')
    .eq('event_id', event.id)
    .eq('sportsbook_id', sbId)
    .eq('market_type', 'total')
    .eq('side', 'over')
    .lte('captured_at', betTime.toISOString())
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (!betTick || betTick.total_points === null) return null;

  const marketTotal = betTick.total_points;
  const modelTotal = projection.model_total_points;
  const edgePoints = marketTotal - modelTotal;

  // Check threshold
  if (Math.abs(edgePoints) < config.edgeThreshold) return null;

  // Determine bet side
  // edge > 0 means market higher than model → bet under
  // edge < 0 means market lower than model → bet over
  const betUnder = edgePoints > 0;
  const betSide = betUnder ? 'under' : 'over';
  const betLabel = betUnder ? `Under ${marketTotal}` : `Over ${marketTotal}`;

  // Get closing line
  const { data: closingLine } = await supabase
    .from('closing_lines')
    .select('total_points')
    .eq('event_id', event.id)
    .eq('sportsbook_id', sbId)
    .eq('market_type', 'total')
    .eq('side', 'over')
    .single();

  const closeNumber = closingLine?.total_points ?? null;

  // Evaluate outcome
  const finalTotal = result.final_total;
  let outcome: 'win' | 'loss' | 'push';

  if (betUnder) {
    if (finalTotal < marketTotal) outcome = 'win';
    else if (finalTotal > marketTotal) outcome = 'loss';
    else outcome = 'push';
  } else {
    if (finalTotal > marketTotal) outcome = 'win';
    else if (finalTotal < marketTotal) outcome = 'loss';
    else outcome = 'push';
  }

  const profit = calculateProfit(outcome, betTick.price_american);

  // Calculate CLV
  let clvPoints: number | null = null;
  if (closeNumber !== null) {
    if (betUnder) {
      clvPoints = marketTotal - closeNumber; // Higher close = got better number
    } else {
      clvPoints = closeNumber - marketTotal; // Lower close = got better number
    }
  }

  return {
    eventId: event.id,
    homeTeam: event.home_team?.name || 'Unknown',
    awayTeam: event.away_team?.name || 'Unknown',
    commenceTime: event.commence_time,
    sportsbookKey: sbInfo.key,
    marketType: 'total',
    betSide,
    betLabel,
    edgePoints,
    betNumber: marketTotal,
    betPrice: betTick.price_american,
    closeNumber,
    actualResult: finalTotal,
    outcome,
    profit,
    clvPoints,
  };
}

/**
 * Calculate profit based on outcome and American odds
 */
function calculateProfit(outcome: 'win' | 'loss' | 'push', price: number): number {
  if (outcome === 'push') return 0;
  if (outcome === 'loss') return -100;

  // Win
  if (price > 0) {
    return price; // e.g., +150 wins $150 on $100
  } else {
    return (100 / Math.abs(price)) * 100; // e.g., -110 wins $90.91 on $100
  }
}

/**
 * Calculate aggregate metrics
 */
function calculateMetrics(config: BacktestConfig, bets: BacktestBet[]): BacktestResult {
  if (bets.length === 0) return createEmptyResult(config);

  const wins = bets.filter(b => b.outcome === 'win').length;
  const losses = bets.filter(b => b.outcome === 'loss').length;
  const pushes = bets.filter(b => b.outcome === 'push').length;
  const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0);
  const totalWagered = bets.length * 100;
  const avgEdge = bets.reduce((sum, b) => sum + Math.abs(b.edgePoints), 0) / bets.length;

  const clvBets = bets.filter(b => b.clvPoints !== null);
  const avgClv = clvBets.length > 0
    ? clvBets.reduce((sum, b) => sum + (b.clvPoints || 0), 0) / clvBets.length
    : null;

  // By market breakdown
  const spreadBets = bets.filter(b => b.marketType === 'spread');
  const totalBets = bets.filter(b => b.marketType === 'total');

  const spreadWins = spreadBets.filter(b => b.outcome === 'win').length;
  const spreadLosses = spreadBets.filter(b => b.outcome === 'loss').length;
  const spreadProfit = spreadBets.reduce((sum, b) => sum + b.profit, 0);

  const totalWins = totalBets.filter(b => b.outcome === 'win').length;
  const totalLosses = totalBets.filter(b => b.outcome === 'loss').length;
  const totalMarketProfit = totalBets.reduce((sum, b) => sum + b.profit, 0);

  // By sportsbook breakdown
  const bySportsbook: Record<string, { bets: number; winRate: number; roi: number }> = {};
  const sportsbookGroups = new Map<string, BacktestBet[]>();

  for (const bet of bets) {
    if (!sportsbookGroups.has(bet.sportsbookKey)) {
      sportsbookGroups.set(bet.sportsbookKey, []);
    }
    sportsbookGroups.get(bet.sportsbookKey)!.push(bet);
  }

  for (const [key, sbBets] of sportsbookGroups) {
    const sbWins = sbBets.filter(b => b.outcome === 'win').length;
    const sbLosses = sbBets.filter(b => b.outcome === 'loss').length;
    const sbProfit = sbBets.reduce((sum, b) => sum + b.profit, 0);

    bySportsbook[key] = {
      bets: sbBets.length,
      winRate: sbWins + sbLosses > 0 ? sbWins / (sbWins + sbLosses) : 0,
      roi: sbBets.length > 0 ? sbProfit / (sbBets.length * 100) : 0,
    };
  }

  return {
    config,
    bets,
    metrics: {
      totalBets: bets.length,
      wins,
      losses,
      pushes,
      winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
      totalWagered,
      totalProfit,
      roi: totalWagered > 0 ? totalProfit / totalWagered : 0,
      avgEdge,
      avgClv,
      byMarket: {
        spread: {
          bets: spreadBets.length,
          winRate: spreadWins + spreadLosses > 0 ? spreadWins / (spreadWins + spreadLosses) : 0,
          roi: spreadBets.length > 0 ? spreadProfit / (spreadBets.length * 100) : 0,
        },
        total: {
          bets: totalBets.length,
          winRate: totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0,
          roi: totalBets.length > 0 ? totalMarketProfit / (totalBets.length * 100) : 0,
        },
      },
      bySportsbook,
    },
  };
}

function createEmptyResult(config: BacktestConfig): BacktestResult {
  return {
    config,
    bets: [],
    metrics: {
      totalBets: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      winRate: 0,
      totalWagered: 0,
      totalProfit: 0,
      roi: 0,
      avgEdge: 0,
      avgClv: null,
      byMarket: {
        spread: { bets: 0, winRate: 0, roi: 0 },
        total: { bets: 0, winRate: 0, roi: 0 },
      },
      bySportsbook: {},
    },
  };
}

function formatSpread(points: number): string {
  if (points > 0) return `+${points}`;
  return points.toString();
}

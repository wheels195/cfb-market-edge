/**
 * Ablation Test Framework
 *
 * Tests each feature incrementally:
 * 1. Baseline: Prior-season SP+ only
 * 2. + Returning Production preseason adjustment
 * 3. + In-season PPA updates
 * 4. + Recent form (last 3 games)
 * 5. + Rest days adjustment
 *
 * Reports incremental lift for each feature.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// =============================================================================
// TYPES
// =============================================================================

interface ModelConfig {
  name: string;
  useReturningProd: boolean;
  useInSeasonPPA: boolean;
  useRecentForm: boolean;
  useRestDays: boolean;
  homeFieldAdvantage: number;
  returningProdWeight: number;
  ppaUpdateWeight: number;
  recentFormWeight: number;
  restDaysWeight: number;
}

interface TeamData {
  priorSP: number;
  returningProd: number | null;
  weeklyPPA: Map<number, { off: number; def: number }>;
  gameDates: Map<number, Date>;
}

interface GameProjection {
  eventId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  projectedSpread: number;
  closingSpread: number;
  actualMargin: number;
}

// =============================================================================
// CONFIGS
// =============================================================================

const CONFIGS: ModelConfig[] = [
  {
    name: 'Baseline (SP+ only)',
    useReturningProd: false,
    useInSeasonPPA: false,
    useRecentForm: false,
    useRestDays: false,
    homeFieldAdvantage: 2.5,
    returningProdWeight: 0,
    ppaUpdateWeight: 0,
    recentFormWeight: 0,
    restDaysWeight: 0,
  },
  {
    name: '+ Returning Production',
    useReturningProd: true,
    useInSeasonPPA: false,
    useRecentForm: false,
    useRestDays: false,
    homeFieldAdvantage: 2.5,
    returningProdWeight: 0.15,
    ppaUpdateWeight: 0,
    recentFormWeight: 0,
    restDaysWeight: 0,
  },
  {
    name: '+ In-Season PPA',
    useReturningProd: true,
    useInSeasonPPA: true,
    useRecentForm: false,
    useRestDays: false,
    homeFieldAdvantage: 2.5,
    returningProdWeight: 0.15,
    ppaUpdateWeight: 0.10,
    recentFormWeight: 0,
    restDaysWeight: 0,
  },
  {
    name: '+ Recent Form (L3)',
    useReturningProd: true,
    useInSeasonPPA: true,
    useRecentForm: true,
    useRestDays: false,
    homeFieldAdvantage: 2.5,
    returningProdWeight: 0.15,
    ppaUpdateWeight: 0.10,
    recentFormWeight: 0.05,
    restDaysWeight: 0,
  },
  {
    name: '+ Rest Days',
    useReturningProd: true,
    useInSeasonPPA: true,
    useRecentForm: true,
    useRestDays: true,
    homeFieldAdvantage: 2.5,
    returningProdWeight: 0.15,
    ppaUpdateWeight: 0.10,
    recentFormWeight: 0.05,
    restDaysWeight: 0.3,
  },
];

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadAllData(season: number): Promise<{
  priorSP: Map<string, number>;
  returningProd: Map<string, number>;
  gamePPA: Map<string, { week: number; off: number; def: number; date: Date }[]>;
  teams: Map<string, string>;
}> {
  // Prior season SP+
  const { data: spData } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_overall')
    .eq('season', season - 1)
    .not('sp_overall', 'is', null);

  const priorSP = new Map<string, number>();
  for (const row of spData || []) {
    priorSP.set(row.team_id, row.sp_overall);
  }

  // Returning production for current season
  const { data: prodData } = await supabase
    .from('returning_production')
    .select('team_id, percent_ppa')
    .eq('season', season)
    .not('percent_ppa', 'is', null);

  const returningProd = new Map<string, number>();
  for (const row of prodData || []) {
    returningProd.set(row.team_id, row.percent_ppa);
  }

  // Game PPA with pagination
  const gamePPA = new Map<string, { week: number; off: number; def: number; date: Date }[]>();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: ppaData } = await supabase
      .from('game_advanced_stats')
      .select('team_id, week, off_ppa, def_ppa')
      .eq('season', season)
      .range(offset, offset + pageSize - 1)
      .order('week', { ascending: true });

    if (!ppaData || ppaData.length === 0) break;

    for (const row of ppaData) {
      if (!gamePPA.has(row.team_id)) {
        gamePPA.set(row.team_id, []);
      }
      // Estimate date from week (approximate)
      const weekStart = new Date(`${season}-08-26`);
      weekStart.setDate(weekStart.getDate() + (row.week - 1) * 7);

      gamePPA.get(row.team_id)!.push({
        week: row.week,
        off: row.off_ppa || 0,
        def: row.def_ppa || 0,
        date: weekStart,
      });
    }

    offset += pageSize;
    if (ppaData.length < pageSize) break;
  }

  // Teams
  const { data: teamData } = await supabase.from('teams').select('id, name');
  const teams = new Map<string, string>();
  for (const t of teamData || []) {
    teams.set(t.id, t.name);
  }

  return { priorSP, returningProd, gamePPA, teams };
}

async function loadEventsWithClosing(season: number): Promise<any[]> {
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

  // Get Pinnacle closing lines
  const { data: pinnacle } = await supabase
    .from('sportsbooks')
    .select('id')
    .eq('key', 'pinnacle')
    .single();

  const pinnacleId = pinnacle?.id;

  const eventIds = allEvents.map(e => e.id);
  const closingMap = new Map<string, number>();

  for (let i = 0; i < eventIds.length; i += 100) {
    const batchIds = eventIds.slice(i, i + 100);

    // Try Pinnacle first
    if (pinnacleId) {
      const { data: lines } = await supabase
        .from('closing_lines')
        .select('event_id, spread_points_home')
        .in('event_id', batchIds)
        .eq('market_type', 'spread')
        .eq('side', 'home')
        .eq('sportsbook_id', pinnacleId)
        .not('spread_points_home', 'is', null);

      for (const cl of lines || []) {
        closingMap.set(cl.event_id, cl.spread_points_home);
      }
    }

    // Fill in with any valid lines
    const missing = batchIds.filter(id => !closingMap.has(id));
    if (missing.length > 0) {
      const { data: lines } = await supabase
        .from('closing_lines')
        .select('event_id, spread_points_home')
        .in('event_id', missing)
        .eq('market_type', 'spread')
        .eq('side', 'home')
        .not('spread_points_home', 'is', null)
        .gte('price_american', -150)
        .lte('price_american', -100);

      for (const cl of lines || []) {
        if (!closingMap.has(cl.event_id)) {
          closingMap.set(cl.event_id, cl.spread_points_home);
        }
      }
    }
  }

  return allEvents.map(e => ({
    ...e,
    closingSpread: closingMap.get(e.id),
  }));
}

// =============================================================================
// PROJECTION
// =============================================================================

function getWeekFromDate(date: string, season: number): number {
  const gameDate = new Date(date);
  const seasonStart = new Date(`${season}-08-26`);
  const daysDiff = Math.floor((gameDate.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.min(16, Math.ceil(daysDiff / 7)));
}

function calculateRating(
  teamId: string,
  week: number,
  gameDate: Date,
  data: {
    priorSP: Map<string, number>;
    returningProd: Map<string, number>;
    gamePPA: Map<string, { week: number; off: number; def: number; date: Date }[]>;
  },
  config: ModelConfig
): number | null {
  const baseSP = data.priorSP.get(teamId);
  if (baseSP === undefined) return null;

  let rating = baseSP;

  // Returning production adjustment
  if (config.useReturningProd) {
    const retProd = data.returningProd.get(teamId);
    if (retProd !== undefined) {
      // retProd is 0-1, average is ~0.5
      // Above average = positive adjustment, below = negative
      const adjustment = (retProd - 0.5) * config.returningProdWeight * 20; // Scale to SP+ points
      rating += adjustment;
    }
  }

  // In-season PPA updates
  if (config.useInSeasonPPA) {
    const games = data.gamePPA.get(teamId);
    if (games && games.length > 0) {
      // Get games BEFORE current week
      const priorGames = games.filter(g => g.week < week);
      if (priorGames.length > 0) {
        // Average net PPA
        const avgNetPPA = priorGames.reduce((sum, g) => sum + (g.off - g.def), 0) / priorGames.length;
        // Convert to SP+ scale (PPA ~0.1-0.3, SP+ ~-30 to +30)
        const expectedPPA = baseSP / 100; // Approximate expected PPA from SP+
        const ppaVsExpected = avgNetPPA - expectedPPA;
        rating += ppaVsExpected * config.ppaUpdateWeight * 100;
      }
    }
  }

  // Recent form (last 3 games)
  if (config.useRecentForm) {
    const games = data.gamePPA.get(teamId);
    if (games && games.length > 0) {
      const priorGames = games.filter(g => g.week < week).slice(-3);
      if (priorGames.length > 0) {
        const avgRecent = priorGames.reduce((sum, g) => sum + (g.off - g.def), 0) / priorGames.length;
        const avgAll = games
          .filter(g => g.week < week)
          .reduce((sum, g) => sum + (g.off - g.def), 0) /
          Math.max(1, games.filter(g => g.week < week).length);

        const recentVsAvg = avgRecent - avgAll;
        rating += recentVsAvg * config.recentFormWeight * 100;
      }
    }
  }

  return rating;
}

function calculateRestAdjustment(
  teamId: string,
  week: number,
  gameDate: Date,
  gamePPA: Map<string, { week: number; off: number; def: number; date: Date }[]>,
  config: ModelConfig
): number {
  if (!config.useRestDays) return 0;

  const games = gamePPA.get(teamId);
  if (!games || games.length === 0) return 0;

  const priorGames = games.filter(g => g.week < week).sort((a, b) => b.week - a.week);
  if (priorGames.length === 0) return 0;

  const lastGame = priorGames[0];
  const daysSinceLast = Math.floor(
    (gameDate.getTime() - lastGame.date.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Standard is 7 days. More = advantage, less = disadvantage
  // Extra day = ~0.5 point advantage, missing day = ~0.5 disadvantage
  const restDiff = daysSinceLast - 7;
  return restDiff * config.restDaysWeight;
}

// =============================================================================
// METRICS
// =============================================================================

interface Metrics {
  n: number;
  mae: number;
  rmse: number;
  correlation: number;
  closingMAE: number;
  maeVsClose: number;
  winRate: number;
  roi: number;
}

function calculateMetrics(projections: GameProjection[]): Metrics {
  const n = projections.length;
  if (n === 0) {
    return { n: 0, mae: 0, rmse: 0, correlation: 0, closingMAE: 0, maeVsClose: 0, winRate: 0, roi: 0 };
  }

  // Model errors (predicted margin = -projectedSpread)
  const modelErrors = projections.map(p => (-p.projectedSpread) - p.actualMargin);
  const mae = modelErrors.reduce((s, e) => s + Math.abs(e), 0) / n;
  const rmse = Math.sqrt(modelErrors.reduce((s, e) => s + e * e, 0) / n);

  // Closing line errors
  const closeErrors = projections.map(p => (-p.closingSpread) - p.actualMargin);
  const closingMAE = closeErrors.reduce((s, e) => s + Math.abs(e), 0) / n;

  // MAE difference (negative = model better)
  const maeVsClose = mae - closingMAE;

  // Correlation
  const predicted = projections.map(p => -p.projectedSpread);
  const actual = projections.map(p => p.actualMargin);
  const meanPred = predicted.reduce((a, b) => a + b, 0) / n;
  const meanAct = actual.reduce((a, b) => a + b, 0) / n;

  let num = 0, denomPred = 0, denomAct = 0;
  for (let i = 0; i < n; i++) {
    num += (predicted[i] - meanPred) * (actual[i] - meanAct);
    denomPred += Math.pow(predicted[i] - meanPred, 2);
    denomAct += Math.pow(actual[i] - meanAct, 2);
  }
  const correlation = denomPred > 0 && denomAct > 0
    ? num / (Math.sqrt(denomPred) * Math.sqrt(denomAct))
    : 0;

  // Betting simulation (bet when model differs from close by 3+ points)
  let wins = 0, bets = 0;
  for (const p of projections) {
    const edge = p.projectedSpread - p.closingSpread;
    if (Math.abs(edge) < 3) continue;

    bets++;
    const side = edge < 0 ? 'home' : 'away';
    const homeCovered = p.actualMargin > -p.closingSpread;
    const won = (side === 'home' && homeCovered) || (side === 'away' && !homeCovered);
    if (won) wins++;
  }

  const winRate = bets > 0 ? wins / bets : 0;
  // At -110, need 52.38% to break even
  // ROI = (winRate * 0.909 - (1-winRate)) / 1
  const roi = bets > 0 ? (winRate * 0.909 - (1 - winRate)) : 0;

  return { n, mae, rmse, correlation, closingMAE, maeVsClose, winRate, roi };
}

// =============================================================================
// MAIN
// =============================================================================

async function runAblation(season: number, config: ModelConfig): Promise<GameProjection[]> {
  const data = await loadAllData(season);
  const events = await loadEventsWithClosing(season);

  const projections: GameProjection[] = [];

  for (const event of events) {
    const homeTeam = event.home_team as { id: string; name: string };
    const awayTeam = event.away_team as { id: string; name: string };
    const results = event.results as { home_score: number; away_score: number } | null;

    if (!homeTeam?.id || !awayTeam?.id) continue;
    if (event.closingSpread === undefined) continue;
    if (!results) continue;

    const week = getWeekFromDate(event.commence_time, season);
    const gameDate = new Date(event.commence_time);

    const homeRating = calculateRating(event.home_team_id, week, gameDate, data, config);
    const awayRating = calculateRating(event.away_team_id, week, gameDate, data, config);

    if (homeRating === null || awayRating === null) continue;

    // Rest adjustments
    const homeRest = calculateRestAdjustment(event.home_team_id, week, gameDate, data.gamePPA, config);
    const awayRest = calculateRestAdjustment(event.away_team_id, week, gameDate, data.gamePPA, config);
    const restDiff = homeRest - awayRest;

    // Project spread
    const ratingDiff = homeRating - awayRating;
    const projectedSpread = -ratingDiff - config.homeFieldAdvantage - restDiff;

    projections.push({
      eventId: event.id,
      season,
      week,
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
      projectedSpread,
      closingSpread: event.closingSpread,
      actualMargin: results.home_score - results.away_score,
    });
  }

  return projections;
}

async function main() {
  const seasons = [2023, 2024];

  console.log('=== ABLATION TEST FRAMEWORK ===');
  console.log(`Testing ${CONFIGS.length} configurations across ${seasons.join(', ')}\n`);

  console.log('Config                      | Games | MAE   | Closing | MAE vs  | Corr   | Win%  | ROI');
  console.log('                            |       |       | MAE     | Close   |        | (3pt) | (3pt)');
  console.log('----------------------------|-------|-------|---------|---------|--------|-------|------');

  let prevMAE: number | null = null;

  for (const config of CONFIGS) {
    const allProjections: GameProjection[] = [];

    for (const season of seasons) {
      const projections = await runAblation(season, config);
      allProjections.push(...projections);
    }

    const metrics = calculateMetrics(allProjections);

    const lift = prevMAE !== null ? (prevMAE - metrics.mae).toFixed(2) : '-';
    prevMAE = metrics.mae;

    const configName = config.name.padEnd(27);
    console.log(
      `${configName} | ${metrics.n.toString().padStart(5)} | ` +
      `${metrics.mae.toFixed(2).padStart(5)} | ${metrics.closingMAE.toFixed(2).padStart(7)} | ` +
      `${(metrics.maeVsClose >= 0 ? '+' : '') + metrics.maeVsClose.toFixed(2).padStart(6)} | ` +
      `${metrics.correlation.toFixed(3).padStart(6)} | ` +
      `${(metrics.winRate * 100).toFixed(1).padStart(4)}% | ` +
      `${(metrics.roi * 100).toFixed(1).padStart(4)}%`
    );
  }

  console.log('\n---');
  console.log('MAE vs Close: negative = model beats closing line');
  console.log('Win%/ROI: betting when |model-close| >= 3 points');

  console.log('\n=== ABLATION COMPLETE ===');
}

main().catch(console.error);

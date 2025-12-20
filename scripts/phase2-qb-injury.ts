/**
 * Phase 2: QB Injury Test
 *
 * Approach:
 * 1. Identify starting QB per team (most pass attempts weeks 1-3)
 * 2. For each game, check if starter played
 * 3. Binary signal: starter_qb_out = true/false
 * 4. Adjust spread when opponent's QB is out (favor team facing backup)
 *
 * Acceptance: Brier improves + stable across sub-periods
 */

import { createClient } from '@supabase/supabase-js';
import {
  projectSpread as v1ProjectSpread,
  calculateEdge,
  didCover,
  calculateProfit,
  brierScore,
  impliedProbability,
} from '../src/lib/models/v1-elo-model';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const API_KEY = process.env.CFBD_API_KEY || '';

// ============================================================================
// STEP 0: Build CFBD school name → our team UUID mapping
// ============================================================================

async function buildTeamMapping(): Promise<Map<string, string>> {
  // Get CFBD teams (school name → cfbd_id)
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdTeams = await res.json();

  const schoolToCfbdId = new Map<string, number>();
  for (const t of cfbdTeams) {
    schoolToCfbdId.set(t.school.toLowerCase(), t.id);
  }

  // Get our teams (cfbd_team_id → our UUID)
  const { data: ourTeams } = await supabase
    .from('teams')
    .select('id, cfbd_team_id')
    .not('cfbd_team_id', 'is', null);

  const cfbdIdToUuid = new Map<number, string>();
  for (const t of ourTeams || []) {
    cfbdIdToUuid.set(parseInt(t.cfbd_team_id, 10), t.id);
  }

  // Build: CFBD school name (lowercase) → our UUID
  const schoolToUuid = new Map<string, string>();
  for (const [school, cfbdId] of schoolToCfbdId) {
    const uuid = cfbdIdToUuid.get(cfbdId);
    if (uuid) {
      schoolToUuid.set(school, uuid);
    }
  }

  console.log(`Team mapping: ${schoolToUuid.size} CFBD schools → our UUIDs`);
  return schoolToUuid;
}

// ============================================================================
// STEP 1: Fetch QB game data from CFBD
// ============================================================================

interface QBGameStats {
  season: number;
  week: number;
  gameId: number;
  teamUuid: string;  // Our team UUID (not CFBD name)
  qbName: string;
  attempts: number;
}

async function fetchQBGameStats(season: number, schoolToUuid: Map<string, string>): Promise<QBGameStats[]> {
  console.log(`  Fetching ${season} QB stats...`);
  const results: QBGameStats[] = [];

  for (let week = 1; week <= 16; week++) {
    try {
      const res = await fetch(
        `https://api.collegefootballdata.com/games/players?year=${season}&week=${week}&seasonType=regular`,
        { headers: { 'Authorization': `Bearer ${API_KEY}` } }
      );

      if (!res.ok) continue;
      const games = await res.json();

      for (const game of games) {
        for (const team of game.teams || []) {
          const schoolName = (team.team || '').toLowerCase();
          const teamUuid = schoolToUuid.get(schoolName);
          if (!teamUuid) continue;  // Skip teams not in our events

          const passing = team.categories?.find((c: any) => c.name === 'passing');
          if (!passing) continue;

          const attType = passing.types?.find((t: any) => t.name === 'C/ATT' || t.name === 'ATT');
          if (!attType) continue;

          for (const athlete of attType.athletes || []) {
            // Parse attempts from "C/ATT" format like "26/31"
            let attempts = 0;
            if (typeof athlete.stat === 'string' && athlete.stat.includes('/')) {
              attempts = parseInt(athlete.stat.split('/')[1], 10) || 0;
            } else {
              attempts = parseInt(athlete.stat, 10) || 0;
            }

            if (attempts > 0) {
              results.push({
                season,
                week,
                gameId: game.id,
                teamUuid,
                qbName: athlete.name,
                attempts,
              });
            }
          }
        }
      }
    } catch (err) {
      // Week doesn't exist
    }
  }

  console.log(`    ${results.length} QB game records`);
  return results;
}

// ============================================================================
// STEP 2: Identify starters and detect when they're out
// ============================================================================

interface TeamQBStatus {
  teamUuid: string;
  season: number;
  starterName: string;
  starterAttempts: number;
  // Per-week: is starter playing?
  weekStatus: Map<number, boolean>;
}

function identifyStartersAndStatus(qbStats: QBGameStats[]): Map<string, TeamQBStatus> {
  // Group by teamUuid + season
  const byTeamSeason = new Map<string, QBGameStats[]>();
  for (const stat of qbStats) {
    const key = `${stat.teamUuid}-${stat.season}`;
    if (!byTeamSeason.has(key)) byTeamSeason.set(key, []);
    byTeamSeason.get(key)!.push(stat);
  }

  const results = new Map<string, TeamQBStatus>();

  for (const [key, stats] of byTeamSeason) {
    // Key format: UUID-season (UUID contains dashes, so split from end)
    const lastDash = key.lastIndexOf('-');
    const teamUuid = key.substring(0, lastDash);
    const season = parseInt(key.substring(lastDash + 1), 10);

    // Find starter: most attempts in weeks 1-3
    const earlyStats = stats.filter(s => s.week <= 3);
    const attemptsByQB = new Map<string, number>();
    for (const s of earlyStats) {
      attemptsByQB.set(s.qbName, (attemptsByQB.get(s.qbName) || 0) + s.attempts);
    }

    let starterName = '';
    let starterAttempts = 0;
    for (const [name, attempts] of attemptsByQB) {
      if (attempts > starterAttempts) {
        starterName = name;
        starterAttempts = attempts;
      }
    }

    if (!starterName) continue;

    // For each week, check if starter played (had any attempts)
    const weekStatus = new Map<number, boolean>();
    const weeks = [...new Set(stats.map(s => s.week))];

    for (const week of weeks) {
      const weekStats = stats.filter(s => s.week === week);
      const starterPlayed = weekStats.some(s => s.qbName === starterName && s.attempts > 0);
      weekStatus.set(week, starterPlayed);
    }

    results.set(key, { teamUuid, season, starterName, starterAttempts, weekStatus });
  }

  return results;
}

// ============================================================================
// STEP 3: Load backtest data with QB status
// ============================================================================

interface BacktestGame {
  eventId: string;
  season: number;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeElo: number;
  awayElo: number;
  homeQBOut: boolean | null;
  awayQBOut: boolean | null;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeMargin: number;
}

async function loadBacktestData(qbStatus: Map<string, TeamQBStatus>): Promise<{ train: BacktestGame[]; test: BacktestGame[] }> {
  console.log('\nLoading backtest data...');

  // Load events
  let allEvents: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('events')
      .select(`id, commence_time, home_team_id, away_team_id,
        home_team:home_team_id(id, name), away_team:away_team_id(id, name)`)
      .eq('status', 'final')
      .order('commence_time')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allEvents = allEvents.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Load results
  const resultMap = new Map<string, { homeScore: number; awayScore: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('results').select('event_id, home_score, away_score').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) resultMap.set(r.event_id, { homeScore: r.home_score, awayScore: r.away_score });
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Load Elo
  const eloMap = new Map<string, number>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('team_elo_snapshots').select('team_id, season, week, elo').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) eloMap.set(`${s.team_id}-${s.season}-${s.week}`, s.elo);
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Load closing lines
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

  const train: BacktestGame[] = [];
  const test: BacktestGame[] = [];

  for (const event of allEvents) {
    const season = getSeason(event.commence_time);
    if (season < 2022 || season > 2024) continue;

    const week = getWeek(event.commence_time, season);
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;
    const homeTeamName = (event.home_team as any)?.name || 'Unknown';
    const awayTeamName = (event.away_team as any)?.name || 'Unknown';

    const result = resultMap.get(event.id);
    const closing = closingMap.get(event.id);
    if (!result || !closing) continue;

    const eloWeek = Math.max(0, week - 1);
    const homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`) || eloMap.get(`${homeTeamId}-${season}-0`);
    const awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`) || eloMap.get(`${awayTeamId}-${season}-0`);
    if (!homeElo || !awayElo) continue;

    // Get QB status using exact UUID match
    let homeQBOut: boolean | null = null;
    let awayQBOut: boolean | null = null;

    const homeQBStatus = qbStatus.get(`${homeTeamId}-${season}`);
    const awayQBStatus = qbStatus.get(`${awayTeamId}-${season}`);

    if (homeQBStatus) {
      const played = homeQBStatus.weekStatus.get(week);
      if (played !== undefined) homeQBOut = !played;
    }
    if (awayQBStatus) {
      const played = awayQBStatus.weekStatus.get(week);
      if (played !== undefined) awayQBOut = !played;
    }

    const game: BacktestGame = {
      eventId: event.id,
      season,
      week,
      homeTeamId,
      awayTeamId,
      homeTeamName,
      awayTeamName,
      homeElo,
      awayElo,
      homeQBOut,
      awayQBOut,
      marketSpreadHome: closing.spreadHome,
      spreadPriceHome: closing.priceHome,
      spreadPriceAway: closing.priceAway,
      homeMargin: result.homeScore - result.awayScore,
    };

    if (season <= 2023) train.push(game);
    else if (season === 2024) test.push(game);
  }

  // Count QB data coverage
  const trainWithQB = train.filter(g => g.homeQBOut !== null && g.awayQBOut !== null).length;
  const testWithQB = test.filter(g => g.homeQBOut !== null && g.awayQBOut !== null).length;
  const trainQBOut = train.filter(g => g.homeQBOut === true || g.awayQBOut === true).length;
  const testQBOut = test.filter(g => g.homeQBOut === true || g.awayQBOut === true).length;

  console.log(`  Train: ${train.length} games (${trainWithQB} with QB data, ${trainQBOut} with starter out)`);
  console.log(`  Test: ${test.length} games (${testWithQB} with QB data, ${testQBOut} with starter out)`);

  return { train, test };
}

// ============================================================================
// STEP 4: V2 projection with QB injury adjustment
// ============================================================================

function projectSpreadV2(
  homeElo: number,
  awayElo: number,
  homeQBOut: boolean | null,
  awayQBOut: boolean | null,
  qbAdjustment: number // Points to adjust when opponent QB is out
): number {
  // Base Elo projection (same as V1)
  const { modelSpreadHome } = v1ProjectSpread(homeElo, awayElo);

  // QB adjustment: if opponent's QB is out, we're stronger
  let adjustment = 0;
  if (awayQBOut === true) adjustment -= qbAdjustment; // Home benefits, spread more negative
  if (homeQBOut === true) adjustment += qbAdjustment; // Away benefits, spread more positive

  return modelSpreadHome + adjustment;
}

// ============================================================================
// STEP 5: Backtest
// ============================================================================

interface BacktestResult {
  bets: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
  avgBrier: number;
}

function runBacktest(games: BacktestGame[], qbAdjustment: number): BacktestResult {
  let wins = 0, losses = 0, totalProfit = 0, brierSum = 0, brierCount = 0;

  for (const game of games) {
    const modelSpreadHome = qbAdjustment === 0
      ? v1ProjectSpread(game.homeElo, game.awayElo).modelSpreadHome
      : projectSpreadV2(game.homeElo, game.awayElo, game.homeQBOut, game.awayQBOut, qbAdjustment);

    const { edge, side } = calculateEdge(game.marketSpreadHome, modelSpreadHome);
    const priceAmerican = side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
    const covered = didCover(game.homeMargin, game.marketSpreadHome, side);
    const profit = calculateProfit(covered, priceAmerican);

    if (covered === true) wins++;
    else if (covered === false) losses++;

    if (covered !== null) {
      totalProfit += profit;
      brierSum += brierScore(impliedProbability(priceAmerican), covered);
      brierCount++;
    }
  }

  return {
    bets: wins + losses,
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    roi: wins + losses > 0 ? (totalProfit / ((wins + losses) * 100)) * 100 : 0,
    avgBrier: brierCount > 0 ? brierSum / brierCount : 0,
  };
}

function runSubPeriodBacktest(games: BacktestGame[], qbAdjustment: number): { early: BacktestResult; late: BacktestResult } {
  const early = games.filter(g => g.week <= 8);
  const late = games.filter(g => g.week > 8);
  return {
    early: runBacktest(early, qbAdjustment),
    late: runBacktest(late, qbAdjustment),
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              PHASE 2: QB INJURY TEST                           ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ Signal: Starter QB out = opponent gets boost                   ║');
  console.log('║ Acceptance: Brier improves + stable across sub-periods         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Build team mapping first (CFBD school name → our UUID)
  console.log('=== Building Team Mapping ===');
  const schoolToUuid = await buildTeamMapping();

  // Fetch QB stats for all seasons
  console.log('\n=== Fetching QB Game Stats ===');
  const allQBStats: QBGameStats[] = [];
  for (const season of [2022, 2023, 2024]) {
    const stats = await fetchQBGameStats(season, schoolToUuid);
    allQBStats.push(...stats);
  }
  console.log(`Total QB game records: ${allQBStats.length}`);

  // Identify starters and their status
  console.log('\n=== Identifying Starters ===');
  const qbStatus = identifyStartersAndStatus(allQBStats);
  console.log(`Teams with identified starters: ${qbStatus.size}`);

  // Count games with starter out
  let gamesWithStarterOut = 0;
  for (const [_, status] of qbStatus) {
    for (const [_, played] of status.weekStatus) {
      if (!played) gamesWithStarterOut++;
    }
  }
  console.log(`Team-games with starter out: ${gamesWithStarterOut}`);

  // Load backtest data
  const { train, test } = await loadBacktestData(qbStatus);

  // Coarse adjustment grid
  const adjustments = [0, 3, 5, 7];

  // Find best adjustment on train set
  console.log('\n=== TRAIN SET: Adjustment Search ===');
  console.log('Adjust    Bets    WinRate    ROI       Brier');
  console.log('─'.repeat(55));

  let bestAdj = 0;
  let bestTrainBrier = Infinity;

  for (const adj of adjustments) {
    const r = runBacktest(train, adj);
    const label = adj === 0 ? 'V1' : `V2(${adj})`;
    console.log(
      `${label.padEnd(10)}${r.bets.toString().padEnd(8)}${(r.winRate * 100).toFixed(1).padEnd(11)}` +
      `${r.roi.toFixed(2).padEnd(10)}${r.avgBrier.toFixed(4)}`
    );

    if (adj > 0 && r.avgBrier < bestTrainBrier) {
      bestTrainBrier = r.avgBrier;
      bestAdj = adj;
    }
  }

  console.log(`\nBest train adjustment: ${bestAdj} points`);

  // Evaluate on test set
  console.log('\n=== TEST SET: V1 vs V2 ===');

  const v1Test = runBacktest(test, 0);
  const v2Test = runBacktest(test, bestAdj);

  console.log('\n         Bets    WinRate    ROI       Brier');
  console.log('─'.repeat(55));
  console.log(`V1       ${v1Test.bets.toString().padEnd(8)}${(v1Test.winRate * 100).toFixed(1).padEnd(11)}${v1Test.roi.toFixed(2).padEnd(10)}${v1Test.avgBrier.toFixed(4)}`);
  console.log(`V2(${bestAdj})    ${v2Test.bets.toString().padEnd(8)}${(v2Test.winRate * 100).toFixed(1).padEnd(11)}${v2Test.roi.toFixed(2).padEnd(10)}${v2Test.avgBrier.toFixed(4)}`);

  const brierImproved = v2Test.avgBrier < v1Test.avgBrier;
  console.log(`\nBrier: ${v1Test.avgBrier.toFixed(4)} → ${v2Test.avgBrier.toFixed(4)} (${brierImproved ? 'IMPROVED' : 'WORSE'})`);

  // Sub-period stability
  console.log('\n=== SUB-PERIOD STABILITY (Test Set) ===');

  const v1SubPeriod = runSubPeriodBacktest(test, 0);
  const v2SubPeriod = runSubPeriodBacktest(test, bestAdj);

  console.log('\nEarly Season (W1-8):');
  console.log(`  V1: Brier=${v1SubPeriod.early.avgBrier.toFixed(4)} (${v1SubPeriod.early.bets} bets)`);
  console.log(`  V2: Brier=${v2SubPeriod.early.avgBrier.toFixed(4)} (${v2SubPeriod.early.bets} bets)`);
  const earlyImproved = v2SubPeriod.early.avgBrier < v1SubPeriod.early.avgBrier;
  console.log(`  ${earlyImproved ? '✓ IMPROVED' : '✗ WORSE'}`);

  console.log('\nLate Season (W9+):');
  console.log(`  V1: Brier=${v1SubPeriod.late.avgBrier.toFixed(4)} (${v1SubPeriod.late.bets} bets)`);
  console.log(`  V2: Brier=${v2SubPeriod.late.avgBrier.toFixed(4)} (${v2SubPeriod.late.bets} bets)`);
  const lateImproved = v2SubPeriod.late.avgBrier < v1SubPeriod.late.avgBrier;
  console.log(`  ${lateImproved ? '✓ IMPROVED' : '✗ WORSE'}`);

  // Final decision
  console.log('\n' + '═'.repeat(60));
  console.log('DECISION');
  console.log('═'.repeat(60));

  const stable = earlyImproved === lateImproved;
  const accept = brierImproved && stable && earlyImproved && lateImproved;

  console.log(`\nBrier improved: ${brierImproved ? 'YES' : 'NO'}`);
  console.log(`Sub-period stable: ${stable ? 'YES' : 'NO'} (Early: ${earlyImproved ? '+' : '-'}, Late: ${lateImproved ? '+' : '-'})`);
  console.log(`\n${accept ? '✓ KEEP QB Injury (adjustment=' + bestAdj + ' pts)' : '✗ REJECT QB Injury - Keep V1'}`);
}

main().catch(console.error);

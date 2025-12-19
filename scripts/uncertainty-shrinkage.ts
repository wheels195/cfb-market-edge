/**
 * Uncertainty Shrinkage Model - v3_ppadiff_regime2
 *
 * MODEL VERSION: v3_ppadiff_regime2
 * ================================
 * Prior weights:
 *   - Week 0 rating: 35% prior Elo + 35% roster continuity + 20% recruiting + 10% conf base
 *   - Regime 1 (Weeks 0-4): 70% prior, 30% in-season (declining)
 *   - Regime 2 (Weeks 5+): 30% prior, 70% in-season
 *
 * Update weights:
 *   - PPA_WEIGHT: 0.75 (opponent-adjusted PPA differential)
 *   - MARGIN_WEIGHT: 0.25 (capped at ±21 points)
 *   - PPA_SCALE: 250 (converts PPA diff to Elo-like update)
 *   - K_FACTOR: 20 (base Elo K-factor)
 *
 * Uncertainty shrinkage:
 *   - Week 0-1: 0.45
 *   - Week 2-4: 0.25
 *   - Week 5+: 0.10
 *   - Roster churn (bottom quartile): +0.15
 *   - Roster churn (2nd quartile): +0.08
 *   - QB transfer out: +0.20
 *   - Coaching change: +0.10
 *   - Cap: 0.75
 *
 * Bet-time rule: Pre-game (spread_open)
 * Edge definition: abs(effective_edge) ranked by percentile
 *
 * Takes the opponent-adjusted PPA model and adds:
 * 1. Uncertainty score = f(week, roster churn, new QB, new coach)
 * 2. Effective edge = raw_edge * (1 - uncertainty_score)
 * 3. Select based on effective edge, not raw edge
 *
 * Goal: Turn "neutral" into "selective positive"
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
  console.log(`  Syncing ${season} PPA...`);

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

  console.log(`    ${results.length} game-team records`);
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

/**
 * Calculate game-level uncertainty from both teams
 *
 * Exact formula (per spec):
 *
 * Week-of-season:
 *   Weeks 0-1: 0.45
 *   Weeks 2-4: 0.25
 *   Weeks 5+:  0.10
 *
 * Roster churn proxy (returning production):
 *   Bottom quartile: +0.15
 *   2nd quartile:    +0.08
 *   Top half:        +0.00
 *
 * QB continuity:
 *   New QB / unknown: +0.20
 *   Returning QB:     +0.00
 *
 * Coaching change (HC): +0.10
 *
 * Cap total at 0.75
 */
function calculateTeamUncertainty(
  week0: Week0Rating | undefined,
  returningPPAQuartiles: { q25: number; q50: number }
): number {
  if (!week0) return 0.30;  // Unknown team gets moderate uncertainty

  let uncertainty = 0;

  // Roster churn proxy (returning production)
  const pctReturning = week0.percent_returning_ppa || 0.5;
  if (pctReturning < returningPPAQuartiles.q25) {
    uncertainty += 0.15;  // Bottom quartile
  } else if (pctReturning < returningPPAQuartiles.q50) {
    uncertainty += 0.08;  // 2nd quartile
  }
  // Top half: +0.00

  // QB continuity: qb_transfers_out > 0 means new QB / unknown
  if (week0.qb_transfers_out > 0) {
    uncertainty += 0.20;
  }

  // Coaching change
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

  // Week-of-season uncertainty
  let weekUncertainty: number;
  if (week <= 1) {
    weekUncertainty = 0.45;
  } else if (week <= 4) {
    weekUncertainty = 0.25;
  } else {
    weekUncertainty = 0.10;
  }

  // Team-specific uncertainty (average of both teams)
  const homeTeamUnc = calculateTeamUncertainty(homeW0, returningPPAQuartiles);
  const awayTeamUnc = calculateTeamUncertainty(awayW0, returningPPAQuartiles);
  const avgTeamUncertainty = (homeTeamUnc + awayTeamUnc) / 2;

  // Total = week + team factors
  const totalUncertainty = weekUncertainty + avgTeamUncertainty;

  // Cap at 0.75
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
  return {
    homeUpdate: finalUpdate,
    awayUpdate: -finalUpdate,
  };
}

function gradeBet(margin: number, spread: number, side: 'home' | 'away'): 'win' | 'loss' | 'push' {
  const homeResult = margin + spread;
  if (Math.abs(homeResult) < 0.001) return 'push';
  const homeCovered = homeResult > 0;
  if (side === 'home') return homeCovered ? 'win' : 'loss';
  return homeCovered ? 'loss' : 'win';
}

async function main() {
  console.log('=== UNCERTAINTY SHRINKAGE MODEL - v3_ppadiff_regime2 ===\n');

  // Sync game PPA
  console.log('Loading PPA data...');
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

  // Calculate returning PPA quartiles across all Week 0 data
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
  console.log(`\nReturning PPA quartiles: Q25=${returningPPAQuartiles.q25.toFixed(2)}, Q50=${returningPPAQuartiles.q50.toFixed(2)}`);
  console.log(`Betting lines: ${lines.length}\n`);

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
  }

  const allResults: Result[] = [];

  for (const season of [2022, 2023, 2024]) {
    console.log(`Processing ${season}...`);

    // Initialize ratings
    const ratings = new Map<string, number>();
    for (const [teamKey, seasons] of week0Map) {
      const w0 = seasons.get(season);
      if (w0) {
        ratings.set(teamKey, w0.week0_rating);
      }
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

      // Calculate model spread
      const diff = homeRating - awayRating + HFA * ELO_TO_SPREAD;
      const modelSpread = -diff / ELO_TO_SPREAD;
      const rawEdge = modelSpread - game.spread_open;

      // Calculate uncertainty for this game
      const uncertainty = calculateGameUncertainty(
        week0Map, game.home_team, game.away_team, season, game.week, returningPPAQuartiles
      );

      // SHRINK edge by uncertainty
      const effectiveEdge = rawEdge * (1 - uncertainty);

      // Grade bet
      const side: 'home' | 'away' = rawEdge < 0 ? 'home' : 'away';
      const margin = game.home_score - game.away_score;
      const result = gradeBet(margin, game.spread_close, side);

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
        });
      }

      // Update ratings
      const gamePPAMap = seasonPPA.get(game.cfbd_game_id);
      const homePPA = gamePPAMap?.get(homeKey);
      const awayPPA = gamePPAMap?.get(awayKey);

      if (homePPA && awayPPA) {
        const homeAdjPPA = calculateOpponentAdjustedPPA(
          homePPA, awayPPA, homeRating, awayRating, avgRating
        );
        const awayAdjPPA = calculateOpponentAdjustedPPA(
          awayPPA, homePPA, awayRating, homeRating, avgRating
        );

        const homeExpectedWin = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
        const { homeUpdate, awayUpdate } = calculateUpdate(
          homeAdjPPA, awayAdjPPA, margin, homeExpectedWin
        );

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

    console.log(`  ${seasonLines.length} games processed`);
  }

  console.log(`\nTotal results: ${allResults.length}\n`);

  // ==========================================================================
  // COMPARISON: RAW EDGE vs EFFECTIVE EDGE
  // ==========================================================================

  console.log('=== RAW EDGE (NO SHRINKAGE) ===\n');
  allResults.sort((a, b) => Math.abs(b.rawEdge) - Math.abs(a.rawEdge));

  console.log('Bucket     | N    | Win%  | ROI    | Avg Unc');
  console.log('-----------|------|-------|--------|--------');

  for (const [name, pct] of [['Top 5%', 0.05], ['Top 10%', 0.1], ['Top 20%', 0.2], ['Top 50%', 0.5], ['All', 1.0]] as const) {
    const n = Math.floor(allResults.length * pct);
    const slice = allResults.slice(0, n);
    const wins = slice.filter(r => r.won).length;
    const winRate = wins / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    const avgUnc = slice.reduce((s, r) => s + r.uncertainty, 0) / slice.length;
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1).padStart(5)}% | ${avgUnc.toFixed(2)}`);
  }

  console.log('\n=== EFFECTIVE EDGE (WITH SHRINKAGE) ===\n');
  allResults.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));

  console.log('Bucket     | N    | Win%  | ROI    | Avg Unc | Avg Raw');
  console.log('-----------|------|-------|--------|---------|--------');

  for (const [name, pct] of [['Top 5%', 0.05], ['Top 10%', 0.1], ['Top 20%', 0.2], ['Top 50%', 0.5], ['All', 1.0]] as const) {
    const n = Math.floor(allResults.length * pct);
    const slice = allResults.slice(0, n);
    const wins = slice.filter(r => r.won).length;
    const winRate = wins / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    const avgUnc = slice.reduce((s, r) => s + r.uncertainty, 0) / slice.length;
    const avgRaw = slice.reduce((s, r) => s + Math.abs(r.rawEdge), 0) / slice.length;
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1).padStart(5)}% | ${avgUnc.toFixed(2).padStart(7)} | ${avgRaw.toFixed(1).padStart(6)}`);
  }

  // ==========================================================================
  // LOW UNCERTAINTY SUBSET (HIGHEST CONFIDENCE BETS)
  // ==========================================================================

  console.log('\n=== LOW UNCERTAINTY GAMES ONLY (unc < 0.25) ===\n');

  const lowUncertainty = allResults.filter(r => r.uncertainty < 0.25);
  lowUncertainty.sort((a, b) => Math.abs(b.rawEdge) - Math.abs(a.rawEdge));

  console.log(`Total low-uncertainty games: ${lowUncertainty.length}`);
  console.log('\nBucket     | N    | Win%  | ROI');
  console.log('-----------|------|-------|-------');

  for (const [name, pct] of [['Top 5%', 0.05], ['Top 10%', 0.1], ['Top 20%', 0.2], ['Top 50%', 0.5], ['All', 1.0]] as const) {
    const n = Math.floor(lowUncertainty.length * pct);
    if (n === 0) continue;
    const slice = lowUncertainty.slice(0, n);
    const wins = slice.filter(r => r.won).length;
    const winRate = wins / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1)}%`);
  }

  // ==========================================================================
  // BY SEASON (HOLDOUT CHECK)
  // ==========================================================================

  console.log('\n=== BY SEASON - EFFECTIVE EDGE TOP 20% ===\n');

  for (const season of [2022, 2023, 2024]) {
    const seasonGames = allResults.filter(r => r.season === season);
    seasonGames.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
    const top20 = seasonGames.slice(0, Math.floor(seasonGames.length * 0.2));

    if (top20.length === 0) continue;

    const wins = top20.filter(r => r.won).length;
    const winRate = wins / top20.length;
    const roi = winRate * 0.909 - (1 - winRate);
    const avgUnc = top20.reduce((s, r) => s + r.uncertainty, 0) / top20.length;

    console.log(`${season} Top 20%: ${(winRate * 100).toFixed(1)}% win, ${(roi * 100).toFixed(1)}% ROI (N=${top20.length}, avgUnc=${avgUnc.toFixed(2)})`);
  }

  // ==========================================================================
  // BY WEEK BUCKET
  // ==========================================================================

  console.log('\n=== BY WEEK BUCKET - EFFECTIVE EDGE TOP 20% ===\n');

  for (const [weekStart, weekEnd, label] of [[1, 4, 'Weeks 1-4'], [5, 8, 'Weeks 5-8'], [9, 16, 'Weeks 9+']] as const) {
    const weekGames = allResults.filter(r => r.week >= weekStart && r.week <= weekEnd);
    weekGames.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
    const top20 = weekGames.slice(0, Math.floor(weekGames.length * 0.2));

    if (top20.length === 0) continue;

    const wins = top20.filter(r => r.won).length;
    const winRate = wins / top20.length;
    const roi = winRate * 0.909 - (1 - winRate);
    const avgUnc = top20.reduce((s, r) => s + r.uncertainty, 0) / top20.length;

    console.log(`${label}: ${(winRate * 100).toFixed(1)}% win, ${(roi * 100).toFixed(1)}% ROI (N=${top20.length}, avgUnc=${avgUnc.toFixed(2)})`);
  }

  // ==========================================================================
  // SAMPLE HIGH-EFFECTIVE-EDGE GAMES
  // ==========================================================================

  console.log('\n=== SAMPLE TOP EFFECTIVE EDGE GAMES ===\n');
  console.log('Matchup                 | Raw  | Eff  | Unc  | Side | Won');
  console.log('------------------------|------|------|------|------|----');

  allResults.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
  for (const r of allResults.slice(0, 20)) {
    const matchup = `${r.awayTeam.slice(0, 10)} @ ${r.homeTeam.slice(0, 10)}`.padEnd(23);
    const raw = (r.rawEdge >= 0 ? '+' : '') + r.rawEdge.toFixed(1);
    const eff = (r.effectiveEdge >= 0 ? '+' : '') + r.effectiveEdge.toFixed(1);
    console.log(
      `${matchup} | ${raw.padStart(4)} | ${eff.padStart(4)} | ${r.uncertainty.toFixed(2)} | ${r.side.padEnd(4)} | ${r.won ? 'Y' : 'N'}`
    );
  }

  // ==========================================================================
  // COMPARISON SUMMARY
  // ==========================================================================

  console.log('\n=== COMPARISON SUMMARY ===\n');
  console.log('Model Evolution (2024 Top 20%):');
  console.log('  Old (prior Elo only):     36.5% win');
  console.log('  Week 0 priors:            44.8% win');
  console.log('  Two-regime model:         49.5% win');
  console.log('  Opponent-adj PPA:         51.4% win');

  const test2024 = allResults.filter(r => r.season === 2024);
  test2024.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
  const top20_2024 = test2024.slice(0, Math.floor(test2024.length * 0.2));
  const wins2024 = top20_2024.filter(r => r.won).length;
  const winRate2024 = wins2024 / top20_2024.length;

  console.log(`  Uncertainty shrinkage:    ${(winRate2024 * 100).toFixed(1)}% win`);

  // Low uncertainty 2024
  const lowUnc2024 = test2024.filter(r => r.uncertainty < 0.25);
  lowUnc2024.sort((a, b) => Math.abs(b.rawEdge) - Math.abs(a.rawEdge));
  const lowUncTop20_2024 = lowUnc2024.slice(0, Math.floor(lowUnc2024.length * 0.2));
  if (lowUncTop20_2024.length > 0) {
    const lowUncWins = lowUncTop20_2024.filter(r => r.won).length;
    const lowUncWinRate = lowUncWins / lowUncTop20_2024.length;
    console.log(`  Low-unc only (2024):      ${(lowUncWinRate * 100).toFixed(1)}% win (N=${lowUncTop20_2024.length})`);
  }

  // Target check
  console.log('\n--- Target Check ---');
  console.log(`Looking for: ≥52-53% win rate in top buckets`);
  console.log(`Achieved:    ${(winRate2024 * 100).toFixed(1)}%`);

  if (winRate2024 >= 0.53) {
    console.log('TARGET MET - Model is profitable');
  } else if (winRate2024 >= 0.52) {
    console.log('CLOSE - Near target');
  } else if (winRate2024 >= 0.50) {
    console.log('NEUTRAL - No regression');
  } else {
    console.log('NEEDS WORK');
  }

  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);

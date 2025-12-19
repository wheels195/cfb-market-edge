/**
 * Edge Display with Uncertainty Labels
 *
 * MODEL VERSION: v3_ppadiff_regime2
 *
 * Output format shows:
 * - Raw edge (what the model sees)
 * - Effective edge (shrunk by uncertainty)
 * - Uncertainty score breakdown
 * - High-uncertainty label for games needing QB status check
 *
 * Betting rules:
 * - Rank by abs(effective_edge)
 * - Games with |raw_edge| >= 10 AND uncertainty >= 0.40 are labeled "HIGH UNCERTAINTY"
 * - High-uncertainty games require QB status confirmation before betting
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

// Uncertainty thresholds
const HIGH_UNCERTAINTY_THRESHOLD = 0.40;
const HIGH_EDGE_THRESHOLD = 10;

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

function calculateTeamUncertainty(
  week0: Week0Rating | undefined,
  returningPPAQuartiles: { q25: number; q50: number }
): { total: number; breakdown: { roster: number; qb: number; coach: number } } {
  if (!week0) return { total: 0.30, breakdown: { roster: 0.10, qb: 0.10, coach: 0.10 } };

  let rosterUnc = 0;
  let qbUnc = 0;
  let coachUnc = 0;

  const pctReturning = week0.percent_returning_ppa || 0.5;
  if (pctReturning < returningPPAQuartiles.q25) {
    rosterUnc = 0.15;
  } else if (pctReturning < returningPPAQuartiles.q50) {
    rosterUnc = 0.08;
  }

  if (week0.qb_transfers_out > 0) {
    qbUnc = 0.20;
  }

  if (week0.coaching_change) {
    coachUnc = 0.10;
  }

  return {
    total: rosterUnc + qbUnc + coachUnc,
    breakdown: { roster: rosterUnc, qb: qbUnc, coach: coachUnc },
  };
}

interface UncertaintyBreakdown {
  total: number;
  week: number;
  homeRoster: number;
  homeQB: number;
  homeCoach: number;
  awayRoster: number;
  awayQB: number;
  awayCoach: number;
}

function calculateGameUncertaintyWithBreakdown(
  week0Map: Map<string, Map<number, Week0Rating>>,
  homeTeam: string,
  awayTeam: string,
  season: number,
  week: number,
  returningPPAQuartiles: { q25: number; q50: number }
): UncertaintyBreakdown {
  const homeKey = homeTeam.toLowerCase();
  const awayKey = awayTeam.toLowerCase();
  const homeW0 = week0Map.get(homeKey)?.get(season);
  const awayW0 = week0Map.get(awayKey)?.get(season);

  let weekUncertainty: number;
  if (week <= 1) {
    weekUncertainty = 0.45;
  } else if (week <= 4) {
    weekUncertainty = 0.25;
  } else {
    weekUncertainty = 0.10;
  }

  const homeUnc = calculateTeamUncertainty(homeW0, returningPPAQuartiles);
  const awayUnc = calculateTeamUncertainty(awayW0, returningPPAQuartiles);

  const avgTeamUncertainty = (homeUnc.total + awayUnc.total) / 2;
  const totalUncertainty = Math.min(0.75, weekUncertainty + avgTeamUncertainty);

  return {
    total: totalUncertainty,
    week: weekUncertainty,
    homeRoster: homeUnc.breakdown.roster,
    homeQB: homeUnc.breakdown.qb,
    homeCoach: homeUnc.breakdown.coach,
    awayRoster: awayUnc.breakdown.roster,
    awayQB: awayUnc.breakdown.qb,
    awayCoach: awayUnc.breakdown.coach,
  };
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
  return { homeUpdate: finalUpdate, awayUpdate: -finalUpdate };
}

function gradeBet(margin: number, spread: number, side: 'home' | 'away'): 'win' | 'loss' | 'push' {
  const homeResult = margin + spread;
  if (Math.abs(homeResult) < 0.001) return 'push';
  const homeCovered = homeResult > 0;
  if (side === 'home') return homeCovered ? 'win' : 'loss';
  return homeCovered ? 'loss' : 'win';
}

interface EdgeResult {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  spreadOpen: number;
  spreadClose: number;
  margin: number;
  modelSpread: number;
  rawEdge: number;
  effectiveEdge: number;
  uncertainty: UncertaintyBreakdown;
  side: 'home' | 'away';
  won: boolean;
  isHighUncertainty: boolean;
  requiresQBCheck: boolean;
}

async function main() {
  console.log('=== EDGE DISPLAY WITH UNCERTAINTY LABELS ===');
  console.log('Model Version: v3_ppadiff_regime2\n');

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

  const allResults: EdgeResult[] = [];

  for (const season of [2022, 2023, 2024]) {
    const ratings = new Map<string, number>();
    for (const [teamKey, seasons] of week0Map) {
      const w0 = seasons.get(season);
      if (w0) ratings.set(teamKey, w0.week0_rating);
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

      const diff = homeRating - awayRating + HFA * ELO_TO_SPREAD;
      const modelSpread = -diff / ELO_TO_SPREAD;
      const rawEdge = modelSpread - game.spread_open;

      const uncertainty = calculateGameUncertaintyWithBreakdown(
        week0Map, game.home_team, game.away_team, season, game.week, returningPPAQuartiles
      );

      const effectiveEdge = rawEdge * (1 - uncertainty.total);

      const side: 'home' | 'away' = rawEdge < 0 ? 'home' : 'away';
      const margin = game.home_score - game.away_score;
      const result = gradeBet(margin, game.spread_close, side);

      // High uncertainty flags
      const isHighUncertainty = Math.abs(rawEdge) >= HIGH_EDGE_THRESHOLD && uncertainty.total >= HIGH_UNCERTAINTY_THRESHOLD;
      const requiresQBCheck = isHighUncertainty && (uncertainty.homeQB > 0 || uncertainty.awayQB > 0);

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
          effectiveEdge,
          uncertainty,
          side,
          won: result === 'win',
          isHighUncertainty,
          requiresQBCheck,
        });
      }

      // Update ratings
      const gamePPAMap = seasonPPA.get(game.cfbd_game_id);
      const homePPA = gamePPAMap?.get(homeKey);
      const awayPPA = gamePPAMap?.get(awayKey);

      if (homePPA && awayPPA) {
        const homeAdjPPA = calculateOpponentAdjustedPPA(homePPA, awayPPA, homeRating, awayRating, avgRating);
        const awayAdjPPA = calculateOpponentAdjustedPPA(awayPPA, homePPA, awayRating, homeRating, avgRating);
        const homeExpectedWin = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
        const { homeUpdate, awayUpdate } = calculateUpdate(homeAdjPPA, awayAdjPPA, margin, homeExpectedWin);
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
  }

  // ==========================================================================
  // DISPLAY TOP EDGES WITH UNCERTAINTY LABELS
  // ==========================================================================

  console.log('=== TOP 50 EDGES BY EFFECTIVE EDGE (2024) ===\n');

  const results2024 = allResults.filter(r => r.season === 2024);
  results2024.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));

  console.log('Matchup                 | Week | Open | Model | Raw  | Eff  | Unc  | Label           | QB? | Won');
  console.log('------------------------|------|------|-------|------|------|------|-----------------|-----|----');

  for (const r of results2024.slice(0, 50)) {
    const matchup = `${r.awayTeam.slice(0, 10)} @ ${r.homeTeam.slice(0, 10)}`.padEnd(23);
    const open = (r.spreadOpen >= 0 ? '+' : '') + r.spreadOpen.toFixed(0);
    const model = (r.modelSpread >= 0 ? '+' : '') + r.modelSpread.toFixed(0);
    const raw = (r.rawEdge >= 0 ? '+' : '') + r.rawEdge.toFixed(1);
    const eff = (r.effectiveEdge >= 0 ? '+' : '') + r.effectiveEdge.toFixed(1);
    const label = r.isHighUncertainty ? 'HIGH UNCERTAINTY' : 'OK';
    const qb = r.requiresQBCheck ? 'Y' : 'N';

    console.log(
      `${matchup} | ${r.week.toString().padStart(4)} | ${open.padStart(4)} | ${model.padStart(5)} | ${raw.padStart(4)} | ${eff.padStart(4)} | ${r.uncertainty.total.toFixed(2)} | ${label.padEnd(15)} | ${qb.padStart(3)} | ${r.won ? 'Y' : 'N'}`
    );
  }

  // ==========================================================================
  // PERFORMANCE BY LABEL
  // ==========================================================================

  console.log('\n=== PERFORMANCE BY LABEL (TOP 20% EFFECTIVE EDGE) ===\n');

  allResults.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
  const top20 = allResults.slice(0, Math.floor(allResults.length * 0.2));

  const okGames = top20.filter(r => !r.isHighUncertainty);
  const highUncGames = top20.filter(r => r.isHighUncertainty);
  const qbCheckGames = top20.filter(r => r.requiresQBCheck);

  console.log(`OK (not high uncertainty):     ${okGames.length} games, ${(okGames.filter(r => r.won).length / okGames.length * 100).toFixed(1)}% win`);
  console.log(`HIGH UNCERTAINTY:              ${highUncGames.length} games, ${(highUncGames.filter(r => r.won).length / highUncGames.length * 100).toFixed(1)}% win`);
  console.log(`  - Requires QB check:         ${qbCheckGames.length} games, ${qbCheckGames.length > 0 ? (qbCheckGames.filter(r => r.won).length / qbCheckGames.length * 100).toFixed(1) : 'N/A'}% win`);

  // ==========================================================================
  // UNCERTAINTY BREAKDOWN FOR HIGH-UNC GAMES
  // ==========================================================================

  console.log('\n=== SAMPLE HIGH-UNCERTAINTY GAMES (REQUIRING QB CHECK) ===\n');

  const qbCheckSample = allResults.filter(r => r.requiresQBCheck).slice(0, 15);

  console.log('Matchup                 | Week | Unc Components                    | Won');
  console.log('------------------------|------|-----------------------------------|----');

  for (const r of qbCheckSample) {
    const matchup = `${r.awayTeam.slice(0, 10)} @ ${r.homeTeam.slice(0, 10)}`.padEnd(23);
    const components = [
      `W:${r.uncertainty.week.toFixed(2)}`,
      r.uncertainty.homeQB > 0 ? `H-QB:${r.uncertainty.homeQB.toFixed(2)}` : null,
      r.uncertainty.awayQB > 0 ? `A-QB:${r.uncertainty.awayQB.toFixed(2)}` : null,
      r.uncertainty.homeCoach > 0 ? `H-HC:${r.uncertainty.homeCoach.toFixed(2)}` : null,
      r.uncertainty.awayCoach > 0 ? `A-HC:${r.uncertainty.awayCoach.toFixed(2)}` : null,
    ].filter(Boolean).join(' ');

    console.log(`${matchup} | ${r.week.toString().padStart(4)} | ${components.padEnd(33)} | ${r.won ? 'Y' : 'N'}`);
  }

  // ==========================================================================
  // FINAL SUMMARY
  // ==========================================================================

  console.log('\n=== FINAL MODEL SUMMARY ===\n');
  console.log('Model Version: v3_ppadiff_regime2');
  console.log('');
  console.log('Configuration:');
  console.log('  Prior weights: 35% prior Elo + 35% roster continuity + 20% recruiting + 10% conf base');
  console.log('  Update weights: 75% opponent-adjusted PPA + 25% capped margin');
  console.log('  PPA scale: 250, K-factor: 20, Margin cap: +/-21');
  console.log('');
  console.log('Uncertainty shrinkage:');
  console.log('  Week 0-1: 0.45 | Week 2-4: 0.25 | Week 5+: 0.10');
  console.log('  Roster churn: bottom quartile +0.15, 2nd quartile +0.08');
  console.log('  QB transfer out: +0.20');
  console.log('  Coaching change: +0.10');
  console.log('  Cap: 0.75');
  console.log('');
  console.log('Betting rules:');
  console.log('  - Rank by abs(effective_edge)');
  console.log(`  - HIGH UNCERTAINTY: |raw_edge| >= ${HIGH_EDGE_THRESHOLD} AND uncertainty >= ${HIGH_UNCERTAINTY_THRESHOLD}`);
  console.log('  - Requires QB check if QB uncertainty component > 0');
  console.log('');

  // Final performance
  allResults.sort((a, b) => Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge));
  const top5 = allResults.slice(0, Math.floor(allResults.length * 0.05));
  const top10 = allResults.slice(0, Math.floor(allResults.length * 0.10));
  const top20Final = allResults.slice(0, Math.floor(allResults.length * 0.20));

  console.log('Historical Performance (2022-2024):');
  console.log(`  Top 5%:  ${(top5.filter(r => r.won).length / top5.length * 100).toFixed(1)}% win, ROI ${((top5.filter(r => r.won).length / top5.length * 0.909 - (1 - top5.filter(r => r.won).length / top5.length)) * 100).toFixed(1)}%`);
  console.log(`  Top 10%: ${(top10.filter(r => r.won).length / top10.length * 100).toFixed(1)}% win, ROI ${((top10.filter(r => r.won).length / top10.length * 0.909 - (1 - top10.filter(r => r.won).length / top10.length)) * 100).toFixed(1)}%`);
  console.log(`  Top 20%: ${(top20Final.filter(r => r.won).length / top20Final.length * 100).toFixed(1)}% win, ROI ${((top20Final.filter(r => r.won).length / top20Final.length * 0.909 - (1 - top20Final.filter(r => r.won).length / top20Final.length)) * 100).toFixed(1)}%`);

  console.log('\n=== DISPLAY COMPLETE ===');
}

main().catch(console.error);

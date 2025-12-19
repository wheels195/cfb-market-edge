/**
 * Opponent-Adjusted PPA Updates
 *
 * Correct implementation:
 * 1. ppa_diff = team_off_ppa - opponent_def_ppa (opponent-adjusted)
 * 2. Use PRIOR-week ratings for opponent adjustment
 * 3. Cap extreme values (±21 or ±28)
 * 4. Update: 75% PPA differential, 25% capped margin
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
const MARGIN_CAP = 21;         // Cap margin at 3 TDs
const PPA_WEIGHT = 0.75;       // 75% PPA
const MARGIN_WEIGHT = 0.25;    // 25% margin
const PPA_SCALE = 250;         // Scale PPA diff to Elo-like update

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

function calculateOpponentAdjustedPPA(
  teamPPA: GamePPA,
  opponentPPA: GamePPA,
  teamPriorRating: number,
  opponentPriorRating: number,
  avgRating: number
): number {
  // Team's offensive PPA adjusted for opponent defensive strength
  // If opponent defense is better than average (higher rating), our offense PPA is more impressive
  const opponentDefenseStrength = (opponentPriorRating - avgRating) / 100;
  const adjustedOffensePPA = teamPPA.offensePPA + opponentDefenseStrength * 0.1;

  // Team's defensive PPA adjusted for opponent offensive strength
  const opponentOffenseStrength = (opponentPriorRating - avgRating) / 100;
  const adjustedDefensePPA = teamPPA.defensePPA - opponentOffenseStrength * 0.1;

  // Net PPA: offense - defense (positive = good)
  return adjustedOffensePPA - adjustedDefensePPA;
}

function calculateUpdate(
  homeAdjPPA: number,
  awayAdjPPA: number,
  margin: number,
  homeExpectedWin: number
): { homeUpdate: number; awayUpdate: number } {
  // Cap margin
  const cappedMargin = Math.max(-MARGIN_CAP, Math.min(MARGIN_CAP, margin));

  // Margin-based update (Elo-style)
  const actualResult = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const marginUpdate = K_FACTOR * (actualResult - homeExpectedWin);

  // PPA-based update: home adj PPA - away adj PPA
  // Positive means home played better (opponent-adjusted)
  const ppaDiff = homeAdjPPA - awayAdjPPA;

  // Cap PPA diff
  const cappedPPADiff = Math.max(-0.5, Math.min(0.5, ppaDiff));
  const ppaUpdate = cappedPPADiff * PPA_SCALE;

  // Blend: 75% PPA, 25% margin
  const totalUpdate = PPA_WEIGHT * ppaUpdate + MARGIN_WEIGHT * marginUpdate;

  // Cap total update
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
  console.log('=== OPPONENT-ADJUSTED PPA MODEL ===\n');

  // Sync game PPA
  console.log('Loading PPA data...');
  const ppa2022 = await syncGamePPA(2022);
  const ppa2023 = await syncGamePPA(2023);
  const ppa2024 = await syncGamePPA(2024);

  // Build lookup: gameId -> team -> PPA
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

  // Load other data
  const week0Map = await loadWeek0Ratings();
  const lines = await loadBettingLines();

  console.log(`\nBetting lines: ${lines.length}\n`);

  // Process each season with walk-forward
  interface Result {
    season: number;
    week: number;
    homeTeam: string;
    awayTeam: string;
    spreadOpen: number;
    spreadClose: number;
    margin: number;
    modelSpread: number;
    edge: number;
    side: 'home' | 'away';
    won: boolean;
  }

  const allResults: Result[] = [];

  for (const season of [2022, 2023, 2024]) {
    console.log(`Processing ${season}...`);

    // Initialize ratings from Week 0
    const ratings = new Map<string, number>();
    for (const [teamKey, seasons] of week0Map) {
      const w0 = seasons.get(season);
      if (w0) {
        ratings.set(teamKey, w0.week0_rating);
      }
    }

    // Get average rating
    const avgRating = ratings.size > 0
      ? Array.from(ratings.values()).reduce((a, b) => a + b, 0) / ratings.size
      : 1500;

    // Get games for this season, sorted by week
    const seasonLines = lines
      .filter(l => l.season === season)
      .sort((a, b) => a.week - b.week || a.cfbd_game_id - b.cfbd_game_id);

    const seasonPPA = ppaLookup.get(season) || new Map();

    for (const game of seasonLines) {
      const homeKey = game.home_team.toLowerCase();
      const awayKey = game.away_team.toLowerCase();

      // Get PRIOR ratings (before this game)
      const homeRating = ratings.get(homeKey) || 1500;
      const awayRating = ratings.get(awayKey) || 1500;

      // Calculate model spread BEFORE the game
      const diff = homeRating - awayRating + HFA * ELO_TO_SPREAD;
      const modelSpread = -diff / ELO_TO_SPREAD;
      const edge = modelSpread - game.spread_open;

      // Grade bet
      const side: 'home' | 'away' = edge < 0 ? 'home' : 'away';
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
          edge,
          side,
          won: result === 'win',
        });
      }

      // Update ratings AFTER the game (for future predictions)
      const gamePPAMap = seasonPPA.get(game.cfbd_game_id);
      const homePPA = gamePPAMap?.get(homeKey);
      const awayPPA = gamePPAMap?.get(awayKey);

      if (homePPA && awayPPA) {
        // Opponent-adjusted PPA
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
        // Fallback: margin-only update if no PPA
        const homeExpectedWin = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
        const actualResult = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
        const update = K_FACTOR * (actualResult - homeExpectedWin) * 0.5;  // Reduced weight
        ratings.set(homeKey, homeRating + update);
        ratings.set(awayKey, awayRating - update);
      }
    }

    console.log(`  ${seasonLines.length} games processed`);
  }

  console.log(`\nTotal results: ${allResults.length}\n`);

  // ==========================================================================
  // WALK-FORWARD ANALYSIS
  // ==========================================================================

  console.log('=== WALK-FORWARD RESULTS ===\n');

  // Overall by edge bucket
  allResults.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  console.log('ALL SEASONS:');
  console.log('Bucket     | N    | Win%  | ROI');
  console.log('-----------|------|-------|-------');

  for (const [name, pct] of [['Top 10%', 0.1], ['Top 20%', 0.2], ['All', 1.0]] as const) {
    const n = Math.floor(allResults.length * pct);
    const slice = allResults.slice(0, n);
    const wins = slice.filter(r => r.won).length;
    const winRate = wins / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1)}%`);
  }

  // By week bucket
  console.log('\n--- By Week (Top 20% Edges) ---\n');

  for (const [weekStart, weekEnd, label] of [[1, 4, 'Weeks 1-4'], [5, 16, 'Weeks 5+']] as const) {
    const weekGames = allResults.filter(r => r.week >= weekStart && r.week <= weekEnd);
    weekGames.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    const top20 = weekGames.slice(0, Math.floor(weekGames.length * 0.2));

    if (top20.length === 0) continue;

    const wins = top20.filter(r => r.won).length;
    const winRate = wins / top20.length;
    const roi = winRate * 0.909 - (1 - winRate);

    console.log(`${label}: ${(winRate * 100).toFixed(1)}% win, ${(roi * 100).toFixed(1)}% ROI (N=${top20.length})`);
  }

  // By season (holdout check)
  console.log('\n--- By Season (Holdout) ---\n');

  for (const season of [2022, 2023, 2024]) {
    const seasonGames = allResults.filter(r => r.season === season);
    seasonGames.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    const top20 = seasonGames.slice(0, Math.floor(seasonGames.length * 0.2));

    if (top20.length === 0) continue;

    const wins = top20.filter(r => r.won).length;
    const winRate = wins / top20.length;
    const roi = winRate * 0.909 - (1 - winRate);

    console.log(`${season} Top 20%: ${(winRate * 100).toFixed(1)}% win, ${(roi * 100).toFixed(1)}% ROI (N=${top20.length})`);
  }

  // ==========================================================================
  // COMPARISON SUMMARY
  // ==========================================================================

  console.log('\n=== COMPARISON SUMMARY ===\n');
  console.log('Model Evolution (2024 Top 20%):');
  console.log('  Old (prior Elo only):     36.5% win');
  console.log('  Week 0 priors:            44.8% win');
  console.log('  Two-regime model:         49.5% win');

  const test2024 = allResults.filter(r => r.season === 2024);
  test2024.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  const top20_2024 = test2024.slice(0, Math.floor(test2024.length * 0.2));
  const wins2024 = top20_2024.filter(r => r.won).length;
  const winRate2024 = wins2024 / top20_2024.length;

  console.log(`  Opponent-adj PPA:         ${(winRate2024 * 100).toFixed(1)}% win`);

  // Check if we hit the target
  console.log('\n--- Target Check ---');
  console.log(`Looking for: ≥52-53% win rate in top buckets`);
  console.log(`Achieved:    ${(winRate2024 * 100).toFixed(1)}%`);

  if (winRate2024 >= 0.52) {
    console.log('✓ TARGET MET');
  } else if (winRate2024 >= 0.50) {
    console.log('○ Neutral (no regression from two-regime)');
  } else {
    console.log('✗ ROLLBACK NEEDED');
  }

  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);

/**
 * PPA-Based Weekly Updates
 *
 * Replace pure Elo margin updates with:
 * 1. Opponent-adjusted PPA differential (primary)
 * 2. Capped margin (secondary)
 *
 * This reduces volatility and false confidence.
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
const K_FACTOR = 20;           // Base Elo K-factor
const MARGIN_CAP = 21;         // Cap margin contribution at 3 TDs
const PPA_WEIGHT = 0.6;        // Weight on PPA vs margin
const MARGIN_WEIGHT = 0.4;     // Weight on margin

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
  netPPA: number;
}

interface GameResult {
  gameId: number;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  margin: number;
  homePPA: GamePPA | null;
  awayPPA: GamePPA | null;
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
          netPPA: (game.offense?.overall || 0) - (game.defense?.overall || 0),
        });
      }
    }
    await new Promise(r => setTimeout(r, 50));
  }

  return results;
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

interface Week0Rating {
  season: number;
  team: string;
  week0_rating: number;
  uncertainty_score: number;
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

function calculatePPAUpdate(
  homePPA: GamePPA | null,
  awayPPA: GamePPA | null,
  margin: number,
  homeExpectedWin: number
): { homeUpdate: number; awayUpdate: number } {
  // Cap margin
  const cappedMargin = Math.max(-MARGIN_CAP, Math.min(MARGIN_CAP, margin));

  // Margin-based update (traditional Elo style)
  const actualResult = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const marginUpdate = K_FACTOR * (actualResult - homeExpectedWin);

  // PPA-based update
  let ppaUpdate = 0;
  if (homePPA && awayPPA) {
    // Net PPA differential: positive means home played better than away
    const homePPADiff = homePPA.netPPA - awayPPA.netPPA;
    // Scale PPA to Elo-like update (~100 Elo points per 0.2 PPA diff)
    ppaUpdate = homePPADiff * 50;
  }

  // Blend updates
  const homeUpdate = PPA_WEIGHT * ppaUpdate + MARGIN_WEIGHT * marginUpdate;
  const awayUpdate = -homeUpdate;

  // Cap total update
  const maxUpdate = K_FACTOR * 1.5;
  return {
    homeUpdate: Math.max(-maxUpdate, Math.min(maxUpdate, homeUpdate)),
    awayUpdate: Math.max(-maxUpdate, Math.min(maxUpdate, awayUpdate)),
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
  console.log('=== PPA-BASED UPDATES MODEL ===\n');

  // Sync game PPA data
  console.log('Syncing game PPA data...');
  const ppa2024 = await syncGamePPA(2024);
  console.log(`  2024: ${ppa2024.length} game-team records`);

  // Build lookup by gameId -> team -> PPA
  const ppaByGame = new Map<number, Map<string, GamePPA>>();
  for (const p of ppa2024) {
    if (!ppaByGame.has(p.gameId)) ppaByGame.set(p.gameId, new Map());
    ppaByGame.get(p.gameId)!.set(p.team.toLowerCase(), p);
  }

  // Load other data
  const week0Map = await loadWeek0Ratings();
  const lines = await loadBettingLines();

  console.log(`\nBetting lines: ${lines.length}\n`);

  // Build dynamic ratings with PPA-based updates
  const ratings = new Map<string, number>();  // team -> current rating

  // Initialize with Week 0 ratings
  for (const [teamKey, seasons] of week0Map) {
    const w0 = seasons.get(2024);
    if (w0) {
      ratings.set(teamKey, w0.week0_rating);
    }
  }

  // Process 2024 games chronologically
  const games2024 = lines
    .filter(l => l.season === 2024)
    .sort((a, b) => a.week - b.week || a.cfbd_game_id - b.cfbd_game_id);

  interface Result {
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
    homeRating: number;
    awayRating: number;
    homePPA: number | null;
    awayPPA: number | null;
  }

  const results: Result[] = [];
  let lastWeek = 0;

  for (const game of games2024) {
    const homeKey = game.home_team.toLowerCase();
    const awayKey = game.away_team.toLowerCase();

    // Get current ratings
    const homeRating = ratings.get(homeKey) || 1500;
    const awayRating = ratings.get(awayKey) || 1500;

    // Calculate model spread BEFORE the game
    const diff = homeRating - awayRating + HFA * ELO_TO_SPREAD;
    const modelSpread = -diff / ELO_TO_SPREAD;
    const edge = modelSpread - game.spread_open;

    // Get game PPA
    const gamePPAMap = ppaByGame.get(game.cfbd_game_id);
    const homePPA = gamePPAMap?.get(homeKey) || null;
    const awayPPA = gamePPAMap?.get(awayKey) || null;

    // Grade bet
    const side: 'home' | 'away' = edge < 0 ? 'home' : 'away';
    const margin = game.home_score - game.away_score;
    const result = gradeBet(margin, game.spread_close, side);

    if (result !== 'push') {
      results.push({
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
        homeRating,
        awayRating,
        homePPA: homePPA?.netPPA || null,
        awayPPA: awayPPA?.netPPA || null,
      });
    }

    // Update ratings based on result (for future games)
    const homeExpectedWin = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
    const { homeUpdate, awayUpdate } = calculatePPAUpdate(homePPA, awayPPA, margin, homeExpectedWin);

    ratings.set(homeKey, homeRating + homeUpdate);
    ratings.set(awayKey, awayRating + awayUpdate);
  }

  console.log(`2024 games processed: ${results.length}\n`);

  // ==========================================================================
  // ANALYSIS
  // ==========================================================================

  console.log('=== 2024 PERFORMANCE (PPA-BASED UPDATES) ===\n');

  results.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  console.log('Bucket     | N    | Win%  | ROI');
  console.log('-----------|------|-------|-------');

  for (const [name, pct] of [['Top 10%', 0.1], ['Top 20%', 0.2], ['Top 50%', 0.5], ['All', 1.0]] as const) {
    const n = Math.floor(results.length * pct);
    const slice = results.slice(0, n);
    const wins = slice.filter(r => r.won).length;
    const winRate = wins / slice.length;
    const roi = winRate * 0.909 - (1 - winRate);
    console.log(`${name.padEnd(10)} | ${n.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1)}%`);
  }

  // By week
  console.log('\n=== BY WEEK (TOP 20% EDGES) ===\n');

  for (const weekRange of [[1, 4], [5, 8], [9, 16]] as const) {
    const weekGames = results.filter(r => r.week >= weekRange[0] && r.week <= weekRange[1]);
    weekGames.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    const top20 = weekGames.slice(0, Math.floor(weekGames.length * 0.2));

    if (top20.length === 0) continue;

    const wins = top20.filter(r => r.won).length;
    const winRate = wins / top20.length;

    console.log(`Weeks ${weekRange[0]}-${weekRange[1]}: ${(winRate * 100).toFixed(1)}% win (N=${top20.length})`);
  }

  // Sample games with PPA
  console.log('\n=== SAMPLE GAMES WITH PPA DATA ===\n');
  console.log('Matchup                 | Model | Open | Edge  | H PPA | A PPA | Won');
  console.log('------------------------|-------|------|-------|-------|-------|----');

  const samplesWithPPA = results.filter(r => r.homePPA !== null).slice(0, 15);
  for (const r of samplesWithPPA) {
    const matchup = `${r.awayTeam.slice(0, 10)} @ ${r.homeTeam.slice(0, 10)}`.padEnd(23);
    const model = (r.modelSpread >= 0 ? '+' : '') + r.modelSpread.toFixed(0);
    const open = (r.spreadOpen >= 0 ? '+' : '') + r.spreadOpen.toFixed(0);
    const edge = (r.edge >= 0 ? '+' : '') + r.edge.toFixed(1);
    const hppa = r.homePPA !== null ? r.homePPA.toFixed(2) : 'N/A';
    const appa = r.awayPPA !== null ? r.awayPPA.toFixed(2) : 'N/A';

    console.log(
      `${matchup} | ${model.padStart(5)} | ${open.padStart(4)} | ${edge.padStart(5)} | ${hppa.padStart(5)} | ${appa.padStart(5)} | ${r.won ? 'Y' : 'N'}`
    );
  }

  // Comparison summary
  console.log('\n=== COMPARISON SUMMARY (2024 Top 20%) ===\n');
  console.log('Old (prior Elo only):     36.5% win');
  console.log('Week 0 priors:            44.8% win');
  console.log('Two-regime model:         49.5% win');

  const top20 = results.slice(0, Math.floor(results.length * 0.2));
  const wins20 = top20.filter(r => r.won).length;
  console.log(`PPA-based updates:        ${(wins20 / top20.length * 100).toFixed(1)}% win`);

  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);

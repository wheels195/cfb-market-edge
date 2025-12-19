/**
 * Fetch and process historical data from CFBD for backtesting
 */

import { getCFBDApiClient } from '@/lib/api/cfbd-api';

const API_KEY = process.env.CFBD_API_KEY || '';
const BASE_URL = 'https://api.collegefootballdata.com';

interface CFBDEloRating {
  year: number;
  team: string;
  conference: string;
  elo: number;
}

interface CFBDSpRating {
  year: number;
  team: string;
  conference: string;
  rating: number;
  ranking: number;
  offense: { rating: number; ranking: number };
  defense: { rating: number; ranking: number };
  specialTeams: { rating: number };
}

interface CFBDAdvancedStats {
  season: number;
  team: string;
  conference: string;
  offense: {
    ppa: number;
    successRate: number;
    explosiveness: number;
    powerSuccess: number;
    stuffRate: number;
  };
  defense: {
    ppa: number;
    successRate: number;
    explosiveness: number;
    havoc: { total: number };
  };
}

interface CFBDBettingLine {
  provider: string;
  spread: number;
  spreadOpen: number | null;
  overUnder: number;
  overUnderOpen: number | null;
}

interface CFBDGameWithLines {
  id: number;
  season: number;
  week: number;
  seasonType: string;
  startDate: string;
  homeTeam: string;
  homeScore: number;
  awayTeam: string;
  awayScore: number;
  lines: CFBDBettingLine[];
}

export interface HistoricalGame {
  gameId: number;
  season: number;
  week: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  // Actual margin (home perspective, positive = home won by X)
  actualMargin: number;
  // Betting lines
  closingSpread: number | null; // Home team spread (negative = home favored)
  openingSpread: number | null;
  closingTotal: number | null;
  openingTotal: number | null;
  // Ratings at time of game
  homeElo: number | null;
  awayElo: number | null;
  homeSpPlus: number | null;
  awaySpPlus: number | null;
  homePPA: number | null;
  awayPPA: number | null;
  homeSuccessRate: number | null;
  awaySuccessRate: number | null;
  // Results
  homeATS: 'win' | 'loss' | 'push' | null; // Did home team cover?
  overUnderResult: 'over' | 'under' | 'push' | null;
}

async function fetchFromCFBD<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`CFBD API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch Elo ratings for a season
 */
export async function fetchEloRatings(season: number): Promise<Map<string, number>> {
  const ratings = await fetchFromCFBD<CFBDEloRating[]>('/ratings/elo', { year: season.toString() });
  const map = new Map<string, number>();
  for (const r of ratings) {
    map.set(r.team.toLowerCase(), r.elo);
  }
  return map;
}

/**
 * Fetch SP+ ratings for a season
 */
export async function fetchSpRatings(season: number): Promise<Map<string, { overall: number; offense: number; defense: number }>> {
  const ratings = await fetchFromCFBD<CFBDSpRating[]>('/ratings/sp', { year: season.toString() });
  const map = new Map<string, { overall: number; offense: number; defense: number }>();
  for (const r of ratings) {
    map.set(r.team.toLowerCase(), {
      overall: r.rating,
      offense: r.offense?.rating || 0,
      defense: r.defense?.rating || 0,
    });
  }
  return map;
}

/**
 * Fetch advanced stats (PPA, success rate) for a season
 */
export async function fetchAdvancedStats(season: number): Promise<Map<string, { ppa: number; successRate: number }>> {
  const stats = await fetchFromCFBD<CFBDAdvancedStats[]>('/stats/season/advanced', { year: season.toString() });
  const map = new Map<string, { ppa: number; successRate: number }>();
  for (const s of stats) {
    map.set(s.team.toLowerCase(), {
      ppa: s.offense?.ppa || 0,
      successRate: s.offense?.successRate || 0,
    });
  }
  return map;
}

/**
 * Fetch games with betting lines for a season
 */
export async function fetchGamesWithLines(season: number): Promise<CFBDGameWithLines[]> {
  const allGames: CFBDGameWithLines[] = [];

  // Fetch regular season (weeks 1-15) and postseason
  for (let week = 1; week <= 16; week++) {
    try {
      const games = await fetchFromCFBD<CFBDGameWithLines[]>('/lines', {
        year: season.toString(),
        week: week.toString(),
      });
      allGames.push(...games);
    } catch {
      // Week might not exist
    }
  }

  // Fetch postseason
  try {
    const postseason = await fetchFromCFBD<CFBDGameWithLines[]>('/lines', {
      year: season.toString(),
      seasonType: 'postseason',
    });
    allGames.push(...postseason);
  } catch {
    // Postseason might not be available
  }

  return allGames;
}

/**
 * Get the closing spread from available lines (prefer DraftKings)
 */
function getClosingSpread(lines: CFBDBettingLine[]): { closing: number | null; opening: number | null } {
  if (!lines || lines.length === 0) {
    return { closing: null, opening: null };
  }

  // Prefer DraftKings, then Bovada, then any
  const dk = lines.find(l => l.provider === 'DraftKings');
  const bovada = lines.find(l => l.provider === 'Bovada');
  const line = dk || bovada || lines[0];

  return {
    closing: line.spread,
    opening: line.spreadOpen ?? line.spread,
  };
}

/**
 * Get the closing total from available lines
 */
function getClosingTotal(lines: CFBDBettingLine[]): { closing: number | null; opening: number | null } {
  if (!lines || lines.length === 0) {
    return { closing: null, opening: null };
  }

  const dk = lines.find(l => l.provider === 'DraftKings');
  const bovada = lines.find(l => l.provider === 'Bovada');
  const line = dk || bovada || lines[0];

  return {
    closing: line.overUnder,
    opening: line.overUnderOpen ?? line.overUnder,
  };
}

/**
 * Determine ATS result for home team
 */
function calculateATSResult(homeScore: number, awayScore: number, spread: number | null): 'win' | 'loss' | 'push' | null {
  if (spread === null) return null;

  const actualMargin = homeScore - awayScore;
  // Spread is from home team perspective (negative = home favored)
  // Home covers if actualMargin > -spread
  // Example: Home -7, they win by 10. actualMargin=10, -spread=7. 10 > 7 = cover
  const coverMargin = actualMargin + spread;

  if (coverMargin > 0) return 'win';
  if (coverMargin < 0) return 'loss';
  return 'push';
}

/**
 * Determine over/under result
 */
function calculateOUResult(homeScore: number, awayScore: number, total: number | null): 'over' | 'under' | 'push' | null {
  if (total === null) return null;

  const actualTotal = homeScore + awayScore;
  if (actualTotal > total) return 'over';
  if (actualTotal < total) return 'under';
  return 'push';
}

/**
 * Build complete historical dataset for backtesting
 */
export async function buildHistoricalDataset(seasons: number[]): Promise<HistoricalGame[]> {
  const allGames: HistoricalGame[] = [];

  for (const season of seasons) {
    console.log(`Fetching data for season ${season}...`);

    // Fetch all data for this season
    const [eloRatings, spRatings, advancedStats, gamesWithLines] = await Promise.all([
      fetchEloRatings(season),
      fetchSpRatings(season),
      fetchAdvancedStats(season),
      fetchGamesWithLines(season),
    ]);

    console.log(`  Found ${gamesWithLines.length} games with lines`);

    for (const game of gamesWithLines) {
      // Skip games without scores
      if (game.homeScore === null || game.awayScore === null) continue;

      const homeKey = game.homeTeam.toLowerCase();
      const awayKey = game.awayTeam.toLowerCase();

      const spreadData = getClosingSpread(game.lines);
      const totalData = getClosingTotal(game.lines);

      const historicalGame: HistoricalGame = {
        gameId: game.id,
        season: game.season,
        week: game.week,
        date: game.startDate,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        actualMargin: game.homeScore - game.awayScore,
        closingSpread: spreadData.closing,
        openingSpread: spreadData.opening,
        closingTotal: totalData.closing,
        openingTotal: totalData.opening,
        homeElo: eloRatings.get(homeKey) || null,
        awayElo: eloRatings.get(awayKey) || null,
        homeSpPlus: spRatings.get(homeKey)?.overall || null,
        awaySpPlus: spRatings.get(awayKey)?.overall || null,
        homePPA: advancedStats.get(homeKey)?.ppa || null,
        awayPPA: advancedStats.get(awayKey)?.ppa || null,
        homeSuccessRate: advancedStats.get(homeKey)?.successRate || null,
        awaySuccessRate: advancedStats.get(awayKey)?.successRate || null,
        homeATS: calculateATSResult(game.homeScore, game.awayScore, spreadData.closing),
        overUnderResult: calculateOUResult(game.homeScore, game.awayScore, totalData.closing),
      };

      allGames.push(historicalGame);
    }
  }

  console.log(`Total games with data: ${allGames.length}`);
  return allGames;
}

/**
 * Filter to only FBS vs FBS games with complete data
 */
export function filterCompleteGames(games: HistoricalGame[]): HistoricalGame[] {
  return games.filter(g =>
    g.closingSpread !== null &&
    g.homeElo !== null &&
    g.awayElo !== null &&
    g.homeATS !== null
  );
}

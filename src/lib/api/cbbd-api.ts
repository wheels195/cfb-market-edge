/**
 * College Basketball Data API Client
 * Uses the same API key as CFBD
 */

const CBBD_BASE_URL = 'https://api.collegebasketballdata.com';

// API call tracking for usage monitoring (paid tier - tracking for visibility only)
let apiCallCount = 0;
const apiCallLog: Array<{ endpoint: string; timestamp: Date }> = [];

export function getCBBDAPIUsage() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const callsThisMonth = apiCallLog.filter(c => c.timestamp >= monthStart).length;

  return {
    totalCalls: apiCallCount,
    callsThisMonth,
    tier: 'paid',
    recentCalls: apiCallLog.slice(-20).map(c => ({
      endpoint: c.endpoint,
      time: c.timestamp.toISOString(),
    })),
  };
}

export function resetCBBDAPICallCount() {
  apiCallCount = 0;
  apiCallLog.length = 0;
}

// Types for CBBD API responses
export interface CBBDTeam {
  id: number;
  sourceId: string;
  school: string;
  mascot: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  primaryColor: string;
  secondaryColor: string;
  currentVenueId: number;
  currentVenue: string;
  currentCity: string;
  currentState: string;
  conferenceId: number | null;
  conference: string | null;
}

export interface CBBDGame {
  id: number;
  sourceId: string;
  seasonLabel: string;
  season: number;
  seasonType: string; // 'regular', 'postseason'
  tournament: string | null;
  startDate: string;
  startTimeTbd: boolean;
  neutralSite: boolean;
  conferenceGame: boolean;
  gameType: string;
  status: string; // 'scheduled', 'in_progress', 'final'
  gameNotes: string | null;
  attendance: number | null;
  homeTeamId: number;
  homeTeam: string;
  homeConferenceId: number | null;
  homeConference: string | null;
  homeSeed: number | null;
  homePoints: number | null;
  homePeriodPoints: number[] | null;
  homeWinner: boolean | null;
  awayTeamId: number;
  awayTeam: string;
  awayConferenceId: number | null;
  awayConference: string | null;
  awaySeed: number | null;
  awayPoints: number | null;
  awayPeriodPoints: number[] | null;
  awayWinner: boolean | null;
  excitement: number | null;
  venueId: number | null;
  venue: string | null;
  city: string | null;
  state: string | null;
}

export interface CBBDAdjustedRating {
  season: number;
  teamId: number;
  team: string;
  conference: string;
  offensiveRating: number;
  defensiveRating: number;
  netRating: number;
  rankings: {
    offense: number;
    defense: number;
    net: number;
  };
}

export interface CBBDSRSRating {
  season: number;
  teamId: number;
  team: string;
  conference: string;
  rating: number;
}

export interface CBBDGameLine {
  provider: string;
  spread: number; // Home spread
  overUnder: number;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  spreadOpen: number | null;
  overUnderOpen: number | null;
}

export interface CBBDGameWithLines {
  gameId: number;
  season: number;
  seasonType: string;
  startDate: string;
  homeTeamId: number;
  homeTeam: string;
  homeConference: string;
  homeScore: number | null;
  awayTeamId: number;
  awayTeam: string;
  awayConference: string;
  awayScore: number | null;
  lines: CBBDGameLine[];
}

export interface CBBDConference {
  id: number;
  sourceId: string;
  name: string;
  abbreviation: string;
  shortName: string;
}

export class CBBDApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.CFBD_API_KEY || '';
    this.baseUrl = CBBD_BASE_URL;

    if (!this.apiKey) {
      throw new Error('CFBD_API_KEY is required for CBBD API');
    }
  }

  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    // Track API call
    apiCallCount++;
    apiCallLog.push({ endpoint, timestamp: new Date() });
    console.log(`[CBBD API] ${endpoint} (call #${apiCallCount})`);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`CBBD API error: ${response.status} ${response.statusText} - ${text}`);
    }

    return response.json();
  }

  /**
   * Get all teams (filter by conference for D1 only)
   */
  async getTeams(): Promise<CBBDTeam[]> {
    const teams = await this.fetch<CBBDTeam[]>('/teams');
    // Filter to D1 teams (those with a conference)
    return teams.filter(t => t.conference !== null);
  }

  /**
   * Get games for a season
   */
  async getGames(season: number, seasonType?: 'regular' | 'postseason'): Promise<CBBDGame[]> {
    const params: Record<string, string> = { season: season.toString() };
    if (seasonType) params.seasonType = seasonType;
    return this.fetch<CBBDGame[]>('/games', params);
  }

  /**
   * Get completed games with scores
   */
  async getCompletedGames(season: number): Promise<CBBDGame[]> {
    const games = await this.getGames(season);
    return games.filter(g => g.status === 'final' && g.homePoints !== null);
  }

  /**
   * Get adjusted efficiency ratings
   */
  async getAdjustedRatings(season: number): Promise<CBBDAdjustedRating[]> {
    return this.fetch<CBBDAdjustedRating[]>('/ratings/adjusted', { season: season.toString() });
  }

  /**
   * Get SRS ratings
   */
  async getSRSRatings(season: number): Promise<CBBDSRSRating[]> {
    return this.fetch<CBBDSRSRating[]>('/ratings/srs', { season: season.toString() });
  }

  /**
   * Get betting lines for games
   */
  async getBettingLines(season: number): Promise<CBBDGameWithLines[]> {
    return this.fetch<CBBDGameWithLines[]>('/lines', { season: season.toString() });
  }

  /**
   * Get conferences
   */
  async getConferences(): Promise<CBBDConference[]> {
    return this.fetch<CBBDConference[]>('/conferences');
  }

  /**
   * Get current season (CBB season spans two calendar years)
   * 2024-25 season = 2025 in the API
   */
  getCurrentSeason(): number {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    // CBB season runs Nov-Apr
    // If we're in Jan-Apr, we're in the "year" season (e.g., Jan 2025 = 2025 season)
    // If we're in Nov-Dec, we're starting the next year's season (e.g., Nov 2024 = 2025 season)
    if (month >= 10) { // Nov or Dec
      return year + 1;
    }
    return year;
  }
}

// Singleton instance
let cbbdClient: CBBDApiClient | null = null;

export function getCBBDApiClient(): CBBDApiClient {
  if (!cbbdClient) {
    cbbdClient = new CBBDApiClient();
  }
  return cbbdClient;
}

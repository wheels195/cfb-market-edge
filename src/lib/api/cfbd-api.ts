import {
  CFBDGame,
  CFBDTeam,
  CFBDWeather,
  CFBDScoreboardGame,
  CFBDGameLines,
  CFBDGamePPA,
  CFBDTeamPPA,
  CFBDTeamRatings,
  CFBDPlayer,
  CFBDPlayerStat,
  CFBDPlayerUsage,
  CFBDTransferPortalPlayer,
  CFBDPlayerGameStats,
} from '@/types/cfbd-api';

// API call tracking for usage monitoring
let apiCallCount = 0;
const apiCallLog: Array<{ endpoint: string; timestamp: Date }> = [];

export function getAPIUsage() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const callsThisMonth = apiCallLog.filter(c => c.timestamp >= monthStart).length;

  return {
    totalCalls: apiCallCount,
    callsThisMonth,
    limit: 5000,
    remaining: Math.max(0, 5000 - callsThisMonth),
    percentUsed: Math.round((callsThisMonth / 5000) * 100),
    recentCalls: apiCallLog.slice(-20).map(c => ({
      endpoint: c.endpoint,
      time: c.timestamp.toISOString(),
    })),
  };
}

export function resetAPICallCount() {
  apiCallCount = 0;
  apiCallLog.length = 0;
}

const BASE_URL = process.env.CFBD_API_BASE_URL || 'https://api.collegefootballdata.com';
const API_KEY = process.env.CFBD_API_KEY;

export class CFBDApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || API_KEY || '';
    this.baseUrl = baseUrl || BASE_URL;

    if (!this.apiKey) {
      throw new Error('CFBD_API_KEY is required');
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

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`CFBD API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get games for a specific season
   */
  async getGames(season: number, week?: number, seasonType?: 'regular' | 'postseason'): Promise<CFBDGame[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (week !== undefined) params.week = week.toString();
    if (seasonType) params.seasonType = seasonType;

    return this.fetch<CFBDGame[]>('/games', params);
  }

  /**
   * Get completed games within a date range
   */
  async getCompletedGames(
    season: number,
    startDate?: string,
    endDate?: string
  ): Promise<CFBDGame[]> {
    const games = await this.getGames(season);
    return games.filter(game => {
      if (!game.completed) return false;
      if (game.homePoints === null || game.awayPoints === null) return false;

      if (startDate || endDate) {
        const gameDate = new Date(game.startDate);
        if (startDate && gameDate < new Date(startDate)) return false;
        if (endDate && gameDate > new Date(endDate)) return false;
      }

      return true;
    });
  }

  /**
   * Get FBS teams
   */
  async getTeams(): Promise<CFBDTeam[]> {
    return this.fetch<CFBDTeam[]>('/teams/fbs');
  }

  /**
   * Get a specific game by ID
   */
  async getGameById(gameId: number): Promise<CFBDGame | null> {
    const games = await this.fetch<CFBDGame[]>('/games', { id: gameId.toString() });
    return games[0] || null;
  }

  /**
   * Get current season year
   */
  getCurrentSeason(): number {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    // College football season typically runs Aug-Jan
    // If we're in Jan, use previous year's season
    if (month < 6) {
      return year - 1;
    }
    return year;
  }

  /**
   * Get weather data for games (Patreon Tier 1+ required)
   */
  async getWeather(season: number, week?: number, seasonType?: 'regular' | 'postseason'): Promise<CFBDWeather[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (week !== undefined) params.week = week.toString();
    if (seasonType) params.seasonType = seasonType;

    return this.fetch<CFBDWeather[]>('/games/weather', params);
  }

  /**
   * Get weather for a specific game by ID
   */
  async getGameWeather(gameId: number): Promise<CFBDWeather | null> {
    const params: Record<string, string> = { gameId: gameId.toString() };
    const weather = await this.fetch<CFBDWeather[]>('/games/weather', params);
    return weather[0] || null;
  }

  /**
   * Get weather for games in a date range
   */
  async getWeatherByDateRange(
    season: number,
    startDate?: string,
    endDate?: string
  ): Promise<CFBDWeather[]> {
    const allWeather = await this.getWeather(season);

    if (!startDate && !endDate) return allWeather;

    return allWeather.filter(w => {
      const gameDate = new Date(w.startTime);
      if (startDate && gameDate < new Date(startDate)) return false;
      if (endDate && gameDate > new Date(endDate)) return false;
      return true;
    });
  }

  // ========== LIVE SCOREBOARD ==========

  /**
   * Get live scoreboard with real-time game updates
   * Returns games in progress and recently completed
   */
  async getScoreboard(classification?: 'fbs' | 'fcs'): Promise<CFBDScoreboardGame[]> {
    const params: Record<string, string> = {};
    if (classification) params.classification = classification;
    return this.fetch<CFBDScoreboardGame[]>('/scoreboard', params);
  }

  /**
   * Get live scoreboard for a specific conference
   */
  async getScoreboardByConference(conference: string): Promise<CFBDScoreboardGame[]> {
    const params: Record<string, string> = { conference };
    return this.fetch<CFBDScoreboardGame[]>('/scoreboard', params);
  }

  // ========== BETTING LINES ==========

  /**
   * Get betting lines for games
   */
  async getBettingLines(
    season: number,
    week?: number,
    seasonType?: 'regular' | 'postseason',
    team?: string
  ): Promise<CFBDGameLines[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (week !== undefined) params.week = week.toString();
    if (seasonType) params.seasonType = seasonType;
    if (team) params.team = team;

    return this.fetch<CFBDGameLines[]>('/lines', params);
  }

  /**
   * Get betting lines for a specific game
   */
  async getGameBettingLines(gameId: number): Promise<CFBDGameLines | null> {
    const params: Record<string, string> = { gameId: gameId.toString() };
    const lines = await this.fetch<CFBDGameLines[]>('/lines', params);
    return lines[0] || null;
  }

  // ========== PPA (PREDICTED POINTS ADDED) METRICS ==========

  /**
   * Get game-level PPA metrics
   */
  async getGamePPA(
    season: number,
    week?: number,
    team?: string,
    seasonType?: 'regular' | 'postseason'
  ): Promise<CFBDGamePPA[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (week !== undefined) params.week = week.toString();
    if (team) params.team = team;
    if (seasonType) params.seasonType = seasonType;

    return this.fetch<CFBDGamePPA[]>('/ppa/games', params);
  }

  /**
   * Get season-level team PPA metrics
   */
  async getTeamPPA(
    season: number,
    team?: string,
    conference?: string
  ): Promise<CFBDTeamPPA[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;
    if (conference) params.conference = conference;

    return this.fetch<CFBDTeamPPA[]>('/ppa/teams', params);
  }

  // ========== TEAM RATINGS ==========

  /**
   * Get composite team ratings (Elo, FPI, SRS, SP+)
   */
  async getTeamRatings(
    season: number,
    team?: string
  ): Promise<CFBDTeamRatings[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;

    return this.fetch<CFBDTeamRatings[]>('/ratings', params);
  }

  /**
   * Get SP+ ratings for teams
   */
  async getSPRatings(
    season: number,
    team?: string
  ): Promise<CFBDTeamRatings[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;

    return this.fetch<CFBDTeamRatings[]>('/ratings/sp', params);
  }

  /**
   * Get Elo ratings history for a team
   */
  async getEloRatings(
    season: number,
    team?: string,
    week?: number
  ): Promise<Array<{ team: string; elo: number; year: number; week?: number }>> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;
    if (week !== undefined) params.week = week.toString();

    return this.fetch('/ratings/elo', params);
  }

  // ========== PLAYER DATA ==========

  /**
   * Get team roster
   */
  async getRoster(team: string, season?: number): Promise<CFBDPlayer[]> {
    const params: Record<string, string> = { team };
    if (season !== undefined) params.year = season.toString();

    return this.fetch<CFBDPlayer[]>('/roster', params);
  }

  /**
   * Get player season statistics
   */
  async getPlayerSeasonStats(
    season: number,
    team?: string,
    category?: 'passing' | 'rushing' | 'receiving' | 'defensive'
  ): Promise<CFBDPlayerStat[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;
    if (category) params.category = category;

    return this.fetch<CFBDPlayerStat[]>('/stats/player/season', params);
  }

  /**
   * Get player game statistics (for identifying starters post-game)
   * Returns player stats broken down by game
   */
  async getPlayerGameStats(
    season: number,
    week?: number,
    seasonType?: 'regular' | 'postseason',
    team?: string,
    category?: 'passing' | 'rushing' | 'receiving' | 'defensive'
  ): Promise<CFBDPlayerGameStats[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (week !== undefined) params.week = week.toString();
    if (seasonType) params.seasonType = seasonType;
    if (team) params.team = team;
    if (category) params.category = category;

    return this.fetch<CFBDPlayerGameStats[]>('/games/players', params);
  }

  /**
   * Get player usage metrics
   */
  async getPlayerUsage(
    season: number,
    team?: string,
    position?: string
  ): Promise<CFBDPlayerUsage[]> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;
    if (position) params.position = position;

    return this.fetch<CFBDPlayerUsage[]>('/player/usage', params);
  }

  /**
   * Search for players
   */
  async searchPlayers(
    searchTerm: string,
    position?: string,
    team?: string
  ): Promise<Array<{ id: string; team: string; name: string; firstName: string; lastName: string; weight: number; height: number; jersey: number; position: string; hometown: string; teamColor: string; teamColorSecondary: string }>> {
    const params: Record<string, string> = { searchTerm };
    if (position) params.position = position;
    if (team) params.team = team;

    return this.fetch('/player/search', params);
  }

  /**
   * Get transfer portal entries
   */
  async getTransferPortal(season: number): Promise<CFBDTransferPortalPlayer[]> {
    const params: Record<string, string> = { year: season.toString() };
    return this.fetch<CFBDTransferPortalPlayer[]>('/player/portal', params);
  }

  /**
   * Get returning production for teams (how much production returns from last year)
   */
  async getReturningProduction(
    season: number,
    team?: string
  ): Promise<Array<{
    season: number;
    team: string;
    conference: string;
    totalPPA: number;
    totalPassingPPA: number;
    totalRushingPPA: number;
    totalReceivingPPA: number;
    percentPPA: number;
    percentPassingPPA: number;
    percentRushingPPA: number;
    percentReceivingPPA: number;
    usage: number;
    passingUsage: number;
    rushingUsage: number;
    receivingUsage: number;
  }>> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;

    return this.fetch('/player/returning', params);
  }

  // ========== TEAM STATISTICS ==========

  /**
   * Get team season statistics (points, yards, turnovers, etc.)
   */
  async getTeamSeasonStats(
    season: number,
    team?: string,
    conference?: string
  ): Promise<Array<{
    season: number;
    team: string;
    conference: string;
    statName: string;
    statValue: number;
  }>> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;
    if (conference) params.conference = conference;

    return this.fetch('/stats/season', params);
  }

  /**
   * Get advanced team season statistics (success rate, explosiveness, havoc, etc.)
   */
  async getAdvancedTeamStats(
    season: number,
    team?: string,
    excludeGarbageTime?: boolean
  ): Promise<Array<{
    season: number;
    team: string;
    conference: string;
    offense: {
      plays: number;
      drives: number;
      ppa: number;
      totalPPA: number;
      successRate: number;
      explosiveness: number;
      powerSuccess: number;
      stuffRate: number;
      lineYards: number;
      lineYardsTotal: number;
      secondLevelYards: number;
      secondLevelYardsTotal: number;
      openFieldYards: number;
      openFieldYardsTotal: number;
      standardDowns: { rate: number; ppa: number; successRate: number; explosiveness: number };
      passingDowns: { rate: number; ppa: number; successRate: number; explosiveness: number };
      rushing: { rate: number; ppa: number; totalPPA: number; successRate: number; explosiveness: number };
      passing: { rate: number; ppa: number; totalPPA: number; successRate: number; explosiveness: number };
    };
    defense: {
      plays: number;
      drives: number;
      ppa: number;
      totalPPA: number;
      successRate: number;
      explosiveness: number;
      powerSuccess: number;
      stuffRate: number;
      lineYards: number;
      lineYardsTotal: number;
      secondLevelYards: number;
      secondLevelYardsTotal: number;
      openFieldYards: number;
      openFieldYardsTotal: number;
      standardDowns: { rate: number; ppa: number; successRate: number; explosiveness: number };
      passingDowns: { rate: number; ppa: number; successRate: number; explosiveness: number };
      rushing: { rate: number; ppa: number; totalPPA: number; successRate: number; explosiveness: number };
      passing: { rate: number; ppa: number; totalPPA: number; successRate: number; explosiveness: number };
      havoc: { total: number; frontSeven: number; db: number };
    };
  }>> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;
    if (excludeGarbageTime) params.excludeGarbageTime = 'true';

    return this.fetch('/stats/season/advanced', params);
  }

  /**
   * Get team records (wins, losses, conference record)
   */
  async getTeamRecords(
    season: number,
    team?: string,
    conference?: string
  ): Promise<Array<{
    year: number;
    team: string;
    conference: string;
    division: string;
    total: { games: number; wins: number; losses: number; ties: number };
    conferenceGames: { games: number; wins: number; losses: number; ties: number };
    homeGames: { games: number; wins: number; losses: number; ties: number };
    awayGames: { games: number; wins: number; losses: number; ties: number };
  }>> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;
    if (conference) params.conference = conference;

    return this.fetch('/records', params);
  }

  /**
   * Get pregame win probabilities (useful for totals model)
   */
  async getPregameWinProbabilities(
    season: number,
    week?: number,
    team?: string
  ): Promise<Array<{
    season: number;
    seasonType: string;
    week: number;
    gameId: number;
    homeTeam: string;
    awayTeam: string;
    spread: number;
    homeWinProb: number;
  }>> {
    const params: Record<string, string> = { year: season.toString() };
    if (week !== undefined) params.week = week.toString();
    if (team) params.team = team;

    return this.fetch('/metrics/wp/pregame', params);
  }

  /**
   * Get predicted points (FPI-like metric)
   */
  async getPredictedPoints(
    season: number,
    week?: number,
    team?: string
  ): Promise<Array<{
    season: number;
    week: number;
    id: number;
    homeTeam: string;
    awayTeam: string;
    homePoints: number;
    awayPoints: number;
    spread: number;
  }>> {
    const params: Record<string, string> = { year: season.toString() };
    if (week !== undefined) params.week = week.toString();
    if (team) params.team = team;

    return this.fetch('/ppa/predicted', params);
  }

  /**
   * Get team recruiting rankings
   */
  async getRecruitingTeams(
    season: number,
    team?: string
  ): Promise<Array<{
    year: number;
    rank: number;
    team: string;
    points: number;
  }>> {
    const params: Record<string, string> = { year: season.toString() };
    if (team) params.team = team;

    return this.fetch('/recruiting/teams', params);
  }

  /**
   * Get talent composite rankings
   */
  async getTalentRankings(
    season: number
  ): Promise<Array<{
    year: number;
    school: string;
    talent: number;
  }>> {
    const params: Record<string, string> = { year: season.toString() };

    return this.fetch('/talent', params);
  }

}

// Singleton instance
let cfbdClient: CFBDApiClient | null = null;

export function getCFBDApiClient(): CFBDApiClient {
  if (!cfbdClient) {
    cfbdClient = new CFBDApiClient();
  }
  return cfbdClient;
}

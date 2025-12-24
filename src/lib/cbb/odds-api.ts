/**
 * CBB Odds API Client
 *
 * Polls The Odds API for college basketball spreads
 */

import {
  OddsApiEvent,
  OddsApiMarket,
  ParsedOdds,
  OddsApiQuota,
} from '@/types/odds-api';

const BASE_URL = process.env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4';
const API_KEY = process.env.ODDS_API_KEY;
const SPORT_KEY = 'basketball_ncaab';  // CBB sport key
const REGIONS = 'us,us2';
const ODDS_FORMAT = 'american';

// Only use DraftKings for CBB
const TARGET_BOOKMAKERS = ['draftkings'];

export class CbbOddsApiClient {
  private apiKey: string;
  private baseUrl: string;
  private lastQuota: OddsApiQuota | null = null;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || API_KEY || '';
    this.baseUrl = baseUrl || BASE_URL;

    if (!this.apiKey) {
      throw new Error('ODDS_API_KEY is required');
    }
  }

  getQuota(): OddsApiQuota | null {
    return this.lastQuota;
  }

  /**
   * Fetch upcoming CBB events
   */
  async getEvents(): Promise<OddsApiEvent[]> {
    const url = new URL(`${this.baseUrl}/sports/${SPORT_KEY}/events`);
    url.searchParams.set('apiKey', this.apiKey);

    const response = await fetch(url.toString());
    this.updateQuota(response);

    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Fetch odds for all upcoming CBB events
   */
  async getOdds(): Promise<OddsApiEvent[]> {
    const url = new URL(`${this.baseUrl}/sports/${SPORT_KEY}/odds`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('regions', REGIONS);
    url.searchParams.set('markets', 'spreads,totals');
    url.searchParams.set('oddsFormat', ODDS_FORMAT);
    url.searchParams.set('bookmakers', TARGET_BOOKMAKERS.join(','));

    const response = await fetch(url.toString());
    this.updateQuota(response);

    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Parse odds for a specific bookmaker (default: DraftKings)
   */
  parseOdds(event: OddsApiEvent, bookmakerKey: string = 'draftkings'): {
    spread: number | null;
    total: number | null;
    homeTeam: string;
    awayTeam: string;
  } {
    const bookmaker = event.bookmakers.find(b => b.key === bookmakerKey);
    if (!bookmaker) {
      return { spread: null, total: null, homeTeam: event.home_team, awayTeam: event.away_team };
    }

    let spread: number | null = null;
    let total: number | null = null;

    for (const market of bookmaker.markets) {
      if (market.key === 'spreads') {
        const homeOutcome = market.outcomes.find(o => o.name === event.home_team);
        if (homeOutcome?.point !== undefined) {
          spread = homeOutcome.point;
        }
      } else if (market.key === 'totals') {
        const overOutcome = market.outcomes.find(o => o.name === 'Over');
        if (overOutcome?.point !== undefined) {
          total = overOutcome.point;
        }
      }
    }

    return {
      spread,
      total,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
    };
  }

  private updateQuota(response: Response): void {
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');

    if (remaining && used) {
      this.lastQuota = {
        requests_remaining: parseInt(remaining, 10),
        requests_used: parseInt(used, 10),
      };
    }
  }
}

// Singleton instance
let cbbOddsApiClient: CbbOddsApiClient | null = null;

export function getCbbOddsApiClient(): CbbOddsApiClient {
  if (!cbbOddsApiClient) {
    cbbOddsApiClient = new CbbOddsApiClient();
  }
  return cbbOddsApiClient;
}

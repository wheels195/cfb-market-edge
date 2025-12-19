import {
  OddsApiEvent,
  OddsApiBookmaker,
  OddsApiMarket,
  ParsedOdds,
  OddsApiQuota,
} from '@/types/odds-api';

const BASE_URL = process.env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4';
const API_KEY = process.env.ODDS_API_KEY;
const SPORT_KEY = 'americanfootball_ncaaf';
const REGIONS = 'us,us2';  // Include us2 for more books
const ODDS_FORMAT = 'american';

// All available US sportsbooks - ordered by sharpness/importance
// Pinnacle and LowVig are sharp books used as market benchmarks
const TARGET_BOOKMAKERS = [
  'pinnacle',      // Sharp benchmark - the gold standard
  'lowvig',        // Another sharp book
  'draftkings',    // Major retail
  'fanduel',       // Major retail
  'betmgm',        // Major retail
  'espnbet',       // ESPN Bet
  'betrivers',     // BetRivers
  'bovada',        // Bovada
  'betonlineag',   // BetOnline
  'hardrockbet',   // Hard Rock
  'ballybet',      // Bally
  'betparx',       // BetParx
  'fliff',         // Fliff
];

// Sharp books used for CLV benchmark
export const SHARP_BOOKMAKERS = ['pinnacle', 'lowvig'];

// Primary retail books for betting recommendations
export const PRIMARY_BOOKMAKERS = ['draftkings', 'fanduel', 'betmgm', 'espnbet'];

export class OddsApiClient {
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

  /**
   * Get the last known API quota (from response headers)
   */
  getQuota(): OddsApiQuota | null {
    return this.lastQuota;
  }

  /**
   * Fetch upcoming NCAAF events
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
   * Fetch odds for all upcoming NCAAF events
   * Filtered to spreads and totals for DraftKings and FanDuel
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
   * Fetch odds for a specific event
   */
  async getEventOdds(eventId: string): Promise<OddsApiEvent | null> {
    const url = new URL(`${this.baseUrl}/sports/${SPORT_KEY}/events/${eventId}/odds`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('regions', REGIONS);
    url.searchParams.set('markets', 'spreads,totals');
    url.searchParams.set('oddsFormat', ODDS_FORMAT);
    url.searchParams.set('bookmakers', TARGET_BOOKMAKERS.join(','));

    const response = await fetch(url.toString());
    this.updateQuota(response);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Parse raw Odds API response into canonical format
   * Now includes all available bookmakers for comprehensive market view
   */
  parseOdds(event: OddsApiEvent, bookmakerFilter?: string[]): ParsedOdds[] {
    const results: ParsedOdds[] = [];
    const filter = bookmakerFilter || TARGET_BOOKMAKERS;

    for (const bookmaker of event.bookmakers) {
      // Only filter if we have a filter list
      if (filter.length > 0 && !filter.includes(bookmaker.key)) continue;

      const parsed: ParsedOdds = {
        eventId: event.id,
        bookmakerKey: bookmaker.key,
        lastUpdate: bookmaker.last_update,
      };

      for (const market of bookmaker.markets) {
        if (market.key === 'spreads') {
          parsed.spreads = this.parseSpreads(market, event.home_team, event.away_team);
        } else if (market.key === 'totals') {
          parsed.totals = this.parseTotals(market);
        }
      }

      results.push(parsed);
    }

    return results;
  }

  /**
   * Get Pinnacle lines specifically (sharp benchmark)
   */
  async getPinnacleOdds(): Promise<OddsApiEvent[]> {
    const url = new URL(`${this.baseUrl}/sports/${SPORT_KEY}/odds`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('regions', 'us,us2');
    url.searchParams.set('markets', 'spreads,totals');
    url.searchParams.set('oddsFormat', ODDS_FORMAT);
    url.searchParams.set('bookmakers', 'pinnacle');

    const response = await fetch(url.toString());
    this.updateQuota(response);

    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get consensus line (average across sharp books)
   */
  getConsensusLine(event: OddsApiEvent): { spread: number | null; total: number | null } {
    const sharpOdds = event.bookmakers.filter(b => SHARP_BOOKMAKERS.includes(b.key));

    let spreadSum = 0, spreadCount = 0;
    let totalSum = 0, totalCount = 0;

    for (const book of sharpOdds) {
      for (const market of book.markets) {
        if (market.key === 'spreads') {
          const homeOutcome = market.outcomes.find(o => o.name === event.home_team);
          if (homeOutcome?.point !== undefined) {
            spreadSum += homeOutcome.point;
            spreadCount++;
          }
        } else if (market.key === 'totals') {
          const overOutcome = market.outcomes.find(o => o.name === 'Over');
          if (overOutcome?.point !== undefined) {
            totalSum += overOutcome.point;
            totalCount++;
          }
        }
      }
    }

    return {
      spread: spreadCount > 0 ? spreadSum / spreadCount : null,
      total: totalCount > 0 ? totalSum / totalCount : null,
    };
  }

  /**
   * Parse spreads market into home/away format
   * Convention: spread_points_home is always from home team perspective
   */
  private parseSpreads(
    market: OddsApiMarket,
    homeTeam: string,
    awayTeam: string
  ): ParsedOdds['spreads'] {
    let homeOutcome = market.outcomes.find(o => o.name === homeTeam);
    let awayOutcome = market.outcomes.find(o => o.name === awayTeam);

    // Sometimes the API uses slightly different team names
    if (!homeOutcome || !awayOutcome) {
      // Try matching by position (first outcome is typically home)
      if (market.outcomes.length >= 2) {
        homeOutcome = market.outcomes[0];
        awayOutcome = market.outcomes[1];
      }
    }

    if (!homeOutcome || !awayOutcome || homeOutcome.point === undefined) {
      return undefined;
    }

    return {
      home: {
        points: homeOutcome.point,  // Home spread (e.g., -6.5)
        price: homeOutcome.price,
      },
      away: {
        points: awayOutcome.point!,  // Away spread (e.g., +6.5)
        price: awayOutcome.price,
      },
    };
  }

  /**
   * Parse totals market into over/under format
   */
  private parseTotals(market: OddsApiMarket): ParsedOdds['totals'] {
    const overOutcome = market.outcomes.find(o => o.name === 'Over');
    const underOutcome = market.outcomes.find(o => o.name === 'Under');

    if (!overOutcome || !underOutcome || overOutcome.point === undefined) {
      return undefined;
    }

    return {
      over: {
        points: overOutcome.point,
        price: overOutcome.price,
      },
      under: {
        points: underOutcome.point!,
        price: underOutcome.price,
      },
    };
  }

  /**
   * Update quota tracking from response headers
   */
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
let oddsApiClient: OddsApiClient | null = null;

export function getOddsApiClient(): OddsApiClient {
  if (!oddsApiClient) {
    oddsApiClient = new OddsApiClient();
  }
  return oddsApiClient;
}

/**
 * Convert American odds to decimal
 */
export function americanToDecimal(american: number): number {
  if (american > 0) {
    return (american / 100) + 1;
  } else {
    return (100 / Math.abs(american)) + 1;
  }
}

/**
 * Generate a hash for deduplication
 */
export function generateTickHash(
  eventId: string,
  bookmakerKey: string,
  marketType: string,
  side: string,
  points: number,
  priceAmerican: number
): string {
  const payload = `${eventId}|${bookmakerKey}|${marketType}|${side}|${points}|${priceAmerican}`;
  // Simple hash for deduplication
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

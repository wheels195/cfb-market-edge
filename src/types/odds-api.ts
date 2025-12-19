// Types for The Odds API responses

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;  // ISO 8601
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;  // ISO 8601
  markets: OddsApiMarket[];
}

export interface OddsApiMarket {
  key: 'spreads' | 'totals' | 'h2h';
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiOutcome {
  name: string;  // Team name for spreads, "Over"/"Under" for totals
  price: number;  // American odds
  point?: number;  // Spread or total points
}

// Parsed/normalized types for internal use
export interface ParsedOdds {
  eventId: string;
  bookmakerKey: string;
  lastUpdate: string;
  spreads?: {
    home: { points: number; price: number };
    away: { points: number; price: number };
  };
  totals?: {
    over: { points: number; price: number };
    under: { points: number; price: number };
  };
}

export interface OddsApiQuota {
  requests_remaining: number;
  requests_used: number;
}

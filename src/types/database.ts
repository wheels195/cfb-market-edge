// Database types matching the Supabase schema

export type MarketType = 'spread' | 'total';
export type SpreadSide = 'home' | 'away';
export type TotalSide = 'over' | 'under';
export type Side = SpreadSide | TotalSide;
export type EventStatus = 'scheduled' | 'in_progress' | 'final' | 'cancelled' | 'postponed';
export type JobStatus = 'running' | 'success' | 'failed';

// Reference Tables
export interface Sportsbook {
  id: string;
  key: string;
  name: string;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  abbrev: string | null;
  cfbd_team_id: string | null;
  odds_api_name: string | null;
  created_at: string;
}

export interface TeamAlias {
  id: string;
  team_id: string;
  alias: string;
  source: 'odds_api' | 'cfbd' | 'manual';
  created_at: string;
}

// Core Tables
export interface Event {
  id: string;
  league: string;
  commence_time: string;
  home_team_id: string;
  away_team_id: string;
  odds_api_event_id: string;
  cfbd_game_id: string | null;
  status: EventStatus;
  created_at: string;
  updated_at: string;
}

export interface EventWithTeams extends Event {
  home_team_name: string;
  home_team_abbrev: string | null;
  away_team_name: string;
  away_team_abbrev: string | null;
}

// Odds Data
export interface OddsTick {
  id: string;
  event_id: string;
  sportsbook_id: string;
  market_type: MarketType;
  captured_at: string;
  side: Side;
  spread_points_home: number | null;
  total_points: number | null;
  price_american: number;
  price_decimal: number;
  payload_hash: string;
  created_at: string;
}

export interface ClosingLine {
  id: string;
  event_id: string;
  sportsbook_id: string;
  market_type: MarketType;
  side: Side;
  captured_at: string;
  spread_points_home: number | null;
  total_points: number | null;
  price_american: number;
  price_decimal: number;
  created_at: string;
}

// Results
export interface Result {
  event_id: string;
  home_score: number;
  away_score: number;
  final_total: number;
  home_margin: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Modeling
export interface ModelVersion {
  id: string;
  name: string;
  description: string | null;
  config: Record<string, unknown> | null;
  created_at: string;
}

export interface TeamRating {
  id: string;
  team_id: string;
  model_version_id: string;
  rating: number;
  games_played: number;
  last_updated: string;
  season: number;
}

export interface TeamStats {
  id: string;
  team_id: string;
  season: number;
  games_played: number;
  total_points_for: number;
  total_points_against: number;
  avg_points_for: number;
  avg_points_against: number;
  last_updated: string;
}

export interface Projection {
  id: string;
  event_id: string;
  model_version_id: string;
  generated_at: string;
  model_spread_home: number;
  model_total_points: number;
  home_rating: number | null;
  away_rating: number | null;
  home_avg_points_for: number | null;
  home_avg_points_against: number | null;
  away_avg_points_for: number | null;
  away_avg_points_against: number | null;
  created_at: string;
}

// Edges
export interface Edge {
  id: string;
  event_id: string;
  sportsbook_id: string;
  market_type: MarketType;
  as_of: string;
  market_spread_home: number | null;
  market_total_points: number | null;
  market_price_american: number | null;
  model_spread_home: number | null;
  model_total_points: number | null;
  edge_points: number;
  recommended_side: Side;
  recommended_bet_label: string;
  rank_abs_edge: number | null;
  explain: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Operational
export interface ApiUsageDaily {
  id: string;
  date: string;
  odds_api_calls: number;
  cfbd_api_calls: number;
  events_synced: number;
  ticks_written: number;
  dedupe_hits: number;
  errors: number;
  created_at: string;
  updated_at: string;
}

export interface JobRun {
  id: string;
  job_name: string;
  started_at: string;
  completed_at: string | null;
  status: JobStatus;
  records_processed: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
}

// Composite types for API responses
export interface EventWithOdds extends EventWithTeams {
  odds: {
    [bookKey: string]: {
      spread?: {
        home: { points: number; price: number };
        away: { points: number; price: number };
        updated_at: string;
      };
      total?: {
        over: { points: number; price: number };
        under: { points: number; price: number };
        updated_at: string;
      };
    };
  };
}

export interface EdgeWithDetails extends Edge {
  event: EventWithTeams;
  sportsbook: Sportsbook;
  projection: Projection | null;
  opening_line?: {
    spread_points_home?: number;
    total_points?: number;
  };
}

-- Fix Supabase security linter issues
-- 1. Enable RLS on all public tables with permissive policies
-- 2. Fix SECURITY DEFINER views

-- ============================================================
-- PART 1: Enable RLS on all tables and add permissive policies
-- ============================================================

-- CFB Core Tables
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sportsbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odds_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closing_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_advanced_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clv_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advanced_team_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elo_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returning_production ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiting_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_advanced_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_weather ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_ratings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_ratings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projections_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_movement_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_portal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfbd_elo_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clv_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfbd_betting_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_elo_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_calibration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_stats_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_predictions ENABLE ROW LEVEL SECURITY;

-- CBB Tables
ALTER TABLE public.cbb_team_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_unmatched_team_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_team_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_team_name_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_sync_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_ratings_season_end ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_betting_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_game_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_elo_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbb_odds_ticks ENABLE ROW LEVEL SECURITY;

-- Reports
ALTER TABLE public.model_reports ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 2: Add permissive policies for all tables
-- (Personal app - allow all access via anon/service keys)
-- ============================================================

-- CFB Core Tables
CREATE POLICY "Allow all access" ON public.teams FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.team_aliases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.sportsbooks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.odds_ticks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.closing_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.team_ratings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.model_versions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.team_stats FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.projections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.job_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.api_usage_daily FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.team_advanced_stats FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.clv_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.edges FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.advanced_team_ratings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.game_context FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.elo_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.returning_production FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.player_seasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.player_usage FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.rosters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.recruiting_classes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.coaches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.game_advanced_stats FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.game_weather FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.team_ratings_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.player_ratings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.player_ratings_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.projections_v2 FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.line_movement_analysis FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.bet_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.transfer_portal FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cfbd_elo_ratings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.clv_tracking FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cfbd_betting_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.team_elo_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.backtest_projections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.model_calibration FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.backtest_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.backtest_bets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.team_stats_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.paper_bets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.game_predictions FOR ALL USING (true) WITH CHECK (true);

-- CBB Tables
CREATE POLICY "Allow all access" ON public.cbb_team_ratings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_unmatched_team_names FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_teams FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_team_aliases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_team_name_mappings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_sync_progress FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_ratings_season_end FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_betting_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_games FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_game_predictions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_elo_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.cbb_odds_ticks FOR ALL USING (true) WITH CHECK (true);

-- Reports
CREATE POLICY "Allow all access" ON public.model_reports FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- PART 3: Fix SECURITY DEFINER views
-- Recreate views without SECURITY DEFINER
-- ============================================================

-- Drop and recreate latest_odds view
DROP VIEW IF EXISTS public.latest_odds;
CREATE VIEW public.latest_odds AS
SELECT DISTINCT ON (event_id, sportsbook_id, market_type, side)
    id,
    event_id,
    sportsbook_id,
    market_type,
    side,
    spread_points_home,
    total_points,
    price_american,
    price_decimal,
    captured_at
FROM public.odds_ticks
ORDER BY event_id, sportsbook_id, market_type, side, captured_at DESC;

-- Drop and recreate upcoming_events view
DROP VIEW IF EXISTS public.upcoming_events;
CREATE VIEW public.upcoming_events AS
SELECT
    e.id,
    e.commence_time,
    e.status,
    e.odds_api_event_id,
    e.cfbd_game_id,
    ht.name AS home_team,
    at.name AS away_team,
    e.home_team_id,
    e.away_team_id
FROM public.events e
LEFT JOIN public.teams ht ON e.home_team_id = ht.id
LEFT JOIN public.teams at ON e.away_team_id = at.id
WHERE e.commence_time > NOW()
ORDER BY e.commence_time;

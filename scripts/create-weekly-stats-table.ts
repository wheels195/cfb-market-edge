/**
 * Create the team_stats_snapshots table
 *
 * Run this script to get the SQL to paste into Supabase SQL Editor:
 * npx tsx scripts/create-weekly-stats-table.ts
 */

console.log(`
=== CREATE WEEKLY STATS TABLE ===

Please run this SQL in Supabase SQL Editor:
https://supabase.com/dashboard/project/cdhujemmhfbsmzchsuci/sql/new

--- Copy from here ---

CREATE TABLE IF NOT EXISTS team_stats_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0,
    off_ppa NUMERIC,
    def_ppa NUMERIC,
    total_plays INTEGER,
    plays_per_game NUMERIC,
    source VARCHAR(50) DEFAULT 'cfbd_ppa',
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season, week)
);

CREATE INDEX IF NOT EXISTS idx_team_stats_team_season_week ON team_stats_snapshots(team_id, season, week);
CREATE INDEX IF NOT EXISTS idx_team_stats_season_week ON team_stats_snapshots(season, week);

--- End SQL ---

After running, verify with:
SELECT COUNT(*) FROM team_stats_snapshots;
`);

-- CBB Team Aliases Migration
-- Adds strict team name matching infrastructure

-- 1. Add odds_api_name to cbb_teams
ALTER TABLE cbb_teams ADD COLUMN IF NOT EXISTS odds_api_name TEXT;
CREATE INDEX IF NOT EXISTS idx_cbb_teams_odds_api_name ON cbb_teams(odds_api_name);

-- 2. Team aliases table for multiple name mappings
CREATE TABLE IF NOT EXISTS cbb_team_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES cbb_teams(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  source TEXT NOT NULL,  -- 'odds_api', 'cbbd', 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alias, source)
);

CREATE INDEX IF NOT EXISTS idx_cbb_team_aliases_alias ON cbb_team_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_cbb_team_aliases_team_id ON cbb_team_aliases(team_id);

-- 3. Unmatched team names log (for failed lookups)
CREATE TABLE IF NOT EXISTS cbb_unmatched_team_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  source TEXT NOT NULL,  -- 'odds_api', 'cbbd'
  context TEXT,          -- Additional context (game_id, date, etc.)
  resolved BOOLEAN DEFAULT FALSE,
  resolved_team_id UUID REFERENCES cbb_teams(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE(team_name, source)
);

CREATE INDEX IF NOT EXISTS idx_cbb_unmatched_resolved ON cbb_unmatched_team_names(resolved);

-- 4. Explicit name mapping table (for known transformations)
CREATE TABLE IF NOT EXISTS cbb_team_name_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,        -- Name from external source
  source_type TEXT NOT NULL,        -- 'odds_api', 'cbbd'
  team_id UUID NOT NULL REFERENCES cbb_teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_name, source_type)
);

CREATE INDEX IF NOT EXISTS idx_cbb_name_mappings_source ON cbb_team_name_mappings(source_name, source_type);

-- Grant permissions
GRANT ALL ON cbb_team_aliases TO authenticated;
GRANT ALL ON cbb_team_aliases TO anon;
GRANT ALL ON cbb_unmatched_team_names TO authenticated;
GRANT ALL ON cbb_unmatched_team_names TO anon;
GRANT ALL ON cbb_team_name_mappings TO authenticated;
GRANT ALL ON cbb_team_name_mappings TO anon;

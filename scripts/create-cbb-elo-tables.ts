/**
 * Create CBB Elo tables directly via Supabase client
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('Creating CBB Elo tables...\n');

  // First check if the table exists by trying to query it
  const { data: existingData, error: existingError } = await supabase
    .from('cbb_elo_snapshots')
    .select('*')
    .limit(1);

  if (!existingError) {
    console.log('Table cbb_elo_snapshots already exists!');
    return;
  }

  // Since we can't create tables via anon key, let's output the SQL
  console.log('The table cbb_elo_snapshots does not exist.');
  console.log('Please run the following SQL in the Supabase dashboard SQL editor:\n');
  console.log('=' .repeat(70));
  console.log(`
-- CBB Elo Snapshots table
CREATE TABLE IF NOT EXISTS cbb_elo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES cbb_teams(id),
  season INTEGER NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  elo NUMERIC(8,2) NOT NULL DEFAULT 1500,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_cbb_elo_snapshots_team_season ON cbb_elo_snapshots(team_id, season);
CREATE INDEX IF NOT EXISTS idx_cbb_elo_snapshots_season ON cbb_elo_snapshots(season);

-- Grant permissions
GRANT ALL ON cbb_elo_snapshots TO authenticated;
GRANT ALL ON cbb_elo_snapshots TO anon;

-- Add columns to cbb_game_predictions
ALTER TABLE cbb_game_predictions
ADD COLUMN IF NOT EXISTS home_elo NUMERIC(8,2),
ADD COLUMN IF NOT EXISTS away_elo NUMERIC(8,2),
ADD COLUMN IF NOT EXISTS home_games_played INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS away_games_played INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS spread_size NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS is_underdog_bet BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS qualifies_for_bet BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS qualification_reason TEXT,
ADD COLUMN IF NOT EXISTS bet_result VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_cbb_predictions_qualifies ON cbb_game_predictions(qualifies_for_bet) WHERE qualifies_for_bet = TRUE;
  `);
  console.log('=' .repeat(70));
  console.log('\nAfter running the SQL, run seed-cbb-elo.ts again.');
}

main().catch(console.error);

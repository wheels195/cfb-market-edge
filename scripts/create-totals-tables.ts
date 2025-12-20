/**
 * Create tables for Totals V1 model
 *
 * Uses Supabase REST API to execute raw SQL
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('Creating tables for Totals V1 model...\n');

  // We'll use the RPC method to execute SQL if available
  // Otherwise, print the SQL for manual execution

  const createSPTable = `
CREATE TABLE IF NOT EXISTS sp_weekly_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid REFERENCES teams(id),
  season int NOT NULL,
  week int NOT NULL,
  sp_overall numeric,
  sp_offense numeric,
  sp_defense numeric,
  source_season int,
  created_at timestamptz DEFAULT now(),
  UNIQUE(team_id, season, week)
);

CREATE INDEX IF NOT EXISTS idx_sp_snapshots_lookup
  ON sp_weekly_snapshots(season, week, team_id);
  `;

  const createPaceTable = `
CREATE TABLE IF NOT EXISTS pace_weekly_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid REFERENCES teams(id),
  season int NOT NULL,
  week int NOT NULL,
  plays_per_game numeric,
  games_played int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(team_id, season, week)
);

CREATE INDEX IF NOT EXISTS idx_pace_snapshots_lookup
  ON pace_weekly_snapshots(season, week, team_id);
  `;

  console.log('Please run these SQL statements in your Supabase SQL Editor:\n');
  console.log('-- SP+ Weekly Snapshots Table');
  console.log(createSPTable);
  console.log('\n-- Pace Weekly Snapshots Table');
  console.log(createPaceTable);

  console.log('\n\nAlternatively, if you have the service role key, use:');
  console.log('npx supabase db push --db-url postgresql://postgres:[PASSWORD]@[PROJECT_REF].supabase.co:5432/postgres');
}

main().catch(console.error);

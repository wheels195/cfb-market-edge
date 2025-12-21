/**
 * Creates the game_predictions table to store locked model predictions at game time.
 * This preserves what our model said so we can track historical performance.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createTable() {
  console.log('Creating game_predictions table...');

  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS game_predictions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id),
        sportsbook_id UUID REFERENCES sportsbooks(id),

        -- Market data at game time
        closing_spread_home DECIMAL(5,1),
        closing_total DECIMAL(5,1),
        closing_price_american INTEGER,

        -- Model prediction at game time
        model_spread_home DECIMAL(5,1),
        model_total DECIMAL(5,1),
        model_version_id UUID REFERENCES model_versions(id),

        -- Edge calculation
        edge_points DECIMAL(5,2),
        recommended_side VARCHAR(10), -- 'home', 'away', 'over', 'under'
        recommended_bet TEXT, -- e.g., "Army +6.5"

        -- Result (filled in after game completes)
        bet_result VARCHAR(10), -- 'win', 'loss', 'push'

        -- Metadata
        locked_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),

        UNIQUE(event_id, sportsbook_id)
      );

      CREATE INDEX IF NOT EXISTS idx_game_predictions_event_id ON game_predictions(event_id);
      CREATE INDEX IF NOT EXISTS idx_game_predictions_locked_at ON game_predictions(locked_at);
    `
  });

  if (error) {
    // Try direct SQL if RPC doesn't exist
    console.log('RPC not available, trying alternative approach...');

    // Create table via REST API (need to handle this differently)
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`
      },
      body: JSON.stringify({
        sql: `SELECT 1`
      })
    });

    console.log('Need to create table via Supabase Dashboard SQL Editor.');
    console.log('Run this SQL:');
    console.log(`
CREATE TABLE IF NOT EXISTS game_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  sportsbook_id UUID REFERENCES sportsbooks(id),

  -- Market data at game time
  closing_spread_home DECIMAL(5,1),
  closing_total DECIMAL(5,1),
  closing_price_american INTEGER,

  -- Model prediction at game time
  model_spread_home DECIMAL(5,1),
  model_total DECIMAL(5,1),
  model_version_id UUID REFERENCES model_versions(id),

  -- Edge calculation
  edge_points DECIMAL(5,2),
  recommended_side VARCHAR(10),
  recommended_bet TEXT,

  -- Result (filled in after game completes)
  bet_result VARCHAR(10),

  -- Metadata
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(event_id, sportsbook_id)
);

CREATE INDEX IF NOT EXISTS idx_game_predictions_event_id ON game_predictions(event_id);
CREATE INDEX IF NOT EXISTS idx_game_predictions_locked_at ON game_predictions(locked_at);
    `);
    return;
  }

  console.log('Table created successfully!');
}

createTable().catch(console.error);

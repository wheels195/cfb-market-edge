/**
 * Debug CFB predictions
 *
 * Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx scripts/debug-cfb-predictions.ts
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function run() {
  // Get all game_predictions with event details
  const { data: preds, count } = await supabase
    .from('game_predictions')
    .select('event_id, edge_points, bet_result, locked_at', { count: 'exact' });

  console.log(`Total game_predictions: ${count}\n`);

  for (const p of preds || []) {
    const { data: ev } = await supabase
      .from('events')
      .select('commence_time, home_team:teams!events_home_team_id_fkey(name), away_team:teams!events_away_team_id_fkey(name)')
      .eq('id', p.event_id)
      .single();

    const home = Array.isArray(ev?.home_team) ? ev.home_team[0] : ev?.home_team;
    const away = Array.isArray(ev?.away_team) ? ev.away_team[0] : ev?.away_team;

    console.log(`${away?.name || 'Away'} @ ${home?.name || 'Home'}`);
    console.log(`  Date: ${ev?.commence_time} | Edge: ${p.edge_points?.toFixed(1)} | Result: ${p.bet_result || 'pending'}`);
  }
}

run().catch(console.error);

/**
 * Generate projections for events that are missing them
 */
import { createClient } from '@supabase/supabase-js';
import { generateProjection, saveProjection } from '../src/lib/models/projections';
import { getDefaultModelVersionId } from '../src/lib/models/elo';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function run() {
  const now = new Date();
  const season = now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();

  console.log('Generating missing projections...');

  // Get model version
  const modelVersionId = await getDefaultModelVersionId();
  console.log(`Model version: ${modelVersionId}`);

  // Get all scheduled events
  const { data: events } = await supabase
    .from('events')
    .select('id, home_team_id, away_team_id, commence_time')
    .eq('status', 'scheduled')
    .gt('commence_time', now.toISOString())
    .order('commence_time', { ascending: true });

  if (!events || events.length === 0) {
    console.log('No scheduled events found');
    return;
  }

  console.log(`Found ${events.length} scheduled events`);

  // Get existing projections
  const eventIds = events.map(e => e.id);
  const { data: existingProjections } = await supabase
    .from('projections')
    .select('event_id')
    .in('event_id', eventIds);

  const existingSet = new Set((existingProjections || []).map(p => p.event_id));
  const missing = events.filter(e => !existingSet.has(e.id));

  console.log(`${existingSet.size} already have projections`);
  console.log(`${missing.length} need projections`);

  let generated = 0;
  let errors = 0;

  for (const event of missing) {
    try {
      const projection = await generateProjection(
        event.id,
        event.home_team_id,
        event.away_team_id,
        season,
        modelVersionId
      );

      await saveProjection(projection, modelVersionId);
      generated++;
      console.log(`Generated projection for ${event.id} (${generated}/${missing.length})`);
    } catch (err) {
      errors++;
      console.error(`Error for ${event.id}: ${err}`);
    }
  }

  console.log(`\nComplete: ${generated} generated, ${errors} errors`);
}

run();

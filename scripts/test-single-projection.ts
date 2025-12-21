/**
 * Test generating a single dual projection
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== SINGLE PROJECTION TEST ===\n');

  // Get one upcoming event
  const now = new Date();
  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team_id,
      away_team_id,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name)
    `)
    .eq('status', 'scheduled')
    .gt('commence_time', now.toISOString())
    .order('commence_time', { ascending: true })
    .limit(1);

  if (!events || events.length === 0) {
    console.log('No upcoming events');
    return;
  }

  const event = events[0];
  const home = (event.home_team as any)?.name || 'Unknown';
  const away = (event.away_team as any)?.name || 'Unknown';
  console.log(`Testing: ${away} @ ${home}`);
  console.log(`Event ID: ${event.id}`);
  console.log(`Home Team ID: ${event.home_team_id}`);
  console.log(`Away Team ID: ${event.away_team_id}`);
  console.log(`Commence: ${event.commence_time}\n`);

  // Import and run the dual projection generator
  const { generateDualProjection, saveDualProjections } = await import('../src/lib/models/dual-projections');

  console.log('Step 1: Generating dual projection...');
  try {
    const projection = await generateDualProjection(
      event.id,
      event.home_team_id,
      event.away_team_id,
      2025
    );

    console.log('\nProjection result:');
    console.log('  Elo-Raw:', projection.eloRaw ? `spread ${projection.eloRaw.modelSpreadHome}` : 'null');
    console.log('  Market-Anchored:', projection.marketAnchored ? `spread ${projection.marketAnchored.modelSpreadHome}` : 'null');
    console.log('  Disagreement:', projection.disagreementPoints?.toFixed(1) ?? 'null');

    if (projection.marketAnchored) {
      console.log('\n  Market-Anchored details:');
      console.log('    Baseline:', projection.marketAnchored.marketBaseline);
      console.log('    Adjustments:', JSON.stringify(projection.marketAnchored.adjustments, null, 2));
    }

    console.log('\nStep 2: Saving to database...');
    try {
      await saveDualProjections(projection);
      console.log('  Saved successfully!');
    } catch (saveErr: any) {
      console.log('  Save error:', saveErr);
      console.log('  Error type:', typeof saveErr);
      console.log('  Error message:', saveErr?.message);
      console.log('  Error code:', saveErr?.code);
      console.log('  Error details:', saveErr?.details);
    }

  } catch (err: any) {
    console.log('Generation error:', err);
    console.log('  Error type:', typeof err);
    console.log('  Error message:', err?.message);
    console.log('  Error stack:', err?.stack);
  }

  // Verify
  console.log('\nStep 3: Verifying...');
  const { data: versions } = await supabase
    .from('model_versions')
    .select('id, name')
    .in('name', ['SPREADS_MARKET_ANCHORED_V1', 'SPREADS_ELO_RAW_V1']);

  for (const v of versions || []) {
    const { data: proj } = await supabase
      .from('projections')
      .select('model_spread_home')
      .eq('event_id', event.id)
      .eq('model_version_id', v.id)
      .single();

    console.log(`  ${v.name}: ${proj ? `spread ${proj.model_spread_home}` : 'not found'}`);
  }
}

main().catch(console.error);

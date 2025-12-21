const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const { data: versions } = await supabase.from('model_versions').select('id, name');
  const versionMap = {};
  for (const v of versions || []) { versionMap[v.id] = v.name; }

  // Check projections
  const { data: proj } = await supabase
    .from('projections')
    .select('event_id, model_version_id, model_spread_home')
    .order('generated_at', { ascending: false })
    .limit(20);

  console.log('=== Projections by Model Version ===');
  const byEvent = {};
  for (const p of proj || []) {
    const key = p.event_id;
    if (byEvent[key] === undefined) byEvent[key] = {};
    byEvent[key][versionMap[p.model_version_id]] = p.model_spread_home;
  }

  for (const eventId of Object.keys(byEvent)) {
    const models = byEvent[eventId];
    console.log('Event:', eventId.slice(0,8));
    console.log('  ELO_RAW:', models['SPREADS_ELO_RAW_V1']);
    console.log('  MARKET_ANCHORED:', models['SPREADS_MARKET_ANCHORED_V1']);
  }
}

check();

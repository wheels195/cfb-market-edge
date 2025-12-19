/**
 * Generate projections for upcoming games using CURRENT SP+ ratings
 *
 * For upcoming games, we use this season's SP+ ratings (updated weekly by CFBD).
 * This is the correct approach because:
 * 1. Current SP+ reflects in-season performance
 * 2. Market may not have fully priced in recent changes
 * 3. No look-ahead bias since games haven't happened yet
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface ModelConfig {
  spread: {
    spDiffWeight: number;
    homeFieldAdvantage: number;
  };
}

interface Projection {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homeSP: number;
  awaySP: number;
  spDiff: number;
  modelSpread: number;
  currentMarketSpread: number | null;
  edge: number | null;
}

async function loadModel(): Promise<ModelConfig | null> {
  const { data } = await supabase
    .from('model_versions')
    .select('config')
    .eq('name', 'sp_plus_v1')
    .single();

  return data?.config as ModelConfig | null;
}

async function getUpcomingGames() {
  const now = new Date().toISOString();

  const { data: events, error } = await supabase
    .from('events')
    .select(`
      id, commence_time, status,
      home_team_id, away_team_id,
      home_team:teams!events_home_team_id_fkey(id, name),
      away_team:teams!events_away_team_id_fkey(id, name)
    `)
    .eq('status', 'scheduled')
    .gte('commence_time', now)
    .order('commence_time', { ascending: true })
    .limit(50);

  if (error) {
    console.error('Error fetching events:', error.message);
    return [];
  }

  return events || [];
}

async function getCurrentSPRatings(): Promise<Map<string, number>> {
  // Use current season (2024) SP+ ratings for bowl games
  // These reflect actual in-season performance, not preseason projections
  const CURRENT_SEASON = 2024;

  const { data } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, season, sp_overall')
    .eq('season', CURRENT_SEASON)
    .not('sp_overall', 'is', null);

  const spMap = new Map<string, number>();

  if (data) {
    for (const r of data) {
      spMap.set(r.team_id, r.sp_overall);
    }
  }

  return spMap;
}

async function getLatestOdds(): Promise<Map<string, number>> {
  // Get latest spread for each event
  const { data } = await supabase
    .from('odds_ticks')
    .select('event_id, spread_points_home, captured_at')
    .eq('market_type', 'spread')
    .eq('side', 'home')
    .not('spread_points_home', 'is', null)
    .order('captured_at', { ascending: false });

  const spreadMap = new Map<string, number>();

  if (data) {
    for (const tick of data) {
      if (!spreadMap.has(tick.event_id)) {
        spreadMap.set(tick.event_id, tick.spread_points_home);
      }
    }
  }

  return spreadMap;
}

async function main() {
  console.log('=== GENERATING PROJECTIONS FOR UPCOMING GAMES ===\n');

  const model = await loadModel();
  if (!model) {
    console.log('No model found. Run train-sp-model-proper.ts first.');
    return;
  }

  console.log(`Model: ${model.spread.spDiffWeight.toFixed(4)} * SP_diff + ${model.spread.homeFieldAdvantage.toFixed(2)} HFA\n`);

  const events = await getUpcomingGames();
  console.log(`Found ${events.length} upcoming games\n`);

  if (events.length === 0) {
    console.log('No upcoming games found.');
    return;
  }

  const spRatings = await getCurrentSPRatings();
  console.log(`Loaded SP+ ratings for ${spRatings.size} teams\n`);

  const marketSpreads = await getLatestOdds();
  console.log(`Loaded market spreads for ${marketSpreads.size} events\n`);

  const projections: Projection[] = [];

  for (const event of events) {
    const homeTeam = (Array.isArray(event.home_team) ? event.home_team[0] : event.home_team) as { id: string; name: string } | undefined;
    const awayTeam = (Array.isArray(event.away_team) ? event.away_team[0] : event.away_team) as { id: string; name: string } | undefined;
    if (!homeTeam || !awayTeam) continue;

    const homeSP = spRatings.get(event.home_team_id);
    const awaySP = spRatings.get(event.away_team_id);

    if (homeSP === undefined || awaySP === undefined) continue;

    const spDiff = homeSP - awaySP;
    const modelSpread = model.spread.spDiffWeight * spDiff + model.spread.homeFieldAdvantage;
    const marketSpread = marketSpreads.get(event.id) ?? null;

    let edge: number | null = null;
    if (marketSpread !== null) {
      edge = marketSpread - modelSpread;
    }

    projections.push({
      eventId: event.id,
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
      commenceTime: event.commence_time,
      homeSP,
      awaySP,
      spDiff,
      modelSpread,
      currentMarketSpread: marketSpread,
      edge,
    });
  }

  console.log('=== PROJECTIONS ===\n');
  console.log('Date       | Matchup                          | Home SP | Away SP | Model  | Market | Edge');
  console.log('-----------|----------------------------------|---------|---------|--------|--------|------');

  for (const p of projections) {
    const date = new Date(p.commenceTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const matchup = `${p.awayTeam} @ ${p.homeTeam}`.substring(0, 32).padEnd(32);
    const marketStr = p.currentMarketSpread !== null ? p.currentMarketSpread.toFixed(1).padStart(6) : '   N/A';
    const edgeStr = p.edge !== null ? `${p.edge >= 0 ? '+' : ''}${p.edge.toFixed(1)}` : ' N/A';

    console.log(
      `${date.padEnd(10)} | ${matchup} | ${p.homeSP.toFixed(1).padStart(7)} | ${p.awaySP.toFixed(1).padStart(7)} | ${p.modelSpread.toFixed(1).padStart(6)} | ${marketStr} | ${edgeStr}`
    );
  }

  // Show games with notable edges
  const gamesWithEdge = projections
    .filter(p => p.edge !== null && Math.abs(p.edge) >= 2.0)
    .sort((a, b) => Math.abs(b.edge!) - Math.abs(a.edge!));

  if (gamesWithEdge.length > 0) {
    console.log('\n=== NOTABLE EDGES (2+ points) ===\n');

    for (const p of gamesWithEdge.slice(0, 10)) {
      const betSide = p.edge! > 0 ? p.homeTeam : p.awayTeam;
      const betLabel = p.edge! > 0 ? 'HOME' : 'AWAY';
      console.log(`${p.awayTeam} @ ${p.homeTeam}`);
      console.log(`  Model: ${p.modelSpread >= 0 ? '+' : ''}${p.modelSpread.toFixed(1)} (home)`);
      console.log(`  Market: ${p.currentMarketSpread! >= 0 ? '+' : ''}${p.currentMarketSpread!.toFixed(1)}`);
      console.log(`  Edge: ${p.edge! >= 0 ? '+' : ''}${p.edge!.toFixed(1)} pts → Bet ${betLabel} (${betSide})`);
      console.log('');
    }
  }

  // Store projections
  console.log('\nSaving projections to database...');

  const { data: modelVersion } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'sp_plus_v1')
    .single();

  if (modelVersion) {
    const toInsert = projections.map(p => ({
      event_id: p.eventId,
      model_version_id: modelVersion.id,
      model_spread_home: p.modelSpread,
      model_total_points: null, // We don't have a good totals model yet
    }));

    // Delete old projections for these events
    await supabase
      .from('projections')
      .delete()
      .in('event_id', projections.map(p => p.eventId));

    // Insert new projections
    const { error } = await supabase
      .from('projections')
      .insert(toInsert);

    if (error) {
      console.log('Error saving projections:', error.message);
    } else {
      console.log(`Saved ${toInsert.length} projections`);
    }
  }

  console.log('\n=== IMPORTANT NOTE ===');
  console.log('These projections use current-season SP+ ratings.');
  console.log('For best results, refresh SP+ ratings weekly (run sync-advanced-ratings.ts).');
}

main().catch(console.error);

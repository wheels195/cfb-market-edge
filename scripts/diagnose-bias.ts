/**
 * Diagnose Model Bias
 *
 * Why does the model perform WORSE on high-edge games?
 * Investigate patterns in failures.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface Projection {
  eventId: string;
  season: number;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  homeSP: number;
  awaySP: number;
  modelSpread: number;
  closingSpread: number;
  edge: number;
  absEdge: number;
  margin: number;
  won: boolean;
  side: 'home' | 'away';
  isBlowout: boolean;
  isMismatch: boolean;
}

async function loadProjections(): Promise<Projection[]> {
  const projections: Projection[] = [];

  for (const season of [2023, 2024]) {
    // Get SP+ ratings
    const { data: spData } = await supabase
      .from('advanced_team_ratings')
      .select('team_id, sp_overall')
      .eq('season', season - 1)
      .not('sp_overall', 'is', null);

    const spMap = new Map<string, number>();
    for (const row of spData || []) {
      spMap.set(row.team_id, row.sp_overall);
    }

    // Get events
    const { data: events } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team_id,
        away_team_id,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name),
        results(home_score, away_score)
      `)
      .eq('status', 'final')
      .gte('commence_time', `${season}-08-01`)
      .lte('commence_time', `${season + 1}-02-15`);

    if (!events) continue;

    // Get closing lines
    const eventIds = events.map(e => e.id);
    const closeMap = new Map<string, number>();

    for (let i = 0; i < eventIds.length; i += 100) {
      const batch = eventIds.slice(i, i + 100);
      const { data: lines } = await supabase
        .from('closing_lines')
        .select('event_id, spread_points_home')
        .in('event_id', batch)
        .eq('market_type', 'spread')
        .eq('side', 'home')
        .gte('price_american', -150)
        .lte('price_american', -100);

      for (const l of lines || []) {
        if (!closeMap.has(l.event_id)) {
          closeMap.set(l.event_id, l.spread_points_home);
        }
      }
    }

    for (const event of events) {
      const closing = closeMap.get(event.id);
      if (closing === undefined) continue;

      const results = event.results as any;
      if (!results) continue;

      const homeSP = spMap.get(event.home_team_id);
      const awaySP = spMap.get(event.away_team_id);
      if (homeSP === undefined || awaySP === undefined) continue;

      const homeTeam = (event.home_team as any)?.name || '?';
      const awayTeam = (event.away_team as any)?.name || '?';

      const modelSpread = -(homeSP - awaySP) - 2.5;
      const edge = modelSpread - closing;
      const absEdge = Math.abs(edge);
      const margin = results.home_score - results.away_score;

      const side = edge < 0 ? 'home' : 'away';
      const homeCovered = margin > -closing;
      const won = (side === 'home' && homeCovered) || (side === 'away' && !homeCovered);

      // Categorize the game
      const isBlowout = Math.abs(margin) > 28;
      const isMismatch = Math.abs(homeSP - awaySP) > 20;

      projections.push({
        eventId: event.id,
        season,
        matchup: `${awayTeam} @ ${homeTeam}`,
        homeTeam,
        awayTeam,
        homeSP,
        awaySP,
        modelSpread,
        closingSpread: closing,
        edge,
        absEdge,
        margin,
        won,
        side,
        isBlowout,
        isMismatch,
      });
    }
  }

  return projections;
}

async function main() {
  console.log('=== DIAGNOSING MODEL BIAS ===\n');

  const projections = await loadProjections();
  console.log(`Total projections: ${projections.length}\n`);

  // Sort by absolute edge
  projections.sort((a, b) => b.absEdge - a.absEdge);

  // Analyze top 10% (high edge games)
  const top10pct = projections.slice(0, Math.floor(projections.length * 0.1));

  console.log('=== TOP 10% EDGE ANALYSIS ===\n');
  console.log(`Games: ${top10pct.length}`);
  console.log(`Avg edge: ${(top10pct.reduce((s, p) => s + p.absEdge, 0) / top10pct.length).toFixed(1)} points`);
  console.log(`Win rate: ${(top10pct.filter(p => p.won).length / top10pct.length * 100).toFixed(1)}%\n`);

  // Break down by characteristics
  console.log('Breakdown by game type:\n');

  // Model direction vs closing direction
  const modelFavorsHome = top10pct.filter(p => p.modelSpread < 0);
  const modelFavorsAway = top10pct.filter(p => p.modelSpread >= 0);
  const closeFavorsHome = top10pct.filter(p => p.closingSpread < 0);

  console.log('Model favors home:', modelFavorsHome.length,
    `(${(modelFavorsHome.filter(p => p.won).length / Math.max(1, modelFavorsHome.length) * 100).toFixed(1)}% win)`);
  console.log('Model favors away:', modelFavorsAway.length,
    `(${(modelFavorsAway.filter(p => p.won).length / Math.max(1, modelFavorsAway.length) * 100).toFixed(1)}% win)`);

  // Mismatch games (big SP+ difference)
  const mismatches = top10pct.filter(p => p.isMismatch);
  const nonMismatches = top10pct.filter(p => !p.isMismatch);

  console.log('\nMismatch games (|SP+ diff| > 20):', mismatches.length,
    `(${(mismatches.filter(p => p.won).length / Math.max(1, mismatches.length) * 100).toFixed(1)}% win)`);
  console.log('Non-mismatch games:', nonMismatches.length,
    `(${(nonMismatches.filter(p => p.won).length / Math.max(1, nonMismatches.length) * 100).toFixed(1)}% win)`);

  // Model MORE aggressive than close (thinks favorite is even better)
  const moreAggressive = top10pct.filter(p =>
    (p.modelSpread < p.closingSpread && p.closingSpread < 0) || // Home fav, model has bigger spread
    (p.modelSpread > p.closingSpread && p.closingSpread > 0)    // Away fav, model has bigger spread
  );
  const lessAggressive = top10pct.filter(p =>
    (p.modelSpread > p.closingSpread && p.closingSpread < 0) || // Home fav, model has smaller spread
    (p.modelSpread < p.closingSpread && p.closingSpread > 0)    // Away fav, model has smaller spread
  );

  console.log('\nModel MORE aggressive than market:', moreAggressive.length,
    `(${(moreAggressive.filter(p => p.won).length / Math.max(1, moreAggressive.length) * 100).toFixed(1)}% win)`);
  console.log('Model LESS aggressive than market:', lessAggressive.length,
    `(${(lessAggressive.filter(p => p.won).length / Math.max(1, lessAggressive.length) * 100).toFixed(1)}% win)`);

  // Edge direction: model says bet home vs bet away
  const betHome = top10pct.filter(p => p.side === 'home');
  const betAway = top10pct.filter(p => p.side === 'away');

  console.log('\nBet HOME (edge < 0):', betHome.length,
    `(${(betHome.filter(p => p.won).length / Math.max(1, betHome.length) * 100).toFixed(1)}% win)`);
  console.log('Bet AWAY (edge > 0):', betAway.length,
    `(${(betAway.filter(p => p.won).length / Math.max(1, betAway.length) * 100).toFixed(1)}% win)`);

  // Show top 20 edge games with details
  console.log('\n=== TOP 20 EDGE GAMES (DETAILS) ===\n');
  console.log('Matchup                              | Model | Close | Edge  | Margin | Result');
  console.log('-------------------------------------|-------|-------|-------|--------|-------');

  for (const p of top10pct.slice(0, 20)) {
    const matchup = p.matchup.substring(0, 36).padEnd(36);
    const model = p.modelSpread >= 0 ? `+${p.modelSpread.toFixed(0)}` : p.modelSpread.toFixed(0);
    const close = p.closingSpread >= 0 ? `+${p.closingSpread.toFixed(0)}` : p.closingSpread.toFixed(0);
    const edge = p.edge >= 0 ? `+${p.edge.toFixed(0)}` : p.edge.toFixed(0);
    const margin = p.margin >= 0 ? `+${p.margin}` : p.margin.toString();

    console.log(
      `${matchup} | ${model.padStart(5)} | ${close.padStart(5)} | ${edge.padStart(5)} | ${margin.padStart(6)} | ${p.won ? 'WON' : 'LOST'}`
    );
  }

  // Analyze the pattern of losses
  console.log('\n=== LOSS PATTERN ANALYSIS ===\n');

  const losses = top10pct.filter(p => !p.won);
  const wins = top10pct.filter(p => p.won);

  console.log(`Losses: ${losses.length}, Wins: ${wins.length}\n`);

  // Check if losses are when model is more aggressive on favorites
  const lossPatterns = {
    modelMoreAggressiveOnFav: 0,
    modelLessAggressiveOnFav: 0,
    modelWrongDirection: 0,
  };

  for (const loss of losses) {
    const marketFavorsHome = loss.closingSpread < 0;
    const modelFavorsHome = loss.modelSpread < 0;

    if (marketFavorsHome !== modelFavorsHome) {
      lossPatterns.modelWrongDirection++;
    } else if (marketFavorsHome) {
      // Both favor home
      if (loss.modelSpread < loss.closingSpread) {
        lossPatterns.modelMoreAggressiveOnFav++;
      } else {
        lossPatterns.modelLessAggressiveOnFav++;
      }
    } else {
      // Both favor away
      if (loss.modelSpread > loss.closingSpread) {
        lossPatterns.modelMoreAggressiveOnFav++;
      } else {
        lossPatterns.modelLessAggressiveOnFav++;
      }
    }
  }

  console.log('Loss patterns:');
  console.log(`  Model more aggressive on favorite: ${lossPatterns.modelMoreAggressiveOnFav}`);
  console.log(`  Model less aggressive on favorite: ${lossPatterns.modelLessAggressiveOnFav}`);
  console.log(`  Model wrong direction entirely: ${lossPatterns.modelWrongDirection}`);

  // Key insight
  console.log('\n=== KEY INSIGHT ===\n');
  console.log('The model uses PRIOR SEASON SP+ ratings.');
  console.log('High-edge games occur when:');
  console.log('  1. Model thinks a team is much better/worse than market');
  console.log('  2. This often means the market has NEW information (roster changes, injuries)');
  console.log('  3. The market is likely more correct because it has current-season info\n');

  console.log('RECOMMENDATION: Add in-season rating adjustments from CFBD data');
  console.log('to capture roster changes and form that the market already knows.\n');

  console.log('=== DIAGNOSIS COMPLETE ===');
}

main().catch(console.error);

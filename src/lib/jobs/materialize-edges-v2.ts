/**
 * Materialize Edges v2 - DEPRECATED
 *
 * ⚠️  THIS MODEL IS DEPRECATED - DO NOT USE FOR PRODUCTION
 *
 * The validated production model is materialize-edges-t60.ts which uses
 * the T-60 ensemble (Elo 50% + SP+ 30% + PPA 20%).
 *
 * Backtest: 758 bets, 63.2% win, +20.6% ROI (2022-2024)
 *
 * This file is kept for reference only. The guard below prevents
 * accidental writes to the edges table.
 */

// GUARD: Prevent this deprecated model from writing to edges table
const DEPRECATED_MODEL_GUARD = true;

import { supabase } from '@/lib/db/client';
import { MODEL_VERSIONS, getBothProjections } from '@/lib/models/dual-projections';

// Calibration data from 2022-2025 backtest analysis
const CALIBRATION = {
  edgeProbabilities: [
    { min: 2.5, max: 3, winProb: 0.595, ev: 13.64, tier: 'very-high' as const },
    { min: 3, max: 4, winProb: 0.558, ev: 6.61, tier: 'high' as const },
    { min: 4, max: 5, winProb: 0.548, ev: 4.55, tier: 'medium' as const },
  ],
  profitableFilter: { minEdge: 2.5, maxEdge: 5 },
};

const WINDOW_CONFIG = {
  LOOKAHEAD_DAYS: 10,
};

// Outlier detection config
const OUTLIER_CONFIG = {
  MAX_DEVIATION_FROM_CONSENSUS: 5, // Books deviating > 5 pts from median are flagged
};

// Only use reliable sportsbooks for edge calculation
const ALLOWED_SPORTSBOOKS = ['draftkings'];

export interface MaterializeEdgesV2Result {
  edgesCreated: number;
  edgesUpdated: number;
  eventsProcessed: number;
  eventsSkipped: number;
  errors: string[];
}

/**
 * Get calibration data for an edge size
 */
function getCalibration(absEdge: number) {
  const qualifies = absEdge >= CALIBRATION.profitableFilter.minEdge &&
                   absEdge < CALIBRATION.profitableFilter.maxEdge;

  const warnings: string[] = [];
  if (absEdge >= 10) warnings.push('LARGE_EDGE: Model disagrees by 10+ pts');
  else if (absEdge >= 5) warnings.push('CAUTION: Edge 5+ pts historically unprofitable');
  else if (absEdge < 2.5) warnings.push('SMALL_EDGE: Under 2.5 pts may not overcome vig');

  for (const bucket of CALIBRATION.edgeProbabilities) {
    if (absEdge >= bucket.min && absEdge < bucket.max) {
      return { winProb: bucket.winProb, ev: bucket.ev, tier: bucket.tier, qualifies, warnings };
    }
  }

  if (absEdge < 2.5) return { winProb: 0.49, ev: -7, tier: 'low' as const, qualifies: false, warnings };
  return { winProb: 0.46, ev: -11, tier: 'skip' as const, qualifies: false, warnings };
}

/**
 * Format spread for display
 */
function formatSpread(spread: number): string {
  if (spread > 0) return `+${spread}`;
  return String(spread);
}

/**
 * Calculate median of an array
 */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Check if a spread is an outlier compared to consensus
 */
function isOutlier(spread: number, consensusSpread: number): boolean {
  return Math.abs(spread - consensusSpread) > OUTLIER_CONFIG.MAX_DEVIATION_FROM_CONSENSUS;
}

/**
 * Get model version ID by name
 */
async function getModelVersionId(name: string): Promise<string | null> {
  const { data } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', name)
    .single();
  return data?.id || null;
}

/**
 * Materialize edges v2 - Clean architecture
 *
 * Reads projections from database, does NOT generate them.
 */
export async function materializeEdgesV2(): Promise<MaterializeEdgesV2Result> {
  const result: MaterializeEdgesV2Result = {
    edgesCreated: 0,
    edgesUpdated: 0,
    eventsProcessed: 0,
    eventsSkipped: 0,
    errors: [],
  };

  // GUARD: This model is deprecated - use materializeEdgesT60 instead
  if (DEPRECATED_MODEL_GUARD) {
    console.error('[MaterializeV2] ⚠️  BLOCKED: This model is deprecated.');
    console.error('[MaterializeV2] Use materializeEdgesT60 from materialize-edges-t60.ts instead.');
    result.errors.push('DEPRECATED: materializeEdgesV2 is disabled. Use materializeEdgesT60.');
    return result;
  }

  try {
    const now = new Date();
    const lookaheadEnd = new Date(now.getTime() + WINDOW_CONFIG.LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

    console.log(`[MaterializeV2] Processing events from ${now.toISOString()} to ${lookaheadEnd.toISOString()}`);

    // Get upcoming events
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
      .lt('commence_time', lookaheadEnd.toISOString());

    if (!events || events.length === 0) {
      console.log('[MaterializeV2] No upcoming events');
      return result;
    }

    console.log(`[MaterializeV2] Found ${events.length} upcoming events`);

    // Get model version ID for market-anchored model
    const marketAnchoredVersionId = await getModelVersionId(MODEL_VERSIONS.MARKET_ANCHORED);
    const eloRawVersionId = await getModelVersionId(MODEL_VERSIONS.ELO_RAW);

    if (!marketAnchoredVersionId) {
      result.errors.push('SPREADS_MARKET_ANCHORED_V1 model version not found');
      return result;
    }

    // Get projections for all events
    const eventIds = events.map(e => e.id);
    const { data: projections } = await supabase
      .from('projections')
      .select('*')
      .in('event_id', eventIds)
      .eq('model_version_id', marketAnchoredVersionId);

    const projectionByEvent = new Map<string, { model_spread_home: number }>();
    for (const p of projections || []) {
      projectionByEvent.set(p.event_id, p);
    }

    // Get Elo-raw projections for disagreement
    const { data: eloProjections } = await supabase
      .from('projections')
      .select('event_id, model_spread_home')
      .in('event_id', eventIds)
      .eq('model_version_id', eloRawVersionId);

    const eloByEvent = new Map<string, number>();
    for (const p of eloProjections || []) {
      eloByEvent.set(p.event_id, p.model_spread_home);
    }

    // Get sportsbooks (filtered to allowed list only)
    const { data: sportsbooks } = await supabase
      .from('sportsbooks')
      .select('id, key, name')
      .in('key', ALLOWED_SPORTSBOOKS);

    if (!sportsbooks || sportsbooks.length === 0) {
      result.errors.push(`No sportsbooks found matching: ${ALLOWED_SPORTSBOOKS.join(', ')}`);
      return result;
    }

    console.log(`[MaterializeV2] Using sportsbooks: ${sportsbooks.map(s => s.key).join(', ')}`);

    // Process each event
    for (const rawEvent of events) {
      const projection = projectionByEvent.get(rawEvent.id);
      if (!projection) {
        result.eventsSkipped++;
        continue;
      }

      result.eventsProcessed++;

      const homeTeam = Array.isArray(rawEvent.home_team) ? rawEvent.home_team[0] : rawEvent.home_team;
      const awayTeam = Array.isArray(rawEvent.away_team) ? rawEvent.away_team[0] : rawEvent.away_team;
      const homeTeamName = homeTeam?.name || 'Home';
      const awayTeamName = awayTeam?.name || 'Away';

      // Get Elo disagreement
      const eloSpread = eloByEvent.get(rawEvent.id);
      const eloDisagreement = eloSpread !== undefined
        ? Math.abs(projection.model_spread_home - eloSpread)
        : null;

      // Get ALL spread ticks for this event to calculate consensus
      const { data: allSpreadTicks } = await supabase
        .from('odds_ticks')
        .select('sportsbook_id, spread_points_home')
        .eq('event_id', rawEvent.id)
        .eq('market_type', 'spread')
        .eq('side', 'home')
        .not('spread_points_home', 'is', null);

      // Get latest spread per sportsbook for consensus calculation
      const latestByBook = new Map<string, number>();
      for (const tick of allSpreadTicks || []) {
        // Since we're not ordering, just take the last one per book
        latestByBook.set(tick.sportsbook_id, tick.spread_points_home);
      }

      // Calculate consensus (median) spread across all books
      const allSpreads = Array.from(latestByBook.values());
      const consensusSpread = allSpreads.length > 0 ? median(allSpreads) : null;

      // Process each sportsbook
      for (const sportsbook of sportsbooks) {
        try {
          // Get latest spread tick
          const { data: latestTick } = await supabase
            .from('odds_ticks')
            .select('spread_points_home, price_american, captured_at')
            .eq('event_id', rawEvent.id)
            .eq('sportsbook_id', sportsbook.id)
            .eq('market_type', 'spread')
            .eq('side', 'home')
            .not('spread_points_home', 'is', null)
            .order('captured_at', { ascending: false })
            .limit(1)
            .single();

          if (!latestTick?.spread_points_home) continue;

          const marketSpreadHome = latestTick.spread_points_home;
          const modelSpreadHome = projection.model_spread_home;

          // Check if this book's spread is an outlier
          const outlierFlag = consensusSpread !== null && isOutlier(marketSpreadHome, consensusSpread);

          // EDGE FORMULA (from spec):
          // edge_points = market_spread_home - model_spread_home
          // If edge > 0 → Bet Home at market number
          // If edge < 0 → Bet Away at market number
          const edgePoints = marketSpreadHome - modelSpreadHome;

          if (edgePoints === 0) continue;

          // Determine recommended side and label
          const recommendedSide = edgePoints > 0 ? 'home' : 'away';
          const recommendedBetLabel = edgePoints > 0
            ? `${homeTeamName} ${formatSpread(marketSpreadHome)}`
            : `${awayTeamName} ${formatSpread(-marketSpreadHome)}`;

          // Get calibration
          const calibration = getCalibration(Math.abs(edgePoints));

          // Add disagreement warning if significant
          const warnings = [...calibration.warnings];
          if (eloDisagreement !== null && eloDisagreement > 5) {
            warnings.push(`ELO_DISAGREE: Pure Elo differs by ${eloDisagreement.toFixed(1)} pts`);
          }

          // Add outlier warning if this book's line deviates significantly from consensus
          if (outlierFlag && consensusSpread !== null) {
            const deviation = Math.abs(marketSpreadHome - consensusSpread);
            warnings.unshift(`OUTLIER_LINE: This book (${marketSpreadHome}) deviates ${deviation.toFixed(1)} pts from consensus (${consensusSpread})`);
          }

          // Determine reason based on edge and outlier status
          let reason: string;
          if (outlierFlag) {
            reason = 'SUSPECT: Line is outlier vs market consensus - likely bad data or alternate line';
          } else if (calibration.qualifies) {
            reason = 'Edge within profitable range';
          } else if (Math.abs(edgePoints) >= 5) {
            reason = 'Large edge - may be model error';
          } else {
            reason = 'Edge too small for reliable profit';
          }

          // Upsert edge
          const edgeData = {
            event_id: rawEvent.id,
            sportsbook_id: sportsbook.id,
            market_type: 'spread',
            as_of: latestTick.captured_at,
            market_spread_home: marketSpreadHome,
            market_total_points: null,
            market_price_american: latestTick.price_american,
            model_spread_home: modelSpreadHome,
            model_total_points: null,
            edge_points: edgePoints,
            recommended_side: recommendedSide,
            recommended_bet_label: recommendedBetLabel,
            explain: {
              winProbability: Math.round(calibration.winProb * 100),
              expectedValue: calibration.ev,
              confidenceTier: outlierFlag ? 'outlier' : calibration.tier,
              qualifies: outlierFlag ? false : calibration.qualifies,
              warnings,
              reason,
              modelVersion: MODEL_VERSIONS.MARKET_ANCHORED,
              eloDisagreementPoints: eloDisagreement,
              consensusSpread: consensusSpread,
              isOutlier: outlierFlag,
            },
          };

          const { error } = await supabase
            .from('edges')
            .upsert(edgeData, {
              onConflict: 'event_id,sportsbook_id,market_type',
            });

          if (error) {
            result.errors.push(`Edge upsert failed: ${error.message}`);
          } else {
            result.edgesUpdated++;
          }

        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          result.errors.push(`Event ${rawEvent.id} / ${sportsbook.key}: ${message}`);
        }
      }
    }

    console.log(`[MaterializeV2] Complete: ${result.eventsProcessed} processed, ${result.eventsSkipped} skipped, ${result.edgesUpdated} edges updated`);

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`MaterializeV2 failed: ${message}`);
  }

  return result;
}

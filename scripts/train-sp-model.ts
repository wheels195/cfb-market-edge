/**
 * Train an improved model using SP+ ratings
 * SP+ is the gold standard for CFB predictions
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface TrainingGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  actualMargin: number;
  actualTotal: number;
  closingSpread: number;
  closingTotal: number;
  // SP+ features
  homeSP: number;
  awaySP: number;
  homeOffSP: number;
  homeDefSP: number;
  awayOffSP: number;
  awayDefSP: number;
  spDiff: number;  // home SP - away SP
}

interface SPModelCoefficients {
  spread: {
    spDiffWeight: number;       // Points per 1.0 SP+ difference
    homeFieldAdvantage: number; // HFA in points
    r2: number;
    mae: number;
    rmse: number;
  };
  total: {
    intercept: number;          // Base total
    offenseWeight: number;      // How much offense affects total
    defenseWeight: number;      // How much defense affects total
    r2: number;
    mae: number;
    rmse: number;
  };
}

async function getAllWithPagination<T>(
  tableName: string,
  selectQuery: string,
  filters?: { column: string; value: unknown; op?: string }[]
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from(tableName).select(selectQuery).range(offset, offset + 999);

    if (filters) {
      for (const f of filters) {
        if (f.op === 'not') {
          query = query.not(f.column, 'is', f.value);
        } else {
          query = query.eq(f.column, f.value);
        }
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error(`Error: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    results.push(...(data as T[]));
    offset += data.length;
    if (data.length < 1000) break;
  }

  return results;
}

async function loadTrainingData(): Promise<TrainingGame[]> {
  console.log('Loading training data with SP+ ratings...');

  // Get events
  const events = await getAllWithPagination<{
    id: string;
    home_team_id: string;
    away_team_id: string;
    commence_time: string;
    home_team: { name: string };
    away_team: { name: string };
  }>('events', `
    id,
    home_team_id,
    away_team_id,
    commence_time,
    home_team:teams!events_home_team_id_fkey(name),
    away_team:teams!events_away_team_id_fkey(name)
  `, [{ column: 'status', value: 'final' }]);
  console.log(`  Loaded ${events.length} events`);

  // Get results
  const results = await getAllWithPagination<{
    event_id: string;
    home_score: number;
    away_score: number;
  }>('results', 'event_id, home_score, away_score');
  const resultMap = new Map(results.map(r => [r.event_id, r]));
  console.log(`  Loaded ${resultMap.size} results`);

  // Get closing lines
  const closingLines = await getAllWithPagination<{
    event_id: string;
    market_type: string;
    side: string;
    spread_points_home: number | null;
    total_points: number | null;
  }>('closing_lines', 'event_id, market_type, side, spread_points_home, total_points');

  const closingSpreadMap = new Map<string, number>();
  const closingTotalMap = new Map<string, number>();
  for (const line of closingLines) {
    if (line.market_type === 'spread' && line.side === 'home' && line.spread_points_home !== null) {
      closingSpreadMap.set(line.event_id, line.spread_points_home);
    }
    if (line.market_type === 'total' && line.total_points !== null) {
      closingTotalMap.set(line.event_id, line.total_points);
    }
  }
  console.log(`  Loaded ${closingSpreadMap.size} closing spreads`);

  // Get SP+ ratings
  const spRatings = await getAllWithPagination<{
    team_id: string;
    season: number;
    sp_overall: number | null;
    sp_offense: number | null;
    sp_defense: number | null;
  }>('advanced_team_ratings', 'team_id, season, sp_overall, sp_offense, sp_defense');

  const spMap = new Map<string, { overall: number; offense: number; defense: number }>();
  for (const r of spRatings) {
    if (r.sp_overall !== null) {
      const key = `${r.team_id}_${r.season}`;
      spMap.set(key, {
        overall: r.sp_overall,
        offense: r.sp_offense || 0,
        defense: r.sp_defense || 0,
      });
    }
  }
  console.log(`  Loaded ${spMap.size} SP+ ratings`);

  // Build training data
  const games: TrainingGame[] = [];

  for (const event of events) {
    const result = resultMap.get(event.id);
    const closingSpread = closingSpreadMap.get(event.id);
    const closingTotal = closingTotalMap.get(event.id);

    if (!result || closingSpread === undefined || closingTotal === undefined) continue;

    const eventDate = new Date(event.commence_time);
    const season = eventDate.getMonth() >= 7 ? eventDate.getFullYear() : eventDate.getFullYear() - 1;

    const homeSP = spMap.get(`${event.home_team_id}_${season}`);
    const awaySP = spMap.get(`${event.away_team_id}_${season}`);

    // Only use games where we have SP+ for both teams
    if (!homeSP || !awaySP) continue;

    games.push({
      eventId: event.id,
      homeTeam: event.home_team.name,
      awayTeam: event.away_team.name,
      actualMargin: result.home_score - result.away_score,
      actualTotal: result.home_score + result.away_score,
      closingSpread,
      closingTotal,
      homeSP: homeSP.overall,
      awaySP: awaySP.overall,
      homeOffSP: homeSP.offense,
      homeDefSP: homeSP.defense,
      awayOffSP: awaySP.offense,
      awayDefSP: awaySP.defense,
      spDiff: homeSP.overall - awaySP.overall,
    });
  }

  console.log(`  Built ${games.length} training games with SP+ data\n`);
  return games;
}

function trainSpreadModel(games: TrainingGame[]): SPModelCoefficients['spread'] {
  console.log(`Training SP+ spread model on ${games.length} games...`);

  const n = games.length;
  if (n < 100) {
    return { spDiffWeight: 1.0, homeFieldAdvantage: -3, r2: 0, mae: 0, rmse: 0 };
  }

  // Linear regression: closingSpread = spDiffWeight * spDiff + homeFieldAdvantage
  // Using normal equations

  let xx00 = 0, xx01 = 0, xx11 = 0;
  let xy0 = 0, xy1 = 0;

  for (const g of games) {
    xx00 += g.spDiff * g.spDiff;
    xx01 += g.spDiff;
    xx11 += 1;
    xy0 += g.spDiff * g.closingSpread;
    xy1 += g.closingSpread;
  }

  const det = xx00 * xx11 - xx01 * xx01;
  const spDiffWeight = (xx11 * xy0 - xx01 * xy1) / det;
  const homeFieldAdvantage = (xx00 * xy1 - xx01 * xy0) / det;

  // Calculate metrics
  let ssr = 0, sst = 0, sumAbs = 0;
  const meanY = xy1 / n;

  for (const g of games) {
    const predicted = spDiffWeight * g.spDiff + homeFieldAdvantage;
    const residual = g.closingSpread - predicted;
    ssr += residual * residual;
    sst += (g.closingSpread - meanY) * (g.closingSpread - meanY);
    sumAbs += Math.abs(residual);
  }

  return {
    spDiffWeight,
    homeFieldAdvantage,
    r2: 1 - (ssr / sst),
    mae: sumAbs / n,
    rmse: Math.sqrt(ssr / n),
  };
}

function trainTotalModel(games: TrainingGame[]): SPModelCoefficients['total'] {
  console.log(`Training SP+ total model on ${games.length} games...`);

  // For totals, model: total = intercept + offWeight*(homeOff + awayOff) + defWeight*(homeDef + awayDef)
  // Simplified: just use offense sum

  const n = games.length;
  if (n < 100) {
    return { intercept: 53, offenseWeight: 0, defenseWeight: 0, r2: 0, mae: 0, rmse: 0 };
  }

  // Simple model: total = intercept + weight * (homeOff + awayOff - homeDef - awayDef)
  // The idea: more offense = higher total, more defense = lower total

  let sumOffDiff = 0, sumY = 0;
  let sumOffDiffSq = 0, sumOffDiffY = 0;

  for (const g of games) {
    const offDiff = (g.homeOffSP + g.awayOffSP) - (g.homeDefSP + g.awayDefSP);
    sumOffDiff += offDiff;
    sumY += g.closingTotal;
    sumOffDiffSq += offDiff * offDiff;
    sumOffDiffY += offDiff * g.closingTotal;
  }

  const meanOff = sumOffDiff / n;
  const meanY = sumY / n;

  // Simple linear regression
  const numerator = sumOffDiffY - n * meanOff * meanY;
  const denominator = sumOffDiffSq - n * meanOff * meanOff;
  const offenseWeight = numerator / denominator;
  const intercept = meanY - offenseWeight * meanOff;

  // Metrics
  let ssr = 0, sst = 0, sumAbs = 0;

  for (const g of games) {
    const offDiff = (g.homeOffSP + g.awayOffSP) - (g.homeDefSP + g.awayDefSP);
    const predicted = intercept + offenseWeight * offDiff;
    const residual = g.closingTotal - predicted;
    ssr += residual * residual;
    sst += (g.closingTotal - meanY) * (g.closingTotal - meanY);
    sumAbs += Math.abs(residual);
  }

  return {
    intercept,
    offenseWeight,
    defenseWeight: -offenseWeight, // Defense has opposite effect
    r2: 1 - (ssr / sst),
    mae: sumAbs / n,
    rmse: Math.sqrt(ssr / n),
  };
}

async function saveModel(coefficients: SPModelCoefficients) {
  const { data: existing } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'sp_plus_v1')
    .single();

  if (existing) {
    await supabase
      .from('model_versions')
      .update({
        description: 'SP+ based model with efficiency metrics',
        config: coefficients,
      })
      .eq('id', existing.id);
    console.log('Updated existing SP+ model');
  } else {
    await supabase
      .from('model_versions')
      .insert({
        name: 'sp_plus_v1',
        description: 'SP+ based model with efficiency metrics',
        config: coefficients,
      });
    console.log('Created new SP+ model');
  }
}

async function main() {
  console.log('=== SP+ MODEL TRAINING ===\n');

  const games = await loadTrainingData();

  if (games.length < 100) {
    console.log('Not enough training data with SP+ ratings');
    return;
  }

  const spreadModel = trainSpreadModel(games);
  const totalModel = trainTotalModel(games);

  const coefficients: SPModelCoefficients = {
    spread: spreadModel,
    total: totalModel,
  };

  console.log('\n=== SP+ MODEL COEFFICIENTS ===\n');
  console.log('Spread Model:');
  console.log(`  SP+ diff weight: ${spreadModel.spDiffWeight.toFixed(4)} (1 SP+ point ≈ ${Math.abs(spreadModel.spDiffWeight).toFixed(2)} spread points)`);
  console.log(`  Home field advantage: ${spreadModel.homeFieldAdvantage.toFixed(2)} points`);
  console.log(`  R² vs closing lines: ${(spreadModel.r2 * 100).toFixed(1)}%`);
  console.log(`  MAE vs closing lines: ${spreadModel.mae.toFixed(2)} points`);

  console.log('\nTotal Model:');
  console.log(`  Base total: ${totalModel.intercept.toFixed(1)} points`);
  console.log(`  Offense weight: ${totalModel.offenseWeight.toFixed(4)}`);
  console.log(`  R² vs closing lines: ${(totalModel.r2 * 100).toFixed(1)}%`);
  console.log(`  MAE vs closing lines: ${totalModel.mae.toFixed(2)} points`);

  // Comparison with Elo model
  console.log('\n=== COMPARISON: SP+ vs Elo Model ===');
  console.log('                    | Elo Model | SP+ Model');
  console.log('--------------------|-----------|----------');
  console.log(`R² (spread)         |    41.3%  | ${(spreadModel.r2 * 100).toFixed(1)}%`);
  console.log(`MAE (spread)        |     9.09  | ${spreadModel.mae.toFixed(2)}`);
  console.log(`Home Field (spread) |    -6.43  | ${spreadModel.homeFieldAdvantage.toFixed(2)}`);

  // Sample predictions
  console.log('\n=== SAMPLE PREDICTIONS ===');
  console.log('\nOhio State (SP+ 31.2) vs Michigan (SP+ ~15) at Ohio State:');
  const spDiff = 31.2 - 15;
  const predictedSpread = spreadModel.spDiffWeight * spDiff + spreadModel.homeFieldAdvantage;
  console.log(`  SP+ diff: ${spDiff.toFixed(1)}`);
  console.log(`  Predicted spread: ${predictedSpread.toFixed(1)} (Ohio State favored)`);

  await saveModel(coefficients);
  console.log('\n=== MODEL SAVED ===');
}

main().catch(console.error);

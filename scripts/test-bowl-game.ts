/**
 * Test T-60 Ensemble Model on Today's Bowl Game
 */

import { createClient } from '@supabase/supabase-js';
import {
  computeT60Projection,
  qualifiesForBet,
  T60_PRODUCTION_CONFIG,
} from '../src/lib/models/t60-ensemble-v1';
import { getCanonicalTeamName } from '../src/lib/team-aliases';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface GameToTest {
  homeTeam: string;
  awayTeam: string;
  dkSpread: number; // Home team spread
  gameTime: string;
}

async function getTeamRatings(teamName: string, season: number) {
  // Get canonical name (Odds API → DB mapping)
  const canonicalName = getCanonicalTeamName(teamName);
  const displayName = canonicalName !== teamName ? `${teamName} → ${canonicalName}` : teamName;

  // Get team ID
  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('name', canonicalName)
    .single();

  if (!team) {
    console.log(`  Team not found: ${displayName}`);
    return null;
  }

  // Get Elo (latest week for season)
  const { data: elo } = await supabase
    .from('team_elo_snapshots')
    .select('elo, week')
    .eq('team_id', team.id)
    .eq('season', season)
    .order('week', { ascending: false })
    .limit(1)
    .single();

  // Get SP+ and PPA
  const { data: ratings } = await supabase
    .from('advanced_team_ratings')
    .select('sp_overall, sp_offense, sp_defense, off_ppa, def_ppa')
    .eq('team_id', team.id)
    .eq('season', season)
    .single();

  return {
    elo: elo?.elo || 1500,
    eloWeek: elo?.week || 0,
    spOverall: ratings?.sp_overall || 0,
    spOffense: ratings?.sp_offense || 0,
    spDefense: ratings?.sp_defense || 0,
    offPPA: ratings?.off_ppa || 0,
    defPPA: ratings?.def_ppa || 0,
  };
}

async function analyzeGame(game: GameToTest) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${game.awayTeam} @ ${game.homeTeam}`);
  console.log(`Game Time: ${game.gameTime}`);
  console.log(`DK Spread: ${game.homeTeam} ${game.dkSpread > 0 ? '+' : ''}${game.dkSpread}`);
  console.log('='.repeat(60));

  const homeRatings = await getTeamRatings(game.homeTeam, 2025);
  const awayRatings = await getTeamRatings(game.awayTeam, 2025);

  if (!homeRatings || !awayRatings) {
    console.log('Missing ratings for one or both teams');
    return;
  }

  console.log(`\n--- Ratings ---`);
  console.log(`${game.homeTeam}: Elo=${homeRatings.elo} (wk${homeRatings.eloWeek}), SP+=${homeRatings.spOverall.toFixed(1)}, PPA off=${homeRatings.offPPA.toFixed(3)} def=${homeRatings.defPPA.toFixed(3)}`);
  console.log(`${game.awayTeam}: Elo=${awayRatings.elo} (wk${awayRatings.eloWeek}), SP+=${awayRatings.spOverall.toFixed(1)}, PPA off=${awayRatings.offPPA.toFixed(3)} def=${awayRatings.defPPA.toFixed(3)}`);

  // Compute projection
  const projection = computeT60Projection(
    homeRatings.elo,
    awayRatings.elo,
    homeRatings.spOverall,
    awayRatings.spOverall,
    homeRatings.offPPA,
    homeRatings.defPPA,
    awayRatings.offPPA,
    awayRatings.defPPA
  );

  console.log(`\n--- Model Projections ---`);
  console.log(`Elo Spread: ${projection.eloSpread.toFixed(1)}`);
  console.log(`SP+ Spread: ${projection.spSpread.toFixed(1)}`);
  console.log(`PPA Spread: ${projection.ppaSpread.toFixed(1)}`);
  console.log(`Ensemble Spread: ${projection.modelSpread.toFixed(1)}`);
  console.log(`Model Disagreement: ${projection.modelDisagreement.toFixed(1)} pts`);
  console.log(`Passes Confidence Filter (≤${T60_PRODUCTION_CONFIG.confidenceFilter.MAX_MODEL_DISAGREEMENT}): ${projection.passesConfidenceFilter ? 'YES' : 'NO'}`);

  // Check if bet qualifies
  const betCheck = qualifiesForBet(game.dkSpread, projection.modelSpread, projection.modelDisagreement);

  console.log(`\n--- Bet Analysis ---`);
  console.log(`Market Spread: ${game.dkSpread}`);
  console.log(`Model Spread: ${projection.modelSpread.toFixed(1)}`);
  console.log(`Edge: ${betCheck.edge.toFixed(1)} pts (${betCheck.edge > 0 ? 'HOME' : 'AWAY'} value)`);
  console.log(`Abs Edge: ${betCheck.absEdge.toFixed(1)} pts`);

  if (betCheck.qualifies) {
    console.log(`\n✓ BET QUALIFIES: ${betCheck.side?.toUpperCase()} (${betCheck.side === 'home' ? game.homeTeam : game.awayTeam})`);
    console.log(`  Bet: ${betCheck.side === 'home' ? game.homeTeam : game.awayTeam} ${betCheck.side === 'home' ? (game.dkSpread > 0 ? '+' : '') + game.dkSpread : ((-game.dkSpread) > 0 ? '+' : '') + (-game.dkSpread)}`);
  } else {
    console.log(`\n✗ NO BET: ${betCheck.reason}`);
  }
}

async function main() {
  console.log('T-60 Ensemble Model - Bowl Game Analysis');
  console.log(`Model Version: ${T60_PRODUCTION_CONFIG.version}`);
  console.log(`Validated: ${T60_PRODUCTION_CONFIG.validatedDate}`);
  console.log(`Edge Filter: ${T60_PRODUCTION_CONFIG.edgeFilter.MIN_EDGE}-${T60_PRODUCTION_CONFIG.edgeFilter.MAX_EDGE} pts`);
  console.log(`Confidence Filter: ≤${T60_PRODUCTION_CONFIG.confidenceFilter.MAX_MODEL_DISAGREEMENT} pts disagreement`);

  // Today's game
  const games: GameToTest[] = [
    { homeTeam: 'Utah State', awayTeam: 'Washington State', dkSpread: -1.5, gameTime: '2025-12-22 19:00 UTC' },
    // Add more games as needed
    { homeTeam: 'Louisville', awayTeam: 'Toledo', dkSpread: -7.0, gameTime: '2025-12-23 19:00 UTC' },
    { homeTeam: 'Southern Mississippi', awayTeam: 'Western Kentucky', dkSpread: 2.5, gameTime: '2025-12-23 22:30 UTC' },
  ];

  for (const game of games) {
    await analyzeGame(game);
  }
}

main().catch(console.error);

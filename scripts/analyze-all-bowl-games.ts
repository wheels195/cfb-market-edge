/**
 * Analyze All Upcoming Bowl Games with T-60 Ensemble Model
 *
 * Fetches current odds from The Odds API and runs projections.
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

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_URL = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';

interface TeamRatings {
  elo: number;
  eloWeek: number;
  spOverall: number;
  offPPA: number;
  defPPA: number;
}

async function getTeamRatings(teamName: string): Promise<TeamRatings | null> {
  const canonicalName = getCanonicalTeamName(teamName);

  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('name', canonicalName)
    .single();

  if (!team) {
    console.log(`  [WARN] Team not found: ${teamName} → ${canonicalName}`);
    return null;
  }

  // Get Elo (latest week for 2025)
  const { data: elo } = await supabase
    .from('team_elo_snapshots')
    .select('elo, week')
    .eq('team_id', team.id)
    .eq('season', 2025)
    .order('week', { ascending: false })
    .limit(1)
    .single();

  // Get SP+ and PPA
  const { data: ratings } = await supabase
    .from('advanced_team_ratings')
    .select('sp_overall, off_ppa, def_ppa')
    .eq('team_id', team.id)
    .eq('season', 2025)
    .single();

  if (!elo && !ratings) {
    console.log(`  [WARN] No ratings found for ${canonicalName}`);
    return null;
  }

  return {
    elo: elo?.elo || 1500,
    eloWeek: elo?.week || 0,
    spOverall: ratings?.sp_overall || 0,
    offPPA: ratings?.off_ppa || 0,
    defPPA: ratings?.def_ppa || 0,
  };
}

interface OddsGame {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

async function fetchBowlOdds(): Promise<OddsGame[]> {
  if (!ODDS_API_KEY) {
    console.log('No ODDS_API_KEY found, using manual game data');
    return [];
  }

  const params = new URLSearchParams({
    apiKey: ODDS_API_KEY,
    regions: 'us',
    markets: 'spreads',
    bookmakers: 'draftkings',
  });

  const response = await fetch(`${ODDS_API_URL}?${params}`);
  if (!response.ok) {
    console.log('Odds API error:', response.status);
    return [];
  }

  const games = await response.json() as OddsGame[];
  return games;
}

function getDKSpread(game: OddsGame): number | null {
  const dk = game.bookmakers.find(b => b.key === 'draftkings');
  if (!dk) return null;

  const spreads = dk.markets.find(m => m.key === 'spreads');
  if (!spreads) return null;

  const homeOutcome = spreads.outcomes.find(o => o.name === game.home_team);
  return homeOutcome?.point ?? null;
}

interface AnalysisResult {
  gameTime: string;
  homeTeam: string;
  awayTeam: string;
  marketSpread: number;
  modelSpread: number;
  edge: number;
  absEdge: number;
  disagreement: number;
  qualifies: boolean;
  side: string | null;
  reason: string | null;
  homeRatings: TeamRatings;
  awayRatings: TeamRatings;
}

async function analyzeGame(game: OddsGame): Promise<AnalysisResult | null> {
  const marketSpread = getDKSpread(game);
  if (marketSpread === null) {
    return null;
  }

  const homeRatings = await getTeamRatings(game.home_team);
  const awayRatings = await getTeamRatings(game.away_team);

  if (!homeRatings || !awayRatings) {
    return null;
  }

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

  const betCheck = qualifiesForBet(
    marketSpread,
    projection.modelSpread,
    projection.modelDisagreement
  );

  return {
    gameTime: game.commence_time,
    homeTeam: game.home_team,
    awayTeam: game.away_team,
    marketSpread,
    modelSpread: projection.modelSpread,
    edge: betCheck.edge,
    absEdge: betCheck.absEdge,
    disagreement: projection.modelDisagreement,
    qualifies: betCheck.qualifies,
    side: betCheck.side,
    reason: betCheck.reason,
    homeRatings,
    awayRatings,
  };
}

async function main() {
  console.log('=== T-60 Bowl Game Analysis ===');
  console.log(`Model: ${T60_PRODUCTION_CONFIG.version}`);
  console.log(`Validated: ${T60_PRODUCTION_CONFIG.validatedDate}`);
  console.log(`Edge Filter: ${T60_PRODUCTION_CONFIG.edgeFilter.MIN_EDGE}-${T60_PRODUCTION_CONFIG.edgeFilter.MAX_EDGE} pts`);
  console.log(`Confidence Filter: ≤${T60_PRODUCTION_CONFIG.confidenceFilter.MAX_MODEL_DISAGREEMENT} pts\n`);

  const games = await fetchBowlOdds();

  if (games.length === 0) {
    console.log('No games found from Odds API');
    return;
  }

  console.log(`Found ${games.length} games with DK odds\n`);

  const results: AnalysisResult[] = [];

  for (const game of games) {
    const result = await analyzeGame(game);
    if (result) {
      results.push(result);
    }
  }

  // Sort by absolute edge (highest first)
  results.sort((a, b) => b.absEdge - a.absEdge);

  // Print qualifying bets first
  const qualifying = results.filter(r => r.qualifies);
  if (qualifying.length > 0) {
    console.log('=== QUALIFYING BETS ===\n');
    for (const r of qualifying) {
      const betTeam = r.side === 'home' ? r.homeTeam : r.awayTeam;
      const betSpread = r.side === 'home' ? r.marketSpread : -r.marketSpread;
      const betSpreadStr = betSpread > 0 ? `+${betSpread}` : String(betSpread);

      console.log(`${r.awayTeam} @ ${r.homeTeam}`);
      console.log(`  Date: ${new Date(r.gameTime).toLocaleString()}`);
      console.log(`  BET: ${betTeam} ${betSpreadStr} (DK)`);
      console.log(`  Edge: ${r.absEdge.toFixed(1)} pts`);
      console.log(`  Model: ${r.modelSpread.toFixed(1)} vs Market: ${r.marketSpread}`);
      console.log(`  Disagreement: ${r.disagreement.toFixed(1)} pts`);
      console.log();
    }
  } else {
    console.log('No qualifying bets found.\n');
  }

  // Print all games summary
  console.log('=== ALL GAMES SUMMARY ===\n');
  console.log('| Game | Market | Model | Edge | Agree | Qualifies |');
  console.log('|------|--------|-------|------|-------|-----------|');

  for (const r of results) {
    const gameLabel = `${r.awayTeam} @ ${r.homeTeam}`.slice(0, 30).padEnd(30);
    const market = String(r.marketSpread).padStart(6);
    const model = r.modelSpread.toFixed(1).padStart(6);
    const edge = r.absEdge.toFixed(1).padStart(5);
    const agree = r.disagreement.toFixed(1).padStart(5);
    const qual = r.qualifies ? 'YES' : 'NO';

    console.log(`| ${gameLabel} | ${market} | ${model} | ${edge} | ${agree} | ${qual.padStart(9)} |`);
  }

  console.log(`\nTotal: ${results.length} games analyzed`);
  console.log(`Qualifying: ${qualifying.length} bets`);
}

main().catch(console.error);

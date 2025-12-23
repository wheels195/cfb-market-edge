/**
 * Apply the validated CBB model to 2026 season
 *
 * Model parameters (from holdout validation):
 * - HOME_ADV: 7.4 points
 * - LEARNING_RATE: 0.08
 * - SEASON_DECAY: 0.7
 * - Conference ratings from historical cross-conference data
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Model parameters from holdout validation
const HOME_ADV = 7.4;
const LEARNING_RATE = 0.08;
const SEASON_DECAY = 0.7;

// Conference ratings (from cross-conference game analysis)
const CONF_RATING: Record<string, number> = {
  "Big 12": 12,
  "SEC": 11,
  "Big Ten": 9,
  "Big East": 7,
  "ACC": 5,
  "Mountain West": 5,
  "Atlantic 10": 4,
  "WCC": 3,
  "American Athletic": 3,
  "Missouri Valley": 2,
  "MAC": 1,
  "Sun Belt": 0,
  "Pac-12": 0, // Remnants
  "Conference USA": -1,
  "WAC": -2,
  "Big West": -3,
  "Ohio Valley": -4,
  "Horizon League": -4,
  "Southern": -5,
  "CAA": -5,
  "Patriot League": -6,
  "Ivy League": -6,
  "Big South": -7,
  "Summit League": -8,
  "ASUN": -8,
  "Northeast": -10,
  "Southland": -11,
  "MEAC": -14,
  "SWAC": -16,
};

// Team ratings storage
const teamRatings: Map<string, { rating: number; games: number }> = new Map();

function getConfRating(conf: string | null): number {
  if (!conf) return 0;
  return CONF_RATING[conf] ?? 0;
}

function getTeamRating(teamId: string): number {
  return teamRatings.get(teamId)?.rating ?? 0;
}

function predictSpread(
  homeTeamId: string,
  awayTeamId: string,
  homeConf: string | null,
  awayConf: string | null
): number {
  const homeRating = getTeamRating(homeTeamId) + getConfRating(homeConf);
  const awayRating = getTeamRating(awayTeamId) + getConfRating(awayConf);

  // Negative spread = home favored
  return awayRating - homeRating - HOME_ADV;
}

function updateRatings(
  homeTeamId: string,
  awayTeamId: string,
  homeConf: string | null,
  awayConf: string | null,
  homeScore: number,
  awayScore: number
): void {
  const predicted = predictSpread(homeTeamId, awayTeamId, homeConf, awayConf);
  const actual = awayScore - homeScore; // Positive = away won by more
  const error = actual - predicted;

  // Update home team
  const homeData = teamRatings.get(homeTeamId) || { rating: 0, games: 0 };
  homeData.rating -= error * LEARNING_RATE; // Home team: if actual > predicted, lower rating
  homeData.games += 1;
  teamRatings.set(homeTeamId, homeData);

  // Update away team
  const awayData = teamRatings.get(awayTeamId) || { rating: 0, games: 0 };
  awayData.rating += error * LEARNING_RATE; // Away team: if actual > predicted, raise rating
  awayData.games += 1;
  teamRatings.set(awayTeamId, awayData);
}

async function main() {
  console.log('=== CBB 2026 Model Application ===\n');

  // Step 1: Load team conferences
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, name, conference');

  const teamConf = new Map<string, string>();
  const teamName = new Map<string, string>();
  for (const t of teams || []) {
    teamConf.set(t.id, t.conference);
    teamName.set(t.id, t.name);
  }

  console.log(`Loaded ${teams?.length} teams with conferences\n`);

  // Step 2: Load 2025 season data for prior ratings
  const { data: games2025 } = await supabase
    .from('cbb_games')
    .select('home_team_id, away_team_id, home_score, away_score')
    .eq('season', 2025)
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true });

  console.log(`Processing ${games2025?.length || 0} games from 2025 season for priors...\n`);

  // Build 2025 ratings
  for (const g of games2025 || []) {
    updateRatings(
      g.home_team_id,
      g.away_team_id,
      teamConf.get(g.home_team_id) || null,
      teamConf.get(g.away_team_id) || null,
      g.home_score,
      g.away_score
    );
  }

  // Apply season decay for 2026
  for (const [teamId, data] of teamRatings) {
    data.rating *= SEASON_DECAY;
    data.games = 0;
  }

  console.log(`Prior ratings loaded (${teamRatings.size} teams), applying ${SEASON_DECAY} decay\n`);

  // Step 3: Load 2026 completed games and update ratings
  const { data: games2026 } = await supabase
    .from('cbb_games')
    .select('id, start_date, home_team_id, away_team_id, home_score, away_score')
    .eq('season', 2026)
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true });

  console.log(`Processing ${games2026?.length || 0} completed 2026 games...\n`);

  for (const g of games2026 || []) {
    updateRatings(
      g.home_team_id,
      g.away_team_id,
      teamConf.get(g.home_team_id) || null,
      teamConf.get(g.away_team_id) || null,
      g.home_score,
      g.away_score
    );
  }

  // Step 4: Get upcoming games with betting lines
  const { data: upcomingGames } = await supabase
    .from('cbb_games')
    .select(`
      id,
      start_date,
      home_team_id,
      away_team_id,
      home_team_name,
      away_team_name,
      cbb_betting_lines (
        spread_home,
        provider
      )
    `)
    .eq('season', 2026)
    .eq('home_score', 0)
    .eq('away_score', 0)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true })
    .limit(100);

  console.log(`\n=== UPCOMING GAMES WITH MODEL PREDICTIONS ===\n`);

  // Find games with betting edges
  interface BettingEdge {
    game: any;
    modelSpread: number;
    marketSpread: number;
    edge: number;
    betSide: 'home' | 'away';
    isUnderdog: boolean;
  }

  const edges: BettingEdge[] = [];

  for (const game of upcomingGames || []) {
    const lines = game.cbb_betting_lines as any;
    const line = Array.isArray(lines) ? lines[0] : lines;

    if (!line?.spread_home) continue;

    const homeConf = teamConf.get(game.home_team_id) || null;
    const awayConf = teamConf.get(game.away_team_id) || null;

    const modelSpread = predictSpread(
      game.home_team_id,
      game.away_team_id,
      homeConf,
      awayConf
    );

    const marketSpread = line.spread_home;

    // Edge = how much we disagree with market
    // Positive edge on home = model thinks home is better than market
    const homeEdge = marketSpread - modelSpread;

    // Determine if there's a bet
    const absEdge = Math.abs(homeEdge);
    const spreadSize = Math.abs(marketSpread);

    if (absEdge >= 2.5) {
      const betSide = homeEdge > 0 ? 'home' : 'away';
      const isUnderdog = (betSide === 'home' && marketSpread > 0) ||
                         (betSide === 'away' && marketSpread < 0);

      edges.push({
        game,
        modelSpread,
        marketSpread,
        edge: absEdge,
        betSide,
        isUnderdog,
      });
    }
  }

  // Sort by edge size
  edges.sort((a, b) => b.edge - a.edge);

  // Display top edges
  console.log('TOP BETTING EDGES (2.5+ pts):\n');

  for (const e of edges.slice(0, 20)) {
    const homeGames = teamRatings.get(e.game.home_team_id)?.games || 0;
    const awayGames = teamRatings.get(e.game.away_team_id)?.games || 0;
    const homeConf = teamConf.get(e.game.home_team_id) || '?';
    const awayConf = teamConf.get(e.game.away_team_id) || '?';

    const betTeam = e.betSide === 'home' ? e.game.home_team_name : e.game.away_team_name;
    const betSpread = e.betSide === 'home'
      ? (e.marketSpread >= 0 ? `+${e.marketSpread}` : e.marketSpread)
      : (e.marketSpread <= 0 ? `+${-e.marketSpread}` : -e.marketSpread);

    console.log(`${e.game.away_team_name} @ ${e.game.home_team_name}`);
    console.log(`  Market: ${e.marketSpread >= 0 ? '+' : ''}${e.marketSpread.toFixed(1)} | Model: ${e.modelSpread >= 0 ? '+' : ''}${e.modelSpread.toFixed(1)}`);
    console.log(`  EDGE: ${e.edge.toFixed(1)} pts on ${betTeam} ${betSpread} ${e.isUnderdog ? '(UNDERDOG)' : ''}`);
    console.log(`  Confs: ${awayConf} @ ${homeConf} | Games: ${awayGames} @ ${homeGames}`);
    console.log();
  }

  // Show qualifying bets (validated strategy criteria)
  console.log('\n=== QUALIFYING BETS (2.5-5pt edge, 10+ spread, 5+ games, underdog) ===\n');

  const qualifyingBets = edges.filter(e => {
    const homeGames = teamRatings.get(e.game.home_team_id)?.games || 0;
    const awayGames = teamRatings.get(e.game.away_team_id)?.games || 0;
    const spreadSize = Math.abs(e.marketSpread);

    return (
      e.edge >= 2.5 &&
      e.edge <= 5.0 &&
      spreadSize >= 10 &&
      homeGames >= 5 &&
      awayGames >= 5 &&
      e.isUnderdog
    );
  });

  if (qualifyingBets.length === 0) {
    console.log('No games currently qualify for the validated betting strategy.\n');
  } else {
    for (const e of qualifyingBets) {
      const homeGames = teamRatings.get(e.game.home_team_id)?.games || 0;
      const awayGames = teamRatings.get(e.game.away_team_id)?.games || 0;

      const betTeam = e.betSide === 'home' ? e.game.home_team_name : e.game.away_team_name;
      const betSpread = e.betSide === 'home'
        ? (e.marketSpread >= 0 ? `+${e.marketSpread}` : e.marketSpread)
        : (e.marketSpread <= 0 ? `+${-e.marketSpread}` : -e.marketSpread);

      console.log(`BET: ${betTeam} ${betSpread}`);
      console.log(`  ${e.game.away_team_name} @ ${e.game.home_team_name}`);
      console.log(`  Edge: ${e.edge.toFixed(1)} pts | Market: ${e.marketSpread.toFixed(1)} | Model: ${e.modelSpread.toFixed(1)}`);
      console.log(`  Games played: ${awayGames} @ ${homeGames}`);
      console.log(`  Date: ${new Date(e.game.start_date).toLocaleDateString()}`);
      console.log();
    }
  }

  // Summary stats
  console.log('\n=== MODEL SUMMARY ===\n');
  console.log(`Total teams with ratings: ${teamRatings.size}`);
  console.log(`2026 completed games processed: ${games2026?.length || 0}`);
  console.log(`Upcoming games with lines: ${upcomingGames?.filter(g => (g.cbb_betting_lines as any)?.spread_home).length || 0}`);
  console.log(`Games with 2.5+ pt edge: ${edges.length}`);
  console.log(`Qualifying bets: ${qualifyingBets.length}`);

  // Show top 10 rated teams
  console.log('\n=== TOP 20 TEAMS BY RATING ===\n');

  const sortedTeams = [...teamRatings.entries()]
    .map(([id, data]) => ({
      id,
      name: teamName.get(id) || 'Unknown',
      conf: teamConf.get(id) || '?',
      rating: data.rating,
      confRating: getConfRating(teamConf.get(id) || null),
      totalRating: data.rating + getConfRating(teamConf.get(id) || null),
      games: data.games,
    }))
    .filter(t => t.games >= 5)
    .sort((a, b) => b.totalRating - a.totalRating)
    .slice(0, 20);

  for (let i = 0; i < sortedTeams.length; i++) {
    const t = sortedTeams[i];
    console.log(`${i + 1}. ${t.name} (${t.conf}): ${t.totalRating.toFixed(1)} total (team: ${t.rating >= 0 ? '+' : ''}${t.rating.toFixed(1)}, conf: ${t.confRating >= 0 ? '+' : ''}${t.confRating})`);
  }
}

main().catch(console.error);

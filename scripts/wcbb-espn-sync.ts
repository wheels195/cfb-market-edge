/**
 * WCBB ESPN Sync
 *
 * Fetches all WCBB game results from ESPN team schedules,
 * then matches with The Odds API historical spreads for backtest.
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY || 'e035a3d861365e045027dc00c240c941';

interface ESPNGame {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeId: string;
  awayId: string;
}

interface OddsGame {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  spread: number | null;
}

// Fetch with delay
async function fetchWithDelay(url: string, delayMs: number = 200): Promise<any> {
  await new Promise(resolve => setTimeout(resolve, delayMs));
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

// Get list of all WCBB teams
async function getTeams(): Promise<{ id: string; name: string }[]> {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams?limit=400';
  const data = await fetchWithDelay(url);

  const teams: { id: string; name: string }[] = [];
  for (const team of data.sports?.[0]?.leagues?.[0]?.teams || []) {
    teams.push({
      id: team.team.id,
      name: team.team.displayName,
    });
  }
  return teams;
}

// Get team schedule for a season
async function getTeamSchedule(teamId: string, season: number): Promise<ESPNGame[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams/${teamId}/schedule?season=${season}`;

  try {
    const data = await fetchWithDelay(url, 100);
    const games: ESPNGame[] = [];

    for (const event of data.events || []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      // Only completed games
      if (!competition.boxscoreAvailable) continue;

      const competitors = competition.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === 'home');
      const away = competitors.find((c: any) => c.homeAway === 'away');

      if (!home || !away) continue;

      // Extract scores from the score property
      const homeScore = parseInt(home.score?.displayValue || home.score || '0');
      const awayScore = parseInt(away.score?.displayValue || away.score || '0');

      if (isNaN(homeScore) || isNaN(awayScore) || (homeScore === 0 && awayScore === 0)) continue;

      games.push({
        id: event.id,
        date: event.date,
        homeTeam: home.team?.displayName || '',
        awayTeam: away.team?.displayName || '',
        homeScore,
        awayScore,
        homeId: home.team?.id || '',
        awayId: away.team?.id || '',
      });
    }

    return games;
  } catch (e) {
    return [];
  }
}

// Normalize team name for matching
function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(bulldogs|wildcats|tigers|eagles|bears|cardinals|huskies|cougars|knights|panthers|hawks|owls|rams|lions|mustangs|broncos|aggies|rebels|volunteers|sooners|longhorns|buckeyes|wolverines|spartans|hoosiers|boilermakers|badgers|hawkeyes|gophers|cornhuskers|jayhawks|cyclones|mountaineers|red raiders|horned frogs|cowboys|beavers|ducks|sun devils|bruins|trojans|utes|buffaloes|golden bears|cardinal|demon deacons|blue devils|tar heels|wolfpack|seminoles|hurricanes|cavaliers|hokies|orange|yellow jackets|crimson tide|razorbacks|gamecocks|commodores|gators|lady vols|terrapins|nittany lions|fighting irish|golden gophers|scarlet knights|golden flashes|red storm|screaming eagles|bison|thundering herd|racers|governors|skyhawks|redhawks|penguins|golden eagles|blue raiders|hilltoppers|shockers|zips|rockets|chippewas|bulls|falcons|bobcats|bearcats|red wolves|coyotes|jackrabbits|leathernecks|salukis|sycamores|redbirds|braves|flames|monarchs|pirates|phoenix|49ers|miners|roadrunners|mean green|blazers|jaguars|trojans|vandals|aggies|lumberjacks|wildcats|antelopes|hornets|panthers)$/g, '')
    .replace(/\bst\.?\s*/g, 'st ')
    .replace(/\bstate\b/g, 'st')
    .replace(/\buniversity\b/g, '')
    .replace(/\bcollege\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Get historical odds from The Odds API
async function getHistoricalOdds(date: string): Promise<OddsGame[]> {
  const url = `https://api.the-odds-api.com/v4/historical/sports/basketball_wncaab/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&date=${date}`;
  try {
    const data = await fetchWithDelay(url, 300);
    const games: OddsGame[] = [];

    for (const game of data.data || []) {
      let spread: number | null = null;
      for (const book of game.bookmakers || []) {
        if (['draftkings', 'fanduel', 'betrivers'].includes(book.key)) {
          const spreadMarket = book.markets?.find((m: any) => m.key === 'spreads');
          if (spreadMarket) {
            const homeOutcome = spreadMarket.outcomes?.find((o: any) => o.name === game.home_team);
            if (homeOutcome?.point !== undefined) {
              spread = homeOutcome.point;
              break;
            }
          }
        }
      }

      games.push({
        id: game.id,
        commence_time: game.commence_time,
        home_team: game.home_team,
        away_team: game.away_team,
        spread,
      });
    }

    return games;
  } catch (e) {
    return [];
  }
}

// Simple Elo system
class EloSystem {
  private ratings: Map<string, number> = new Map();
  private gameCount: Map<string, number> = new Map();

  private readonly BASE_ELO = 1500;
  private readonly K_FACTOR = 20;
  private readonly HOME_ADVANTAGE = 100;
  private readonly ELO_DIVISOR = 28;

  getElo(team: string): number {
    const key = normalizeTeam(team);
    if (!this.ratings.has(key)) {
      this.ratings.set(key, this.BASE_ELO);
      this.gameCount.set(key, 0);
    }
    return this.ratings.get(key)!;
  }

  getGamesPlayed(team: string): number {
    return this.gameCount.get(normalizeTeam(team)) || 0;
  }

  updateElo(homeTeam: string, awayTeam: string, homeScore: number, awayScore: number): void {
    const homeKey = normalizeTeam(homeTeam);
    const awayKey = normalizeTeam(awayTeam);

    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);

    const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo - this.HOME_ADVANTAGE) / 400));
    const actualHome = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
    const marginMultiplier = Math.log(Math.abs(homeScore - awayScore) + 1) * 0.8;

    const change = this.K_FACTOR * marginMultiplier * (actualHome - expectedHome);
    this.ratings.set(homeKey, homeElo + change);
    this.ratings.set(awayKey, awayElo - change);

    this.gameCount.set(homeKey, (this.gameCount.get(homeKey) || 0) + 1);
    this.gameCount.set(awayKey, (this.gameCount.get(awayKey) || 0) + 1);
  }

  getSpread(homeTeam: string, awayTeam: string): number {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);
    return (awayElo - homeElo) / this.ELO_DIVISOR - 3.5; // HFA subtracted
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          WCBB ESPN SYNC + BACKTEST                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Step 1: Get all WCBB teams
  console.log('\n=== STEP 1: Fetching WCBB Teams ===\n');
  const teams = await getTeams();
  console.log(`Found ${teams.length} teams`);

  // Step 2: Fetch schedules for 2024-25 season (season=2025 in ESPN)
  console.log('\n=== STEP 2: Fetching Team Schedules ===\n');

  const allGames: Map<string, ESPNGame> = new Map();
  let teamsProcessed = 0;

  // Fetch all teams for complete coverage
  for (const team of teams) {
    const games = await getTeamSchedule(team.id, 2025);
    for (const game of games) {
      if (!allGames.has(game.id)) {
        allGames.set(game.id, game);
      }
    }
    teamsProcessed++;
    if (teamsProcessed % 20 === 0) {
      console.log(`  ${teamsProcessed} teams processed, ${allGames.size} unique games...`);
    }
  }

  console.log(`\nTotal unique games from ESPN: ${allGames.size}`);

  // Step 3: Fetch historical odds
  console.log('\n=== STEP 3: Fetching Historical Odds ===\n');

  const oddsGames: Map<string, OddsGame> = new Map();
  const startDate = new Date('2024-11-01');
  const endDate = new Date('2025-12-20'); // Full date range

  const datesToCheck: string[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    datesToCheck.push(current.toISOString().replace('.000Z', 'Z'));
    current.setDate(current.getDate() + 2);
  }

  console.log(`Checking ${datesToCheck.length} dates for odds...`);

  let oddsApiCalls = 0;
  for (const dateStr of datesToCheck) {
    const games = await getHistoricalOdds(dateStr);
    for (const game of games) {
      if (game.spread !== null && !oddsGames.has(game.id)) {
        oddsGames.set(game.id, game);
      }
    }
    oddsApiCalls++;
    if (oddsApiCalls % 20 === 0) {
      console.log(`  ${oddsApiCalls} API calls, ${oddsGames.size} games with spreads...`);
    }
  }

  console.log(`\nTotal games with odds: ${oddsGames.size}`);

  // Step 4: Match ESPN games with Odds API games
  console.log('\n=== STEP 4: Matching Games ===\n');

  interface MergedGame {
    espnId: string;
    oddsId: string;
    date: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    spread: number;
  }

  const mergedGames: MergedGame[] = [];
  let matched = 0;
  let unmatched = 0;

  for (const oddsGame of oddsGames.values()) {
    const oddsDate = new Date(oddsGame.commence_time);
    const oddsHomeNorm = normalizeTeam(oddsGame.home_team);
    const oddsAwayNorm = normalizeTeam(oddsGame.away_team);

    // Find matching ESPN game
    let bestMatch: ESPNGame | null = null;

    for (const espnGame of allGames.values()) {
      const espnDate = new Date(espnGame.date);

      // Check if same day (within 24 hours)
      const dateDiff = Math.abs(espnDate.getTime() - oddsDate.getTime());
      if (dateDiff > 24 * 60 * 60 * 1000) continue;

      const espnHomeNorm = normalizeTeam(espnGame.homeTeam);
      const espnAwayNorm = normalizeTeam(espnGame.awayTeam);

      // Match teams
      const homeMatch = oddsHomeNorm === espnHomeNorm ||
                       oddsHomeNorm.includes(espnHomeNorm) ||
                       espnHomeNorm.includes(oddsHomeNorm);
      const awayMatch = oddsAwayNorm === espnAwayNorm ||
                       oddsAwayNorm.includes(espnAwayNorm) ||
                       espnAwayNorm.includes(oddsAwayNorm);

      if (homeMatch && awayMatch) {
        bestMatch = espnGame;
        break;
      }
    }

    if (bestMatch && oddsGame.spread !== null) {
      mergedGames.push({
        espnId: bestMatch.id,
        oddsId: oddsGame.id,
        date: oddsGame.commence_time,
        homeTeam: oddsGame.home_team,
        awayTeam: oddsGame.away_team,
        homeScore: bestMatch.homeScore,
        awayScore: bestMatch.awayScore,
        spread: oddsGame.spread,
      });
      matched++;
    } else {
      unmatched++;
    }
  }

  console.log(`Matched: ${matched} games`);
  console.log(`Unmatched: ${unmatched} games`);

  if (mergedGames.length < 50) {
    console.log('\nNot enough matched games for backtest.');

    // Debug: show sample unmatched
    console.log('\nSample unmatched odds games:');
    let shown = 0;
    for (const oddsGame of oddsGames.values()) {
      if (shown >= 5) break;
      const wasMatched = mergedGames.some(m => m.oddsId === oddsGame.id);
      if (!wasMatched) {
        console.log(`  ${oddsGame.home_team} vs ${oddsGame.away_team} (${oddsGame.commence_time.split('T')[0]})`);
        shown++;
      }
    }
    return;
  }

  // Sort by date
  mergedGames.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Step 5: Run backtest
  console.log('\n=== STEP 5: Running Backtest ===\n');

  const elo = new EloSystem();

  interface BetResult {
    won: boolean;
    profit: number;
    betSide: 'home' | 'away';
    edge: number;
  }

  const results: BetResult[] = [];

  for (const game of mergedGames) {
    const homeGames = elo.getGamesPlayed(game.homeTeam);
    const awayGames = elo.getGamesPlayed(game.awayTeam);

    const modelSpread = elo.getSpread(game.homeTeam, game.awayTeam);
    const marketSpread = game.spread;
    const edge = marketSpread - modelSpread;
    const absEdge = Math.abs(edge);

    // Only bet if both teams have at least 1 game
    if (homeGames >= 1 && awayGames >= 1) {
      const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
      const actualMargin = game.homeScore - game.awayScore;

      let won: boolean;
      if (betSide === 'home') {
        won = actualMargin > -marketSpread;
      } else {
        won = actualMargin < -marketSpread;
      }

      if (actualMargin !== -marketSpread) {
        results.push({
          won,
          profit: won ? 0.91 : -1.0,
          betSide,
          edge: absEdge,
        });
      }
    }

    elo.updateElo(game.homeTeam, game.awayTeam, game.homeScore, game.awayScore);
  }

  // Results
  console.log('=== WCBB BACKTEST RESULTS ===\n');

  function summarize(bets: BetResult[], label: string) {
    if (bets.length === 0) {
      console.log(`${label}: No bets`);
      return;
    }
    const wins = bets.filter(b => b.won).length;
    const winRate = wins / bets.length;
    const profit = bets.reduce((sum, b) => sum + b.profit, 0);
    const roi = profit / bets.length;
    const homeBets = bets.filter(b => b.betSide === 'home').length;

    console.log(`${label}: ${bets.length} bets | ${wins}-${bets.length - wins} | ${(winRate * 100).toFixed(1)}% | ROI: ${(roi * 100).toFixed(1)}%`);
    console.log(`  Home: ${homeBets} (${(homeBets / bets.length * 100).toFixed(0)}%), Away: ${bets.length - homeBets} (${((bets.length - homeBets) / bets.length * 100).toFixed(0)}%)`);
  }

  summarize(results, 'All bets');
  summarize(results.filter(r => r.edge >= 2.5 && r.edge <= 5), 'Edge 2.5-5 pts');
  summarize(results.filter(r => r.edge >= 3 && r.edge <= 6), 'Edge 3-6 pts');
  summarize(results.filter(r => r.edge >= 5 && r.edge <= 10), 'Edge 5-10 pts');
  summarize(results.filter(r => r.edge >= 7), 'Edge 7+ pts');

  const allRoi = results.length > 0 ? results.reduce((sum, b) => sum + b.profit, 0) / results.length : -1;

  console.log('\n=== ASSESSMENT ===\n');

  if (allRoi > 0.05) {
    console.log('✅ PROMISING: ROI > +5%');
  } else if (allRoi > 0) {
    console.log('⚠️ MARGINAL: ROI positive but < +5%');
  } else if (allRoi > -0.045) {
    console.log('⚠️ NEUTRAL: ROI near baseline (-4.5%)');
  } else {
    console.log('❌ NO EDGE: ROI worse than random');
  }

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);

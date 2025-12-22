/**
 * WCBB Backtest V2
 *
 * Uses The Odds API for historical spreads + ESPN for scores.
 * Builds Elo from game results and tests against market.
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY || 'e035a3d861365e045027dc00c240c941';
const SPORT_KEY = 'basketball_wncaab';

interface OddsGame {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  spread: number | null; // Home team spread
}

interface ESPNGame {
  date: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  completed: boolean;
}

interface MergedGame {
  id: string;
  date: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  spread: number;
}

// Normalize team names for matching - extract just the school name
function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    // Remove common mascots at end
    .replace(/\s+(bulldogs|wildcats|tigers|eagles|bears|cardinals|huskies|cougars|knights|panthers|hawks|owls|rams|lions|mustangs|broncos|aggies|rebels|volunteers|sooners|longhorns|buckeyes|wolverines|spartans|hoosiers|boilermakers|badgers|hawkeyes|gophers|cornhuskers|jayhawks|cyclones|mountaineers|red raiders|horned frogs|cowboys|beavers|ducks|sun devils|bruins|trojans|utes|buffaloes|golden bears|cardinal|tribe|demon deacons|blue devils|tar heels|wolfpack|seminoles|hurricanes|cavaliers|hokies|orange|yellow jackets|crimson tide|razorbacks|gamecocks|commodores|gators|vols|lady vols|lady|women's|w\.|wbb|terrapins|nittany lions|fighting irish|golden gophers|scarlet knights|golden flashes|red storm|blue hose|rainbow wahine|rainbow warriors|aztecs|toreros|matadors|anteaters|waves|gaels|pilots|dons|zags|gonzaga|mean green|horned toads|mocs|paladins|catamounts|keydets|flames|liberty|screaming eagles|bison|thundering herd|racers|governors|skyhawks|redhawks|penguins|golden eagles|blue raiders|hilltoppers|shockers|zips|rockets|chippewas|huskies|broncos|bulls|falcons|bobcats|bearcats|red wolves)$/g, '')
    .replace(/\bst\.?\s*/g, 'st ')
    .replace(/\bstate\b/g, 'st')
    .replace(/\buniversity\b/g, '')
    .replace(/\bcollege\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Get core school identifier from team name
function getSchoolCore(name: string): string {
  const normalized = normalizeTeam(name);
  // Extract first significant word(s) - usually the school name
  const parts = normalized.split(' ').filter(p => p.length > 2);
  return parts.slice(0, 2).join(' ');
}

// Fetch with delay
async function fetchWithDelay(url: string, delayMs: number = 300): Promise<any> {
  await new Promise(resolve => setTimeout(resolve, delayMs));
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

// Get historical odds from The Odds API
async function getHistoricalOdds(date: string): Promise<OddsGame[]> {
  const url = `https://api.the-odds-api.com/v4/historical/sports/${SPORT_KEY}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&date=${date}`;
  try {
    const data = await fetchWithDelay(url);
    const games: OddsGame[] = [];

    for (const game of data.data || []) {
      // Find DraftKings or FanDuel spread
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

// Get scores from ESPN for a specific date
async function getESPNScores(dateStr: string): Promise<ESPNGame[]> {
  // Format: YYYYMMDD
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?limit=200&dates=${dateStr}`;
  try {
    const data = await fetchWithDelay(url, 100);
    const games: ESPNGame[] = [];

    for (const event of data.events || []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home');
      const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away');

      if (!homeTeam || !awayTeam) continue;

      const status = competition.status?.type?.completed;

      games.push({
        date: event.date,
        home_team: homeTeam.team?.displayName || '',
        away_team: awayTeam.team?.displayName || '',
        home_score: parseInt(homeTeam.score) || 0,
        away_score: parseInt(awayTeam.score) || 0,
        completed: status === true,
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

  // Model spread: positive = home underdog, negative = home favorite
  getSpread(homeTeam: string, awayTeam: string): number {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);
    // HFA is SUBTRACTED (home advantage makes spread more negative)
    return (awayElo - homeElo) / this.ELO_DIVISOR - 3.5;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          WCBB BACKTEST V2 (Odds API + ESPN)                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Date range: 2024-2025 WCBB season
  const startDate = new Date('2024-11-15');
  const endDate = new Date('2025-12-20');

  console.log(`\nSyncing from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

  // Step 1: Collect all games with odds
  console.log('\n=== STEP 1: Fetching Historical Odds ===\n');

  const allOddsGames: Map<string, OddsGame> = new Map();
  const datesToCheck: string[] = [];

  const current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = current.toISOString().replace('.000Z', 'Z');
    datesToCheck.push(dateStr);
    current.setDate(current.getDate() + 2); // Every 2 days
  }

  console.log(`Checking ${datesToCheck.length} date snapshots for odds...`);

  let oddsApiCalls = 0;
  for (const dateStr of datesToCheck) {
    const games = await getHistoricalOdds(dateStr);
    for (const game of games) {
      if (game.spread !== null && !allOddsGames.has(game.id)) {
        allOddsGames.set(game.id, game);
      }
    }
    oddsApiCalls++;
    if (oddsApiCalls % 20 === 0) {
      console.log(`  ${oddsApiCalls} API calls, ${allOddsGames.size} games with spreads...`);
    }
  }

  console.log(`\nTotal games with odds: ${allOddsGames.size}`);
  console.log(`Odds API calls: ${oddsApiCalls}`);

  // Step 2: Fetch scores from ESPN for each game date
  console.log('\n=== STEP 2: Fetching ESPN Scores ===\n');

  const espnScoresByDate: Map<string, ESPNGame[]> = new Map();
  const gamesDates = new Set<string>();

  for (const game of allOddsGames.values()) {
    const d = new Date(game.commence_time);
    const espnDate = d.toISOString().split('T')[0].replace(/-/g, '');
    gamesDates.add(espnDate);
  }

  console.log(`Fetching scores for ${gamesDates.size} unique dates...`);

  let espnCalls = 0;
  for (const date of Array.from(gamesDates).sort()) {
    const scores = await getESPNScores(date);
    espnScoresByDate.set(date, scores);
    espnCalls++;
    if (espnCalls % 20 === 0) {
      console.log(`  ${espnCalls} ESPN calls...`);
    }
  }

  console.log(`ESPN API calls: ${espnCalls}`);

  // Step 3: Match odds games with ESPN scores
  console.log('\n=== STEP 3: Matching Games ===\n');

  const mergedGames: MergedGame[] = [];
  let matched = 0;
  let unmatched = 0;

  for (const oddsGame of allOddsGames.values()) {
    const d = new Date(oddsGame.commence_time);
    const espnDate = d.toISOString().split('T')[0].replace(/-/g, '');
    const espnGames = espnScoresByDate.get(espnDate) || [];

    const oddsHomeNorm = normalizeTeam(oddsGame.home_team);
    const oddsAwayNorm = normalizeTeam(oddsGame.away_team);

    // Find matching ESPN game
    let bestMatch: ESPNGame | null = null;
    const oddsHomeCore = getSchoolCore(oddsGame.home_team);
    const oddsAwayCore = getSchoolCore(oddsGame.away_team);

    for (const espnGame of espnGames) {
      if (!espnGame.completed) continue;

      const espnHomeNorm = normalizeTeam(espnGame.home_team);
      const espnAwayNorm = normalizeTeam(espnGame.away_team);
      const espnHomeCore = getSchoolCore(espnGame.home_team);
      const espnAwayCore = getSchoolCore(espnGame.away_team);

      // Try multiple matching strategies
      const homeMatch =
        oddsHomeNorm === espnHomeNorm ||
        oddsHomeNorm.includes(espnHomeNorm) ||
        espnHomeNorm.includes(oddsHomeNorm) ||
        oddsHomeCore === espnHomeCore ||
        (oddsHomeCore.length > 4 && espnHomeCore.includes(oddsHomeCore)) ||
        (espnHomeCore.length > 4 && oddsHomeCore.includes(espnHomeCore));

      const awayMatch =
        oddsAwayNorm === espnAwayNorm ||
        oddsAwayNorm.includes(espnAwayNorm) ||
        espnAwayNorm.includes(oddsAwayNorm) ||
        oddsAwayCore === espnAwayCore ||
        (oddsAwayCore.length > 4 && espnAwayCore.includes(oddsAwayCore)) ||
        (espnAwayCore.length > 4 && oddsAwayCore.includes(espnAwayCore));

      if (homeMatch && awayMatch) {
        bestMatch = espnGame;
        break;
      }
    }

    if (bestMatch && oddsGame.spread !== null) {
      mergedGames.push({
        id: oddsGame.id,
        date: oddsGame.commence_time,
        home_team: oddsGame.home_team,
        away_team: oddsGame.away_team,
        home_score: bestMatch.home_score,
        away_score: bestMatch.away_score,
        spread: oddsGame.spread,
      });
      matched++;
    } else {
      unmatched++;
    }
  }

  console.log(`Matched: ${matched} games`);
  console.log(`Unmatched: ${unmatched} games`);

  // Debug: show some unmatched examples
  if (unmatched > 0) {
    console.log('\nSample unmatched (first 5):');
    let shown = 0;
    for (const oddsGame of allOddsGames.values()) {
      if (shown >= 5) break;
      const d = new Date(oddsGame.commence_time);
      const espnDate = d.toISOString().split('T')[0].replace(/-/g, '');
      const espnGames = espnScoresByDate.get(espnDate) || [];
      const wasMatched = mergedGames.some(m => m.id === oddsGame.id);
      if (!wasMatched) {
        console.log(`  ${oddsGame.home_team} vs ${oddsGame.away_team} (${espnDate})`);
        console.log(`    ESPN games that day: ${espnGames.filter(g => g.completed).length} completed`);
        if (espnGames.length > 0) {
          const sample = espnGames.slice(0, 2);
          for (const g of sample) {
            console.log(`      - ${g.home_team} vs ${g.away_team} (${g.completed ? 'completed' : 'not completed'})`);
          }
        }
        shown++;
      }
    }
  }

  if (mergedGames.length < 50) {
    console.log('\nNot enough matched games for meaningful backtest.');
    return;
  }

  // Sort by date
  mergedGames.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Step 4: Build Elo and run backtest
  console.log('\n=== STEP 4: Building Elo & Running Backtest ===\n');

  const elo = new EloSystem();

  interface BetResult {
    won: boolean;
    profit: number;
    betSide: 'home' | 'away';
    edge: number;
    homeGames: number;
    awayGames: number;
  }

  const results: BetResult[] = [];
  const minGamesRequired = 1; // Lower threshold to get more bets

  for (const game of mergedGames) {
    const homeGames = elo.getGamesPlayed(game.home_team);
    const awayGames = elo.getGamesPlayed(game.away_team);

    // Calculate model spread BEFORE updating Elo
    const modelSpread = elo.getSpread(game.home_team, game.away_team);
    const marketSpread = game.spread;

    // Edge = market - model (positive = bet home, negative = bet away)
    const edge = marketSpread - modelSpread;
    const absEdge = Math.abs(edge);

    // Only bet if we have Elo history for both teams
    if (homeGames >= minGamesRequired && awayGames >= minGamesRequired) {
      const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
      const actualMargin = game.home_score - game.away_score;

      let won: boolean;
      if (betSide === 'home') {
        won = actualMargin > -marketSpread;
      } else {
        won = actualMargin < -marketSpread;
      }

      // Skip pushes
      if (actualMargin !== -marketSpread) {
        results.push({
          won,
          profit: won ? 0.91 : -1.0,
          betSide,
          edge: absEdge,
          homeGames,
          awayGames,
        });
      }
    }

    // Update Elo AFTER betting decision
    elo.updateElo(game.home_team, game.away_team, game.home_score, game.away_score);
  }

  // Step 5: Results
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

  // Assessment
  const allRoi = results.length > 0 ? results.reduce((sum, b) => sum + b.profit, 0) / results.length : -1;

  console.log('\n=== ASSESSMENT ===\n');

  if (allRoi > 0.05) {
    console.log('✅ PROMISING: ROI > +5%');
    console.log('   Worth further investigation');
  } else if (allRoi > 0) {
    console.log('⚠️ MARGINAL: ROI positive but < +5%');
    console.log('   May not overcome real-world friction');
  } else if (allRoi > -0.045) {
    console.log('⚠️ NEUTRAL: ROI near baseline (-4.5%)');
    console.log('   No clear edge detected');
  } else {
    console.log('❌ NO EDGE: ROI worse than random');
    console.log('   Market appears efficient');
  }

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);

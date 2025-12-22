/**
 * WCBB Sync and Backtest
 *
 * Pulls historical WCBB data from The Odds API and runs a backtest
 * using in-memory Elo ratings (no database tables needed).
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY || 'e035a3d861365e045027dc00c240c941';
const SPORT_KEY = 'basketball_wncaab';

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

interface ScoreGame {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
}

interface GameData {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  spread_open: number | null;  // DraftKings spread for home team
  spread_close: number | null;
  completed: boolean;
}

// Fetch with rate limiting
async function fetchWithDelay(url: string, delayMs: number = 500): Promise<any> {
  await new Promise(resolve => setTimeout(resolve, delayMs));
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error: ${response.status} - ${text}`);
  }
  return response.json();
}

// Get historical odds for a specific date
async function getHistoricalOdds(date: string): Promise<OddsGame[]> {
  const url = `https://api.the-odds-api.com/v4/historical/sports/${SPORT_KEY}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&date=${date}`;
  const data = await fetchWithDelay(url);
  return data.data || [];
}

// Get historical events (for scores)
async function getHistoricalScores(date: string): Promise<ScoreGame[]> {
  const url = `https://api.the-odds-api.com/v4/historical/sports/${SPORT_KEY}/scores?apiKey=${ODDS_API_KEY}&date=${date}`;
  try {
    const data = await fetchWithDelay(url);
    return data.data || [];
  } catch (e) {
    return [];
  }
}

// Extract DraftKings spread from bookmakers
function extractSpread(bookmakers: OddsGame['bookmakers'], homeTeam: string): number | null {
  // Prefer DraftKings, then FanDuel, then BetRivers
  const preferredBooks = ['draftkings', 'fanduel', 'betrivers'];

  for (const bookKey of preferredBooks) {
    const book = bookmakers.find(b => b.key === bookKey);
    if (book) {
      const spreadsMarket = book.markets.find(m => m.key === 'spreads');
      if (spreadsMarket) {
        const homeOutcome = spreadsMarket.outcomes.find(o => o.name === homeTeam);
        if (homeOutcome && homeOutcome.point !== undefined) {
          return homeOutcome.point;
        }
      }
    }
  }
  return null;
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
    if (!this.ratings.has(team)) {
      this.ratings.set(team, this.BASE_ELO);
      this.gameCount.set(team, 0);
    }
    return this.ratings.get(team)!;
  }

  getGamesPlayed(team: string): number {
    return this.gameCount.get(team) || 0;
  }

  updateElo(homeTeam: string, awayTeam: string, homeScore: number, awayScore: number): void {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);

    const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo - this.HOME_ADVANTAGE) / 400));
    const actualHome = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
    const marginMultiplier = Math.log(Math.abs(homeScore - awayScore) + 1) * 0.8;

    const change = this.K_FACTOR * marginMultiplier * (actualHome - expectedHome);
    this.ratings.set(homeTeam, homeElo + change);
    this.ratings.set(awayTeam, awayElo - change);

    this.gameCount.set(homeTeam, (this.gameCount.get(homeTeam) || 0) + 1);
    this.gameCount.set(awayTeam, (this.gameCount.get(awayTeam) || 0) + 1);
  }

  getSpread(homeTeam: string, awayTeam: string): number {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);
    // Positive = home underdog, Negative = home favorite
    return (awayElo - homeElo) / this.ELO_DIVISOR - 3.5; // HFA subtracted
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          WCBB SYNC AND BACKTEST                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Date range to sync: Nov 2024 to now
  const startDate = new Date('2024-11-15');
  const endDate = new Date('2025-12-20');

  console.log(`\nSyncing WCBB data from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log('This will make multiple API calls...\n');

  const allGames: Map<string, GameData> = new Map();

  // Sample dates throughout the season (every 3 days to reduce API calls)
  const datesToCheck: string[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    // Format: YYYY-MM-DDTHH:MM:SSZ (no milliseconds)
    const dateStr = current.toISOString().replace('.000Z', 'Z');
    datesToCheck.push(dateStr);
    current.setDate(current.getDate() + 3); // Every 3 days
  }

  console.log(`Checking ${datesToCheck.length} date snapshots...`);

  let apiCalls = 0;
  const maxApiCalls = 500; // Allow more API calls with paid subscription

  for (const dateStr of datesToCheck) {
    if (apiCalls >= maxApiCalls) {
      console.log(`\nReached API call limit (${maxApiCalls}), stopping sync.`);
      break;
    }

    try {
      // Get odds for this date
      const odds = await getHistoricalOdds(dateStr);
      apiCalls++;

      for (const game of odds) {
        if (!allGames.has(game.id)) {
          const spread = extractSpread(game.bookmakers, game.home_team);
          allGames.set(game.id, {
            id: game.id,
            commence_time: game.commence_time,
            home_team: game.home_team,
            away_team: game.away_team,
            home_score: null,
            away_score: null,
            spread_open: spread,
            spread_close: spread, // Will update with later snapshots
            completed: false,
          });
        } else {
          // Update spread_close with latest
          const spread = extractSpread(game.bookmakers, allGames.get(game.id)!.home_team);
          if (spread !== null) {
            allGames.get(game.id)!.spread_close = spread;
          }
        }
      }

      // Get scores for this date
      const scores = await getHistoricalScores(dateStr);
      apiCalls++;

      for (const game of scores) {
        if (allGames.has(game.id) && game.completed && game.scores) {
          const existing = allGames.get(game.id)!;
          const homeScore = game.scores.find(s => s.name === game.home_team);
          const awayScore = game.scores.find(s => s.name === game.away_team);

          if (homeScore && awayScore) {
            existing.home_score = parseInt(homeScore.score);
            existing.away_score = parseInt(awayScore.score);
            existing.completed = true;
          }
        }
      }

      if (apiCalls % 20 === 0) {
        console.log(`  ${apiCalls} API calls, ${allGames.size} games found...`);
      }
    } catch (e) {
      console.log(`  Error on ${dateStr}: ${e}`);
    }
  }

  console.log(`\n=== SYNC COMPLETE ===`);
  console.log(`Total games found: ${allGames.size}`);
  console.log(`API calls used: ${apiCalls}`);

  // Filter to completed games with spreads
  const completedGames = Array.from(allGames.values())
    .filter(g => g.completed && g.home_score !== null && g.spread_close !== null)
    .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());

  console.log(`Completed games with spreads: ${completedGames.length}`);

  if (completedGames.length < 100) {
    console.log('\nNot enough games for meaningful backtest. Need more API calls or wider date range.');
    return;
  }

  // Build Elo and run backtest
  console.log('\n=== BUILDING ELO AND RUNNING BACKTEST ===\n');

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

  for (const game of completedGames) {
    // Get pre-game Elo
    const homeElo = elo.getElo(game.home_team);
    const awayElo = elo.getElo(game.away_team);
    const homeGames = elo.getGamesPlayed(game.home_team);
    const awayGames = elo.getGamesPlayed(game.away_team);

    // Calculate model spread
    const modelSpread = elo.getSpread(game.home_team, game.away_team);
    const marketSpread = game.spread_close!;

    // Edge calculation
    const edge = marketSpread - modelSpread;
    const absEdge = Math.abs(edge);

    // Only bet if we have some Elo history
    if (homeGames >= 3 && awayGames >= 3) {
      const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
      const actualMargin = game.home_score! - game.away_score!;

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
    elo.updateElo(game.home_team, game.away_team, game.home_score!, game.away_score!);
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

    console.log(`${label}: ${bets.length} bets | ${wins}-${bets.length-wins} | ${(winRate*100).toFixed(1)}% | ROI: ${(roi*100).toFixed(1)}%`);
    console.log(`  Home: ${homeBets} (${(homeBets/bets.length*100).toFixed(0)}%), Away: ${bets.length-homeBets} (${((bets.length-homeBets)/bets.length*100).toFixed(0)}%)`);
  }

  summarize(results, 'All bets');
  summarize(results.filter(r => r.edge >= 2.5 && r.edge <= 5), 'Edge 2.5-5 pts');
  summarize(results.filter(r => r.edge >= 3 && r.edge <= 6), 'Edge 3-6 pts');
  summarize(results.filter(r => r.edge >= 5 && r.edge <= 10), 'Edge 5-10 pts');
  summarize(results.filter(r => r.edge >= 7), 'Edge 7+ pts');

  // Check if there's signal
  const allRoi = results.reduce((sum, b) => sum + b.profit, 0) / results.length;

  console.log('\n=== ASSESSMENT ===\n');

  if (allRoi > 0.05) {
    console.log('✅ PROMISING: ROI > +5%');
    console.log('   Worth further investigation with more data');
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

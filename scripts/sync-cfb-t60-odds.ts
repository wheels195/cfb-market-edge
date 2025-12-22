/**
 * Sync CFB T-60 Spreads from Historical Odds API
 *
 * For each game in cfbd_betting_lines:
 * 1. Get the start_date (kickoff time)
 * 2. Query Historical Odds API at T-60 (kickoff - 60 minutes)
 * 3. Find DraftKings spread for the matching teams
 * 4. Store spread_t60 in the database
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ODDS_API_KEY = process.env.ODDS_API_KEY || 'e035a3d861365e045027dc00c240c941';
const SPORT = 'americanfootball_ncaaf';

interface HistoricalOddsResponse {
  id: string;
  sport_key: string;
  sport_title: string;
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

interface GameForSync {
  cfbd_game_id: number;
  home_team: string;
  away_team: string;
  start_date: string;
  spread_close: number | null;
}

// Team name normalization (CFBD to Odds API)
const TEAM_NAME_MAP: Record<string, string> = {
  'Miami': 'Miami (FL)',
  'Miami (FL)': 'Miami (FL)',
  'Miami (OH)': 'Miami (OH)',
  'Mississippi': 'Ole Miss',
  'Ole Miss': 'Ole Miss',
  'Louisiana': 'Louisiana Ragin Cajuns',
  'Louisiana-Monroe': 'Louisiana Monroe Warhawks',
  'UL Monroe': 'Louisiana Monroe Warhawks',
  'ULM': 'Louisiana Monroe Warhawks',
  'Louisiana-Lafayette': 'Louisiana Ragin Cajuns',
  'Appalachian State': 'Appalachian State Mountaineers',
  'App State': 'Appalachian State Mountaineers',
  'Coastal Carolina': 'Coastal Carolina Chanticleers',
  'Georgia Southern': 'Georgia Southern Eagles',
  'Texas State': 'Texas State Bobcats',
  'Troy': 'Troy Trojans',
  'South Alabama': 'South Alabama Jaguars',
  'Arkansas State': 'Arkansas State Red Wolves',
  'Southern Mississippi': 'Southern Miss Golden Eagles',
  'Southern Miss': 'Southern Miss Golden Eagles',
  'UTSA': 'UT San Antonio Roadrunners',
  'UT San Antonio': 'UT San Antonio Roadrunners',
  'North Texas': 'North Texas Mean Green',
  'Middle Tennessee': 'Middle Tennessee Blue Raiders',
  'MTSU': 'Middle Tennessee Blue Raiders',
  'Western Kentucky': 'Western Kentucky Hilltoppers',
  'WKU': 'Western Kentucky Hilltoppers',
  'FIU': 'FIU Panthers',
  'Florida International': 'FIU Panthers',
  'Florida Atlantic': 'Florida Atlantic Owls',
  'FAU': 'Florida Atlantic Owls',
  'Charlotte': 'Charlotte 49ers',
  'Old Dominion': 'Old Dominion Monarchs',
  'ODU': 'Old Dominion Monarchs',
  'Rice': 'Rice Owls',
  'UTEP': 'UTEP Miners',
  'New Mexico State': 'New Mexico State Aggies',
  'NMSU': 'New Mexico State Aggies',
  'Liberty': 'Liberty Flames',
  'Sam Houston State': 'Sam Houston Bearkats',
  'Sam Houston': 'Sam Houston Bearkats',
  'Jacksonville State': 'Jacksonville State Gamecocks',
  'James Madison': 'James Madison Dukes',
  'JMU': 'James Madison Dukes',
  'Kennesaw State': 'Kennesaw State Owls',
  'USC': 'USC Trojans',
  'Southern California': 'USC Trojans',
  'LSU': 'LSU Tigers',
  'UCF': 'UCF Knights',
  'Central Florida': 'UCF Knights',
  'SMU': 'SMU Mustangs',
  'TCU': 'TCU Horned Frogs',
  'BYU': 'BYU Cougars',
  'Brigham Young': 'BYU Cougars',
  // Add more as needed
};

function normalizeTeamName(cfbdName: string): string {
  // Check exact match first
  if (TEAM_NAME_MAP[cfbdName]) {
    return TEAM_NAME_MAP[cfbdName];
  }
  // Return as-is if no mapping
  return cfbdName;
}

function teamsMatch(cfbdHome: string, cfbdAway: string, oddsHome: string, oddsAway: string): boolean {
  const normHome = normalizeTeamName(cfbdHome).toLowerCase();
  const normAway = normalizeTeamName(cfbdAway).toLowerCase();
  const oddsHomeLower = oddsHome.toLowerCase();
  const oddsAwayLower = oddsAway.toLowerCase();

  // Check if names contain each other (fuzzy match)
  const homeMatch = oddsHomeLower.includes(normHome) || normHome.includes(oddsHomeLower) ||
                    oddsHomeLower.split(' ')[0] === normHome.split(' ')[0];
  const awayMatch = oddsAwayLower.includes(normAway) || normAway.includes(oddsAwayLower) ||
                    oddsAwayLower.split(' ')[0] === normAway.split(' ')[0];

  return homeMatch && awayMatch;
}

async function fetchHistoricalOdds(date: string): Promise<HistoricalOddsResponse[]> {
  const url = `https://api.the-odds-api.com/v4/historical/sports/${SPORT}/odds?` +
    `apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&oddsFormat=american&date=${date}`;

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Odds API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.data || data || [];
}

async function getGamesForSync(): Promise<GameForSync[]> {
  // Load start dates from JSON
  const startDatesFile = '/home/wheel/cfb-market-edge/data/game-start-dates.json';
  let startDates: Record<string, string> = {};

  if (fs.existsSync(startDatesFile)) {
    startDates = JSON.parse(fs.readFileSync(startDatesFile, 'utf-8'));
  }

  // Get games from database
  const games: GameForSync[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('cfbd_betting_lines')
      .select('cfbd_game_id, home_team, away_team, spread_close, season')
      .not('home_score', 'is', null)
      .not('spread_close', 'is', null)
      .in('season', [2022, 2023, 2024])
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching games:', error);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const startDate = startDates[row.cfbd_game_id.toString()];
      if (startDate) {
        games.push({
          cfbd_game_id: row.cfbd_game_id,
          home_team: row.home_team,
          away_team: row.away_team,
          start_date: startDate,
          spread_close: row.spread_close,
        });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return games;
}

async function main() {
  console.log('========================================');
  console.log('  CFB T-60 Odds Sync');
  console.log('========================================\n');

  // Get games to sync
  const games = await getGamesForSync();
  console.log(`Games with start dates: ${games.length}`);

  if (games.length === 0) {
    console.log('No games to sync!');
    return;
  }

  // Group games by date (to minimize API calls)
  const gamesByDate = new Map<string, GameForSync[]>();
  for (const game of games) {
    const kickoff = new Date(game.start_date);
    const t60 = new Date(kickoff.getTime() - 60 * 60 * 1000); // T-60
    const dateKey = t60.toISOString();

    if (!gamesByDate.has(dateKey)) {
      gamesByDate.set(dateKey, []);
    }
    gamesByDate.get(dateKey)!.push(game);
  }

  console.log(`Unique T-60 timestamps: ${gamesByDate.size}`);

  // Process in batches
  const results: Array<{ cfbd_game_id: number; spread_t60: number | null; matched: boolean }> = [];
  let processed = 0;
  let matched = 0;
  let apiCalls = 0;

  // Sort dates chronologically
  const sortedDates = Array.from(gamesByDate.keys()).sort();

  for (const dateKey of sortedDates) {
    const gamesForDate = gamesByDate.get(dateKey)!;

    try {
      // Fetch historical odds for this timestamp
      const oddsData = await fetchHistoricalOdds(dateKey);
      apiCalls++;

      // Log progress
      if (apiCalls % 10 === 0) {
        console.log(`API calls: ${apiCalls}, processed: ${processed}/${games.length}, matched: ${matched}`);
      }

      // Match games
      for (const game of gamesForDate) {
        let spreadT60: number | null = null;
        let foundMatch = false;

        for (const oddsGame of oddsData) {
          if (teamsMatch(game.home_team, game.away_team, oddsGame.home_team, oddsGame.away_team)) {
            // Find DraftKings spread
            const dk = oddsGame.bookmakers.find(b => b.key === 'draftkings');
            if (dk) {
              const spreadMarket = dk.markets.find(m => m.key === 'spreads');
              if (spreadMarket) {
                const homeOutcome = spreadMarket.outcomes.find(o =>
                  o.name.toLowerCase().includes(game.home_team.toLowerCase().split(' ')[0]) ||
                  game.home_team.toLowerCase().includes(o.name.toLowerCase().split(' ')[0])
                );
                if (homeOutcome && homeOutcome.point !== undefined) {
                  spreadT60 = homeOutcome.point;
                  foundMatch = true;
                  matched++;
                }
              }
            }
            break;
          }
        }

        results.push({
          cfbd_game_id: game.cfbd_game_id,
          spread_t60: spreadT60,
          matched: foundMatch,
        });
        processed++;
      }

      // Rate limit: 1 request per second
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.error(`Error for ${dateKey}:`, err);
      // Mark games as unmatched
      for (const game of gamesForDate) {
        results.push({
          cfbd_game_id: game.cfbd_game_id,
          spread_t60: null,
          matched: false,
        });
        processed++;
      }
    }

    // Save progress every 100 API calls
    if (apiCalls % 100 === 0) {
      const progressFile = '/home/wheel/cfb-market-edge/data/t60-sync-progress.json';
      fs.writeFileSync(progressFile, JSON.stringify({
        apiCalls,
        processed,
        matched,
        results: results.slice(-1000), // Last 1000 results
      }, null, 2));
    }
  }

  console.log(`\n=== Sync Complete ===`);
  console.log(`API calls: ${apiCalls}`);
  console.log(`Games processed: ${processed}`);
  console.log(`Games matched: ${matched} (${(matched / processed * 100).toFixed(1)}%)`);

  // Save results
  const resultsFile = '/home/wheel/cfb-market-edge/data/t60-spreads.json';
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${resultsFile}`);

  // Show sample
  const matchedResults = results.filter(r => r.matched);
  console.log(`\nSample matched results:`);
  for (const r of matchedResults.slice(0, 5)) {
    console.log(`  Game ${r.cfbd_game_id}: T-60 spread = ${r.spread_t60}`);
  }
}

main().catch(console.error);

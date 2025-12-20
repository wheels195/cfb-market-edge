/**
 * Test The Odds API sync on a single game
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) {
    return Math.round((decimal - 1) * 100);
  } else {
    return Math.round(-100 / (decimal - 1));
  }
}

async function test() {
  console.log('Testing The Odds API historical sync...\n');

  // Get a sample event from 2024 season
  const { data: events } = await supabase
    .from('events')
    .select('id, commence_time, home_team, away_team, status')
    .gte('commence_time', '2024-09-14T00:00:00Z')
    .lte('commence_time', '2024-09-15T00:00:00Z')
    .eq('status', 'final')
    .limit(3);

  console.log('Sample events:');
  for (const e of events || []) {
    console.log(`  ${e.away_team} @ ${e.home_team} - ${e.commence_time}`);
  }

  if (!events?.length) {
    console.log('No events found');
    return;
  }

  const event = events[0];
  console.log(`\nTesting with: ${event.away_team} @ ${event.home_team}`);
  console.log(`Kickoff: ${event.commence_time}`);

  const kickoff = new Date(event.commence_time);

  // Opening line: 7 days before
  const openingDate = new Date(kickoff);
  openingDate.setDate(openingDate.getDate() - 7);
  console.log(`\nFetching opening odds from: ${openingDate.toISOString()}`);

  const openUrl = `https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds?` +
    `apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&bookmakers=draftkings&date=${openingDate.toISOString()}`;

  const openRes = await fetch(openUrl);
  const openData = await openRes.json();

  console.log(`API timestamp: ${openData.timestamp}`);
  console.log(`Games in response: ${openData.data?.length || 0}`);

  // Find our game
  const homeNorm = event.home_team.toLowerCase();
  const awayNorm = event.away_team.toLowerCase();

  const matchingGame = openData.data?.find((g: any) => {
    const gHome = g.home_team.toLowerCase();
    const gAway = g.away_team.toLowerCase();
    return gHome.includes(homeNorm.split(' ')[0]) || homeNorm.includes(gHome.split(' ')[0]);
  });

  if (matchingGame) {
    console.log(`\nFound matching game: ${matchingGame.away_team} @ ${matchingGame.home_team}`);

    const dk = matchingGame.bookmakers?.find((b: any) => b.key === 'draftkings');
    if (dk) {
      console.log('DraftKings spreads:');
      const spreads = dk.markets?.find((m: any) => m.key === 'spreads');
      for (const outcome of spreads?.outcomes || []) {
        const american = decimalToAmerican(outcome.price);
        console.log(`  ${outcome.name}: ${outcome.point > 0 ? '+' : ''}${outcome.point} @ ${outcome.price} (${american})`);
      }
    }
  } else {
    console.log('\nNo matching game found in API response');
    console.log('Sample games from response:');
    for (const g of (openData.data || []).slice(0, 5)) {
      console.log(`  ${g.away_team} @ ${g.home_team}`);
    }
  }

  // Check closing line
  const closingDate = new Date(kickoff);
  closingDate.setHours(closingDate.getHours() - 1);
  console.log(`\nFetching closing odds from: ${closingDate.toISOString()}`);

  const closeUrl = `https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds?` +
    `apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&bookmakers=draftkings&date=${closingDate.toISOString()}`;

  const closeRes = await fetch(closeUrl);
  const closeData = await closeRes.json();

  console.log(`API timestamp: ${closeData.timestamp}`);

  const closeMatch = closeData.data?.find((g: any) => {
    const gHome = g.home_team.toLowerCase();
    return gHome.includes(homeNorm.split(' ')[0]) || homeNorm.includes(gHome.split(' ')[0]);
  });

  if (closeMatch) {
    console.log(`Found matching game: ${closeMatch.away_team} @ ${closeMatch.home_team}`);

    const dk = closeMatch.bookmakers?.find((b: any) => b.key === 'draftkings');
    if (dk) {
      console.log('DraftKings closing spreads:');
      const spreads = dk.markets?.find((m: any) => m.key === 'spreads');
      for (const outcome of spreads?.outcomes || []) {
        const american = decimalToAmerican(outcome.price);
        console.log(`  ${outcome.name}: ${outcome.point > 0 ? '+' : ''}${outcome.point} @ ${outcome.price} (${american})`);
      }
    }
  }
}

test().catch(console.error);

/**
 * Check available bowl games from CFBD and Odds API
 */

const CFBD_API_KEY = process.env.CFBD_API_KEY!;

async function main() {
  console.log('=== Checking Bowl Games ===\n');

  // Check CFBD for 2024 postseason (current bowl season)
  const response = await fetch(
    'https://apinext.collegefootballdata.com/games?year=2024&seasonType=postseason',
    {
      headers: {
        'Authorization': `Bearer ${CFBD_API_KEY}`,
        'Accept': 'application/json',
      },
    }
  );

  if (!response.ok) {
    console.log('CFBD Error:', response.status);
    return;
  }

  const games = await response.json();
  console.log('2024 Postseason Games from CFBD:', games.length);

  // Filter to upcoming (after today)
  const now = new Date();
  const upcoming = games.filter((g: any) => new Date(g.startDate) > now);
  console.log('Upcoming games:', upcoming.length);

  console.log('\n--- Upcoming Bowl Games ---');
  for (const g of upcoming) {
    const date = g.startDate ? new Date(g.startDate).toLocaleDateString() : 'TBD';
    const time = g.startDate ? new Date(g.startDate).toLocaleTimeString() : '';
    console.log(`${date} ${time}: ${g.awayTeam || 'TBD'} vs ${g.homeTeam || 'TBD'}`);
    if (g.notes) console.log(`  Bowl: ${g.notes}`);
  }

  // Check for games with betting lines
  console.log('\n--- Checking for betting lines ---');
  const linesResponse = await fetch(
    'https://apinext.collegefootballdata.com/lines?year=2024&seasonType=postseason',
    {
      headers: {
        'Authorization': `Bearer ${CFBD_API_KEY}`,
        'Accept': 'application/json',
      },
    }
  );

  if (linesResponse.ok) {
    const lines = await linesResponse.json();
    const upcomingWithLines = lines.filter((g: any) => {
      const gameDate = new Date(g.startDate);
      return gameDate > now && g.lines && g.lines.length > 0;
    });
    console.log('Upcoming games with lines:', upcomingWithLines.length);

    for (const g of upcomingWithLines.slice(0, 10)) {
      const bestLine = g.lines.find((l: any) => l.provider === 'consensus') || g.lines[0];
      if (bestLine) {
        console.log(`${g.awayTeam} @ ${g.homeTeam}: spread ${bestLine.spread}, total ${bestLine.overUnder}`);
      }
    }
  }
}

main().catch(console.error);

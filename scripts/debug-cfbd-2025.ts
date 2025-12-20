import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

async function main() {
  const cfbd = getCFBDApiClient();

  console.log('=== ARMY 2025 GAMES ===\n');

  try {
    const games = await cfbd.getGames(2025);
    const armyGames = games.filter(
      (g) => g.homeTeam === 'Army' || g.awayTeam === 'Army'
    );

    console.log('Army 2025 games found:', armyGames.length);

    let wins = 0;
    let losses = 0;

    for (const g of armyGames) {
      const isHome = g.homeTeam === 'Army';
      const armyScore = isHome ? g.homePoints : g.awayPoints;
      const oppScore = isHome ? g.awayPoints : g.homePoints;
      const opp = isHome ? g.awayTeam : g.homeTeam;

      if (armyScore === null || armyScore === undefined) {
        console.log(`Week ${g.week}: vs ${opp} - NOT PLAYED`);
      } else {
        const result =
          armyScore > oppScore ? 'W' : armyScore < oppScore ? 'L' : 'T';
        if (armyScore > oppScore) wins++;
        else if (armyScore < oppScore) losses++;
        console.log(`Week ${g.week}: vs ${opp} ${armyScore}-${oppScore} (${result})`);
      }
    }

    console.log(`\nArmy 2025 Record: ${wins}-${losses}`);
  } catch (e) {
    console.log('Error:', e);
  }

  // Get the Elo data directly
  console.log('\n=== ELO CHECK ===\n');

  try {
    const elo2025 = await cfbd.getEloRatings(2025);
    const army2025 = elo2025.find((d) => d.team === 'Army');
    console.log('Army 2025 Elo (CFBD):', army2025?.elo || 'N/A');

    const elo2024 = await cfbd.getEloRatings(2024);
    const army2024 = elo2024.find((d) => d.team === 'Army');
    console.log('Army 2024 Elo (CFBD):', army2024?.elo || 'N/A');
  } catch (e) {
    console.log('Elo error:', e);
  }
}

main().catch(console.error);

/**
 * Create tables and sync CFBD betting lines + Elo
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const CFBD_API_KEY = process.env.CFBD_API_KEY || '';

async function cfbdFetch(endpoint: string) {
  const response = await fetch(`https://apinext.collegefootballdata.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${CFBD_API_KEY}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`CFBD API error: ${response.status}`);
  }
  return response.json();
}

async function syncBettingLines() {
  console.log('=== SYNCING CFBD BETTING LINES ===\n');

  const allRows: any[] = [];

  for (const season of [2021, 2022, 2023, 2024]) {
    console.log(`Season ${season}...`);

    for (let week = 1; week <= 16; week++) {
      try {
        const data = await cfbdFetch(`/lines?year=${season}&week=${week}`);
        for (const game of data || []) {
          const line = (game.lines || []).find((l: any) =>
            l.spread !== null && (l.provider === 'Bovada' || l.provider === 'ESPN Bet')
          ) || (game.lines || []).find((l: any) => l.spread !== null);

          if (!line) continue;

          allRows.push({
            cfbd_game_id: game.id,
            season: game.season,
            week: game.week,
            home_team: game.homeTeam,
            away_team: game.awayTeam,
            home_score: game.homeScore,
            away_score: game.awayScore,
            spread_open: line.spreadOpen,
            spread_close: line.spread,
            total_open: line.overUnderOpen,
            total_close: line.overUnder,
            provider: line.provider,
          });
        }
      } catch (e) {
        // Week doesn't exist
      }
      await new Promise(r => setTimeout(r, 50));
    }

    // Postseason
    try {
      const post = await cfbdFetch(`/lines?year=${season}&seasonType=postseason`);
      for (const game of post || []) {
        const line = (game.lines || []).find((l: any) =>
          l.spread !== null && (l.provider === 'Bovada' || l.provider === 'ESPN Bet')
        ) || (game.lines || []).find((l: any) => l.spread !== null);

        if (!line) continue;

        allRows.push({
          cfbd_game_id: game.id,
          season: game.season,
          week: game.week || 99,
          home_team: game.homeTeam,
          away_team: game.awayTeam,
          home_score: game.homeScore,
          away_score: game.awayScore,
          spread_open: line.spreadOpen,
          spread_close: line.spread,
          total_open: line.overUnderOpen,
          total_close: line.overUnder,
          provider: line.provider,
        });
      }
    } catch (e) {}
  }

  console.log(`Total lines: ${allRows.length}`);

  // Delete existing
  await supabase.from('cfbd_betting_lines').delete().gte('season', 2021);

  // Insert in batches
  for (let i = 0; i < allRows.length; i += 500) {
    const batch = allRows.slice(i, i + 500);
    const { error } = await supabase.from('cfbd_betting_lines').insert(batch);
    if (error) console.log(`Insert error: ${error.message}`);
    process.stdout.write(`\r  Inserted ${Math.min(i + 500, allRows.length)}/${allRows.length}`);
  }
  console.log('\n');

  return allRows.length;
}

async function syncEloRatings() {
  console.log('=== SYNCING CFBD ELO RATINGS ===\n');

  const allRows: any[] = [];

  for (const season of [2021, 2022, 2023, 2024]) {
    const data = await cfbdFetch(`/ratings/elo?year=${season}`);
    console.log(`Season ${season}: ${data.length} teams`);

    for (const r of data) {
      allRows.push({
        season,
        team_name: r.team,
        conference: r.conference,
        elo: r.elo,
      });
    }
  }

  // Delete existing
  await supabase.from('cfbd_elo_ratings').delete().gte('season', 2021);

  // Insert
  const { error } = await supabase.from('cfbd_elo_ratings').insert(allRows);
  if (error) console.log(`Insert error: ${error.message}`);

  console.log(`Inserted ${allRows.length} Elo ratings\n`);

  return allRows.length;
}

async function main() {
  const lines = await syncBettingLines();
  const elo = await syncEloRatings();

  console.log('=== SYNC COMPLETE ===');
  console.log(`Betting lines: ${lines}`);
  console.log(`Elo ratings: ${elo}`);

  // Quick stats
  const { data: withBoth } = await supabase
    .from('cfbd_betting_lines')
    .select('cfbd_game_id')
    .not('spread_open', 'is', null)
    .not('spread_close', 'is', null);

  console.log(`\nGames with both open & close spread: ${withBoth?.length || 0}`);
}

main().catch(console.error);

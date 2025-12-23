/**
 * Rebuild CBB Elo ratings from scratch
 * Fixes the bug where 0-0 games were treated as ties
 */

import { createClient } from '@supabase/supabase-js';
import { CbbEloSystem } from '../src/lib/models/cbb-elo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function rebuild() {
  const season = 2026;
  console.log(`\n=== Rebuilding CBB Elo for season ${season} ===\n`);

  const elo = new CbbEloSystem();

  // Get all COMPLETED games (score != 0-0)
  const { data: games, error } = await supabase
    .from('cbb_games')
    .select('id, start_date, home_team_id, away_team_id, home_team_name, away_team_name, home_score, away_score')
    .eq('season', season)
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Processing ${games?.length} completed D1 games...\n`);

  // Process in chronological order
  let processed = 0;
  for (const game of games || []) {
    const before = {
      home: elo.getElo(game.home_team_id),
      away: elo.getElo(game.away_team_id),
    };

    const changes = elo.update(
      game.home_team_id,
      game.away_team_id,
      game.home_score,
      game.away_score
    );

    processed++;

    // Log some updates for verification
    if (processed <= 5 || processed % 200 === 0) {
      console.log(`${game.away_team_name} @ ${game.home_team_name}`);
      console.log(`  Score: ${game.away_score}-${game.home_score}`);
      console.log(`  Home: ${before.home.toFixed(0)} → ${elo.getElo(game.home_team_id).toFixed(0)} (${changes.homeEloChange >= 0 ? '+' : ''}${changes.homeEloChange.toFixed(1)})`);
      console.log(`  Away: ${before.away.toFixed(0)} → ${elo.getElo(game.away_team_id).toFixed(0)} (${changes.awayEloChange >= 0 ? '+' : ''}${changes.awayEloChange.toFixed(1)})`);
      console.log();
    }
  }

  console.log(`\nProcessed ${processed} games`);

  // Save to database
  const ratings = elo.getAllRatings();
  console.log(`Saving ${ratings.length} team ratings...`);

  const snapshots = ratings.map(r => ({
    team_id: r.teamId,
    season,
    games_played: r.gamesPlayed,
    elo: r.elo,
    updated_at: new Date().toISOString(),
  }));

  // Delete existing and insert fresh
  await supabase.from('cbb_elo_snapshots').delete().eq('season', season);

  const { error: insertError } = await supabase
    .from('cbb_elo_snapshots')
    .insert(snapshots);

  if (insertError) {
    console.error('Insert error:', insertError);
  } else {
    console.log(`Saved ${ratings.length} ratings`);
  }

  // Show top 20 teams by Elo
  console.log('\n=== TOP 20 TEAMS BY ELO ===\n');
  const sorted = ratings.sort((a, b) => b.elo - a.elo).slice(0, 20);

  // Get team names
  const teamIds = sorted.map(r => r.teamId);
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, name, conference')
    .in('id', teamIds);

  const teamMap = new Map(teams?.map(t => [t.id, t]) || []);

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const team = teamMap.get(r.teamId);
    console.log(`${i + 1}. ${team?.name || 'Unknown'} (${team?.conference}): ${r.elo.toFixed(0)} Elo, ${r.gamesPlayed} games`);
  }

  // Show some specific teams from our losing bets
  console.log('\n=== TEAMS FROM OUR BETS ===\n');
  const checkTeams = ['Wichita State', 'Eastern Kentucky', 'UAB', 'UNC Asheville', 'Harvard', 'Holy Cross'];
  for (const name of checkTeams) {
    const team = teams?.find(t => t.name === name);
    if (team) {
      const rating = ratings.find(r => r.teamId === team.id);
      if (rating) {
        console.log(`${name}: ${rating.elo.toFixed(0)} Elo, ${rating.gamesPlayed} games`);
      }
    }
  }
}

rebuild().catch(console.error);

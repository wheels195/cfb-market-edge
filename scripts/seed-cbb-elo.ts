/**
 * Seed CBB Elo Ratings
 *
 * Processes all historical games to build current Elo ratings.
 * Stores snapshots in cbb_elo_snapshots table.
 *
 * Usage:
 *   npx tsx scripts/seed-cbb-elo.ts [--from-season YYYY] [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import { CbbEloSystem, CBB_ELO_CONSTANTS } from '../src/lib/models/cbb-elo';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface Game {
  id: string;
  season: number;
  start_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

async function fetchAllGames(fromSeason: number = 2020): Promise<Game[]> {
  console.log(`Fetching games from season ${fromSeason}...`);

  const PAGE_SIZE = 1000;
  let allGames: Game[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('cbb_games')
      .select('id, season, start_date, home_team_id, away_team_id, home_score, away_score')
      .gte('season', fromSeason)
      .not('home_score', 'is', null)
      .not('away_team_id', 'is', null)
      .order('start_date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching games:', error);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allGames = allGames.concat(data as Game[]);
      offset += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMore = false;
    }

    if (offset % 5000 === 0) {
      console.log(`  Fetched ${allGames.length} games...`);
    }
  }

  return allGames;
}

async function saveEloSnapshots(
  elo: CbbEloSystem,
  season: number,
  dryRun: boolean
): Promise<number> {
  const ratings = elo.getAllRatings();

  if (dryRun) {
    console.log(`  [DRY RUN] Would save ${ratings.length} snapshots for season ${season}`);
    return ratings.length;
  }

  // Build upsert data - filter out null/undefined team IDs
  const snapshots = ratings
    .filter(r => r.teamId && r.teamId !== 'null' && r.teamId !== 'undefined')
    .map(r => ({
      team_id: r.teamId,
      season,
      games_played: r.gamesPlayed,
      elo: r.elo,
      updated_at: new Date().toISOString(),
    }));

  // Batch upsert
  const BATCH_SIZE = 500;
  let saved = 0;

  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('cbb_elo_snapshots')
      .upsert(batch, {
        onConflict: 'team_id,season',
      });

    if (error) {
      console.error(`  Error saving batch:`, error);
    } else {
      saved += batch.length;
    }
  }

  return saved;
}

async function main() {
  const args = process.argv.slice(2);
  const fromSeason = args.includes('--from-season')
    ? parseInt(args[args.indexOf('--from-season') + 1])
    : 2020;
  const dryRun = args.includes('--dry-run');

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║            CBB ELO SEEDING                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  if (dryRun) {
    console.log('*** DRY RUN MODE - No changes will be saved ***\n');
  }

  console.log(`Configuration:`);
  console.log(`  From Season: ${fromSeason}`);
  console.log(`  K-Factor: ${CBB_ELO_CONSTANTS.K_FACTOR}`);
  console.log(`  Home Advantage: ${CBB_ELO_CONSTANTS.HOME_ADVANTAGE}`);
  console.log(`  Season Carryover: ${CBB_ELO_CONSTANTS.SEASON_CARRYOVER * 100}%\n`);

  // Fetch all games
  const games = await fetchAllGames(fromSeason);
  console.log(`\nLoaded ${games.length} completed games\n`);

  // Group by season
  const gamesBySeason = new Map<number, Game[]>();
  for (const g of games) {
    if (!gamesBySeason.has(g.season)) {
      gamesBySeason.set(g.season, []);
    }
    gamesBySeason.get(g.season)!.push(g);
  }

  const seasons = Array.from(gamesBySeason.keys()).sort();
  console.log(`Seasons: ${seasons.join(', ')}\n`);

  // Process games chronologically
  const elo = new CbbEloSystem();
  let totalGamesProcessed = 0;

  for (const season of seasons) {
    const seasonGames = gamesBySeason.get(season)!;
    seasonGames.sort((a, b) =>
      new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
    );

    // Reset for new season (with carryover)
    if (season > seasons[0]) {
      elo.resetSeason();
    }

    console.log(`Season ${season}: ${seasonGames.length} games`);

    // Process each game
    for (const game of seasonGames) {
      elo.update(
        game.home_team_id,
        game.away_team_id,
        game.home_score,
        game.away_score
      );
      totalGamesProcessed++;
    }

    // Save snapshot at end of season (or current point)
    const saved = await saveEloSnapshots(elo, season, dryRun);
    console.log(`  → Saved ${saved} team snapshots`);

    // Show top/bottom teams
    const ratings = elo.getAllRatings()
      .filter(r => r.gamesPlayed >= 5)
      .sort((a, b) => b.elo - a.elo);

    if (ratings.length > 0) {
      console.log(`  Top 5: ${ratings.slice(0, 5).map(r => `${r.elo.toFixed(0)}`).join(', ')}`);
      console.log(`  Bottom 5: ${ratings.slice(-5).map(r => `${r.elo.toFixed(0)}`).join(', ')}`);
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Total games processed: ${totalGamesProcessed}`);
  console.log(`Final teams with ratings: ${elo.getAllRatings().length}`);

  // Show current season summary
  const currentSeason = seasons[seasons.length - 1];
  const currentRatings = elo.getAllRatings()
    .filter(r => r.gamesPlayed >= 5)
    .sort((a, b) => b.elo - a.elo);

  console.log(`\nSeason ${currentSeason} - Top 20 by Elo:`);

  // Get team names
  const teamIds = currentRatings.slice(0, 20).map(r => r.teamId);
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, name')
    .in('id', teamIds);

  const teamNames = new Map(teams?.map(t => [t.id, t.name]) || []);

  for (let i = 0; i < Math.min(20, currentRatings.length); i++) {
    const r = currentRatings[i];
    const name = teamNames.get(r.teamId) || 'Unknown';
    console.log(`  ${(i + 1).toString().padStart(2)}. ${name.padEnd(25)} ${r.elo.toFixed(0)} (${r.gamesPlayed} games)`);
  }

  if (!dryRun) {
    console.log('\nElo seeding complete!');
  } else {
    console.log('\n[DRY RUN] No changes were saved');
  }
}

main().catch(console.error);

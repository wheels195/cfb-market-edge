/**
 * Run CBB match odds to games job
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface MatchOddsResult {
  ticksProcessed: number;
  gamesMatched: number;
  linesWritten: number;
  errors: string[];
}

/**
 * Normalize team name for matching
 */
function normalizeTeamName(name: string): string {
  // Common mascot patterns to remove
  const mascots = [
    'Wildcats', 'Tigers', 'Bears', 'Lions', 'Eagles', 'Hawks', 'Owls',
    'Panthers', 'Bulldogs', 'Huskies', 'Bruins', 'Cardinals', 'Hornets',
    'Spartans', 'Trojans', 'Gators', 'Seminoles', 'Wolverines', 'Buckeyes',
    'Red Storm', 'Blue Devils', 'Tar Heels', 'Orange', 'Yellow Jackets',
    'Commodores', 'Razorbacks', 'Fighting Illini', 'Hoosiers', 'Badgers',
    'Boilermakers', 'Hawkeyes', 'Nittany Lions', 'Mountaineers', 'Jayhawks',
    'Cyclones', 'Cornhuskers', 'Cowboys', 'Cougars', 'Ducks', 'Sun Devils',
    'Buffaloes', 'Utes', 'Waves', 'Toreros', 'Broncos', 'Aztecs', 'Rebels',
    'Aggies', 'Zips', 'Rockets', 'Bobcats', 'Redhawks', 'Bearcats', 'Flyers',
    'Musketeers', 'Friars', 'Pirates', 'Hoyas', 'Explorers', 'Colonels',
    'Midshipmen', 'Cadets', 'Knights', 'Thundering Herd', 'Golden Eagles',
    'Roadrunners', 'Matadors', 'Phoenix', 'Anteaters', 'Highlanders',
    'Hatters', 'Camels', 'Fighting Camels', 'Gaels', 'Thunderbirds',
    'Vandals', 'Mavericks'
  ];

  let normalized = name;
  for (const mascot of mascots) {
    normalized = normalized.replace(new RegExp(`\\s+${mascot}$`, 'i'), '');
  }

  // Apply specific name mappings
  const nameMap: Record<string, string> = {
    'csu bakersfield': 'cal state bakersfield',
    'csu northridge': 'cal state northridge',
    'ucf': 'ucf',
    'florida atlantic': 'florida atlantic',
    'sacramento st': 'sacramento state',
    'idaho': 'idaho',
    'oral roberts': 'oral roberts',
    'ut-arlington': 'ut arlington',
    "saint mary's": "saint mary's",
  };

  const lower = normalized.toLowerCase();
  for (const [key, val] of Object.entries(nameMap)) {
    if (lower === key) {
      return val;
    }
  }

  return normalized.trim();
}

async function main() {
  console.log('=== Matching CBB Odds to Games ===\n');

  const result: MatchOddsResult = {
    ticksProcessed: 0,
    gamesMatched: 0,
    linesWritten: 0,
    errors: [],
  };

  // Get recent odds ticks
  const { data: ticks, error: tickError } = await supabase
    .from('cbb_odds_ticks')
    .select('event_id, home_team, away_team, commence_time, spread_home, captured_at')
    .gte('commence_time', new Date().toISOString())
    .order('captured_at', { ascending: false });

  if (tickError) {
    console.error('Error fetching ticks:', tickError);
    return;
  }

  console.log(`Found ${ticks?.length || 0} odds ticks with upcoming games\n`);

  // Get all upcoming games
  const now = new Date();
  const future = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const { data: games, error: gameError } = await supabase
    .from('cbb_games')
    .select('id, cbbd_game_id, home_team_name, away_team_name, start_date')
    .gte('start_date', now.toISOString())
    .lte('start_date', future.toISOString())
    .eq('home_score', 0)
    .eq('away_score', 0);

  if (gameError) {
    console.error('Error fetching games:', gameError);
    return;
  }

  console.log(`Found ${games?.length || 0} upcoming games\n`);

  // Build lookup map with normalized names
  const gameMap = new Map<string, typeof games[0]>();
  for (const game of games || []) {
    const homeNorm = normalizeTeamName(game.home_team_name).toLowerCase();
    const awayNorm = normalizeTeamName(game.away_team_name).toLowerCase();
    const key = `${homeNorm}|${awayNorm}`;
    gameMap.set(key, game);
  }

  // Match ticks to games
  const matched: Array<{ tick: any; game: any }> = [];
  const unmatched: string[] = [];

  for (const tick of ticks || []) {
    result.ticksProcessed++;

    const homeNorm = normalizeTeamName(tick.home_team).toLowerCase();
    const awayNorm = normalizeTeamName(tick.away_team).toLowerCase();
    const key = `${homeNorm}|${awayNorm}`;

    let game = gameMap.get(key);

    // Try fuzzy matching if exact match fails
    if (!game) {
      for (const [gameKey, g] of gameMap) {
        const [gHome, gAway] = gameKey.split('|');
        if (
          (gHome.includes(homeNorm) || homeNorm.includes(gHome)) &&
          (gAway.includes(awayNorm) || awayNorm.includes(gAway))
        ) {
          game = g;
          break;
        }
      }
    }

    if (!game) {
      // Try matching just the first word of each team
      const homeFirst = homeNorm.split(' ')[0];
      const awayFirst = awayNorm.split(' ')[0];
      for (const [gameKey, g] of gameMap) {
        const [gHome, gAway] = gameKey.split('|');
        if (gHome.startsWith(homeFirst) && gAway.startsWith(awayFirst)) {
          game = g;
          break;
        }
      }
    }

    if (game) {
      result.gamesMatched++;
      matched.push({ tick, game });

      // Delete existing then insert (no unique constraint on game_id)
      await supabase
        .from('cbb_betting_lines')
        .delete()
        .eq('game_id', game.id);

      const { error: insertError } = await supabase
        .from('cbb_betting_lines')
        .insert({
          game_id: game.id,
          cbbd_game_id: game.cbbd_game_id,
          spread_home: tick.spread_home,
          provider: 'draftkings',
        });

      if (insertError) {
        result.errors.push(`Game ${game.id}: ${insertError.message}`);
      } else {
        result.linesWritten++;
      }
    } else {
      unmatched.push(`${tick.away_team} @ ${tick.home_team}`);
    }
  }

  console.log('=== Results ===');
  console.log(`Ticks processed: ${result.ticksProcessed}`);
  console.log(`Games matched: ${result.gamesMatched}`);
  console.log(`Lines written: ${result.linesWritten}`);
  console.log(`Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  ${err}`);
    }
  }

  console.log('\n=== Matched Games ===');
  for (const { tick, game } of matched.slice(0, 20)) {
    console.log(`  "${tick.away_team} @ ${tick.home_team}" -> "${game.away_team_name} @ ${game.home_team_name}" (spread: ${tick.spread_home})`);
  }

  if (unmatched.length > 0) {
    console.log('\n=== Unmatched Ticks ===');
    for (const u of unmatched.slice(0, 10)) {
      console.log(`  ${u}`);
    }
  }
}

main().catch(console.error);

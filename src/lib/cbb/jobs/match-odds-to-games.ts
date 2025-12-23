/**
 * CBB Match Odds to Games Job
 *
 * Matches odds from cbb_odds_ticks to games in cbb_games
 * and populates cbb_betting_lines for the materialize-edges job.
 */

import { supabase } from '@/lib/db/client';

export interface MatchOddsResult {
  ticksProcessed: number;
  gamesMatched: number;
  linesWritten: number;
  errors: string[];
}

/**
 * Normalize team name for matching
 * Removes mascot names and standardizes abbreviations
 */
function normalizeTeamName(name: string): string {
  // Common mascot patterns to remove
  const mascots = [
    'Wildcats', 'Tigers', 'Bears', 'Lions', 'Eagles', 'Hawks', 'Owls',
    'Panthers', 'Bulldogs', 'Huskies', 'Bruins', 'Cardinals', 'Hornets',
    'Spartans', 'Trojans', 'Gators', 'Seminoles', 'Wolverines', 'Buckeyes',
    'Fighting Irish', 'Volunteers', 'Crimson Tide', 'Longhorns', 'Sooners',
    'Red Storm', 'Blue Devils', 'Tar Heels', 'Orange', 'Yellow Jackets',
    'Commodores', 'Razorbacks', 'Fighting Illini', 'Hoosiers', 'Badgers',
    'Boilermakers', 'Hawkeyes', 'Nittany Lions', 'Mountaineers', 'Jayhawks',
    'Cyclones', 'Cornhuskers', 'Cowboys', 'Cougars', 'Ducks', 'Sun Devils',
    'Buffaloes', 'Utes', 'Rainmakers', 'Waves', 'Toreros', 'Broncos',
    'Aztecs', 'Rebels', 'Aggies', 'Zips', 'Rockets', 'Bobcats', 'Redhawks',
    'Bearcats', 'Flyers', 'Musketeers', 'Friars', 'Pirates', 'Hoyas',
    'Explorers', 'Colonels', 'Midshipmen', 'Cadets', 'Knights',
    'Thundering Herd', 'Golden Eagles', 'Roadrunners', 'Matadors', 'Phoenix',
    'Anteaters', 'Highlanders', 'Hatters', 'Camels', 'Fighting Camels',
    'Gaels', 'Thunderbirds', 'Vandals', 'Mavericks'
  ];

  let normalized = name;
  for (const mascot of mascots) {
    normalized = normalized.replace(new RegExp(`\\s+${mascot}$`, 'i'), '');
  }

  // Common abbreviation mappings
  const abbrevMap: Record<string, string> = {
    'st.': 'State',
    'st ': 'State ',
    'csu ': 'Cal State ',
    'uc ': 'UC ',
    'morgan st': 'Morgan State',
    'missouri st': 'Missouri State',
    'grambling st': 'Grambling',
    'sacramento st': 'Sacramento State',
    'norfolk st': 'Norfolk State',
    "st. john's": "St. John's",
    'csu bakersfield': 'Cal State Bakersfield',
    'csu northridge': 'Cal State Northridge',
    'northern iowa': 'Northern Iowa',
    "saint mary's": "Saint Mary's",
    'maryland-eastern shore': 'Maryland Eastern Shore',
  };

  const lowerNormalized = normalized.toLowerCase();
  for (const [abbrev, full] of Object.entries(abbrevMap)) {
    if (lowerNormalized.includes(abbrev)) {
      normalized = normalized.replace(new RegExp(abbrev, 'i'), full);
    }
  }

  return normalized.trim();
}

/**
 * Match odds ticks to games and populate betting lines
 */
export async function matchOddsToGames(): Promise<MatchOddsResult> {
  const result: MatchOddsResult = {
    ticksProcessed: 0,
    gamesMatched: 0,
    linesWritten: 0,
    errors: [],
  };

  try {
    // Get recent odds ticks
    const { data: ticks, error: tickError } = await supabase
      .from('cbb_odds_ticks')
      .select('event_id, home_team, away_team, commence_time, spread_home, captured_at')
      .gte('commence_time', new Date().toISOString())
      .order('captured_at', { ascending: false });

    if (tickError) {
      result.errors.push(`Error fetching ticks: ${tickError.message}`);
      return result;
    }

    console.log(`Processing ${ticks?.length || 0} odds ticks`);

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
      result.errors.push(`Error fetching games: ${gameError.message}`);
      return result;
    }

    console.log(`Found ${games?.length || 0} upcoming games`);

    // Build lookup map with normalized names
    const gameMap = new Map<string, typeof games[0]>();
    for (const game of games || []) {
      const homeNorm = normalizeTeamName(game.home_team_name).toLowerCase();
      const awayNorm = normalizeTeamName(game.away_team_name).toLowerCase();
      const key = `${homeNorm}|${awayNorm}`;
      gameMap.set(key, game);
    }

    // Match ticks to games
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
      }
    }

    console.log(`Matched ${result.gamesMatched} games, wrote ${result.linesWritten} lines`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Job error: ${message}`);
  }

  return result;
}

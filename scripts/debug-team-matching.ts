/**
 * Debug script to compare team names between DB and Odds API
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

// Map common school name variations
const SCHOOL_ALIASES: Record<string, string> = {
  'app state': 'appalachian state',
  'appalachian state mountaineers': 'appalachian state',
  'ole miss': 'mississippi',
  'ole miss rebels': 'mississippi',
  'miami hurricanes': 'miami',
  'lsu': 'louisiana state',
  'lsu tigers': 'louisiana state',
  'ucf': 'central florida',
  'ucf knights': 'central florida',
  'smu': 'southern methodist',
  'smu mustangs': 'southern methodist',
  'tcu': 'texas christian',
  'tcu horned frogs': 'texas christian',
  'utsa': 'texas san antonio',
  'utsa roadrunners': 'texas san antonio',
  'utep': 'texas el paso',
  'utep miners': 'texas el paso',
  'umass': 'massachusetts',
  'umass minutemen': 'massachusetts',
  'pitt': 'pittsburgh',
  'pitt panthers': 'pittsburgh',
};

const MASCOTS = [
  'crimson tide', 'fighting irish', 'buckeyes', 'nittany lions', 'golden gophers',
  'wolverines', 'spartans', 'hawkeyes', 'badgers', 'boilermakers', 'longhorns',
  'sooners', 'aggies', 'ducks', 'trojans', 'bruins', 'seminoles', 'hurricanes',
  'gators', 'volunteers', 'razorbacks', 'rebels', 'bulldogs', 'tigers', 'wildcats',
  'bears', 'horned frogs', 'jayhawks', 'cyclones', 'mountaineers', 'red raiders',
  'cougars', 'bearcats', 'knights', 'panthers', 'cardinals', 'orange', 'wolfpack',
  'tar heels', 'blue devils', 'yellow jackets', 'demon deacons', 'cavaliers',
  'hokies', 'eagles', 'owls', 'chanticleers', 'thundering herd', 'rockets',
  'redhawks', 'zips', 'bulls', 'bobcats', 'chippewas', 'huskies', 'broncos',
  'flames', 'monarchs', 'falcons', 'mean green', 'roadrunners', 'blazers',
  'golden eagles', 'pirates', 'jaguars', 'aztecs', 'lobos', 'rams', 'wolf pack',
  'miners', 'beavers', 'mustangs', 'minutemen', 'golden flashes', 'midshipmen',
  'scarlet knights', 'terrapins', 'gamecocks', 'commodores', 'fighting illini',
  'hoosiers', 'cornhuskers', 'green wave', 'blue hens', 'warhawks', 'utes'
];

function normalizeTeam(name: string): string {
  let normalized = name.toLowerCase().trim();

  if (SCHOOL_ALIASES[normalized]) {
    return SCHOOL_ALIASES[normalized];
  }

  for (const mascot of MASCOTS) {
    if (normalized.endsWith(' ' + mascot)) {
      normalized = normalized.slice(0, -(mascot.length + 1)).trim();
      break;
    }
  }

  if (SCHOOL_ALIASES[normalized]) {
    return SCHOOL_ALIASES[normalized];
  }

  return normalized;
}

async function test() {
  // Get sample events from Sept 3 2022
  const { data: events } = await supabase
    .from('events')
    .select(`id, commence_time, home_team:home_team_id(name), away_team:away_team_id(name)`)
    .eq('status', 'final')
    .gte('commence_time', '2022-09-03T00:00:00Z')
    .lt('commence_time', '2022-09-04T00:00:00Z')
    .limit(10);

  console.log('Sample DB events for 2022-09-03:\n');
  for (const e of events || []) {
    const homeName = (e.home_team as any)?.name || 'Unknown';
    const awayName = (e.away_team as any)?.name || 'Unknown';
    console.log(`  DB: ${awayName} @ ${homeName}`);
    console.log(`  Normalized: "${normalizeTeam(awayName)}" @ "${normalizeTeam(homeName)}"\n`);
  }

  // Get sample from Odds API
  const url = `https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&bookmakers=draftkings&date=2022-09-03T12:00:00Z`;
  const res = await fetch(url);
  const data = await res.json();

  console.log('\nSample Odds API games for 2022-09-03:\n');
  for (const g of data.data?.slice(0, 10) || []) {
    console.log(`  API: ${g.away_team} @ ${g.home_team}`);
    console.log(`  Normalized: "${normalizeTeam(g.away_team)}" @ "${normalizeTeam(g.home_team)}"\n`);
  }
}

test().catch(console.error);

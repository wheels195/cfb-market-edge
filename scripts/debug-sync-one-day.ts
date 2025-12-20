/**
 * Debug: sync one day to see what's happening
 */
import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

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

function teamsMatch(dbHome: string, dbAway: string, apiHome: string, apiAway: string): boolean {
  const dbH = normalizeTeam(dbHome);
  const dbA = normalizeTeam(dbAway);
  const apiH = normalizeTeam(apiHome);
  const apiA = normalizeTeam(apiAway);

  // Exact match
  if (dbH === apiH && dbA === apiA) return true;

  // Substring match - one must contain the other entirely
  const homeMatch = dbH === apiH || dbH.includes(apiH) || apiH.includes(dbH);
  const awayMatch = dbA === apiA || dbA.includes(apiA) || apiA.includes(dbA);

  if (homeMatch && awayMatch) return true;

  // Stricter word matching: first significant word must match exactly
  const getFirstWord = (s: string) => s.split(' ').find(w => w.length > 2) || s;
  const homeFirstMatch = getFirstWord(dbH) === getFirstWord(apiH);
  const awayFirstMatch = getFirstWord(dbA) === getFirstWord(apiA);

  return homeFirstMatch && awayFirstMatch;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function hashPayload(data: Record<string, unknown>): string {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').slice(0, 8);
}

async function test() {
  // Get DK sportsbook
  const { data: sb } = await supabase.from('sportsbooks').select('id').eq('key', 'draftkings').single();
  const dkId = sb?.id;
  console.log('DraftKings ID:', dkId);

  // Get events from Sept 3, 2022
  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team:home_team_id(name),
      away_team:away_team_id(name)
    `)
    .eq('status', 'final')
    .gte('commence_time', '2022-09-03T00:00:00Z')
    .lt('commence_time', '2022-09-04T00:00:00Z')
    .limit(20);

  console.log(`\nFound ${events?.length} DB events for 2022-09-03\n`);

  // Fetch odds API data
  const url = `https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&bookmakers=draftkings&date=2022-09-03T12:00:00Z`;
  const res = await fetch(url);
  const oddsData = await res.json();

  console.log(`Found ${oddsData.data?.length} API games\n`);

  // Try to match each DB event
  let matched = 0;
  let synced = 0;

  for (const event of events || []) {
    const homeName = (event.home_team as any)?.name || 'Unknown';
    const awayName = (event.away_team as any)?.name || 'Unknown';

    const dbHomeNorm = normalizeTeam(homeName);
    const dbAwayNorm = normalizeTeam(awayName);

    console.log(`DB: ${awayName} @ ${homeName}`);
    console.log(`  Normalized: "${dbAwayNorm}" @ "${dbHomeNorm}"`);

    // Find match
    const match = oddsData.data?.find((g: any) => teamsMatch(homeName, awayName, g.home_team, g.away_team));

    if (match) {
      matched++;
      console.log(`  MATCHED: ${match.away_team} @ ${match.home_team}`);

      const dk = match.bookmakers?.find((b: any) => b.key === 'draftkings');
      const spreads = dk?.markets?.find((m: any) => m.key === 'spreads');

      if (spreads?.outcomes?.length) {
        console.log(`  Spreads found: ${spreads.outcomes.length} outcomes`);

        // Find home outcome
        const homeOutcome = spreads.outcomes.find((o: any) => {
          const oNorm = normalizeTeam(o.name);
          return oNorm === dbHomeNorm ||
            oNorm.includes(dbHomeNorm) ||
            dbHomeNorm.includes(oNorm) ||
            oNorm.split(' ').filter((w: string) => w.length > 2).some((w: string) => dbHomeNorm.includes(w)) ||
            dbHomeNorm.split(' ').filter(w => w.length > 2).some(w => oNorm.includes(w));
        });

        if (homeOutcome) {
          console.log(`  Home outcome: ${homeOutcome.name} ${homeOutcome.point} @ ${homeOutcome.price}`);

          const payloadHash = hashPayload({ t: 'close', e: event.id, s: 'home' });

          // Check if exists
          const { data: existing } = await supabase
            .from('odds_ticks')
            .select('id')
            .eq('payload_hash', payloadHash)
            .limit(1);

          if (existing?.length) {
            console.log(`  Already exists, skipping`);
          } else {
            const record = {
              event_id: event.id,
              sportsbook_id: dkId,
              market_type: 'spread',
              captured_at: oddsData.timestamp,
              side: 'home',
              spread_points_home: homeOutcome.point,
              total_points: null,
              price_american: decimalToAmerican(homeOutcome.price),
              price_decimal: homeOutcome.price,
              payload_hash: payloadHash,
              tick_type: 'close',
            };

            const { error } = await supabase.from('odds_ticks').insert(record);
            if (error) {
              console.log(`  INSERT ERROR: ${error.message}`);
            } else {
              synced++;
              console.log(`  SYNCED!`);
            }
          }
        } else {
          console.log(`  No home outcome found`);
          console.log(`  Outcomes: ${spreads.outcomes.map((o: any) => o.name).join(', ')}`);
        }
      } else {
        console.log(`  No DK spreads found`);
      }
    } else {
      console.log(`  No match found`);
    }
    console.log('');
  }

  console.log(`\nSummary: ${matched} matched, ${synced} synced out of ${events?.length} events`);
}

test().catch(console.error);

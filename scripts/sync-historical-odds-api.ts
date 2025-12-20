/**
 * Sync historical betting lines from The Odds API with ACTUAL prices
 *
 * Strategy:
 * - Fetch closing lines (game day, ~4 hours before kickoff) - most reliable
 * - Fetch opening lines (game day - 3 days) when available
 *
 * This gives us actual spread prices, not assumed -110
 */
import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

interface OddsApiOutcome {
  name: string;
  price: number;
  point: number;
}

interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsApiBookmaker[];
}

interface OddsApiHistoricalResponse {
  timestamp: string;
  previous_timestamp: string;
  next_timestamp: string;
  data: OddsApiEvent[];
}

interface DBEvent {
  id: string;
  commence_time: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

let dkSportsbookId: string | null = null;
let apiCallCount = 0;

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function hashPayload(data: Record<string, unknown>): string {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').slice(0, 8);
}

async function fetchHistoricalOdds(date: string): Promise<OddsApiHistoricalResponse | null> {
  const url = `${ODDS_API_BASE}/historical/sports/americanfootball_ncaaf/odds?` +
    `apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&bookmakers=draftkings&date=${date}`;

  apiCallCount++;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 422) return null;
      console.error(`  API error: ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.error(`  Fetch error: ${err}`);
    return null;
  }
}

async function getEventsForDateRange(startDate: string, endDate: string): Promise<DBEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team:home_team_id(name),
      away_team:away_team_id(name)
    `)
    .eq('status', 'final')
    .gte('commence_time', startDate)
    .lte('commence_time', endDate)
    .order('commence_time');

  if (error) {
    console.error(`Error fetching events: ${error.message}`);
    return [];
  }

  return (data || []) as unknown as DBEvent[];
}

async function getSportsbookId(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('sportsbooks')
    .select('id')
    .eq('key', key)
    .single();
  return data?.id || null;
}

// Map common school name variations
const SCHOOL_ALIASES: Record<string, string> = {
  'app state': 'appalachian state',
  'appalachian state mountaineers': 'appalachian state',
  'appalachian state': 'appalachian state',
  'ole miss': 'mississippi',
  'ole miss rebels': 'mississippi',
  'miami (oh)': 'miami oh',
  'miami (fl)': 'miami',
  'miami hurricanes': 'miami',
  'miami redhawks': 'miami oh',
  'usc trojans': 'usc',
  'southern california': 'usc',
  'lsu': 'louisiana state',
  'lsu tigers': 'louisiana state',
  'louisiana state tigers': 'louisiana state',
  'ucf': 'central florida',
  'ucf knights': 'central florida',
  'central florida knights': 'central florida',
  'smu': 'southern methodist',
  'smu mustangs': 'southern methodist',
  'tcu': 'texas christian',
  'tcu horned frogs': 'texas christian',
  'byu': 'brigham young',
  'byu cougars': 'brigham young',
  'ul monroe': 'louisiana monroe',
  'ul monroe warhawks': 'louisiana monroe',
  'louisiana-monroe': 'louisiana monroe',
  'louisiana-lafayette': 'louisiana lafayette',
  'louisiana ragin cajuns': 'louisiana lafayette',
  'utsa': 'texas san antonio',
  'utsa roadrunners': 'texas san antonio',
  'utep': 'texas el paso',
  'utep miners': 'texas el paso',
  'umass': 'massachusetts',
  'umass minutemen': 'massachusetts',
  'uconn': 'connecticut',
  'uconn huskies': 'connecticut',
  'pitt': 'pittsburgh',
  'pitt panthers': 'pittsburgh',
  'nc state': 'north carolina state',
  'nc state wolfpack': 'north carolina state',
};

// All mascot names to strip
const MASCOTS = [
  'crimson tide', 'fighting irish', 'buckeyes', 'nittany lions', 'golden gophers',
  'wolverines', 'spartans', 'hawkeyes', 'badgers', 'boilermakers', 'hoosiers',
  'cornhuskers', 'longhorns', 'sooners', 'aggies', 'ducks', 'trojans', 'bruins',
  'seminoles', 'hurricanes', 'gators', 'volunteers', 'razorbacks', 'rebels',
  'bulldogs', 'tigers', 'wildcats', 'bears', 'horned frogs', 'jayhawks', 'cyclones',
  'mountaineers', 'red raiders', 'cougars', 'bearcats', 'knights', 'panthers',
  'cardinals', 'orange', 'wolfpack', 'tar heels', 'blue devils', 'yellow jackets',
  'demon deacons', 'cavaliers', 'hokies', 'eagles', 'owls', 'chanticleers',
  'thundering herd', 'rockets', 'redhawks', 'zips', 'bulls', 'bobcats', 'chippewas',
  'huskies', 'broncos', 'flames', 'monarchs', 'falcons', 'mean green', 'roadrunners',
  'blazers', 'golden eagles', '49ers', 'pirates', 'jaguars', 'mocs', 'runnin bulldogs',
  'beach', 'rainbow warriors', 'aztecs', 'lobos', 'rams', 'wolf pack', 'miners',
  'beavers', 'mustangs', 'minutemen', 'golden flashes', 'midshipmen', 'scarlet knights',
  'terrapins', 'gamecocks', 'commodores', 'fighting illini', 'fighting hawks',
  'salukis', 'jackrabbits', 'red wolves', 'ragin cajuns', 'warhawks', 'hilltoppers',
  'vandals', 'runnin\' utes', 'utes', 'sun devils', 'black knights', 'penguins',
  'leathernecks', 'racers', 'colonels', 'governors', 'skyhawks', 'redhawks',
  'golden hurricane', 'green wave', 'blue hens', 'spiders', 'billikens'
];

function normalizeTeam(name: string): string {
  let normalized = name.toLowerCase().trim();

  // Check alias first
  if (SCHOOL_ALIASES[normalized]) {
    return SCHOOL_ALIASES[normalized];
  }

  // Strip mascots from end
  for (const mascot of MASCOTS) {
    if (normalized.endsWith(' ' + mascot)) {
      normalized = normalized.slice(0, -(mascot.length + 1)).trim();
      break;
    }
  }

  // Check alias again after stripping mascot
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

  // If both substring match, good
  if (homeMatch && awayMatch) return true;

  // Stricter word matching: first significant word must match exactly
  const getFirstWord = (s: string) => s.split(' ').find(w => w.length > 2) || s;
  const homeFirstMatch = getFirstWord(dbH) === getFirstWord(apiH);
  const awayFirstMatch = getFirstWord(dbA) === getFirstWord(apiA);

  return homeFirstMatch && awayFirstMatch;
}

function findOutcomeForTeam(outcomes: OddsApiOutcome[], teamName: string): OddsApiOutcome | null {
  const normalized = normalizeTeam(teamName);
  return outcomes.find(o => {
    const oNorm = normalizeTeam(o.name);
    // Exact match
    if (oNorm === normalized) return true;
    // Substring match
    if (oNorm.includes(normalized) || normalized.includes(oNorm)) return true;
    // Word-based match
    return oNorm.split(' ').filter(w => w.length > 2).some(w => normalized.includes(w)) ||
           normalized.split(' ').filter(w => w.length > 2).some(w => oNorm.includes(w));
  }) || null;
}

async function processGameDay(gameDate: string, events: DBEvent[]): Promise<{ open: number; close: number }> {
  const stats = { open: 0, close: 0 };

  // Fetch odds for this game day at noon UTC
  // gameDate is like "2022-09-03", we need "2022-09-03T12:00:00Z"
  const fetchDateStr = `${gameDate}T12:00:00Z`;

  const oddsData = await fetchHistoricalOdds(fetchDateStr);
  if (!oddsData?.data) {
    console.log(`  No odds data for ${gameDate}`);
    return stats;
  }

  console.log(`  Found ${oddsData.data.length} games in Odds API`);

  for (const event of events) {
    const homeName = (event.home_team as any)?.name;
    const awayName = (event.away_team as any)?.name;
    if (!homeName || !awayName) continue;

    // Find matching game in API data
    const match = oddsData.data.find(g => teamsMatch(homeName, awayName, g.home_team, g.away_team));

    if (!match?.bookmakers) continue;

    const dk = match.bookmakers.find(b => b.key === 'draftkings');
    const spreads = dk?.markets.find(m => m.key === 'spreads');
    if (!spreads?.outcomes) continue;

    const homeOutcome = findOutcomeForTeam(spreads.outcomes, homeName);
    const awayOutcome = findOutcomeForTeam(spreads.outcomes, awayName);

    // Insert closing lines (game day odds are essentially closing lines)
    if (homeOutcome) {
      const payloadHash = hashPayload({ t: 'close', e: event.id, s: 'home' });

      // Check if exists first
      const { data: existing } = await supabase
        .from('odds_ticks')
        .select('id')
        .eq('payload_hash', payloadHash)
        .limit(1);

      if (!existing?.length) {
        const record = {
          event_id: event.id,
          sportsbook_id: dkSportsbookId!,
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
        if (!error) stats.close++;
      }
    }

    if (awayOutcome) {
      const payloadHash = hashPayload({ t: 'close', e: event.id, s: 'away' });

      // Check if exists first
      const { data: existing } = await supabase
        .from('odds_ticks')
        .select('id')
        .eq('payload_hash', payloadHash)
        .limit(1);

      if (!existing?.length) {
        const record = {
          event_id: event.id,
          sportsbook_id: dkSportsbookId!,
          market_type: 'spread',
          captured_at: oddsData.timestamp,
          side: 'away',
          spread_points_home: -awayOutcome.point, // Convert to home perspective
          total_points: null,
          price_american: decimalToAmerican(awayOutcome.price),
          price_decimal: awayOutcome.price,
          payload_hash: payloadHash,
          tick_type: 'close',
        };

        const { error } = await supabase.from('odds_ticks').insert(record);
        if (!error) stats.close++;
      }
    }
  }

  return stats;
}

async function main() {
  console.log('=== Syncing Historical Odds from The Odds API ===\n');
  console.log('Fetching ACTUAL spread prices for DraftKings\n');

  if (!ODDS_API_KEY) {
    console.error('ODDS_API_KEY is required');
    return;
  }

  dkSportsbookId = await getSportsbookId('draftkings');
  if (!dkSportsbookId) {
    console.error('DraftKings sportsbook not found');
    return;
  }
  console.log('DraftKings ID:', dkSportsbookId);

  // Get all final events grouped by date - paginate to get all
  let allEvents: DBEvent[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: page, error } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team:home_team_id(name),
        away_team:away_team_id(name)
      `)
      .eq('status', 'final')
      .order('commence_time')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`Error fetching events: ${error.message}`);
      break;
    }

    if (!page || page.length === 0) break;

    allEvents = allEvents.concat(page as unknown as DBEvent[]);
    offset += pageSize;

    if (page.length < pageSize) break; // Last page
  }

  if (allEvents.length === 0) {
    console.error('No events found');
    return;
  }

  console.log(`Found ${allEvents.length} final events\n`);

  // Group by date
  const byDate = new Map<string, DBEvent[]>();
  for (const event of allEvents as DBEvent[]) {
    const date = event.commence_time.split('T')[0];
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(event);
  }

  console.log(`Grouped into ${byDate.size} unique game days\n`);

  let totalClose = 0;
  let processed = 0;

  for (const [date, events] of byDate) {
    processed++;
    console.log(`[${processed}/${byDate.size}] ${date} (${events.length} games)`);

    const stats = await processGameDay(date, events);
    totalClose += stats.close;

    console.log(`  Synced: ${stats.close} closing ticks`);

    // Rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== Sync Complete ===');
  console.log(`API calls: ${apiCallCount}`);
  console.log(`Closing ticks synced: ${totalClose}`);

  // Verify
  const { data: ticks } = await supabase.from('odds_ticks').select('tick_type');
  const counts: Record<string, number> = {};
  for (const t of ticks || []) {
    counts[t.tick_type || 'null'] = (counts[t.tick_type || 'null'] || 0) + 1;
  }
  console.log('\nTick type distribution:', counts);
}

main().catch(console.error);

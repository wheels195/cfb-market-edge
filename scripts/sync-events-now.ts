import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ODDS_API_KEY = process.env.ODDS_API_KEY;

interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
}

async function syncEvents() {
  console.log('Fetching events from Odds API...');

  const url = `https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&oddsFormat=american`;
  const res = await fetch(url);
  const events: OddsEvent[] = await res.json();

  console.log(`Found ${events.length} events from Odds API`);

  // Get existing events
  const { data: existingEvents } = await supabase.from('events').select('odds_api_event_id');
  const existingIds = new Set(existingEvents?.map(e => e.odds_api_event_id) || []);

  // Get team mapping
  const { data: teams } = await supabase.from('teams').select('id, name');
  const teamByName = new Map<string, string>();
  for (const t of teams || []) {
    teamByName.set(t.name.toLowerCase(), t.id);
  }

  // Common suffixes to strip
  const suffixes = /\s+(Cougars|Aggies|Cardinals|Rockets|Hilltoppers|Golden Eagles|Rebels|Bobcats|Golden Bears|Rainbow Warriors|Chippewas|Wildcats|Lobos|Golden Gophers|Panthers|Roadrunners|Pirates|Nittany Lions|Tigers|Huskies|Black Knights|Yellow Jackets|RedHawks|Bulldogs|Mean Green|Aztecs|Cavaliers|Eagles|Mountaineers|Chanticleers|Volunteers|Fighting Illini|Trojans|Horned Frogs|Hawkeyes|Commodores|Sun Devils|Blue Devils|Wolverines|Longhorns|Cornhuskers|Utes|Hurricanes|Buckeyes|Ducks|Red Raiders|Crimson Tide|Hoosiers|Owls|Midshipmen|Bearcats|Mustangs|Demon Deacons|Bruins|Broncos|Bears|Seminoles|Sooners|Orange|Tar Heels|Hokies|Spartans|Scarlet Knights|Terrapins|Boilermakers|Gamecocks)$/i;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    const homeTeamClean = event.home_team.replace(suffixes, '').trim();
    const awayTeamClean = event.away_team.replace(suffixes, '').trim();

    let homeId = teamByName.get(homeTeamClean.toLowerCase()) || teamByName.get(event.home_team.toLowerCase());
    let awayId = teamByName.get(awayTeamClean.toLowerCase()) || teamByName.get(event.away_team.toLowerCase());

    // Create teams if needed
    if (!homeId) {
      const { data: newTeam } = await supabase.from('teams').insert({ name: homeTeamClean }).select().single();
      if (newTeam) {
        homeId = newTeam.id;
        teamByName.set(homeTeamClean.toLowerCase(), homeId);
        console.log(`Created team: ${homeTeamClean}`);
      }
    }
    if (!awayId) {
      const { data: newTeam } = await supabase.from('teams').insert({ name: awayTeamClean }).select().single();
      if (newTeam) {
        awayId = newTeam.id;
        teamByName.set(awayTeamClean.toLowerCase(), awayId);
        console.log(`Created team: ${awayTeamClean}`);
      }
    }

    if (!homeId || !awayId) {
      console.log(`Skipping - missing team: ${homeTeamClean} or ${awayTeamClean}`);
      skipped++;
      continue;
    }

    if (existingIds.has(event.id)) {
      await supabase.from('events').update({
        commence_time: event.commence_time,
        status: 'scheduled'
      }).eq('odds_api_event_id', event.id);
      updated++;
    } else {
      const { error } = await supabase.from('events').insert({
        odds_api_event_id: event.id,
        home_team_id: homeId,
        away_team_id: awayId,
        commence_time: event.commence_time,
        status: 'scheduled'
      });
      if (!error) {
        created++;
        console.log(`Created: ${awayTeamClean} @ ${homeTeamClean} on ${new Date(event.commence_time).toLocaleDateString()}`);
      } else {
        console.log(`Error: ${error.message}`);
      }
    }
  }

  console.log(`\nSummary: Created ${created}, Updated ${updated}, Skipped ${skipped}`);
}

syncEvents();

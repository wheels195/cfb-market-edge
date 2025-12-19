/**
 * Fix SP+ ratings to use correct team IDs
 *
 * Problem: SP+ ratings were synced using CFBD team names ("Alabama")
 * but events use Odds API team names ("Alabama Crimson Tide").
 *
 * Solution: Create a mapping and update advanced_team_ratings to use
 * the same team IDs as events.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Manual mapping of CFBD short names to Odds API full names
// This covers FBS teams that might appear in SP+ ratings
const TEAM_NAME_MAP: Record<string, string[]> = {
  'Air Force': ['Air Force Falcons', 'Air Force'],
  'Akron': ['Akron Zips', 'Akron'],
  'Alabama': ['Alabama Crimson Tide', 'Alabama'],
  'App State': ['Appalachian State Mountaineers', 'Appalachian State', 'App State'],
  'Arizona': ['Arizona Wildcats', 'Arizona'],
  'Arizona State': ['Arizona State Sun Devils', 'Arizona State'],
  'Arkansas': ['Arkansas Razorbacks', 'Arkansas'],
  'Arkansas State': ['Arkansas State Red Wolves', 'Arkansas State'],
  'Army': ['Army Black Knights', 'Army West Point', 'Army'],
  'Auburn': ['Auburn Tigers', 'Auburn'],
  'BYU': ['BYU Cougars', 'Brigham Young Cougars', 'BYU'],
  'Ball State': ['Ball State Cardinals', 'Ball State'],
  'Baylor': ['Baylor Bears', 'Baylor'],
  'Boise State': ['Boise State Broncos', 'Boise State'],
  'Boston College': ['Boston College Eagles', 'Boston College'],
  'Bowling Green': ['Bowling Green Falcons', 'Bowling Green'],
  'Buffalo': ['Buffalo Bulls', 'Buffalo'],
  'California': ['California Golden Bears', 'Cal Bears', 'California', 'Cal'],
  'Central Michigan': ['Central Michigan Chippewas', 'Central Michigan'],
  'Charlotte': ['Charlotte 49ers', 'Charlotte'],
  'Cincinnati': ['Cincinnati Bearcats', 'Cincinnati'],
  'Clemson': ['Clemson Tigers', 'Clemson'],
  'Coastal Carolina': ['Coastal Carolina Chanticleers', 'Coastal Carolina'],
  'Colorado': ['Colorado Buffaloes', 'Colorado'],
  'Colorado State': ['Colorado State Rams', 'Colorado State'],
  'Duke': ['Duke Blue Devils', 'Duke'],
  'East Carolina': ['East Carolina Pirates', 'East Carolina', 'ECU'],
  'Eastern Michigan': ['Eastern Michigan Eagles', 'Eastern Michigan'],
  'FIU': ['FIU Panthers', 'Florida International Panthers', 'FIU'],
  'Florida': ['Florida Gators', 'Florida'],
  'Florida Atlantic': ['Florida Atlantic Owls', 'FAU Owls', 'FAU'],
  'Florida State': ['Florida State Seminoles', 'Florida State'],
  'Fresno State': ['Fresno State Bulldogs', 'Fresno State'],
  'Georgia': ['Georgia Bulldogs', 'Georgia'],
  'Georgia Southern': ['Georgia Southern Eagles', 'Georgia Southern'],
  'Georgia State': ['Georgia State Panthers', 'Georgia State'],
  'Georgia Tech': ['Georgia Tech Yellow Jackets', 'Georgia Tech'],
  'Hawai\'i': ['Hawaii Rainbow Warriors', 'Hawaii', 'Hawai\'i'],
  'Houston': ['Houston Cougars', 'Houston'],
  'Illinois': ['Illinois Fighting Illini', 'Illinois'],
  'Indiana': ['Indiana Hoosiers', 'Indiana'],
  'Iowa': ['Iowa Hawkeyes', 'Iowa'],
  'Iowa State': ['Iowa State Cyclones', 'Iowa State'],
  'Jacksonville State': ['Jacksonville State Gamecocks', 'Jacksonville State'],
  'James Madison': ['James Madison Dukes', 'James Madison', 'JMU'],
  'Kansas': ['Kansas Jayhawks', 'Kansas'],
  'Kansas State': ['Kansas State Wildcats', 'Kansas State'],
  'Kent State': ['Kent State Golden Flashes', 'Kent State'],
  'Kentucky': ['Kentucky Wildcats', 'Kentucky'],
  'LSU': ['LSU Tigers', 'Louisiana State Tigers', 'LSU'],
  'Liberty': ['Liberty Flames', 'Liberty'],
  'Louisiana': ['Louisiana Ragin\' Cajuns', 'Louisiana-Lafayette', 'UL Lafayette', 'Louisiana'],
  'Louisiana Tech': ['Louisiana Tech Bulldogs', 'Louisiana Tech'],
  'Louisville': ['Louisville Cardinals', 'Louisville'],
  'Marshall': ['Marshall Thundering Herd', 'Marshall'],
  'Maryland': ['Maryland Terrapins', 'Maryland'],
  'Memphis': ['Memphis Tigers', 'Memphis'],
  'Miami': ['Miami Hurricanes', 'Miami (FL)', 'Miami FL', 'Miami'],
  'Miami (OH)': ['Miami (OH) RedHawks', 'Miami Ohio', 'Miami (OH)'],
  'Michigan': ['Michigan Wolverines', 'Michigan'],
  'Michigan State': ['Michigan State Spartans', 'Michigan State'],
  'Middle Tennessee': ['Middle Tennessee Blue Raiders', 'Middle Tennessee', 'MTSU'],
  'Minnesota': ['Minnesota Golden Gophers', 'Minnesota'],
  'Mississippi State': ['Mississippi State Bulldogs', 'Mississippi State'],
  'Missouri': ['Missouri Tigers', 'Missouri', 'Mizzou'],
  'NC State': ['NC State Wolfpack', 'North Carolina State Wolfpack', 'NC State'],
  'Navy': ['Navy Midshipmen', 'Navy'],
  'Nebraska': ['Nebraska Cornhuskers', 'Nebraska'],
  'Nevada': ['Nevada Wolf Pack', 'Nevada'],
  'New Mexico': ['New Mexico Lobos', 'New Mexico'],
  'New Mexico State': ['New Mexico State Aggies', 'New Mexico State', 'NMSU'],
  'North Carolina': ['North Carolina Tar Heels', 'UNC Tar Heels', 'North Carolina'],
  'North Texas': ['North Texas Mean Green', 'North Texas', 'UNT'],
  'Northern Illinois': ['Northern Illinois Huskies', 'Northern Illinois', 'NIU'],
  'Northwestern': ['Northwestern Wildcats', 'Northwestern'],
  'Notre Dame': ['Notre Dame Fighting Irish', 'Notre Dame'],
  'Ohio': ['Ohio Bobcats', 'Ohio'],
  'Ohio State': ['Ohio State Buckeyes', 'Ohio State'],
  'Oklahoma': ['Oklahoma Sooners', 'Oklahoma'],
  'Oklahoma State': ['Oklahoma State Cowboys', 'Oklahoma State'],
  'Old Dominion': ['Old Dominion Monarchs', 'Old Dominion', 'ODU'],
  'Ole Miss': ['Ole Miss Rebels', 'Mississippi Rebels', 'Ole Miss'],
  'Oregon': ['Oregon Ducks', 'Oregon'],
  'Oregon State': ['Oregon State Beavers', 'Oregon State'],
  'Penn State': ['Penn State Nittany Lions', 'Penn State'],
  'Pittsburgh': ['Pittsburgh Panthers', 'Pitt Panthers', 'Pittsburgh', 'Pitt'],
  'Purdue': ['Purdue Boilermakers', 'Purdue'],
  'Rice': ['Rice Owls', 'Rice'],
  'Rutgers': ['Rutgers Scarlet Knights', 'Rutgers'],
  'SMU': ['SMU Mustangs', 'Southern Methodist Mustangs', 'SMU'],
  'Sam Houston State': ['Sam Houston Bearkats', 'Sam Houston State', 'Sam Houston'],
  'San Diego State': ['San Diego State Aztecs', 'San Diego State', 'SDSU'],
  'San José State': ['San Jose State Spartans', 'San Jose State', 'SJSU'],
  'South Alabama': ['South Alabama Jaguars', 'South Alabama'],
  'South Carolina': ['South Carolina Gamecocks', 'South Carolina'],
  'South Florida': ['South Florida Bulls', 'USF Bulls', 'South Florida', 'USF'],
  'Southern Miss': ['Southern Miss Golden Eagles', 'Southern Mississippi', 'Southern Miss'],
  'Stanford': ['Stanford Cardinal', 'Stanford'],
  'Syracuse': ['Syracuse Orange', 'Syracuse'],
  'TCU': ['TCU Horned Frogs', 'Texas Christian Horned Frogs', 'TCU'],
  'Temple': ['Temple Owls', 'Temple'],
  'Tennessee': ['Tennessee Volunteers', 'Tennessee'],
  'Texas': ['Texas Longhorns', 'Texas'],
  'Texas A&M': ['Texas A&M Aggies', 'Texas A&M'],
  'Texas State': ['Texas State Bobcats', 'Texas State'],
  'Texas Tech': ['Texas Tech Red Raiders', 'Texas Tech'],
  'Toledo': ['Toledo Rockets', 'Toledo'],
  'Troy': ['Troy Trojans', 'Troy'],
  'Tulane': ['Tulane Green Wave', 'Tulane'],
  'Tulsa': ['Tulsa Golden Hurricane', 'Tulsa'],
  'UAB': ['UAB Blazers', 'Alabama-Birmingham Blazers', 'UAB'],
  'UCF': ['UCF Knights', 'Central Florida Knights', 'UCF'],
  'UCLA': ['UCLA Bruins', 'UCLA'],
  'UConn': ['UConn Huskies', 'Connecticut Huskies', 'UConn', 'Connecticut'],
  'UNLV': ['UNLV Rebels', 'UNLV'],
  'USC': ['USC Trojans', 'Southern California Trojans', 'USC'],
  'UTEP': ['UTEP Miners', 'Texas-El Paso Miners', 'UTEP'],
  'UTSA': ['UTSA Roadrunners', 'Texas-San Antonio Roadrunners', 'UTSA'],
  'Utah': ['Utah Utes', 'Utah'],
  'Utah State': ['Utah State Aggies', 'Utah State'],
  'Vanderbilt': ['Vanderbilt Commodores', 'Vanderbilt'],
  'Virginia': ['Virginia Cavaliers', 'Virginia'],
  'Virginia Tech': ['Virginia Tech Hokies', 'Virginia Tech'],
  'Wake Forest': ['Wake Forest Demon Deacons', 'Wake Forest'],
  'Washington': ['Washington Huskies', 'Washington'],
  'Washington State': ['Washington State Cougars', 'Washington State'],
  'West Virginia': ['West Virginia Mountaineers', 'West Virginia'],
  'Western Kentucky': ['Western Kentucky Hilltoppers', 'Western Kentucky', 'WKU'],
  'Western Michigan': ['Western Michigan Broncos', 'Western Michigan'],
  'Wisconsin': ['Wisconsin Badgers', 'Wisconsin'],
  'Wyoming': ['Wyoming Cowboys', 'Wyoming'],
};

async function main() {
  console.log('=== FIXING SP+ TEAM MAPPING ===\n');

  // Get all teams from the database
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name');

  if (!allTeams) {
    console.log('No teams found');
    return;
  }

  console.log(`Found ${allTeams.length} teams in database\n`);

  // Build a map of all possible names to team IDs
  const nameToTeamId = new Map<string, string>();
  for (const team of allTeams) {
    nameToTeamId.set(team.name.toLowerCase(), team.id);
  }

  // Get current SP+ ratings
  const { data: spRatings } = await supabase
    .from('advanced_team_ratings')
    .select('id, team_id, season, sp_overall, teams!inner(name)')
    .not('sp_overall', 'is', null);

  if (!spRatings) {
    console.log('No SP+ ratings found');
    return;
  }

  console.log(`Found ${spRatings.length} SP+ ratings\n`);

  // For each SP+ rating, find the correct team ID using the mapping
  let updated = 0;
  let notFound = 0;

  for (const rating of spRatings) {
    const cfbdName = (rating.teams as any).name;

    // Try to find matching team from Odds API
    const possibleNames = TEAM_NAME_MAP[cfbdName] || [cfbdName];
    let matchedTeamId: string | null = null;

    for (const name of possibleNames) {
      const teamId = nameToTeamId.get(name.toLowerCase());
      if (teamId && teamId !== rating.team_id) {
        matchedTeamId = teamId;
        break;
      }
    }

    if (matchedTeamId) {
      // Update the rating to use the correct team ID
      const { error } = await supabase
        .from('advanced_team_ratings')
        .update({ team_id: matchedTeamId })
        .eq('id', rating.id);

      if (!error) {
        updated++;
        if (updated <= 10) {
          console.log(`Updated ${cfbdName}: ${rating.team_id} → ${matchedTeamId}`);
        }
      }
    } else {
      notFound++;
      if (notFound <= 5) {
        console.log(`No mapping found for: ${cfbdName}`);
      }
    }
  }

  console.log(`\nUpdated ${updated} ratings`);
  console.log(`No mapping found for ${notFound} ratings`);

  // Verify the fix
  console.log('\n=== VERIFYING FIX ===');

  const { data: events } = await supabase
    .from('events')
    .select('home_team_id')
    .eq('status', 'scheduled')
    .limit(100);

  const eventTeamIds = new Set((events || []).map(e => e.home_team_id));

  const { data: newSpRatings } = await supabase
    .from('advanced_team_ratings')
    .select('team_id')
    .not('sp_overall', 'is', null);

  const spTeamIds = new Set((newSpRatings || []).map(r => r.team_id));

  let matching = 0;
  for (const id of eventTeamIds) {
    if (spTeamIds.has(id)) matching++;
  }

  console.log(`Event teams with SP+ ratings: ${matching}/${eventTeamIds.size}`);
}

main().catch(console.error);

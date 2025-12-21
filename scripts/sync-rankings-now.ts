import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const CFBD_API_KEY = process.env.CFBD_API_KEY;
const BASE_URL = 'https://apinext.collegefootballdata.com';

async function syncRankings() {
  const season = 2024;

  // Get team mapping
  const { data: teams } = await supabase.from('teams').select('id, cfbd_team_id');
  const teamIdMap = new Map<string, string>();
  for (const team of teams || []) {
    if (team.cfbd_team_id) {
      teamIdMap.set(team.cfbd_team_id, team.id);
    }
  }
  console.log('Team mappings loaded:', teamIdMap.size);

  // Fetch postseason rankings (most recent)
  const url = `${BASE_URL}/rankings?year=${season}&seasonType=postseason`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${CFBD_API_KEY}` }
  });

  const data = await response.json();
  const latest = data[data.length - 1];
  console.log('Got rankings for week', latest.week, 'season', latest.season);

  let count = 0;
  for (const poll of latest.polls) {
    if (poll.poll !== 'AP Top 25' && poll.poll !== 'Coaches Poll') continue;

    console.log('Processing', poll.poll, '-', poll.ranks.length, 'teams');
    for (const r of poll.ranks) {
      const teamId = teamIdMap.get(r.teamId.toString());

      const { error } = await supabase.from('team_rankings').upsert({
        team_id: teamId || null,
        cfbd_team_id: r.teamId,
        season: latest.season,
        week: latest.week,
        season_type: latest.seasonType,
        poll: poll.poll,
        rank: r.rank,
        points: r.points,
        first_place_votes: r.firstPlaceVotes,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'cfbd_team_id,season,week,season_type,poll' });

      if (error) {
        console.error(r.school, error.message);
      } else {
        count++;
      }
    }
  }
  console.log('Synced', count, 'rankings');

  // Verify
  const { data: verify } = await supabase
    .from('team_rankings')
    .select('rank, cfbd_team_id, poll')
    .eq('poll', 'AP Top 25')
    .order('rank')
    .limit(10);
  console.log('Top 10 AP:', verify);
}

syncRankings();

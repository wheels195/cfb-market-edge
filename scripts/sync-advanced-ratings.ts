/**
 * Sync advanced team ratings from CFBD API
 * Includes SP+, Elo, FPI, recruiting, talent, and advanced stats
 */
import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

// Create client directly with env vars
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const BATCH_SIZE = 100;

interface SyncRatingsResult {
  seasonsProcessed: number;
  teamsProcessed: number;
  ratingsCreated: number;
  ratingsUpdated: number;
  apiCalls: number;
  timeSeconds: number;
  errors: string[];
}

async function getAllTeams(): Promise<Map<string, string>> {
  const teamMap = new Map<string, string>();
  let offset = 0;

  while (true) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name')
      .range(offset, offset + 999);

    if (!teams || teams.length === 0) break;
    for (const t of teams) {
      teamMap.set(t.name, t.id);
    }
    offset += teams.length;
    if (teams.length < 1000) break;
  }

  return teamMap;
}

async function syncAdvancedRatings(
  seasons: number[] = [2022, 2023, 2024, 2025]
): Promise<SyncRatingsResult> {
  const startTime = Date.now();
  const result: SyncRatingsResult = {
    seasonsProcessed: 0,
    teamsProcessed: 0,
    ratingsCreated: 0,
    ratingsUpdated: 0,
    apiCalls: 0,
    timeSeconds: 0,
    errors: [],
  };

  const client = getCFBDApiClient();

  // First, create the table if it doesn't exist
  console.log('Ensuring advanced_team_ratings table exists...');
  const { error: tableError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS advanced_team_ratings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        season INTEGER NOT NULL,
        cfbd_elo NUMERIC,
        fpi NUMERIC,
        srs NUMERIC,
        sp_overall NUMERIC,
        sp_offense NUMERIC,
        sp_defense NUMERIC,
        recruiting_rank INTEGER,
        recruiting_points NUMERIC,
        talent_rating NUMERIC,
        off_ppa NUMERIC,
        off_success_rate NUMERIC,
        off_explosiveness NUMERIC,
        off_power_success NUMERIC,
        off_stuff_rate NUMERIC,
        off_line_yards NUMERIC,
        off_havoc NUMERIC,
        def_ppa NUMERIC,
        def_success_rate NUMERIC,
        def_explosiveness NUMERIC,
        def_power_success NUMERIC,
        def_stuff_rate NUMERIC,
        def_line_yards NUMERIC,
        def_havoc NUMERIC,
        off_passing_ppa NUMERIC,
        off_rushing_ppa NUMERIC,
        def_passing_ppa NUMERIC,
        def_rushing_ppa NUMERIC,
        last_updated TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(team_id, season)
      );
    `
  });

  if (tableError) {
    console.log('Note: Could not create table via RPC (may already exist), continuing...');
  }

  // Get all teams
  console.log('Loading teams...');
  const teamMap = await getAllTeams();
  console.log(`Found ${teamMap.size} teams\n`);

  // Collect all ratings data
  const ratingsMap = new Map<string, Record<string, unknown>>();

  for (const season of seasons.sort((a, b) => a - b)) {
    console.log(`Fetching data for ${season}...`);

    // 1. Get SP+ ratings (the gold standard for CFB)
    try {
      console.log('  Fetching SP+ ratings...');
      const spResponse = await fetch(`https://api.collegefootballdata.com/ratings/sp?year=${season}`, {
        headers: {
          'Authorization': `Bearer ${process.env.CFBD_API_KEY}`,
          'Accept': 'application/json',
        },
      });
      const spRatings = await spResponse.json() as Array<{
        year: number;
        team: string;
        conference: string;
        rating: number;
        ranking: number;
        offense: { rating: number; ranking: number };
        defense: { rating: number; ranking: number };
      }>;
      result.apiCalls++;

      for (const r of spRatings) {
        const teamId = teamMap.get(r.team);
        if (!teamId) continue;

        const key = `${teamId}_${season}`;
        const existing = ratingsMap.get(key) || { team_id: teamId, season };
        ratingsMap.set(key, {
          ...existing,
          sp_overall: r.rating,
          sp_offense: r.offense?.rating,
          sp_defense: r.defense?.rating,
        });
        result.teamsProcessed++;
      }
      console.log(`    Got SP+ for ${spRatings.length} teams`);
    } catch (err) {
      result.errors.push(`SP+ ${season}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // 2. Get recruiting rankings
    try {
      console.log('  Fetching recruiting rankings...');
      const recruiting = await client.getRecruitingTeams(season);
      result.apiCalls++;

      for (const r of recruiting) {
        const teamId = teamMap.get(r.team);
        if (!teamId) continue;

        const key = `${teamId}_${season}`;
        const existing = ratingsMap.get(key) || { team_id: teamId, season };
        ratingsMap.set(key, {
          ...existing,
          recruiting_rank: r.rank,
          recruiting_points: r.points,
        });
      }
      console.log(`    Got recruiting for ${recruiting.length} teams`);
    } catch (err) {
      result.errors.push(`Recruiting ${season}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // 3. Get talent composite
    try {
      console.log('  Fetching talent rankings...');
      const talent = await client.getTalentRankings(season);
      result.apiCalls++;

      for (const t of talent) {
        const teamId = teamMap.get(t.school);
        if (!teamId) continue;

        const key = `${teamId}_${season}`;
        const existing = ratingsMap.get(key) || { team_id: teamId, season };
        ratingsMap.set(key, {
          ...existing,
          talent_rating: t.talent,
        });
      }
      console.log(`    Got talent for ${talent.length} teams`);
    } catch (err) {
      result.errors.push(`Talent ${season}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // 4. Get advanced stats
    try {
      console.log('  Fetching advanced stats...');
      const advanced = await client.getAdvancedTeamStats(season);
      result.apiCalls++;

      for (const a of advanced) {
        const teamId = teamMap.get(a.team);
        if (!teamId) continue;

        const key = `${teamId}_${season}`;
        const existing = ratingsMap.get(key) || { team_id: teamId, season };
        ratingsMap.set(key, {
          ...existing,
          off_ppa: a.offense?.ppa,
          off_success_rate: a.offense?.successRate,
          off_explosiveness: a.offense?.explosiveness,
          def_ppa: a.defense?.ppa,
          def_success_rate: a.defense?.successRate,
          def_explosiveness: a.defense?.explosiveness,
        });
      }
      console.log(`    Got advanced stats for ${advanced.length} teams`);
    } catch (err) {
      result.errors.push(`Advanced ${season}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    result.seasonsProcessed++;
  }

  // Batch upsert all ratings
  console.log(`\nInserting ${ratingsMap.size} team-season ratings...`);
  const allRatings = [...ratingsMap.values()];

  for (let i = 0; i < allRatings.length; i += BATCH_SIZE) {
    const batch = allRatings.slice(i, i + BATCH_SIZE);

    // Try upsert first
    const { error } = await supabase
      .from('advanced_team_ratings')
      .upsert(batch, { onConflict: 'team_id,season' });

    if (error) {
      // If table doesn't exist or upsert fails, try insert
      if (error.message.includes('does not exist')) {
        result.errors.push('Table does not exist - please run migration first');
        break;
      }
      result.errors.push(`Batch ${i}: ${error.message}`);
      continue;
    }

    result.ratingsCreated += batch.length;

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= allRatings.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, allRatings.length)}/${allRatings.length}`);
    }
  }

  result.timeSeconds = Math.round((Date.now() - startTime) / 1000);
  return result;
}

async function main() {
  console.log('Syncing advanced team ratings...\n');

  const result = await syncAdvancedRatings([2022, 2023, 2024, 2025]);

  console.log('\n=== SYNC COMPLETE ===');
  console.log(`Time: ${result.timeSeconds} seconds`);
  console.log(`Seasons processed: ${result.seasonsProcessed}`);
  console.log(`Teams processed: ${result.teamsProcessed}`);
  console.log(`Ratings created: ${result.ratingsCreated}`);
  console.log(`API calls: ${result.apiCalls}`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    result.errors.slice(0, 20).forEach(e => console.log(`  - ${e}`));
  }

  // Show sample of top-rated teams
  console.log('\n=== TOP TEAMS BY SP+ (2024) ===');
  const { data: topTeams } = await supabase
    .from('advanced_team_ratings')
    .select(`
      sp_overall,
      sp_offense,
      sp_defense,
      cfbd_elo,
      recruiting_rank,
      talent_rating,
      teams!inner(name)
    `)
    .eq('season', 2024)
    .not('sp_overall', 'is', null)
    .order('sp_overall', { ascending: false })
    .limit(15);

  if (topTeams) {
    console.log('\nRank | Team                | SP+   | Off   | Def   | Elo  | Recruit | Talent');
    console.log('-----|---------------------|-------|-------|-------|------|---------|--------');
    topTeams.forEach((t, i) => {
      const team = (Array.isArray(t.teams) ? (t.teams[0] as { name: string })?.name : (t.teams as { name: string })?.name) || 'Unknown';
      console.log(
        `${(i + 1).toString().padStart(4)} | ${team.padEnd(19)} | ${(t.sp_overall?.toFixed(1) || '-').padStart(5)} | ${(t.sp_offense?.toFixed(1) || '-').padStart(5)} | ${(t.sp_defense?.toFixed(1) || '-').padStart(5)} | ${(t.cfbd_elo?.toFixed(0) || '-').padStart(4)} | ${(t.recruiting_rank?.toString() || '-').padStart(7)} | ${(t.talent_rating?.toFixed(0) || '-').padStart(6)}`
      );
    });
  }
}

main().catch(console.error);

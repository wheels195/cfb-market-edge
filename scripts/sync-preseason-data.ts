/**
 * Sync Preseason Data for Week 0 Priors
 *
 * Sources:
 * 1. Returning production (PPA by team)
 * 2. Recruiting rankings
 * 3. Coaches (hireDate for coaching changes)
 * 4. Transfer portal (QB transfers)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const CFBD_API_KEY = process.env.CFBD_API_KEY || '';

async function cfbdFetch(endpoint: string) {
  const response = await fetch(`https://apinext.collegefootballdata.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${CFBD_API_KEY}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) {
    console.log(`CFBD error for ${endpoint}: ${response.status}`);
    return null;
  }
  return response.json();
}

async function createTables() {
  // Create tables via raw SQL (will need to run migrations separately)
  console.log('Tables should be created via Supabase migrations.');
  console.log('Proceeding with data sync...');
}

async function syncReturningProduction() {
  console.log('\n=== Syncing Returning Production ===');

  const allData: any[] = [];

  for (const year of [2022, 2023, 2024]) {
    const data = await cfbdFetch(`/player/returning?year=${year}`);
    if (data) {
      for (const team of data) {
        allData.push({
          season: year,
          team: team.team,
          conference: team.conference,
          total_ppa: team.totalPPA,
          total_passing_ppa: team.totalPassingPPA,
          total_receiving_ppa: team.totalReceivingPPA,
          total_rushing_ppa: team.totalRushingPPA,
          percent_ppa: team.percentPPA,
          percent_passing_ppa: team.percentPassingPPA,
          percent_receiving_ppa: team.percentReceivingPPA,
          percent_rushing_ppa: team.percentRushingPPA,
          usage: team.usage,
          passing_usage: team.passingUsage,
          receiving_usage: team.receivingUsage,
          rushing_usage: team.rushingUsage,
        });
      }
      console.log(`  ${year}: ${data.length} teams`);
    }
  }

  return allData;
}

async function syncRecruiting() {
  console.log('\n=== Syncing Recruiting ===');

  const allData: any[] = [];

  for (const year of [2022, 2023, 2024]) {
    const data = await cfbdFetch(`/recruiting/teams?year=${year}`);
    if (data) {
      for (const team of data) {
        allData.push({
          season: year,
          team: team.team,
          rank: team.rank,
          points: team.points,
        });
      }
      console.log(`  ${year}: ${data.length} teams`);
    }
  }

  return allData;
}

async function syncCoaches() {
  console.log('\n=== Syncing Coaches ===');

  const allData: any[] = [];

  for (const year of [2022, 2023, 2024]) {
    const data = await cfbdFetch(`/coaches?year=${year}`);
    if (data) {
      for (const coach of data) {
        const season = coach.seasons?.find((s: any) => s.year === year);
        if (season) {
          allData.push({
            season: year,
            team: season.school,
            first_name: coach.firstName,
            last_name: coach.lastName,
            hire_date: coach.hireDate,
            games: season.games,
            wins: season.wins,
            losses: season.losses,
          });
        }
      }
      console.log(`  ${year}: ${data.length} coaches`);
    }
  }

  return allData;
}

async function syncQBTransfers() {
  console.log('\n=== Syncing QB Transfers ===');

  const allData: any[] = [];

  for (const year of [2022, 2023, 2024]) {
    const data = await cfbdFetch(`/player/portal?year=${year}`);
    if (data) {
      const qbs = data.filter((p: any) => p.position === 'QB');
      for (const qb of qbs) {
        allData.push({
          season: year,
          first_name: qb.firstName,
          last_name: qb.lastName,
          position: qb.position,
          origin: qb.origin,
          destination: qb.destination,
          transfer_date: qb.transferDate,
          stars: qb.stars,
          rating: qb.rating,
          eligibility: qb.eligibility,
        });
      }
      console.log(`  ${year}: ${qbs.length} QB transfers`);
    }
  }

  return allData;
}

async function main() {
  console.log('=== SYNC PRESEASON DATA ===');

  const returningProd = await syncReturningProduction();
  const recruiting = await syncRecruiting();
  const coaches = await syncCoaches();
  const qbTransfers = await syncQBTransfers();

  console.log('\n=== DATA SUMMARY ===');
  console.log(`Returning production: ${returningProd.length} records`);
  console.log(`Recruiting: ${recruiting.length} records`);
  console.log(`Coaches: ${coaches.length} records`);
  console.log(`QB transfers: ${qbTransfers.length} records`);

  // Save to local JSON files for now (will insert to DB after creating tables)
  const fs = require('fs');

  fs.writeFileSync('/tmp/returning_production.json', JSON.stringify(returningProd, null, 2));
  fs.writeFileSync('/tmp/recruiting.json', JSON.stringify(recruiting, null, 2));
  fs.writeFileSync('/tmp/coaches.json', JSON.stringify(coaches, null, 2));
  fs.writeFileSync('/tmp/qb_transfers.json', JSON.stringify(qbTransfers, null, 2));

  console.log('\nData saved to /tmp/*.json');

  // Process for Week 0 priors
  console.log('\n=== BUILDING WEEK 0 PRIORS ===');

  // Get Elo ratings from prior season end
  const { data: eloData } = await supabase
    .from('cfbd_elo_ratings')
    .select('*');

  // Build team -> prior season final Elo
  const priorSeasonElo = new Map<string, Map<number, number>>();
  for (const row of eloData || []) {
    const teamKey = row.team_name.toLowerCase();
    if (!priorSeasonElo.has(teamKey)) {
      priorSeasonElo.set(teamKey, new Map());
    }
    const existing = priorSeasonElo.get(teamKey)!.get(row.season);
    if (!existing || row.week > 10) {
      priorSeasonElo.get(teamKey)!.set(row.season, row.elo);
    }
  }

  // Build Week 0 ratings
  const week0Ratings: any[] = [];

  // Normalize recruiting points (max ~320, min ~100)
  const maxRecruiting = Math.max(...recruiting.map(r => r.points));
  const minRecruiting = Math.min(...recruiting.map(r => r.points));

  for (const season of [2022, 2023, 2024]) {
    const seasonReturning = returningProd.filter(r => r.season === season);
    const seasonRecruiting = recruiting.filter(r => r.season === season);
    const seasonCoaches = coaches.filter(c => c.season === season);
    const seasonQBTransfers = qbTransfers.filter(q => q.season === season);

    for (const team of seasonReturning) {
      const teamKey = team.team.toLowerCase();

      // 1. Prior season Elo (35%)
      const priorElo = priorSeasonElo.get(teamKey)?.get(season - 1) || 1500;

      // 2. Roster continuity via returning PPA (35%)
      // percentPPA is 0-1 scale, convert to Elo-like scale
      const rosterContinuity = 1500 + (team.percent_ppa - 0.5) * 400;

      // 3. Recruiting (20%)
      const teamRecruiting = seasonRecruiting.find(r =>
        r.team.toLowerCase() === teamKey
      );
      const recruitingNorm = teamRecruiting
        ? (teamRecruiting.points - minRecruiting) / (maxRecruiting - minRecruiting)
        : 0.5;
      const recruitingElo = 1300 + recruitingNorm * 400;

      // 4. Conference base (10%) - placeholder
      const conferenceBase = 1500;

      // Check coaching change
      const teamCoach = seasonCoaches.find(c =>
        c.team.toLowerCase() === teamKey
      );
      let coachingChange = false;
      if (teamCoach?.hire_date) {
        const hireYear = new Date(teamCoach.hire_date).getFullYear();
        coachingChange = hireYear === season || hireYear === season - 1;
      }

      // Check QB transfer activity
      const qbTransferOut = seasonQBTransfers.filter(q =>
        q.origin?.toLowerCase() === teamKey
      );
      const qbTransferIn = seasonQBTransfers.filter(q =>
        q.destination?.toLowerCase() === teamKey
      );

      // Calculate Week 0 rating
      const week0Rating = Math.round(
        0.35 * priorElo +
        0.35 * rosterContinuity +
        0.20 * recruitingElo +
        0.10 * conferenceBase
      );

      // Uncertainty factors
      let uncertaintyScore = 0;
      if (coachingChange) uncertaintyScore += 0.2;
      if (team.percent_ppa < 0.4) uncertaintyScore += 0.15;  // Low returning production
      if (qbTransferOut.length > 0) uncertaintyScore += 0.15;
      if (qbTransferIn.length > 0) uncertaintyScore += 0.05;  // New QB is unknown

      week0Ratings.push({
        season,
        team: team.team,
        conference: team.conference,
        prior_elo: priorElo,
        roster_continuity: Math.round(rosterContinuity),
        recruiting_elo: Math.round(recruitingElo),
        week0_rating: week0Rating,
        percent_returning_ppa: team.percent_ppa,
        percent_returning_passing: team.percent_passing_ppa,
        coaching_change: coachingChange,
        qb_transfers_out: qbTransferOut.length,
        qb_transfers_in: qbTransferIn.length,
        uncertainty_score: Math.min(1, uncertaintyScore),
      });
    }

    console.log(`${season}: ${seasonReturning.length} teams processed`);
  }

  // Save Week 0 ratings
  fs.writeFileSync('/tmp/week0_ratings.json', JSON.stringify(week0Ratings, null, 2));
  console.log(`\nWeek 0 ratings saved: ${week0Ratings.length} teams`);

  // Show sample
  console.log('\n=== SAMPLE WEEK 0 RATINGS (2024) ===');
  const sample2024 = week0Ratings.filter(r => r.season === 2024).slice(0, 10);
  console.log('Team                 | Prior | Roster | Recruit | Week0 | Unc | Coach | QB Out');
  console.log('---------------------|-------|--------|---------|-------|-----|-------|-------');
  for (const r of sample2024) {
    console.log(
      `${r.team.padEnd(20)} | ${r.prior_elo.toString().padStart(5)} | ${r.roster_continuity.toString().padStart(6)} | ` +
      `${r.recruiting_elo.toString().padStart(7)} | ${r.week0_rating.toString().padStart(5)} | ` +
      `${r.uncertainty_score.toFixed(2).padStart(3)} | ${r.coaching_change ? 'Y' : 'N'}     | ${r.qb_transfers_out}`
    );
  }

  // Compare to teams that changed a lot
  console.log('\n=== HIGH UNCERTAINTY TEAMS (2024) ===');
  const highUnc = week0Ratings
    .filter(r => r.season === 2024 && r.uncertainty_score >= 0.2)
    .sort((a, b) => b.uncertainty_score - a.uncertainty_score)
    .slice(0, 15);

  for (const r of highUnc) {
    console.log(
      `${r.team.padEnd(20)} | Unc: ${r.uncertainty_score.toFixed(2)} | ` +
      `Coach: ${r.coaching_change ? 'Y' : 'N'} | QB Out: ${r.qb_transfers_out} | ` +
      `Ret PPA: ${(r.percent_returning_ppa * 100).toFixed(0)}%`
    );
  }

  console.log('\n=== SYNC COMPLETE ===');
}

main().catch(console.error);

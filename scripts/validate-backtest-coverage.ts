/**
 * Validate backtest data coverage
 * Check that events have:
 * 1. Elo snapshots for both teams (preseason/week 0 at minimum)
 * 2. Closing line ticks with actual prices
 * 3. Final results
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface CoverageStats {
  totalEvents: number;
  withResults: number;
  withClosingLines: number;
  withHomeElo: number;
  withAwayElo: number;
  fullyReady: number;
}

// Derive CFB season from game date
// Aug-Dec games = that year's season
// Jan games = previous year's season (bowl games)
function getSeason(commenceTime: string): number {
  const date = new Date(commenceTime);
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();

  // January = bowl games from previous season
  if (month === 0) {
    return year - 1;
  }
  return year;
}

// Estimate week from game date within season
// Week 0 = last week of August
// Week 1 = first week of September
// etc.
function estimateWeek(commenceTime: string, season: number): number {
  const date = new Date(commenceTime);
  const month = date.getMonth();
  const day = date.getDate();

  // January bowl games = week 16 or so
  if (month === 0) {
    return 16;
  }

  // August = week 0 or 1
  if (month === 7) {
    return day < 25 ? 0 : 1;
  }

  // September-December
  // Week 1 = ~Sept 1-7, Week 2 = ~Sept 8-14, etc.
  // Rough approximation: week = 1 + (dayOfYear - Sept1) / 7
  const sept1 = new Date(season, 8, 1).getTime();
  const gameTime = date.getTime();
  const daysSinceSept1 = Math.floor((gameTime - sept1) / (1000 * 60 * 60 * 24));

  return Math.max(1, Math.min(16, 1 + Math.floor(daysSinceSept1 / 7)));
}

async function validateCoverage() {
  console.log('=== Backtest Data Coverage Validation ===\n');

  // Get all final events with results - paginate
  let allEvents: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: page, error } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team_id,
        away_team_id,
        home_team:home_team_id(id, name),
        away_team:away_team_id(id, name)
      `)
      .eq('status', 'final')
      .order('commence_time')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching events:', error.message);
      return;
    }

    if (!page || page.length === 0) break;
    allEvents = allEvents.concat(page);
    offset += pageSize;
    if (page.length < pageSize) break;
  }

  console.log(`Total final events: ${allEvents.length}\n`);

  // Get all results - paginate
  console.log('Fetching results...');
  const resultEventIds = new Set<string>();
  let resultsOffset = 0;
  while (true) {
    const { data: resultsPage } = await supabase
      .from('results')
      .select('event_id')
      .range(resultsOffset, resultsOffset + 999);
    if (!resultsPage || resultsPage.length === 0) break;
    for (const r of resultsPage) resultEventIds.add(r.event_id);
    resultsOffset += 1000;
    if (resultsPage.length < 1000) break;
  }
  console.log(`Fetched ${resultEventIds.size} results`);

  // Get all closing line ticks - paginate
  console.log('Fetching closing line ticks...');
  const closingEventIds = new Set<string>();
  let ticksOffset = 0;
  while (true) {
    const { data: ticksPage } = await supabase
      .from('odds_ticks')
      .select('event_id')
      .eq('tick_type', 'close')
      .range(ticksOffset, ticksOffset + 999);
    if (!ticksPage || ticksPage.length === 0) break;
    for (const t of ticksPage) closingEventIds.add(t.event_id);
    ticksOffset += 1000;
    if (ticksPage.length < 1000) break;
  }
  console.log(`Fetched ${closingEventIds.size} unique events with closing ticks`);

  // Get all Elo snapshots - paginate to get all records
  console.log('Fetching Elo snapshots (with pagination)...');
  let allEloSnapshots: Array<{ team_id: string; season: number; week: number }> = [];
  let eloOffset = 0;
  const eloPageSize = 1000;

  while (true) {
    const { data: page } = await supabase
      .from('team_elo_snapshots')
      .select('team_id, season, week')
      .range(eloOffset, eloOffset + eloPageSize - 1);

    if (!page || page.length === 0) break;
    allEloSnapshots = allEloSnapshots.concat(page);
    eloOffset += eloPageSize;
    if (page.length < eloPageSize) break;
  }
  console.log(`Fetched ${allEloSnapshots.length} Elo snapshots\n`);

  // Build lookup: `${teamId}-${season}` -> Set of weeks available
  const eloByTeamSeason = new Map<string, Set<number>>();
  for (const snap of allEloSnapshots) {
    const key = `${snap.team_id}-${snap.season}`;
    if (!eloByTeamSeason.has(key)) {
      eloByTeamSeason.set(key, new Set());
    }
    eloByTeamSeason.get(key)!.add(snap.week);
  }

  // Validate by season
  const statsBySeason: Record<number, CoverageStats> = {};

  for (const event of allEvents) {
    const season = getSeason(event.commence_time);
    const week = estimateWeek(event.commence_time, season);
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;

    if (!statsBySeason[season]) {
      statsBySeason[season] = {
        totalEvents: 0,
        withResults: 0,
        withClosingLines: 0,
        withHomeElo: 0,
        withAwayElo: 0,
        fullyReady: 0,
      };
    }

    const stats = statsBySeason[season];
    stats.totalEvents++;

    const hasResult = resultEventIds.has(event.id);
    const hasClosing = closingEventIds.has(event.id);

    // For Elo, check if we have week-1 OR week 0 (preseason baseline)
    const homeKey = `${homeTeamId}-${season}`;
    const awayKey = `${awayTeamId}-${season}`;
    const homeWeeks = eloByTeamSeason.get(homeKey);
    const awayWeeks = eloByTeamSeason.get(awayKey);

    // Use week-1, fallback to week 0
    const eloWeek = Math.max(0, week - 1);
    const hasHomeElo = homeWeeks && (homeWeeks.has(eloWeek) || homeWeeks.has(0));
    const hasAwayElo = awayWeeks && (awayWeeks.has(eloWeek) || awayWeeks.has(0));

    if (hasResult) stats.withResults++;
    if (hasClosing) stats.withClosingLines++;
    if (hasHomeElo) stats.withHomeElo++;
    if (hasAwayElo) stats.withAwayElo++;

    if (hasResult && hasClosing && hasHomeElo && hasAwayElo) {
      stats.fullyReady++;
    }
  }

  // Print results
  console.log('Coverage by Season:');
  console.log('='.repeat(80));
  console.log(
    'Season'.padEnd(8) +
    'Total'.padEnd(8) +
    'Results'.padEnd(10) +
    'Closing'.padEnd(10) +
    'HomeElo'.padEnd(10) +
    'AwayElo'.padEnd(10) +
    'Ready'.padEnd(8) +
    'Ready%'
  );
  console.log('-'.repeat(80));

  let totalReady = 0;
  let totalEvents = 0;

  for (const season of Object.keys(statsBySeason).sort()) {
    const s = statsBySeason[parseInt(season)];
    const readyPct = s.totalEvents > 0 ? ((s.fullyReady / s.totalEvents) * 100).toFixed(1) : '0.0';
    console.log(
      season.padEnd(8) +
      s.totalEvents.toString().padEnd(8) +
      s.withResults.toString().padEnd(10) +
      s.withClosingLines.toString().padEnd(10) +
      s.withHomeElo.toString().padEnd(10) +
      s.withAwayElo.toString().padEnd(10) +
      s.fullyReady.toString().padEnd(8) +
      `${readyPct}%`
    );
    totalReady += s.fullyReady;
    totalEvents += s.totalEvents;
  }

  console.log('-'.repeat(80));
  console.log(
    'TOTAL'.padEnd(8) +
    totalEvents.toString().padEnd(8) +
    ''.padEnd(10) +
    ''.padEnd(10) +
    ''.padEnd(10) +
    ''.padEnd(10) +
    totalReady.toString().padEnd(8) +
    `${totalEvents > 0 ? ((totalReady / totalEvents) * 100).toFixed(1) : '0.0'}%`
  );

  // Training vs Test split
  console.log('\n\nTraining (2022-2023) vs Test (2024) Split:');
  console.log('='.repeat(50));

  const trainStats = { events: 0, ready: 0 };
  const testStats = { events: 0, ready: 0 };

  for (const season of Object.keys(statsBySeason).map(Number)) {
    const s = statsBySeason[season];
    if (season <= 2023) {
      trainStats.events += s.totalEvents;
      trainStats.ready += s.fullyReady;
    } else {
      testStats.events += s.totalEvents;
      testStats.ready += s.fullyReady;
    }
  }

  const trainPct = trainStats.events > 0 ? ((trainStats.ready / trainStats.events) * 100).toFixed(1) : '0.0';
  const testPct = testStats.events > 0 ? ((testStats.ready / testStats.events) * 100).toFixed(1) : '0.0';
  console.log(`Training: ${trainStats.ready}/${trainStats.events} ready (${trainPct}%)`);
  console.log(`Test:     ${testStats.ready}/${testStats.events} ready (${testPct}%)`);

  // Diagnose missing data
  console.log('\n\nDiagnosing Missing Data:');
  console.log('='.repeat(50));

  // Sample events missing closing lines
  const missingClosing: any[] = [];
  const missingElo: any[] = [];

  for (const event of allEvents) {
    const season = getSeason(event.commence_time);
    const week = estimateWeek(event.commence_time, season);
    const homeName = (event.home_team as any)?.name || 'Unknown';
    const awayName = (event.away_team as any)?.name || 'Unknown';
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;

    const hasClosing = closingEventIds.has(event.id);

    const homeKey = `${homeTeamId}-${season}`;
    const awayKey = `${awayTeamId}-${season}`;
    const homeWeeks = eloByTeamSeason.get(homeKey);
    const awayWeeks = eloByTeamSeason.get(awayKey);
    const eloWeek = Math.max(0, week - 1);
    const hasHomeElo = homeWeeks && (homeWeeks.has(eloWeek) || homeWeeks.has(0));
    const hasAwayElo = awayWeeks && (awayWeeks.has(eloWeek) || awayWeeks.has(0));

    if (!hasClosing && missingClosing.length < 5) {
      missingClosing.push({
        date: event.commence_time.split('T')[0],
        game: `${awayName} @ ${homeName}`,
        season,
        week,
      });
    }

    if ((!hasHomeElo || !hasAwayElo) && missingElo.length < 5) {
      missingElo.push({
        date: event.commence_time.split('T')[0],
        game: `${awayName} @ ${homeName}`,
        season,
        week,
        missingHome: !hasHomeElo,
        missingAway: !hasAwayElo,
        homeName,
        awayName,
        homeTeamId,
        awayTeamId,
      });
    }
  }

  if (missingClosing.length > 0) {
    console.log('\nSample events missing closing lines:');
    for (const e of missingClosing) {
      console.log(`  ${e.date}: ${e.game} (S${e.season} W${e.week})`);
    }
  }

  if (missingElo.length > 0) {
    console.log('\nSample events missing Elo:');
    for (const e of missingElo) {
      console.log(`  ${e.date}: ${e.game} (S${e.season} W${e.week})`);
      console.log(`    Missing: ${e.missingHome ? e.homeName : ''}${e.missingHome && e.missingAway ? ', ' : ''}${e.missingAway ? e.awayName : ''}`);
    }
  }

  // Check Elo snapshot coverage
  console.log('\n\nElo Snapshot Coverage:');
  const eloCountBySeason: Record<number, number> = {};
  for (const snap of allEloSnapshots) {
    eloCountBySeason[snap.season] = (eloCountBySeason[snap.season] || 0) + 1;
  }
  for (const season of Object.keys(eloCountBySeason).sort()) {
    console.log(`  ${season}: ${eloCountBySeason[parseInt(season)]} snapshots`);
  }

  // Unique teams with Elo by season
  console.log('\nUnique teams with Elo by season:');
  const teamsBySeason: Record<number, Set<string>> = {};
  for (const snap of allEloSnapshots) {
    if (!teamsBySeason[snap.season]) teamsBySeason[snap.season] = new Set();
    teamsBySeason[snap.season].add(snap.team_id);
  }
  for (const season of Object.keys(teamsBySeason).sort()) {
    console.log(`  ${season}: ${teamsBySeason[parseInt(season)].size} teams`);
  }
}

validateCoverage().catch(console.error);

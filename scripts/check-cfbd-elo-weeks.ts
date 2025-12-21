/**
 * Check CFBD Elo data availability by week
 */

const BASE_URL = 'https://api.collegefootballdata.com';
const API_KEY = process.env.CFBD_API_KEY;

async function checkWeek(year: number, week: number): Promise<void> {
  const url = new URL(`${BASE_URL}/ratings/elo`);
  url.searchParams.set('year', String(year));
  url.searchParams.set('week', String(week));

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (response.status !== 200) {
    console.log(`Year ${year} Week ${week}: Error ${response.status}`);
    return;
  }

  const data = await response.json();
  if (data.length === 0) {
    console.log(`Year ${year} Week ${week}: No data`);
  } else {
    const army = data.find((d: any) => d.team.toLowerCase() === 'army');
    console.log(`Year ${year} Week ${week}: ${data.length} teams | Army: ${army?.elo || 'N/A'}`);
  }
}

async function main() {
  console.log('=== CFBD ELO BY WEEK ===\n');

  const weeks = [0, 1, 5, 10, 13, 14, 15, 16];

  console.log('2025 Season:');
  for (const w of weeks) {
    await checkWeek(2025, w);
  }

  console.log('\n2024 Season:');
  for (const w of weeks) {
    await checkWeek(2024, w);
  }
}

main().catch(console.error);

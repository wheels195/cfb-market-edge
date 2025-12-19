/**
 * Check actual SP+ response format
 */
const API_KEY = process.env.CFBD_API_KEY;

async function main() {
  const response = await fetch('https://api.collegefootballdata.com/ratings/sp?year=2024', {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();
  console.log('Sample SP+ response (first 3):');
  console.log(JSON.stringify(data.slice(0, 3), null, 2));
}

main();

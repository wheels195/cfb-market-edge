import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

const searchTerms = [
  'St. Thomas', 'Thomas',
  'Seattle',
  'Omaha', 'Nebraska Omaha',
  'Queens',
  'Maryland-Eastern', 'Eastern Shore',
  'Florida Int', 'FIU',
  'Texas A&M-Commerce', 'Commerce',
  'IUPUI',
  'Appalachian',
  'Hawaii', 'Hawai'
];

async function search() {
  for (const term of searchTerms) {
    const { data } = await supabase
      .from('cbb_teams')
      .select('id, school, mascot')
      .ilike('school', '%' + term + '%')
      .limit(5);
    if (data?.length) {
      console.log(`Searching '${term}':`);
      data.forEach(t => console.log(`  - ${t.school} ${t.mascot || ''} (id: ${t.id})`));
    }
  }
}
search();

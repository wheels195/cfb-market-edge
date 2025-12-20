/**
 * Quick test of Odds API historical sync
 */
import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function hashPayload(data: Record<string, unknown>): string {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').slice(0, 8);
}

async function test() {
  // Get DK sportsbook
  const { data: sb } = await supabase.from('sportsbooks').select('id').eq('key', 'draftkings').single();
  const dkId = sb?.id;
  console.log('DraftKings ID:', dkId);

  // Get 3 events from September 2024
  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team:home_team_id(name),
      away_team:away_team_id(name)
    `)
    .eq('status', 'final')
    .gte('commence_time', '2024-09-07T00:00:00Z')
    .lte('commence_time', '2024-09-08T00:00:00Z')
    .limit(3);

  console.log(`\nFound ${events?.length || 0} events to test\n`);

  for (const event of events || []) {
    const homeName = (event.home_team as any)?.name || 'Unknown';
    const awayName = (event.away_team as any)?.name || 'Unknown';

    console.log(`=== ${awayName} @ ${homeName} ===`);
    console.log(`Kickoff: ${event.commence_time}`);

    const kickoff = new Date(event.commence_time);

    // Get opening odds (7 days before)
    const openDate = new Date(kickoff);
    openDate.setDate(openDate.getDate() - 7);

    console.log(`Fetching opening odds at: ${openDate.toISOString()}`);

    const openUrl = `https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds?` +
      `apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&bookmakers=draftkings&date=${openDate.toISOString()}`;

    const openRes = await fetch(openUrl);
    const openData = await openRes.json();

    console.log(`API timestamp: ${openData.timestamp}`);
    console.log(`Games in snapshot: ${openData.data?.length || 0}`);

    // Find matching game
    const dbHome = homeName.toLowerCase();
    const dbAway = awayName.toLowerCase();

    const match = openData.data?.find((g: any) => {
      const apiHome = g.home_team.toLowerCase();
      const apiAway = g.away_team.toLowerCase();
      // Match on first word of team name
      return apiHome.includes(dbHome.split(' ')[0]) || dbHome.includes(apiHome.split(' ')[0]);
    });

    if (match) {
      console.log(`Matched: ${match.away_team} @ ${match.home_team}`);

      const dk = match.bookmakers?.find((b: any) => b.key === 'draftkings');
      const spreads = dk?.markets?.find((m: any) => m.key === 'spreads');

      if (spreads) {
        console.log('Spreads:');
        for (const o of spreads.outcomes) {
          const american = decimalToAmerican(o.price);
          console.log(`  ${o.name}: ${o.point > 0 ? '+' : ''}${o.point} @ ${o.price} (${american})`);
        }

        // Insert test tick
        const outcome = spreads.outcomes[0];
        const record = {
          event_id: event.id,
          sportsbook_id: dkId,
          market_type: 'spread',
          captured_at: openData.timestamp,
          side: 'home',
          spread_points_home: outcome.point,
          total_points: null,
          price_american: decimalToAmerican(outcome.price),
          price_decimal: outcome.price,
          payload_hash: hashPayload({ t: 'open', e: event.id, s: 'home', p: outcome.point }),
          tick_type: 'open',
        };

        const { error } = await supabase.from('odds_ticks').upsert(record, { onConflict: 'payload_hash' });
        console.log(`Insert: ${error ? error.message : 'SUCCESS'}`);
      }
    } else {
      console.log('No match found');
    }

    console.log('');

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  // Check final tick count
  const { data: ticks } = await supabase.from('odds_ticks').select('tick_type');
  const counts: Record<string, number> = {};
  for (const t of ticks || []) {
    counts[t.tick_type || 'null'] = (counts[t.tick_type || 'null'] || 0) + 1;
  }
  console.log('Tick type counts:', counts);
}

test().catch(console.error);

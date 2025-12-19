import { supabase } from './client';
import { OddsTick, ClosingLine, Projection, Result } from '@/types/database';

export interface EventDetailData {
  oddsHistory: {
    draftkings: {
      spread: OddsTick[];
      total: OddsTick[];
    };
    fanduel: {
      spread: OddsTick[];
      total: OddsTick[];
    };
  };
  closingLines: ClosingLine[];
  projection: Projection | null;
  result: Result | null;
}

/**
 * Get all data needed for event detail page
 */
export async function getEventDetailData(eventId: string): Promise<EventDetailData> {
  // Get sportsbooks
  const { data: sportsbooks } = await supabase
    .from('sportsbooks')
    .select('id, key');

  const sbMap = new Map<string, string>();
  for (const sb of sportsbooks || []) {
    sbMap.set(sb.id, sb.key);
  }

  // Get odds history
  const { data: oddsTicks } = await supabase
    .from('odds_ticks')
    .select('*')
    .eq('event_id', eventId)
    .order('captured_at', { ascending: true });

  // Organize by book and market
  const oddsHistory: EventDetailData['oddsHistory'] = {
    draftkings: { spread: [], total: [] },
    fanduel: { spread: [], total: [] },
  };

  for (const tick of oddsTicks || []) {
    const bookKey = sbMap.get(tick.sportsbook_id);
    if (!bookKey) continue;

    const book = bookKey === 'draftkings' ? 'draftkings' : 'fanduel';
    if (tick.market_type === 'spread') {
      oddsHistory[book].spread.push(tick);
    } else if (tick.market_type === 'total') {
      oddsHistory[book].total.push(tick);
    }
  }

  // Get closing lines
  const { data: closingLines } = await supabase
    .from('closing_lines')
    .select('*')
    .eq('event_id', eventId);

  // Get projection
  const { data: projection } = await supabase
    .from('projections')
    .select('*')
    .eq('event_id', eventId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  // Get result
  const { data: result } = await supabase
    .from('results')
    .select('*')
    .eq('event_id', eventId)
    .single();

  return {
    oddsHistory,
    closingLines: closingLines || [],
    projection: projection || null,
    result: result || null,
  };
}

/**
 * Transform odds ticks into chart data format
 */
export interface ChartDataPoint {
  time: string;
  timestamp: number;
  homeSpread?: number;
  awaySpread?: number;
  homePrice?: number;
  awayPrice?: number;
  totalPoints?: number;
  overPrice?: number;
  underPrice?: number;
}

export function transformSpreadTicksToChartData(ticks: OddsTick[]): ChartDataPoint[] {
  // Group by captured_at timestamp
  const byTime = new Map<string, ChartDataPoint>();

  for (const tick of ticks) {
    const timeKey = tick.captured_at;
    if (!byTime.has(timeKey)) {
      byTime.set(timeKey, {
        time: tick.captured_at,
        timestamp: new Date(tick.captured_at).getTime(),
      });
    }

    const point = byTime.get(timeKey)!;
    if (tick.side === 'home' && tick.spread_points_home !== null) {
      point.homeSpread = tick.spread_points_home;
      point.homePrice = tick.price_american;
    } else if (tick.side === 'away' && tick.spread_points_home !== null) {
      point.awaySpread = -tick.spread_points_home;
      point.awayPrice = tick.price_american;
    }
  }

  return Array.from(byTime.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export function transformTotalTicksToChartData(ticks: OddsTick[]): ChartDataPoint[] {
  // Group by captured_at timestamp
  const byTime = new Map<string, ChartDataPoint>();

  for (const tick of ticks) {
    const timeKey = tick.captured_at;
    if (!byTime.has(timeKey)) {
      byTime.set(timeKey, {
        time: tick.captured_at,
        timestamp: new Date(tick.captured_at).getTime(),
      });
    }

    const point = byTime.get(timeKey)!;
    if (tick.side === 'over' && tick.total_points !== null) {
      point.totalPoints = tick.total_points;
      point.overPrice = tick.price_american;
    } else if (tick.side === 'under' && tick.total_points !== null) {
      point.totalPoints = tick.total_points;
      point.underPrice = tick.price_american;
    }
  }

  return Array.from(byTime.values()).sort((a, b) => a.timestamp - b.timestamp);
}

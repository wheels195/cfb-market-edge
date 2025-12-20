import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

export async function GET() {
  try {
    // Get all paper bets
    const { data: bets, error } = await supabase
      .from('paper_bets')
      .select('*')
      .order('bet_placed_at', { ascending: true });

    if (error) throw error;

    // Calculate summary stats
    const settled = bets?.filter(b => b.result === 'win' || b.result === 'loss') || [];
    const wins = settled.filter(b => b.result === 'win').length;
    const losses = settled.filter(b => b.result === 'loss').length;
    const pending = bets?.filter(b => b.result === 'pending').length || 0;

    const totalStaked = settled.reduce((sum, b) => sum + (b.stake_amount || 0), 0);
    const totalProfit = settled.reduce((sum, b) => sum + (b.profit_loss || 0), 0);
    const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;

    // Calculate CLV
    const betsWithCLV = settled.filter(b => b.clv_points !== null);
    const avgCLV = betsWithCLV.length > 0
      ? betsWithCLV.reduce((sum, b) => sum + b.clv_points, 0) / betsWithCLV.length
      : null;

    // Calculate cumulative P&L for chart
    let cumulative = 0;
    const equityCurve = settled.map(b => {
      cumulative += b.profit_loss || 0;
      return {
        date: b.bet_placed_at,
        pnl: cumulative,
        week: b.week,
      };
    });

    // Weekly breakdown
    const weeklyStats = new Map<string, { wins: number; losses: number; profit: number; clv: number[] }>();
    for (const bet of bets || []) {
      const key = `${bet.season}-W${bet.week}`;
      if (!weeklyStats.has(key)) {
        weeklyStats.set(key, { wins: 0, losses: 0, profit: 0, clv: [] });
      }
      const stats = weeklyStats.get(key)!;
      if (bet.result === 'win') stats.wins++;
      if (bet.result === 'loss') stats.losses++;
      if (bet.profit_loss) stats.profit += bet.profit_loss;
      if (bet.clv_points !== null) stats.clv.push(bet.clv_points);
    }

    const weeklyBreakdown = Array.from(weeklyStats.entries()).map(([week, stats]) => ({
      week,
      wins: stats.wins,
      losses: stats.losses,
      profit: stats.profit,
      avgCLV: stats.clv.length > 0 ? stats.clv.reduce((a, b) => a + b, 0) / stats.clv.length : null,
    }));

    // Max drawdown calculation
    let peak = 0;
    let maxDrawdown = 0;
    cumulative = 0;
    for (const bet of settled) {
      cumulative += bet.profit_loss || 0;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return NextResponse.json({
      summary: {
        totalBets: bets?.length || 0,
        settledBets: settled.length,
        pending,
        wins,
        losses,
        winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
        totalStaked,
        totalProfit,
        roi,
        maxDrawdown,
        avgCLV,
      },
      equityCurve,
      weeklyBreakdown,
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summary' },
      { status: 500 }
    );
  }
}

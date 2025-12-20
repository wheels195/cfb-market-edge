import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// GET - Fetch all paper bets
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const season = searchParams.get('season');
    const week = searchParams.get('week');

    let query = supabase
      .from('paper_bets')
      .select(`
        *,
        events (
          id,
          commence_time,
          home_team:home_team_id (id, name),
          away_team:away_team_id (id, name)
        )
      `)
      .order('bet_placed_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    if (season) {
      query = query.eq('season', parseInt(season));
    }
    if (week) {
      query = query.eq('week', parseInt(week));
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ bets: data });
  } catch (error) {
    console.error('Error fetching paper bets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch paper bets' },
      { status: 500 }
    );
  }
}

// POST - Create a new paper bet
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      event_id,
      side,
      market_spread_home,
      spread_price_american,
      model_spread_home,
      edge_points,
      week_rank,
      stake_amount,
      season,
      week,
      notes,
    } = body;

    // Validate required fields
    if (!event_id || !side || market_spread_home === undefined || !spread_price_american) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const abs_edge = Math.abs(edge_points);

    const { data, error } = await supabase
      .from('paper_bets')
      .insert({
        event_id,
        side,
        market_type: 'spread',
        market_spread_home,
        spread_price_american,
        model_spread_home,
        edge_points,
        abs_edge,
        week_rank,
        units: 1.0,
        stake_amount: stake_amount || 100.0,
        season,
        week,
        status: 'pending',
        result: 'pending',
        notes,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ bet: data });
  } catch (error) {
    console.error('Error creating paper bet:', error);
    return NextResponse.json(
      { error: 'Failed to create paper bet' },
      { status: 500 }
    );
  }
}

// DELETE - Clear all paper bets (for resetting after data corrections)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const confirmClear = searchParams.get('confirm');

    // Require confirmation parameter to prevent accidental deletion
    if (confirmClear !== 'true') {
      return NextResponse.json(
        { error: 'Must confirm deletion with ?confirm=true' },
        { status: 400 }
      );
    }

    // Count before deleting
    const { count } = await supabase
      .from('paper_bets')
      .select('id', { count: 'exact', head: true });

    // Delete all paper bets
    const { error } = await supabase
      .from('paper_bets')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'All paper bets cleared',
      deletedCount: count || 0
    });
  } catch (error) {
    console.error('Error clearing paper bets:', error);
    return NextResponse.json(
      { error: 'Failed to clear paper bets' },
      { status: 500 }
    );
  }
}

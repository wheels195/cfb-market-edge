/**
 * Model Reports API
 *
 * Returns stored model performance reports from model_reports table.
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get('sport') || 'all'; // 'cfb', 'cbb', or 'all'

  try {
    let query = supabase
      .from('model_reports')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(30);

    if (sport !== 'all') {
      query = query.eq('sport', sport);
    }

    const { data: reports, error } = await query;

    if (error) {
      console.error('Error fetching reports:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get latest report for each sport
    const latestCFB = reports?.find(r => r.sport === 'cfb');
    const latestCBB = reports?.find(r => r.sport === 'cbb');

    return NextResponse.json({
      reports: reports || [],
      latest: {
        cfb: latestCFB || null,
        cbb: latestCBB || null,
      },
    });
  } catch (error) {
    console.error('Reports API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}

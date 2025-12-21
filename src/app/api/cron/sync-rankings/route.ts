import { NextResponse } from 'next/server';
import { syncRankings } from '@/lib/jobs/sync-rankings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await syncRankings();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Sync rankings error:', error);
    return NextResponse.json(
      { error: 'Failed to sync rankings' },
      { status: 500 }
    );
  }
}

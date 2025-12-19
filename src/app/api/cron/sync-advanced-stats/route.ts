import { NextResponse } from 'next/server';
import { syncAdvancedStats } from '@/lib/jobs/sync-advanced-stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await syncAdvancedStats();

    return NextResponse.json({
      success: result.success,
      teamsUpdated: result.teamsUpdated,
      errors: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

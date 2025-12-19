import { NextResponse } from 'next/server';
import { syncTeamLocations } from '@/lib/models/situational';
import { syncAdvancedStats } from '@/lib/jobs/sync-advanced-stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Sync team data from CFBD:
 * - Team locations (for travel distance)
 * - Advanced stats (pace, success rate, havoc, etc.)
 */
export async function GET() {
  try {
    const errors: string[] = [];

    // Sync team locations
    const locResult = await syncTeamLocations();
    if (locResult.errors.length > 0) {
      errors.push(...locResult.errors);
    }

    // Sync advanced stats
    const statsResult = await syncAdvancedStats();
    if (statsResult.errors.length > 0) {
      errors.push(...statsResult.errors);
    }

    return NextResponse.json({
      success: true,
      locationsUpdated: locResult.updated,
      statsUpdated: statsResult.teamsUpdated,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

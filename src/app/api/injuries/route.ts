import { NextResponse } from 'next/server';
import {
  getAllInjuryReports,
  initializeInjuryData,
  updateInjuryCache,
  parseInjuryData,
  isInjuryCacheStale,
  CURRENT_INJURIES,
} from '@/lib/models/injury-analysis';

export const dynamic = 'force-dynamic';

/**
 * GET /api/injuries - Get all injury reports
 */
export async function GET() {
  try {
    // Initialize if cache is empty or stale
    if (isInjuryCacheStale()) {
      initializeInjuryData();
    }

    const reports = getAllInjuryReports();

    // Summary stats
    const summary = {
      totalTeams: reports.length,
      totalInjuries: reports.reduce((sum, r) => sum + r.injuries.length, 0),
      totalOut: reports.reduce((sum, r) => sum + r.totalOut, 0),
      totalQuestionable: reports.reduce((sum, r) => sum + r.totalQuestionable, 0),
      criticalQBInjuries: reports
        .flatMap(r => r.injuries)
        .filter(i => i.position.toUpperCase() === 'QB' && i.status === 'out')
        .map(i => ({ team: i.team, player: i.playerName, injury: i.injuryType })),
    };

    return NextResponse.json({
      success: true,
      summary,
      reports: reports.sort((a, b) => b.totalOut - a.totalOut),
    });
  } catch (error) {
    console.error('Injuries API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/injuries - Update injury data manually
 * Body: { injuries: Array<{ team, player, position, injury, status }> }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.injuries && Array.isArray(body.injuries)) {
      const reports = parseInjuryData(body.injuries);
      updateInjuryCache(reports);

      return NextResponse.json({
        success: true,
        message: `Updated ${reports.length} teams with ${body.injuries.length} injuries`,
        reports,
      });
    }

    // If no body, just refresh from hardcoded data
    initializeInjuryData();

    return NextResponse.json({
      success: true,
      message: 'Refreshed injury data from current known injuries',
      injuryCount: CURRENT_INJURIES.length,
    });
  } catch (error) {
    console.error('Injuries POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

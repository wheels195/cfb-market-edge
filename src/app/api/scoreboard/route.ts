import { NextResponse } from 'next/server';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const classification = url.searchParams.get('classification') as 'fbs' | 'fcs' | null;
    const conference = url.searchParams.get('conference');

    const cfbd = getCFBDApiClient();

    let games;
    if (conference) {
      games = await cfbd.getScoreboardByConference(conference);
    } else {
      games = await cfbd.getScoreboard(classification || 'fbs');
    }

    // Sort games: in_progress first, then scheduled, then completed
    const statusOrder = { 'in_progress': 0, 'scheduled': 1, 'completed': 2 };
    games.sort((a, b) => {
      const orderA = statusOrder[a.status] ?? 3;
      const orderB = statusOrder[b.status] ?? 3;
      if (orderA !== orderB) return orderA - orderB;
      // Then sort by start time
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });

    return NextResponse.json({
      success: true,
      games,
      summary: {
        total: games.length,
        inProgress: games.filter(g => g.status === 'in_progress').length,
        scheduled: games.filter(g => g.status === 'scheduled').length,
        completed: games.filter(g => g.status === 'completed').length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Scoreboard error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

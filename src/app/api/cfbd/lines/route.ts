import { NextResponse } from 'next/server';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const season = parseInt(url.searchParams.get('season') || '2024', 10);
    const week = url.searchParams.get('week');
    const team = url.searchParams.get('team');
    const seasonType = url.searchParams.get('seasonType') as 'regular' | 'postseason' | null;

    const cfbd = getCFBDApiClient();

    const lines = await cfbd.getBettingLines(
      season,
      week ? parseInt(week, 10) : undefined,
      seasonType || undefined,
      team || undefined
    );

    // Summarize line availability by provider
    const providerCounts: Record<string, number> = {};
    for (const game of lines) {
      for (const line of game.lines) {
        providerCounts[line.provider] = (providerCounts[line.provider] || 0) + 1;
      }
    }

    return NextResponse.json({
      success: true,
      games: lines,
      summary: {
        totalGames: lines.length,
        gamesWithLines: lines.filter(g => g.lines.length > 0).length,
        providers: providerCounts,
      },
    });
  } catch (error) {
    console.error('Betting lines error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

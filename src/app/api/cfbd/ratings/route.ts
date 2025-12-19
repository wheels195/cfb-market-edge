import { NextResponse } from 'next/server';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const season = parseInt(url.searchParams.get('season') || '2024', 10);
    const team = url.searchParams.get('team');

    const cfbd = getCFBDApiClient();

    const ratings = await cfbd.getTeamRatings(season, team || undefined);

    // Calculate rankings by different metrics
    const rankedByElo = [...ratings].sort((a, b) => b.elo - a.elo);
    const rankedBySP = [...ratings]
      .filter(r => r.spOverall !== null)
      .sort((a, b) => (b.spOverall || 0) - (a.spOverall || 0));

    return NextResponse.json({
      success: true,
      data: ratings,
      summary: {
        totalTeams: ratings.length,
        season,
        topByElo: rankedByElo.slice(0, 25).map((t, i) => ({
          rank: i + 1,
          team: t.team,
          conference: t.conference,
          elo: t.elo,
        })),
        topBySP: rankedBySP.slice(0, 25).map((t, i) => ({
          rank: i + 1,
          team: t.team,
          conference: t.conference,
          spOverall: t.spOverall,
          spOffense: t.spOffense,
          spDefense: t.spDefense,
        })),
      },
    });
  } catch (error) {
    console.error('Ratings error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

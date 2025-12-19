import { NextResponse } from 'next/server';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const season = parseInt(url.searchParams.get('season') || '2024', 10);
    const week = url.searchParams.get('week');
    const team = url.searchParams.get('team');
    const type = url.searchParams.get('type') || 'teams'; // 'teams' or 'games'

    const cfbd = getCFBDApiClient();

    if (type === 'games') {
      const gamePPA = await cfbd.getGamePPA(
        season,
        week ? parseInt(week, 10) : undefined,
        team || undefined
      );

      return NextResponse.json({
        success: true,
        type: 'games',
        data: gamePPA,
        summary: {
          totalRecords: gamePPA.length,
          teamsIncluded: [...new Set(gamePPA.map(g => g.team))].length,
        },
      });
    } else {
      const teamPPA = await cfbd.getTeamPPA(
        season,
        team || undefined
      );

      // Calculate rankings
      const rankedByOffense = [...teamPPA].sort((a, b) => b.offense.overall - a.offense.overall);
      const rankedByDefense = [...teamPPA].sort((a, b) => a.defense.overall - b.defense.overall);

      return NextResponse.json({
        success: true,
        type: 'teams',
        data: teamPPA,
        summary: {
          totalTeams: teamPPA.length,
          topOffense: rankedByOffense.slice(0, 10).map(t => ({
            team: t.team,
            ppa: t.offense.overall,
          })),
          topDefense: rankedByDefense.slice(0, 10).map(t => ({
            team: t.team,
            ppa: t.defense.overall,
          })),
        },
      });
    }
  } catch (error) {
    console.error('PPA metrics error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

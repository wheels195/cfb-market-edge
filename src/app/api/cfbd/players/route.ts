import { NextResponse } from 'next/server';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const team = url.searchParams.get('team');
    const season = parseInt(url.searchParams.get('season') || '2024', 10);
    const type = url.searchParams.get('type') || 'roster'; // roster, stats, usage, returning

    if (!team && type !== 'returning') {
      return NextResponse.json(
        { success: false, error: 'Team parameter required for roster, stats, and usage' },
        { status: 400 }
      );
    }

    const cfbd = getCFBDApiClient();

    if (type === 'roster') {
      const roster = await cfbd.getRoster(team!, season);

      // Group by position
      const byPosition: Record<string, typeof roster> = {};
      for (const player of roster) {
        if (!byPosition[player.position]) {
          byPosition[player.position] = [];
        }
        byPosition[player.position].push(player);
      }

      return NextResponse.json({
        success: true,
        type: 'roster',
        team,
        season,
        totalPlayers: roster.length,
        byPosition,
        roster,
      });
    }

    if (type === 'stats') {
      const stats = await cfbd.getPlayerSeasonStats(season, team!);

      // Group stats by player
      const byPlayer: Record<string, { name: string; position: string; stats: Record<string, string> }> = {};
      for (const stat of stats) {
        if (!byPlayer[stat.playerId]) {
          byPlayer[stat.playerId] = {
            name: stat.player,
            position: stat.position,
            stats: {},
          };
        }
        byPlayer[stat.playerId].stats[stat.statType] = stat.stat;
      }

      return NextResponse.json({
        success: true,
        type: 'stats',
        team,
        season,
        totalStats: stats.length,
        players: Object.values(byPlayer),
      });
    }

    if (type === 'usage') {
      const usage = await cfbd.getPlayerUsage(season, team!);

      // Sort by overall usage
      usage.sort((a, b) => b.usage.overall - a.usage.overall);

      return NextResponse.json({
        success: true,
        type: 'usage',
        team,
        season,
        totalPlayers: usage.length,
        topUsage: usage.slice(0, 15).map(p => ({
          name: p.name,
          position: p.position,
          overall: p.usage.overall,
          pass: p.usage.pass,
          rush: p.usage.rush,
        })),
        players: usage,
      });
    }

    if (type === 'returning') {
      const returning = await cfbd.getReturningProduction(season, team || undefined);

      // Sort by percent returning
      returning.sort((a, b) => b.percentPPA - a.percentPPA);

      return NextResponse.json({
        success: true,
        type: 'returning',
        season,
        totalTeams: returning.length,
        topReturning: returning.slice(0, 25).map(t => ({
          team: t.team,
          conference: t.conference,
          percentPPA: Math.round(t.percentPPA * 100),
          percentPassingPPA: Math.round(t.percentPassingPPA * 100),
          percentRushingPPA: Math.round(t.percentRushingPPA * 100),
        })),
        data: returning,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid type parameter' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Player data error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

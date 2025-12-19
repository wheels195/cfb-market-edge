import { NextResponse } from 'next/server';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const season = parseInt(url.searchParams.get('season') || '2024', 10);
    const team = url.searchParams.get('team');

    const cfbd = getCFBDApiClient();
    let portal = await cfbd.getTransferPortal(season);

    // Filter by team if specified (either origin or destination)
    if (team) {
      const teamLower = team.toLowerCase();
      portal = portal.filter(p =>
        p.origin.toLowerCase().includes(teamLower) ||
        (p.destination && p.destination.toLowerCase().includes(teamLower))
      );
    }

    // Separate into incoming and outgoing
    const incoming = team
      ? portal.filter(p => p.destination?.toLowerCase().includes(team.toLowerCase()))
      : [];
    const outgoing = team
      ? portal.filter(p => p.origin.toLowerCase().includes(team.toLowerCase()))
      : [];

    // Count by position
    const byPosition: Record<string, number> = {};
    for (const player of portal) {
      byPosition[player.position] = (byPosition[player.position] || 0) + 1;
    }

    // High-impact transfers (4+ stars)
    const highImpact = portal.filter(p => p.stars >= 4);

    return NextResponse.json({
      success: true,
      season,
      team: team || null,
      summary: {
        totalTransfers: portal.length,
        committed: portal.filter(p => p.destination !== null).length,
        uncommitted: portal.filter(p => p.destination === null).length,
        highImpact: highImpact.length,
        byPosition,
      },
      ...(team && {
        teamSummary: {
          incoming: incoming.length,
          outgoing: outgoing.length,
          netTransfers: incoming.length - outgoing.length,
          incomingPlayers: incoming.map(p => ({
            name: `${p.firstName} ${p.lastName}`,
            position: p.position,
            origin: p.origin,
            stars: p.stars,
            rating: p.rating,
          })),
          outgoingPlayers: outgoing.map(p => ({
            name: `${p.firstName} ${p.lastName}`,
            position: p.position,
            destination: p.destination,
            stars: p.stars,
            rating: p.rating,
          })),
        },
      }),
      highImpactTransfers: highImpact.slice(0, 50).map(p => ({
        name: `${p.firstName} ${p.lastName}`,
        position: p.position,
        origin: p.origin,
        destination: p.destination,
        stars: p.stars,
        rating: p.rating,
        transferDate: p.transferDate,
      })),
    });
  } catch (error) {
    console.error('Transfer portal error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EdgeWithDetails } from '@/types/database';
import { format, formatDistanceToNow } from 'date-fns';

interface EdgesFeedProps {
  edges: EdgeWithDetails[];
}

// Group edges by event
interface GameGroup {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbrev: string | null;
  awayAbbrev: string | null;
  commenceTime: Date;
  spreadEdges: EdgeWithDetails[];
  totalEdges: EdgeWithDetails[];
  bestSpreadEdge: EdgeWithDetails | null;
  bestTotalEdge: EdgeWithDetails | null;
  hasQualifying: boolean;
}

function groupEdgesByGame(edges: EdgeWithDetails[]): GameGroup[] {
  const groups = new Map<string, GameGroup>();

  for (const edge of edges) {
    const eventId = edge.event.id;

    if (!groups.has(eventId)) {
      groups.set(eventId, {
        eventId,
        homeTeam: edge.event.home_team_name,
        awayTeam: edge.event.away_team_name,
        homeAbbrev: edge.event.home_team_abbrev || null,
        awayAbbrev: edge.event.away_team_abbrev || null,
        commenceTime: new Date(edge.event.commence_time),
        spreadEdges: [],
        totalEdges: [],
        bestSpreadEdge: null,
        bestTotalEdge: null,
        hasQualifying: false,
      });
    }

    const group = groups.get(eventId)!;
    const explain = edge.explain as { qualifies?: boolean } | null;

    if (explain?.qualifies) {
      group.hasQualifying = true;
    }

    if (edge.market_type === 'spread') {
      group.spreadEdges.push(edge);
    } else {
      group.totalEdges.push(edge);
    }
  }

  // Find best edge for each market type (highest absolute edge that qualifies, or just highest)
  for (const group of groups.values()) {
    // Sort by qualifying first, then by absolute edge
    const sortEdges = (edges: EdgeWithDetails[]) => {
      return [...edges].sort((a, b) => {
        const aQ = (a.explain as { qualifies?: boolean })?.qualifies ? 1 : 0;
        const bQ = (b.explain as { qualifies?: boolean })?.qualifies ? 1 : 0;
        if (aQ !== bQ) return bQ - aQ;
        return Math.abs(b.edge_points) - Math.abs(a.edge_points);
      });
    };

    const sortedSpreads = sortEdges(group.spreadEdges);
    const sortedTotals = sortEdges(group.totalEdges);

    group.spreadEdges = sortedSpreads;
    group.totalEdges = sortedTotals;
    group.bestSpreadEdge = sortedSpreads[0] || null;
    group.bestTotalEdge = sortedTotals[0] || null;
  }

  // Sort groups: qualifying first, then by best edge
  return Array.from(groups.values()).sort((a, b) => {
    if (a.hasQualifying !== b.hasQualifying) return a.hasQualifying ? -1 : 1;
    const aEdge = Math.max(
      Math.abs(a.bestSpreadEdge?.edge_points || 0),
      Math.abs(a.bestTotalEdge?.edge_points || 0)
    );
    const bEdge = Math.max(
      Math.abs(b.bestSpreadEdge?.edge_points || 0),
      Math.abs(b.bestTotalEdge?.edge_points || 0)
    );
    return bEdge - aEdge;
  });
}

export function EdgesFeed({ edges }: EdgesFeedProps) {
  const gameGroups = groupEdgesByGame(edges);
  const qualifyingGames = gameGroups.filter(g => g.hasQualifying);
  const otherGames = gameGroups.filter(g => !g.hasQualifying);

  return (
    <div className="space-y-8">
      {/* Qualifying Games */}
      {qualifyingGames.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <h2 className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Action ({qualifyingGames.length})
              </h2>
            </div>
            <p className="text-xs text-zinc-500">Edges in profitable range (2.5-5 pts)</p>
          </div>
          <div className="space-y-3">
            {qualifyingGames.map(group => (
              <GameCard key={group.eventId} group={group} />
            ))}
          </div>
        </section>
      )}

      {/* Other Games */}
      {otherGames.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-4">
            Monitoring ({otherGames.length})
          </h2>
          <div className="space-y-3">
            {otherGames.map(group => (
              <GameCard key={group.eventId} group={group} />
            ))}
          </div>
        </section>
      )}

      {edges.length === 0 && (
        <div className="text-center py-16">
          <p className="text-zinc-400">No edges found</p>
        </div>
      )}
    </div>
  );
}

function GameCard({ group }: { group: GameGroup }) {
  const [expanded, setExpanded] = useState(false);
  const timeUntil = formatDistanceToNow(group.commenceTime, { addSuffix: false });

  // Get team display names (prefer abbreviations)
  const away = group.awayAbbrev || group.awayTeam.split(' ').pop() || group.awayTeam;
  const home = group.homeAbbrev || group.homeTeam.split(' ').pop() || group.homeTeam;

  return (
    <div className={`
      rounded-xl border transition-all duration-200
      ${group.hasQualifying
        ? 'bg-zinc-900 border-emerald-500/30'
        : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
      }
    `}>
      {/* Game Header */}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-4">
          <Link href={`/events/${group.eventId}`} className="group">
            <h3 className="text-lg font-semibold text-zinc-100 group-hover:text-white transition-colors">
              {away} <span className="text-zinc-500 font-normal">@</span> {home}
            </h3>
            <p className="text-sm text-zinc-500">
              {format(group.commenceTime, 'EEE, MMM d · h:mm a')} <span className="text-zinc-600">·</span> {timeUntil}
            </p>
          </Link>

          {group.hasQualifying && (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Qualifying
            </span>
          )}
        </div>

        {/* Best Edges Row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Spread */}
          <EdgeSummary
            label="Spread"
            edge={group.bestSpreadEdge}
            allEdges={group.spreadEdges}
            expanded={expanded}
          />

          {/* Total */}
          <EdgeSummary
            label="Total"
            edge={group.bestTotalEdge}
            allEdges={group.totalEdges}
            expanded={expanded}
          />
        </div>
      </div>

      {/* Expand Toggle */}
      {(group.spreadEdges.length > 1 || group.totalEdges.length > 1) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-5 py-2.5 flex items-center justify-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 border-t border-zinc-800/50 transition-colors"
        >
          <span>
            {expanded ? 'Hide' : 'Compare'} {group.spreadEdges.length + group.totalEdges.length} books
          </span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Expanded Book Comparison */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-zinc-800/50">
          <div className="grid grid-cols-2 gap-4 pt-4">
            {/* All Spread Books */}
            <div className="space-y-2">
              {group.spreadEdges.map(edge => (
                <BookRow key={edge.id} edge={edge} />
              ))}
            </div>

            {/* All Total Books */}
            <div className="space-y-2">
              {group.totalEdges.map(edge => (
                <BookRow key={edge.id} edge={edge} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeSummary({
  label,
  edge,
  allEdges,
  expanded
}: {
  label: string;
  edge: EdgeWithDetails | null;
  allEdges: EdgeWithDetails[];
  expanded: boolean;
}) {
  if (!edge) {
    return (
      <div className="p-3 rounded-lg bg-zinc-800/30">
        <p className="text-xs text-zinc-600 mb-1">{label}</p>
        <p className="text-sm text-zinc-500">No data</p>
      </div>
    );
  }

  const explain = edge.explain as {
    qualifies?: boolean;
    winProbability?: number;
    expectedValue?: number;
    confidenceTier?: string;
  } | null;

  const qualifies = explain?.qualifies ?? false;
  const winProb = explain?.winProbability;
  const ev = explain?.expectedValue;
  const bookName = edge.sportsbook?.name || 'Unknown';
  const bookCount = allEdges.length;

  return (
    <div className={`
      p-3 rounded-lg transition-colors
      ${qualifies
        ? 'bg-emerald-500/10 border border-emerald-500/20'
        : 'bg-zinc-800/30'
      }
    `}>
      {/* Label + Book */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-zinc-500">{label}</p>
        <p className="text-xs text-zinc-500">
          {bookName}
          {bookCount > 1 && !expanded && (
            <span className="text-zinc-600 ml-1">+{bookCount - 1}</span>
          )}
        </p>
      </div>

      {/* Bet + Edge */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-zinc-100 truncate">
          {edge.recommended_bet_label}
        </p>
        <p className={`text-lg font-semibold tabular-nums ${
          qualifies ? 'text-emerald-400' : 'text-zinc-300'
        }`}>
          {edge.edge_points > 0 ? '+' : ''}{edge.edge_points.toFixed(1)}
        </p>
      </div>

      {/* Stats */}
      {qualifies && winProb && (
        <div className="flex items-center gap-3 mt-2 text-xs">
          <span className="text-zinc-500">
            {winProb}% win
          </span>
          {ev !== undefined && (
            <span className={ev > 0 ? 'text-emerald-400' : 'text-zinc-500'}>
              {ev > 0 ? '+' : ''}${ev.toFixed(0)} EV
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function BookRow({ edge }: { edge: EdgeWithDetails }) {
  const explain = edge.explain as {
    qualifies?: boolean;
    lineMovement?: {
      sharpSignal: string;
      alignsWithBet: boolean;
    } | null;
  } | null;

  const qualifies = explain?.qualifies ?? false;
  const bookName = edge.sportsbook?.name || 'Unknown';
  const bookKey = edge.sportsbook?.key || '';
  const isSharp = ['pinnacle', 'lowvig'].includes(bookKey);
  const lineMovement = explain?.lineMovement;
  const hasSharpSignal = lineMovement && lineMovement.sharpSignal !== 'neutral';

  return (
    <div className={`
      flex items-center justify-between py-2 px-3 rounded-lg text-sm
      ${qualifies ? 'bg-emerald-500/5' : 'bg-zinc-800/20'}
    `}>
      <div className="flex items-center gap-2">
        <span className="text-zinc-300">{bookName}</span>
        {isSharp && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
            SHARP
          </span>
        )}
        {hasSharpSignal && (
          <span className={`text-[10px] ${lineMovement.alignsWithBet ? 'text-emerald-400' : 'text-amber-400'}`}>
            {lineMovement.alignsWithBet ? '✓' : '⚠'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-zinc-400 text-xs">
          {edge.market_type === 'spread'
            ? formatSpread(edge.market_spread_home || 0)
            : edge.market_total_points
          }
        </span>
        <span className={`font-medium tabular-nums ${
          qualifies ? 'text-emerald-400' : 'text-zinc-300'
        }`}>
          {edge.edge_points > 0 ? '+' : ''}{edge.edge_points.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function formatSpread(points: number): string {
  if (points > 0) return `+${points}`;
  return points.toString();
}

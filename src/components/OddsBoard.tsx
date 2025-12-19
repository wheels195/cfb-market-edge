'use client';

import React from 'react';
import Link from 'next/link';
import { EventWithOdds } from '@/types/database';
import { format } from 'date-fns';
import { formatOdds, formatSpread } from '@/lib/db/queries-odds';

interface OddsBoardProps {
  events: EventWithOdds[];
}

const BOOKS = [
  { key: 'draftkings', name: 'DK' },
  { key: 'fanduel', name: 'FD' },
];

export function OddsBoard({ events }: OddsBoardProps) {
  // Group events by date
  const eventsByDate = events.reduce((acc, event) => {
    const date = format(new Date(event.commence_time), 'yyyy-MM-dd');
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(event);
    return acc;
  }, {} as Record<string, EventWithOdds[]>);

  return (
    <div className="space-y-8">
      {Object.entries(eventsByDate).map(([date, dayEvents]) => (
        <div key={date}>
          <h2 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
            {format(new Date(date), 'EEEE, MMMM d')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="text-left py-2 px-3 text-sm font-medium text-zinc-500 dark:text-zinc-400 w-48">
                    Game
                  </th>
                  {BOOKS.map(book => (
                    <th
                      key={book.key}
                      colSpan={2}
                      className="text-center py-2 px-3 text-sm font-medium text-zinc-500 dark:text-zinc-400"
                    >
                      {book.name}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-zinc-200 dark:border-zinc-700 text-xs text-zinc-400 dark:text-zinc-500">
                  <th></th>
                  {BOOKS.map(book => (
                    <React.Fragment key={book.key}>
                      <th className="py-1 px-2">Spread</th>
                      <th className="py-1 px-2">Total</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dayEvents.map(event => (
                  <OddsRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function OddsRow({ event }: { event: EventWithOdds }) {
  const commenceTime = new Date(event.commence_time);
  const timeStr = format(commenceTime, 'h:mm a');

  return (
    <>
      {/* Away team row */}
      <tr className="border-b border-zinc-100 dark:border-zinc-800">
        <td className="py-2 px-3">
          <Link
            href={`/events/${event.id}`}
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {event.away_team_name}
            </div>
          </Link>
        </td>
        {BOOKS.map(book => {
          const bookOdds = event.odds[book.key];
          return (
            <React.Fragment key={`away-${book.key}`}>
              <td className="py-2 px-2 text-center">
                {bookOdds?.spread ? (
                  <SpreadCell
                    points={-bookOdds.spread.home.points}
                    price={bookOdds.spread.away.price}
                  />
                ) : (
                  <span className="text-zinc-400">-</span>
                )}
              </td>
              <td className="py-2 px-2 text-center">
                {bookOdds?.total ? (
                  <TotalCell
                    side="over"
                    points={bookOdds.total.over.points}
                    price={bookOdds.total.over.price}
                  />
                ) : (
                  <span className="text-zinc-400">-</span>
                )}
              </td>
            </React.Fragment>
          );
        })}
      </tr>
      {/* Home team row */}
      <tr className="border-b-2 border-zinc-200 dark:border-zinc-700">
        <td className="py-2 px-3">
          <Link
            href={`/events/${event.id}`}
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              @ {event.home_team_name}
            </div>
            <div className="text-xs text-zinc-500">{timeStr}</div>
          </Link>
        </td>
        {BOOKS.map(book => {
          const bookOdds = event.odds[book.key];
          return (
            <React.Fragment key={`home-${book.key}`}>
              <td className="py-2 px-2 text-center">
                {bookOdds?.spread ? (
                  <SpreadCell
                    points={bookOdds.spread.home.points}
                    price={bookOdds.spread.home.price}
                  />
                ) : (
                  <span className="text-zinc-400">-</span>
                )}
              </td>
              <td className="py-2 px-2 text-center">
                {bookOdds?.total ? (
                  <TotalCell
                    side="under"
                    points={bookOdds.total.under.points}
                    price={bookOdds.total.under.price}
                  />
                ) : (
                  <span className="text-zinc-400">-</span>
                )}
              </td>
            </React.Fragment>
          );
        })}
      </tr>
    </>
  );
}

function SpreadCell({ points, price }: { points: number; price: number }) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 rounded px-2 py-1 inline-block min-w-[80px]">
      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {formatSpread(points)}
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        {formatOdds(price)}
      </div>
    </div>
  );
}

function TotalCell({
  side,
  points,
  price,
}: {
  side: 'over' | 'under';
  points: number;
  price: number;
}) {
  const label = side === 'over' ? 'O' : 'U';
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 rounded px-2 py-1 inline-block min-w-[80px]">
      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {label} {points}
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        {formatOdds(price)}
      </div>
    </div>
  );
}

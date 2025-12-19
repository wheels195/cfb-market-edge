import { getUpcomingEvents } from '@/lib/db/queries';
import { EventsList } from '@/components/EventsList';

export const dynamic = 'force-dynamic';
export const revalidate = 60; // Revalidate every minute

export default async function HomePage() {
  let events: Awaited<ReturnType<typeof getUpcomingEvents>> = [];
  let error: string | null = null;

  try {
    events = await getUpcomingEvents(50);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load events';
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Upcoming Games
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            NCAAF games with available odds from DraftKings and FanDuel
          </p>
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">
            Error loading events: {error}
          </p>
          <p className="text-sm text-red-500 dark:text-red-500 mt-2">
            Make sure your database is configured and the schema is applied.
          </p>
        </div>
      ) : events.length === 0 ? (
        <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-8 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">
            No upcoming games found.
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-2">
            Run the sync-events job to fetch games from The Odds API.
          </p>
        </div>
      ) : (
        <EventsList events={events} />
      )}
    </div>
  );
}

import { getEventsWithOdds } from '@/lib/db/queries-odds';
import { OddsBoard } from '@/components/OddsBoard';

export const dynamic = 'force-dynamic';
export const revalidate = 30; // Revalidate every 30 seconds

export default async function OddsPage() {
  let events: Awaited<ReturnType<typeof getEventsWithOdds>> = [];
  let error: string | null = null;

  try {
    events = await getEventsWithOdds(50);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load odds';
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Odds Board
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Current spreads and totals from DraftKings and FanDuel
        </p>
      </div>

      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">
            Error loading odds: {error}
          </p>
        </div>
      ) : events.length === 0 ? (
        <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-8 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">
            No games with odds available.
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-2">
            Run the sync-events and poll-odds jobs to fetch data.
          </p>
        </div>
      ) : (
        <OddsBoard events={events} />
      )}
    </div>
  );
}

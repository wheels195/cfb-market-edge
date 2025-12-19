import { notFound } from 'next/navigation';
import { getEventById } from '@/lib/db/queries';
import {
  getEventDetailData,
  transformSpreadTicksToChartData,
  transformTotalTicksToChartData,
} from '@/lib/db/queries-event';
import { LineMovementChart } from '@/components/LineMovementChart';
import { format } from 'date-fns';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EventDetailPage({ params }: PageProps) {
  const { id } = await params;
  const event = await getEventById(id);

  if (!event) {
    notFound();
  }

  const detailData = await getEventDetailData(id);

  const commenceTime = new Date(event.commence_time);
  const dateStr = format(commenceTime, 'EEEE, MMMM d, yyyy');
  const timeStr = format(commenceTime, 'h:mm a');

  // Transform data for charts
  const dkSpreadData = transformSpreadTicksToChartData(detailData.oddsHistory.draftkings.spread);
  const fdSpreadData = transformSpreadTicksToChartData(detailData.oddsHistory.fanduel.spread);
  const dkTotalData = transformTotalTicksToChartData(detailData.oddsHistory.draftkings.total);
  const fdTotalData = transformTotalTicksToChartData(detailData.oddsHistory.fanduel.total);

  // Get opening and current values
  const dkSpreadOpen = dkSpreadData[0]?.homeSpread;
  const dkSpreadCurrent = dkSpreadData[dkSpreadData.length - 1]?.homeSpread;
  const fdSpreadOpen = fdSpreadData[0]?.homeSpread;
  const fdSpreadCurrent = fdSpreadData[fdSpreadData.length - 1]?.homeSpread;

  const dkTotalOpen = dkTotalData[0]?.totalPoints;
  const dkTotalCurrent = dkTotalData[dkTotalData.length - 1]?.totalPoints;
  const fdTotalOpen = fdTotalData[0]?.totalPoints;
  const fdTotalCurrent = fdTotalData[fdTotalData.length - 1]?.totalPoints;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {event.away_team_name} @ {event.home_team_name}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {dateStr} at {timeStr}
          </p>
        </div>
      </div>

      {/* Result if available */}
      {detailData.result && (
        <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Final Score</h3>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {event.away_team_name} {detailData.result.away_score} - {detailData.result.home_score} {event.home_team_name}
          </div>
          <div className="text-sm text-zinc-500 mt-1">
            Total: {detailData.result.final_total} | Home Margin: {detailData.result.home_margin > 0 ? '+' : ''}{detailData.result.home_margin}
          </div>
        </div>
      )}

      {/* Projection if available */}
      {detailData.projection && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-2">Model Projection</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-blue-600 dark:text-blue-500">Spread</div>
              <div className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                {event.home_team_name} {detailData.projection.model_spread_home > 0 ? '+' : ''}{detailData.projection.model_spread_home.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs text-blue-600 dark:text-blue-500">Total</div>
              <div className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                {detailData.projection.model_total_points.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Line Movement Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DraftKings Spread */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">DraftKings Spread</h3>
            {dkSpreadOpen !== undefined && dkSpreadCurrent !== undefined && (
              <LineMovement open={dkSpreadOpen} current={dkSpreadCurrent} />
            )}
          </div>
          {dkSpreadData.length > 0 ? (
            <LineMovementChart
              data={dkSpreadData}
              dataKey="homeSpread"
              label={`${event.home_team_name} Spread`}
              color="#3b82f6"
            />
          ) : (
            <div className="h-48 flex items-center justify-center text-zinc-400">
              No spread data available
            </div>
          )}
        </div>

        {/* FanDuel Spread */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">FanDuel Spread</h3>
            {fdSpreadOpen !== undefined && fdSpreadCurrent !== undefined && (
              <LineMovement open={fdSpreadOpen} current={fdSpreadCurrent} />
            )}
          </div>
          {fdSpreadData.length > 0 ? (
            <LineMovementChart
              data={fdSpreadData}
              dataKey="homeSpread"
              label={`${event.home_team_name} Spread`}
              color="#8b5cf6"
            />
          ) : (
            <div className="h-48 flex items-center justify-center text-zinc-400">
              No spread data available
            </div>
          )}
        </div>

        {/* DraftKings Total */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">DraftKings Total</h3>
            {dkTotalOpen !== undefined && dkTotalCurrent !== undefined && (
              <LineMovement open={dkTotalOpen} current={dkTotalCurrent} />
            )}
          </div>
          {dkTotalData.length > 0 ? (
            <LineMovementChart
              data={dkTotalData}
              dataKey="totalPoints"
              label="Total Points"
              color="#10b981"
            />
          ) : (
            <div className="h-48 flex items-center justify-center text-zinc-400">
              No total data available
            </div>
          )}
        </div>

        {/* FanDuel Total */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">FanDuel Total</h3>
            {fdTotalOpen !== undefined && fdTotalCurrent !== undefined && (
              <LineMovement open={fdTotalOpen} current={fdTotalCurrent} />
            )}
          </div>
          {fdTotalData.length > 0 ? (
            <LineMovementChart
              data={fdTotalData}
              dataKey="totalPoints"
              label="Total Points"
              color="#f59e0b"
            />
          ) : (
            <div className="h-48 flex items-center justify-center text-zinc-400">
              No total data available
            </div>
          )}
        </div>
      </div>

      {/* Closing Lines */}
      {detailData.closingLines.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Closing Lines</h3>
          <div className="text-sm text-zinc-500">
            {detailData.closingLines.length} closing line(s) recorded
          </div>
        </div>
      )}
    </div>
  );
}

function LineMovement({ open, current }: { open: number; current: number }) {
  const diff = current - open;
  if (diff === 0) return null;

  const isUp = diff > 0;
  return (
    <span className={`text-sm font-medium ${isUp ? 'text-green-600' : 'text-red-600'}`}>
      {open.toFixed(1)} → {current.toFixed(1)} ({isUp ? '+' : ''}{diff.toFixed(1)})
    </span>
  );
}

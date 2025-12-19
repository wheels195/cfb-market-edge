'use client';

import { useState } from 'react';
import { BacktestResult, BacktestBet } from '@/lib/backtest/runner';
import { format } from 'date-fns';

export default function BacktestPage() {
  const [config, setConfig] = useState({
    startDate: '',
    endDate: '',
    edgeThreshold: '1.0',
    betTimeMinutes: '60',
    sportsbookKey: '',
    marketType: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const runBacktest = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Backtest failed');
      }

      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const exportToCsv = () => {
    if (!result || result.bets.length === 0) return;

    const headers = [
      'Date',
      'Home Team',
      'Away Team',
      'Sportsbook',
      'Market',
      'Bet',
      'Edge',
      'Number',
      'Price',
      'Close',
      'Result',
      'Outcome',
      'Profit',
      'CLV',
    ];

    const rows = result.bets.map(bet => [
      format(new Date(bet.commenceTime), 'yyyy-MM-dd'),
      bet.homeTeam,
      bet.awayTeam,
      bet.sportsbookKey,
      bet.marketType,
      bet.betLabel,
      bet.edgePoints.toFixed(1),
      bet.betNumber.toString(),
      bet.betPrice.toString(),
      bet.closeNumber?.toString() || '',
      bet.actualResult.toString(),
      bet.outcome,
      bet.profit.toFixed(2),
      bet.clvPoints?.toFixed(1) || '',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest-${config.startDate}-${config.endDate}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Backtest
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Test model performance on historical data
        </p>
      </div>

      {/* Configuration Form */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Configuration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={config.startDate}
              onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={config.endDate}
              onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Edge Threshold (points)
            </label>
            <select
              value={config.edgeThreshold}
              onChange={(e) => setConfig({ ...config, edgeThreshold: e.target.value })}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            >
              <option value="0.5">0.5+</option>
              <option value="1.0">1.0+</option>
              <option value="1.5">1.5+</option>
              <option value="2.0">2.0+</option>
              <option value="3.0">3.0+</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Bet Time (minutes before kickoff)
            </label>
            <select
              value={config.betTimeMinutes}
              onChange={(e) => setConfig({ ...config, betTimeMinutes: e.target.value })}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            >
              <option value="30">30 minutes</option>
              <option value="60">60 minutes</option>
              <option value="120">2 hours</option>
              <option value="240">4 hours</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Sportsbook
            </label>
            <select
              value={config.sportsbookKey}
              onChange={(e) => setConfig({ ...config, sportsbookKey: e.target.value })}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            >
              <option value="">All Books</option>
              <option value="draftkings">DraftKings</option>
              <option value="fanduel">FanDuel</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Market Type
            </label>
            <select
              value={config.marketType}
              onChange={(e) => setConfig({ ...config, marketType: e.target.value })}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            >
              <option value="">All Markets</option>
              <option value="spread">Spreads</option>
              <option value="total">Totals</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={runBacktest}
            disabled={loading || !config.startDate || !config.endDate}
            className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Running...' : 'Run Backtest'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Metrics Summary */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
                Results Summary
              </h2>
              {result.bets.length > 0 && (
                <button
                  onClick={exportToCsv}
                  className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  Export CSV
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Total Bets"
                value={result.metrics.totalBets.toString()}
              />
              <MetricCard
                label="Win Rate"
                value={`${(result.metrics.winRate * 100).toFixed(1)}%`}
                subtext={`${result.metrics.wins}W - ${result.metrics.losses}L - ${result.metrics.pushes}P`}
              />
              <MetricCard
                label="Total Profit"
                value={`$${result.metrics.totalProfit.toFixed(2)}`}
                positive={result.metrics.totalProfit > 0}
              />
              <MetricCard
                label="ROI"
                value={`${(result.metrics.roi * 100).toFixed(1)}%`}
                positive={result.metrics.roi > 0}
              />
              <MetricCard
                label="Avg Edge"
                value={`${result.metrics.avgEdge.toFixed(1)} pts`}
              />
              {result.metrics.avgClv !== null && (
                <MetricCard
                  label="Avg CLV"
                  value={`${result.metrics.avgClv.toFixed(1)} pts`}
                  positive={result.metrics.avgClv > 0}
                />
              )}
            </div>

            {/* By Market Breakdown */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                By Market
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
                  <div className="text-xs text-zinc-500">Spreads</div>
                  <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {result.metrics.byMarket.spread.bets} bets
                  </div>
                  <div className="text-sm text-zinc-500">
                    {(result.metrics.byMarket.spread.winRate * 100).toFixed(1)}% WR |{' '}
                    <span className={result.metrics.byMarket.spread.roi >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {(result.metrics.byMarket.spread.roi * 100).toFixed(1)}% ROI
                    </span>
                  </div>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
                  <div className="text-xs text-zinc-500">Totals</div>
                  <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {result.metrics.byMarket.total.bets} bets
                  </div>
                  <div className="text-sm text-zinc-500">
                    {(result.metrics.byMarket.total.winRate * 100).toFixed(1)}% WR |{' '}
                    <span className={result.metrics.byMarket.total.roi >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {(result.metrics.byMarket.total.roi * 100).toFixed(1)}% ROI
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bets Table */}
          {result.bets.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Individual Bets ({result.bets.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-400">
                      <th className="text-left py-2 px-3">Date</th>
                      <th className="text-left py-2 px-3">Game</th>
                      <th className="text-left py-2 px-3">Book</th>
                      <th className="text-left py-2 px-3">Bet</th>
                      <th className="text-right py-2 px-3">Edge</th>
                      <th className="text-right py-2 px-3">Number</th>
                      <th className="text-right py-2 px-3">Close</th>
                      <th className="text-center py-2 px-3">Outcome</th>
                      <th className="text-right py-2 px-3">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.bets.map((bet, idx) => (
                      <BetRow key={idx} bet={bet} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtext,
  positive,
}: {
  label: string;
  value: string;
  subtext?: string;
  positive?: boolean;
}) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div
        className={`text-xl font-bold ${
          positive !== undefined
            ? positive
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
            : 'text-zinc-900 dark:text-zinc-100'
        }`}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-xs text-zinc-500 dark:text-zinc-500">{subtext}</div>
      )}
    </div>
  );
}

function BetRow({ bet }: { bet: BacktestBet }) {
  const outcomeColors = {
    win: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    loss: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    push: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  };

  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800 text-sm">
      <td className="py-2 px-3 text-zinc-500">
        {format(new Date(bet.commenceTime), 'M/d')}
      </td>
      <td className="py-2 px-3">
        <div className="text-zinc-900 dark:text-zinc-100">
          {bet.awayTeam} @ {bet.homeTeam}
        </div>
      </td>
      <td className="py-2 px-3 text-zinc-500">{bet.sportsbookKey}</td>
      <td className="py-2 px-3">
        <span className="text-zinc-900 dark:text-zinc-100">{bet.betLabel}</span>
      </td>
      <td className="py-2 px-3 text-right text-zinc-500">
        {bet.edgePoints.toFixed(1)}
      </td>
      <td className="py-2 px-3 text-right text-zinc-900 dark:text-zinc-100">
        {bet.betNumber}
      </td>
      <td className="py-2 px-3 text-right text-zinc-500">
        {bet.closeNumber ?? '-'}
      </td>
      <td className="py-2 px-3 text-center">
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${outcomeColors[bet.outcome]}`}
        >
          {bet.outcome.toUpperCase()}
        </span>
      </td>
      <td
        className={`py-2 px-3 text-right font-medium ${
          bet.profit > 0
            ? 'text-green-600 dark:text-green-400'
            : bet.profit < 0
            ? 'text-red-600 dark:text-red-400'
            : 'text-zinc-500'
        }`}
      >
        {bet.profit > 0 ? '+' : ''}${bet.profit.toFixed(0)}
      </td>
    </tr>
  );
}

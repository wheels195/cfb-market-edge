'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { ChartDataPoint } from '@/lib/db/queries-event';

interface LineMovementChartProps {
  data: ChartDataPoint[];
  dataKey: string;
  label: string;
  color: string;
}

export function LineMovementChart({ data, dataKey, label, color }: LineMovementChartProps) {
  // Calculate Y axis domain with some padding
  const values = data.map(d => d[dataKey as keyof ChartDataPoint] as number).filter(v => v !== undefined);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const padding = (maxVal - minVal) * 0.1 || 1;

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value) => format(new Date(value), 'M/d HH:mm')}
            stroke="#6b7280"
            fontSize={10}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[minVal - padding, maxVal + padding]}
            stroke="#6b7280"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => value.toFixed(1)}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || !payload[0] || label === undefined) return null;
              return (
                <div className="bg-zinc-800 text-white px-3 py-2 rounded shadow-lg text-sm">
                  <div className="text-zinc-400 text-xs mb-1">
                    {format(new Date(label as number), 'MMM d, HH:mm')}
                  </div>
                  <div className="font-medium">
                    {payload[0].name}: {Number(payload[0].value).toFixed(1)}
                  </div>
                </div>
              );
            }}
          />
          <Line
            type="stepAfter"
            dataKey={dataKey}
            name={label}
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

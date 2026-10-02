import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { sequentialBlueForValue, useChartTheme } from '@/lib/chartPalette';
import type { BarangayRankingRow } from '@/lib/api';

// Magnitude read (population per barangay), not identity -- every bar uses
// the sequential blue ramp keyed by its own count, never the categorical
// palette (that's reserved for the Sankey/household-tree's module colors).
export function BarangayRankingChart({
  data,
  selectedCode,
  onBarangayClick,
}: {
  data: BarangayRankingRow[];
  selectedCode: string | null;
  onBarangayClick: (code: string) => void;
}) {
  const theme = useChartTheme();

  if (data.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--t-muted)', textAlign: 'center', padding: '48px 0' }}>
        No barangay data yet. It fills in once citizens have a barangay on file.
      </p>
    );
  }

  const counts = data.map((d) => d.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const top = data.slice(0, 15); // ranked list, not every barangay in the city at once

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={top} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--t-muted)' }} />
        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: 'var(--t-muted)' }} />
        <Tooltip contentStyle={{ borderRadius: 'var(--r-md)', fontSize: 12 }} formatter={(value) => [value, 'Citizens']} />
        <Bar isAnimationActive={false}
          dataKey="count"
          radius={[0, 4, 4, 0]}
          maxBarSize={22}
          onClick={(entry) => onBarangayClick((entry as unknown as BarangayRankingRow).code)}
          cursor="pointer"
        >
          {top.map((row) => (
            <Cell
              key={row.code}
              fill={sequentialBlueForValue(row.count, min, max, theme)}
              stroke={selectedCode === row.code ? 'var(--primary)' : 'none'}
              strokeWidth={selectedCode === row.code ? 2 : 0}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

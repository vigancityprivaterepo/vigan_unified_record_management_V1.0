import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendPoint } from '@/lib/api';

// Two series telling distinct series apart -> categorical, slots 1 (blue)
// and 2 (orange) from the same fixed palette used everywhere else on this
// page, even though neither is a membership module -- the identity here is
// "registrations" vs "merges," not a module.
// Focal series = brand teal; context series = muted (charts.md emphasis rule).
const REGISTRATIONS_COLOR = '#0F766E';
const MERGES_COLOR = '#9CA3AF';

export function TrendChart({ data, onMonthClick }: { data: TrendPoint[]; onMonthClick: (month: string) => void }) {
  if (data.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--t-muted)', textAlign: 'center', padding: '48px 0' }}>
        No activity on file yet for this range.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        onClick={(e) => {
          // Recharts 3 reports the clicked point by index (activeLabel can be
          // missing), so look the month up in our own data.
          const ev = e as { activeLabel?: unknown; activeIndex?: unknown; activeTooltipIndex?: unknown } | null;
          const idx = Number(ev?.activeIndex ?? ev?.activeTooltipIndex);
          const month = typeof ev?.activeLabel === 'string' ? ev.activeLabel : Number.isInteger(idx) ? data[idx]?.month : undefined;
          if (month) onMonthClick(month);
        }}
        style={{ cursor: 'pointer' }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--t-muted)' }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--t-muted)' }} />
        <Tooltip contentStyle={{ borderRadius: 'var(--r-md)', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line isAnimationActive={false} type="monotone" dataKey="registrations" name="New registrations" stroke={REGISTRATIONS_COLOR} strokeWidth={2} dot={{ r: 4 }} />
        <Line isAnimationActive={false} type="monotone" dataKey="merges" name="Dedup merges" stroke={MERGES_COLOR} strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

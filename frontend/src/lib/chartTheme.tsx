// Shared chart look, per reference/Anti-AI-UI charts.md ("premium minimal"):
// colorblind-safe categorical palette (teal first, no purple), max 4 colored
// series, horizontal dashed gridlines only, no axis/tick lines, tabular
// numbers, a custom tooltip card, circle legend, donuts capped at 5 slices.

const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

// Modified Okabe-Ito. Light values are the reference set; dark values are
// the same hues lifted for the emerald dark surface.
const CATEGORICAL = {
  light: ['#0F766E', '#0072B2', '#D55E00', '#CC79A7', '#E69F00', '#009E73'],
  dark: ['#2DD4BF', '#56B4E9', '#F0884A', '#E3A3C9', '#F2C063', '#5FD3A5'],
};
const MUTED = { light: '#9CA3AF', dark: '#6F9C8D' };
export const MAX_COLORED_SERIES = 4;
export const MAX_DONUT_SLICES = 5;

// Series i gets a palette color while i < 4; any further series is muted
// grey, so a chart never turns into a rainbow.
export function seriesColor(i: number, limit = MAX_COLORED_SERIES): string {
  const dark = isDark();
  return i < limit ? (dark ? CATEGORICAL.dark : CATEGORICAL.light)[i]! : dark ? MUTED.dark : MUTED.light;
}

export function mutedColor(): string {
  return isDark() ? MUTED.dark : MUTED.light;
}

export const axisProps = {
  tick: { fill: 'var(--t-light)', fontSize: 12 },
  axisLine: false as const,
  tickLine: false as const,
};
export const gridProps = { stroke: 'var(--border-soft)', strokeDasharray: '4 4', vertical: false as const };

// Donuts: largest 4 groups + "Other" once there are more than 5.
export function capSlices<T extends { label: string; value: number }>(points: T[]): Array<{ label: string; value: number }> {
  const sorted = [...points].sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_DONUT_SLICES) return sorted;
  const top = sorted.slice(0, MAX_DONUT_SLICES - 1);
  const rest = sorted.slice(MAX_DONUT_SLICES - 1).reduce((a, p) => a + p.value, 0);
  return [...top, { label: 'Other', value: rest }];
}

type TipItem = { name?: string | number; value?: number | string; color?: string; payload?: { fill?: string } };

// Custom tooltip card: label, then dot + name + right-aligned tabular value.
export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TipItem[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ws-chart-tip">
      {label != null && label !== '' && <div className="ws-chart-tip-label">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="ws-chart-tip-row">
          <span className="ws-chart-tip-dot" style={{ background: p.color ?? p.payload?.fill }} aria-hidden="true" />
          <span className="ws-chart-tip-name">{p.name}</span>
          <span className="ws-chart-tip-value">{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export const legendProps = { iconType: 'circle' as const, iconSize: 8, wrapperStyle: { fontSize: 12, paddingTop: 8 } };

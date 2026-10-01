import { useEffect, useState } from 'react';
import { api, ApiError, type DashboardWidget, type WidgetSeriesRow } from '@/lib/api';
import { capSlices, mutedColor, seriesColor, MAX_DONUT_SLICES } from '@/lib/chartTheme';
import { officeColor } from '@/lib/officeTheme';

const MAX_BARS = 6;

// Compact, axis-free thumbnail of a saved widget for the Visualizations
// grid. Bars (for bar and line widgets) take the first source's office
// color; the full chart with axes and tooltips is WidgetCard on the Dashboard.
export function WidgetPreview({ widget, hue, loadData }: { widget: DashboardWidget; hue: number; loadData?: (id: string) => Promise<WidgetSeriesRow[]> }) {
  const [rows, setRows] = useState<WidgetSeriesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (loadData ?? api.getDashboardWidgetData)(widget.id)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load data'));
    // loadData is a fresh closure each render; refetch only for a different widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  if (error) return <div className="ws-viz-preview ws-viz-empty">{error}</div>;
  if (!rows) return <div className="ws-viz-preview ws-viz-empty"><span className="spinner sm" /></div>;
  if (rows.length === 0) return <div className="ws-viz-preview ws-viz-empty">No records yet</div>;

  const points = rows.map((r) => ({ label: r.label ?? '(blank)', value: r.counts.reduce((a, c) => a + c, 0) }));

  if (widget.chartType === 'number') {
    return (
      <div className="ws-viz-preview" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.01em', color: officeColor(hue, 'deep') }}>
          {points.reduce((a, p) => a + p.value, 0).toLocaleString()}
        </span>
      </div>
    );
  }

  if (widget.chartType === 'donut') {
    const sl = capSlices(points);
    const total = Math.max(1, sl.reduce((a, p) => a + p.value, 0));
    const r = 34;
    const c = 2 * Math.PI * r;
    let offset = 0;
    return (
      <div className="ws-viz-preview" style={{ gap: 16, alignItems: 'center' }}>
        <svg width="92" height="92" viewBox="0 0 92 92" role="img" aria-label={`${widget.title} donut preview`}>
          {sl.map((p, i) => {
            const len = (p.value / total) * c;
            const el = (
              <circle key={p.label} cx="46" cy="46" r={r} fill="none" stroke={p.label === 'Other' ? mutedColor() : seriesColor(i, MAX_DONUT_SLICES)} strokeWidth="14"
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 46 46)" />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, minWidth: 0 }}>
          {sl.slice(0, 4).map((p, i) => (
            <span key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: p.label === 'Other' ? mutedColor() : seriesColor(i, MAX_DONUT_SLICES), flex: 'none' }} />
              {p.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Months read left to right, so keep the latest ones; anything else shows
  // its biggest groups.
  const byMonth = widget.groupBy.includes('month');
  const shown = byMonth
    ? [...points].sort((a, b) => a.label.localeCompare(b.label)).slice(-MAX_BARS)
    : [...points].sort((a, b) => b.value - a.value).slice(0, MAX_BARS);
  const max = Math.max(1, ...shown.map((p) => p.value));
  return (
    <div className="ws-viz-preview" role="img" aria-label={`${widget.title} preview`}>
      {shown.map((p) => (
        <div key={p.label} className="ws-viz-bar" title={`${p.label}: ${p.value.toLocaleString()}`}
          style={{ height: `${Math.max(6, (p.value / max) * 100)}%`, background: officeColor(hue, 'chart') }} />
      ))}
    </div>
  );
}

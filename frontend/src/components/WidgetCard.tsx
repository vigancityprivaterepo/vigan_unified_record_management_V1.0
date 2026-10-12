import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { IconButton } from '@/components/IconButton';
import { EDIT_ICON, TRASH_ICON } from '@/lib/actionIcons';
import { api, ApiError, type DashboardWidget, type WidgetSeriesRow } from '@/lib/api';
import { axisProps, capSlices, ChartTooltip, gridProps, legendProps, MAX_DONUT_SLICES, mutedColor, seriesColor } from '@/lib/chartTheme';

// Chart styling comes from lib/chartTheme (palette, axes, tooltip card).
// DESIGN.md sets MOTION 1 (hover and focus only), so charts draw without an
// entrance animation.

// Renders one saved widget's chart -- shared by the Visualizations page
// (where it's built/managed, `onEdit`/`onDelete` present) and the Dashboard
// (where it's just displayed alongside the KPI strip, both omitted).
export function WidgetCard({
  widget,
  onEdit,
  onDelete,
  loadData,
  onSelect,
  selected,
}: {
  widget: DashboardWidget;
  onEdit?: () => void;
  onDelete?: () => void;
  // Office boards fetch through the office's own route.
  loadData?: (id: string) => Promise<WidgetSeriesRow[]>;
  // Clicking a bar, slice or point picks that group (its label).
  onSelect?: (label: string) => void;
  selected?: string | null;
}) {
  const [rows, setRows] = useState<WidgetSeriesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (loadData ?? api.getDashboardWidgetData)(widget.id)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load data'));
    // loadData is a fresh closure each render; refetch only for a different widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  // Recharts wants one row per point with a key per series -- turn each
  // module's aligned `counts[i]` into `row[moduleId] = count`.
  // Months read left to right (the API orders groups by size).
  const byMonth = widget.groupBy[0] === 'month';
  const chartData = rows
    ?.map((r) => ({
      label: r.label,
      ...Object.fromEntries(widget.sourceModules.map((m, i) => [m.id, r.counts[i] ?? 0])),
    }))
    .sort((a, b) => (byMonth ? String(a.label).localeCompare(String(b.label)) : 0));
  const slices = capSlices((rows ?? []).map((r) => ({ label: r.label ?? '(blank)', value: r.counts.reduce((a, c) => a + c, 0) })));
  const ariaLabel = `${widget.title}: ${widget.chartType} chart of ${widget.sourceModules.map((m) => m.name).join(', ')}`;

  const total = rows?.[0]?.counts.reduce((sum, c) => sum + c, 0) ?? 0;
  // Past the slice limit the last donut slice is several small groups added
  // together, so there is no single group to open.
  const isMerged = (i: number) => (rows?.length ?? 0) > MAX_DONUT_SLICES && i === slices.length - 1;
  const clickable = onSelect ? { cursor: 'pointer' as const } : undefined;
  // A picked group stays solid; the rest fade back.
  const dim = (label: unknown) => (selected != null && label !== selected ? 0.35 : 1);

  const filterParts = [
    widget.filterBarangayName ? `Barangay: ${widget.filterBarangayName}` : null,
    widget.filterSex ? `Sex: ${widget.filterSex === 'M' ? 'Male' : 'Female'}` : null,
    widget.filterMonth ? `Month: ${widget.filterMonth}` : null,
    widget.filterFieldValue ? `Only: ${widget.filterFieldValue}` : null,
  ].filter((p): p is string => p !== null);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-base)', display: 'block' }}>{widget.title}</span>
          <span style={{ fontSize: 12, color: 'var(--t-muted)' }}>
            {widget.sourceModules.map((m) => m.name).join(', ')}
            {filterParts.length > 0 ? ` · ${filterParts.join(' · ')}` : ''}
          </span>
        </div>
        {(onEdit || onDelete) && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {onEdit && <IconButton label="Edit" icon={EDIT_ICON} onClick={onEdit} />}
            {onDelete && <IconButton label="Delete" icon={TRASH_ICON} danger onClick={onDelete} />}
          </div>
        )}
      </div>

      {error && <div className="field-error">{error}</div>}
      {rows === null && !error && <span className="spinner sm" />}

      {rows && rows.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--t-muted)', textAlign: 'center', padding: '32px 0' }}>
          No records yet in {widget.sourceModules.map((m) => m.name).join(' / ')}. It fills in once staff submit
          registrations there.
        </p>
      )}

      {rows && rows.length > 0 && widget.chartType === 'number' && (
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 32, color: 'var(--t-base)', fontVariantNumeric: 'tabular-nums' }}>
            {total.toLocaleString()}
          </div>
          {widget.sourceModules.length > 1 && (
            <ul style={{ marginTop: 8, fontSize: 12, color: 'var(--t-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {widget.sourceModules.map((m, i) => (
                <li key={m.id}>
                  {m.name}: {(rows[0]?.counts[i] ?? 0).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {chartData && chartData.length > 0 && widget.chartType === 'bar' && (
        <div style={{ height: 220 }} role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -8 }} style={clickable}
              onClick={(e) => { if (onSelect && e?.activeLabel != null) onSelect(String(e.activeLabel)); }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
              <YAxis {...axisProps} allowDecimals={false} width={44} domain={[0, 'auto']} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--primary)', fillOpacity: 0.06 }} />
              {widget.sourceModules.length > 1 && <Legend {...legendProps} />}
              {widget.sourceModules.map((m, i) => (
                <Bar key={m.id} dataKey={m.id} name={m.name} fill={seriesColor(i)} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {chartData.map((d) => <Cell key={String(d.label)} fillOpacity={dim(d.label)} />)}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows && rows.length > 0 && widget.chartType === 'donut' && (
        <div style={{ height: 240 }} role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="85%" paddingAngle={1} isAnimationActive={false}
                onClick={(_sector, index) => { const sl = slices[index]; if (onSelect && sl && !isMerged(index)) onSelect(sl.label); }}>
                {slices.map((sl, i) => (
                  <Cell key={sl.label} fill={sl.label === 'Other' ? mutedColor() : seriesColor(i, MAX_DONUT_SLICES)} stroke="var(--bg-card)"
                    fillOpacity={dim(sl.label)} style={onSelect && !isMerged(i) ? clickable : undefined} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend {...legendProps} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData && chartData.length > 0 && widget.chartType === 'line' && (
        <div style={{ height: 220 }} role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }} style={clickable}
              onClick={(e) => { if (onSelect && e?.activeLabel != null) onSelect(String(e.activeLabel)); }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
              <YAxis {...axisProps} allowDecimals={false} width={44} domain={[0, 'auto']} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--t-light)', strokeWidth: 1, strokeDasharray: '4 4' }} />
              {widget.sourceModules.length > 1 && <Legend {...legendProps} />}
              {widget.sourceModules.map((m, i) => (
                <Line key={m.id} type="monotone" dataKey={m.id} name={m.name} stroke={seriesColor(i)} strokeWidth={i === 0 ? 2.5 : 1.75} isAnimationActive={false}
                  dot={selected != null ? (p: { cx?: number; cy?: number; payload?: { label?: string | null } }) => (p.payload?.label === selected ? <circle key={`${m.id}-${p.payload.label}`} cx={p.cx} cy={p.cy} r={5} fill={seriesColor(i)} /> : <g key={`${m.id}-${p.payload?.label}`} />) : false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

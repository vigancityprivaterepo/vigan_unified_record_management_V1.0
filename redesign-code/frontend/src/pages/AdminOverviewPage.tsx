import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { shortName } from '@/components/shell/OfficeSidebar';
import { api, type InsightsSummary, type OfficeBreakdown, type SankeyData } from '@/lib/api';
import { officeColor } from '@/lib/officeTheme';

// City overview: a sentence that says what happened, four KPIs, then charts
// that all color by office and cross-filter by barangay. Every chart reads
// already-shaped data; this page owns the filter and the fetches.
export function AdminOverviewPage() {
  const [barangay, setBarangay] = useState<{ code: string; name: string } | null>(null);
  const [data, setData] = useState<OfficeBreakdown | null>(null);
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [sankey, setSankey] = useState<SankeyData | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);
  const [hoverOffice, setHoverOffice] = useState<string | null>(null);

  const from = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 11); return d.toISOString().slice(0, 7); }, []);

  useEffect(() => {
    const filters = { barangayCode: barangay?.code, from };
    api.officeBreakdown(filters).then(setData).catch(() => setData(null));
    api.insightsSummary({ barangayCode: barangay?.code }).then(setSummary).catch(() => setSummary(null));
    api.insightsSankey({ barangayCode: barangay?.code }).then(setSankey).catch(() => setSankey(null));
  }, [barangay, from]);
  useEffect(() => { api.reviewQueue().then((q) => setQueueCount(q.length)).catch(() => setQueueCount(null)); }, []);

  if (!data) return <span className="spinner" />;

  const offices = data.offices;
  const color = (id: string) => officeColor(offices.find((o) => o.id === id)?.accentHue ?? 255, 'chart');
  const visible = offices.filter((o) => !hidden.has(o.id));
  const months = data.months;
  const totals = months.map((m) => offices.reduce((a, o) => a + (m.counts[o.id] ?? 0), 0));
  const visTotals = months.map((m) => visible.reduce((a, o) => a + (m.counts[o.id] ?? 0), 0));
  const last = totals[totals.length - 1] ?? 0;
  const prev = totals[totals.length - 2] ?? 0;
  const change = prev ? ((last - prev) / prev) * 100 : 0;
  const lastMonth = months[months.length - 1];
  const lead = lastMonth ? [...offices].sort((a, b) => (lastMonth.counts[b.id] ?? 0) - (lastMonth.counts[a.id] ?? 0))[0] : null;
  const monthLabel = (ym: string, long = false) => new Date(`${ym}-01T00:00`).toLocaleDateString('en-PH', long ? { month: 'long', year: 'numeric' } : { month: 'short' });

  // Stacked monthly bars
  const W = 720, H = 256, X0 = 48, X1 = 708, Y0 = 14, Y1 = 222;
  const slot = (X1 - X0) / Math.max(1, months.length);
  const bw = Math.min(32, slot * 0.6);
  const maxV = niceMax(Math.max(10, ...visTotals));
  const y = (v: number) => Y1 - (v / maxV) * (Y1 - Y0);

  // Donut
  const officeTotals = offices.map((o) => ({ o, total: months.reduce((a, m) => a + (m.counts[o.id] ?? 0), 0) }));
  const grand = officeTotals.reduce((a, x) => a + x.total, 0) || 1;
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  const hovered = officeTotals.find((x) => x.o.id === hoverOffice);

  // Overlap -- from the existing Sankey buckets, mapped module -> office
  const overlaps = (sankey?.buckets ?? [])
    .filter((b) => b.moduleIds.length >= 2)
    .map((b) => ({ ...b, officeIds: [...new Set(b.moduleIds.map((id) => data.moduleOffice[id]))] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const overlapMax = Math.max(1, ...overlaps.map((b) => b.count));
  const brgyMax = Math.max(1, ...data.barangays.map((b) => b.total));

  const spark = totals.map((v, i) => [i * (110 / Math.max(1, totals.length - 1)), 34 - (v / Math.max(1, ...totals)) * 30]);
  const sparkLine = spark.length ? 'M' + spark.map((p) => p.join(' ')).join(' L') : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1 style={{ fontSize: 34 }}>City overview</h1>
        </div>
        {barangay && (
          <button className="ws-chip is-on" onClick={() => setBarangay(null)}>Barangay: {barangay.name} ✕</button>
        )}
      </div>

      <div className="ws-kpis">
        <div className="ws-card ws-kpi">
          <span className="ws-kpi-label">Entries this month</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <span className="ws-kpi-value">{last.toLocaleString()}</span>
            <svg width="110" height="36" viewBox="0 0 110 36" style={{ overflow: 'visible' }} aria-hidden="true">
              <path d={sparkLine} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: change >= 0 ? 'var(--success)' : 'var(--danger)' }}>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% vs last month</span>
        </div>
        <div className="ws-card ws-kpi">
          <span className="ws-kpi-label">Citizens in master registry</span>
          <span className="ws-kpi-value">{summary?.totalCitizens.toLocaleString() ?? '—'}</span>
        </div>
        <div className="ws-card ws-kpi">
          <span className="ws-kpi-label">Served by 2+ programs</span>
          <span className="ws-kpi-value">{summary?.overlapCount.toLocaleString() ?? '—'}</span>
        </div>
        <div className="ws-card ws-kpi">
          <span className="ws-kpi-label">Awaiting duplicate review</span>
          <span className="ws-kpi-value">{queueCount ?? '—'}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: queueCount ? 'var(--warning)' : 'var(--success)' }}>{queueCount ? 'Needs a decision' : 'All caught up'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <section className="ws-card ws-card--pad" style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Entries per month, by office</h2>
            
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {offices.map((o) => {
              const on = !hidden.has(o.id);
              return (
                <button key={o.id} className={`ws-legend-btn${on ? '' : ' is-off'}`} onMouseEnter={() => setHoverOffice(o.id)} onMouseLeave={() => setHoverOffice(null)}
                  onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })}>
                  <span className="ws-legend-box" style={{ background: on ? color(o.id) : 'transparent', border: on ? 0 : '1.5px solid var(--border)' }}>{on && <Icon name="check" size={11} strokeWidth={3.5} className="" />}</span>
                  {shortName(o.name)}
                </button>
              );
            })}
          </div>
          <div style={{ position: 'relative' }} onMouseLeave={() => setHoverMonth(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Stacked bar chart of entries per month by office">
              {[0, 0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={X0} x2={X1} y1={y(maxV * t)} y2={y(maxV * t)} stroke="var(--border-soft)" />)}
              {months.map((m, i) => {
                let acc = 0;
                return visible.map((o) => {
                  const v = m.counts[o.id] ?? 0;
                  if (!v) return null;
                  const top = y(acc + v), h = y(acc) - top;
                  acc += v;
                  const dim = (hoverMonth !== null && hoverMonth !== i) || (hoverOffice !== null && hoverOffice !== o.id);
                  return <rect key={`${m.month}-${o.id}`} x={X0 + i * slot + (slot - bw) / 2} y={top + 1} width={bw} height={Math.max(0, h - 1.5)} rx={2} fill={color(o.id)} opacity={dim ? 0.25 : 1} style={{ transition: 'opacity .15s' }} />;
                });
              })}
              {months.map((m, i) => <rect key={m.month} x={X0 + i * slot} y={8} width={slot} height={Y1 - 8} fill="transparent" onMouseEnter={() => setHoverMonth(i)} />)}
            </svg>
            {[0, 0.5, 1].map((t) => (
              <span key={t} className="ws-axis" style={{ left: 0, width: `${(40 / W) * 100}%`, textAlign: 'right', top: `${(y(maxV * t) / H) * 100}%`, transform: 'translateY(-50%)' }}>{Math.round(maxV * t).toLocaleString()}</span>
            ))}
            {months.map((m, i) => (
              <span key={m.month} className="ws-axis" style={{ left: `${((X0 + i * slot + slot / 2) / W) * 100}%`, top: `${(240 / H) * 100}%`, transform: 'translate(-50%,-50%)', color: hoverMonth === i ? 'var(--t-base)' : undefined, fontWeight: hoverMonth === i ? 700 : 500 }}>{monthLabel(m.month)}</span>
            ))}
            {hoverMonth !== null && months[hoverMonth] && (
              <div className="ws-tip" style={{ left: `${((X0 + hoverMonth * slot + slot / 2) / W) * 100}%`, transform: hoverMonth > months.length - 5 ? 'translateX(calc(-100% - 26px))' : 'translateX(26px)' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{monthLabel(months[hoverMonth].month, true)}</div>
                {[...visible].reverse().map((o) => (
                  <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: color(o.id) }} />
                    <span style={{ flex: 1 }}>{shortName(o.name)}</span>
                    <strong>{(months[hoverMonth].counts[o.id] ?? 0).toLocaleString()}</strong>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-soft)', marginTop: 8, paddingTop: 8 }}><span>Total</span><strong>{visTotals[hoverMonth].toLocaleString()}</strong></div>
              </div>
            )}
          </div>
        </section>

        <section className="ws-card ws-card--pad" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><h2 style={{ margin: 0, fontSize: 18 }}>Share of the workload</h2></div>
          <div style={{ position: 'relative', width: 200, height: 200, alignSelf: 'center' }}>
            <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="Share of entries by office">
              <circle cx="100" cy="100" r={R} fill="none" stroke="var(--bg-muted)" strokeWidth={24} />
              <g transform="rotate(-90 100 100)">
                {officeTotals.map(({ o, total }) => {
                  const len = (total / grand) * C;
                  const on = hoverOffice === o.id;
                  const el = <circle key={o.id} cx="100" cy="100" r={R} fill="none" stroke={color(o.id)} strokeWidth={on ? 30 : 24} strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-offset}
                    opacity={hoverOffice && !on ? 0.3 : 1} style={{ transition: 'opacity .15s, stroke-width .15s', cursor: 'pointer' }} onMouseEnter={() => setHoverOffice(o.id)} onMouseLeave={() => setHoverOffice(null)} />;
                  offset += len;
                  return el;
                })}
              </g>
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{(hovered ? hovered.total : grand).toLocaleString()}</div>
              <div style={{ fontSize: 13, color: 'var(--t-muted)', maxWidth: 110 }}>{hovered ? shortName(hovered.o.name) : 'entries in 12 months'}</div>
            </div>
          </div>
          <div>
            {officeTotals.map(({ o, total }) => (
              <div key={o.id} onMouseEnter={() => setHoverOffice(o.id)} onMouseLeave={() => setHoverOffice(null)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, fontSize: 14, background: hoverOffice === o.id ? 'var(--bg-hover)' : 'transparent' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: color(o.id) }} />
                <span style={{ flex: 1 }}>{shortName(o.name)}</span>
                <span style={{ color: 'var(--t-muted)' }}>{Math.round((total / grand) * 100)}%</span>
                <strong style={{ minWidth: 56, textAlign: 'right' }}>{total.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <section className="ws-card ws-card--pad" style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><h2 style={{ margin: 0, fontSize: 18 }}>Busiest barangays</h2></div>
          <div>
            {data.barangays.map((b, i) => {
              const on = barangay?.code === b.code;
              return (
                <button key={b.code} className={`ws-brgy-row${on ? ' is-on' : ''}${barangay && !on ? ' is-dim' : ''}`} onClick={() => setBarangay(on ? null : { code: b.code, name: b.name })}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--t-light)' }}>{i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                  <span className="ws-stack">
                    {visible.map((o) => <span key={o.id} style={{ width: `${((b.counts[o.id] ?? 0) / brgyMax) * 100}%`, background: color(o.id), opacity: hoverOffice && hoverOffice !== o.id ? 0.25 : 1 }} />)}
                  </span>
                  <strong style={{ fontSize: 14, textAlign: 'right' }}>{b.total.toLocaleString()}</strong>
                </button>
              );
            })}
          </div>
        </section>

        <section className="ws-card ws-card--pad" style={{ flex: '1 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><h2 style={{ margin: 0, fontSize: 18 }}>Citizens served by more than one program</h2></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {offices.map((o) => <span key={o.id} style={{ fontSize: 12, fontWeight: 600, color: '#fff', padding: '3px 9px', borderRadius: 999, background: officeColor(o.accentHue, 'acc') }}>{shortName(o.name)}</span>)}
          </div>
          {overlaps.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)', fontSize: 14 }}>No citizens are enrolled in more than one program yet.</p>}
          {overlaps.map((b) => (
            <div key={b.moduleIds.join(',')} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) 64px', gap: 14, alignItems: 'center' }}>
              <span style={{ display: 'flex', gap: 6 }}>
                {offices.map((o) => <span key={o.id} style={{ width: 12, height: 12, borderRadius: '50%', background: b.officeIds.includes(o.id) ? color(o.id) : 'var(--bg-muted)' }} />)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 5 }}>{b.label}</div>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-muted)' }}><div style={{ width: `${(b.count / overlapMax) * 100}%`, height: 8, borderRadius: 4, background: 'var(--t-base)' }} /></div>
              </div>
              <strong style={{ fontSize: 15, textAlign: 'right' }}>{b.count.toLocaleString()}</strong>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function niceMax(v: number): number {
  const m = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / m;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * m;
}

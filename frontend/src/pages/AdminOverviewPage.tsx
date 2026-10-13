import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { compact, shortName } from '@/components/shell/OfficeSidebar';
import type { AdminTab } from '@/components/shell/AdminSidebar';
import { api, ApiError, type CityAttention, type InsightsSummary, type OfficeBreakdown, type SankeyData } from '@/lib/api';
import { seriesColor } from '@/lib/chartTheme';
import { useViewOnly } from '@/lib/viewOnly';


export function AdminOverviewPage({ onNavigate }: { onNavigate?: (tab: AdminTab) => void } = {}) {
  const viewOnly = useViewOnly();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      await api.exportMasterlist();
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const [barangay, setBarangay] = useState<{ code: string; name: string } | null>(null);
  const [data, setData] = useState<OfficeBreakdown | null>(null);
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [sankey, setSankey] = useState<SankeyData | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [queueError, setQueueError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);
  const [hoverOffice, setHoverOffice] = useState<string | null>(null);
  const [coverageOrder, setCoverageOrder] = useState<'fewest' | 'most'>('fewest');
  const [showAllBrgy, setShowAllBrgy] = useState(false);

  const from = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 11); return d.toISOString().slice(0, 7); }, []);

  useEffect(() => {
    const filters = { barangayCode: barangay?.code, from };
    setLoadError(null);
    setSummaryError(false);
    api.officeBreakdown(filters).then(setData).catch((err) => { setData(null); setLoadError(err); });
    api.insightsSummary({ barangayCode: barangay?.code }).then(setSummary).catch(() => { setSummary(null); setSummaryError(true); });
    api.insightsSankey({ barangayCode: barangay?.code }).then(setSankey).catch(() => setSankey(null));
  }, [barangay, from, attempt]);
  useEffect(() => {
    if (viewOnly) return; // the queue holds names
    setQueueError(false);
    api.reviewQueue().then((q) => setQueueCount(q.length)).catch(() => { setQueueCount(null); setQueueError(true); });
  }, [attempt, viewOnly]);

  if (loadError) return <LoadError what="the city overview" error={loadError} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data) return <span className="spinner" />;

  const offices = data.offices;
  
  const rank = [...offices]
    .map((o) => ({ id: o.id, t: data.months.reduce((a, m) => a + (m.counts[o.id] ?? 0), 0) }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.id);
  const color = (id: string) => seriesColor(rank.indexOf(id));
  const visible = offices.filter((o) => !hidden.has(o.id));
  const months = data.months;
  const totals = months.map((m) => offices.reduce((a, o) => a + (m.counts[o.id] ?? 0), 0));
  const visTotals = months.map((m) => visible.reduce((a, o) => a + (m.counts[o.id] ?? 0), 0));
  const last = totals[totals.length - 1] ?? 0;
  const prev = totals[totals.length - 2] ?? 0;
  const change = prev ? ((last - prev) / prev) * 100 : 0;
  const prevMonthName = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString('en-PH', { month: 'long' });
  const monthLabel = (ym: string, long = false) => new Date(`${ym}-01T00:00`).toLocaleDateString('en-PH', long ? { month: 'long', year: 'numeric' } : { month: 'short' });

  // Stacked monthly bars
  const W = 720, H = 256, X0 = 48, X1 = 708, Y0 = 14, Y1 = 222;
  const slot = (X1 - X0) / Math.max(1, months.length);
  const bw = Math.min(32, slot * 0.6);
  const maxV = niceMax(Math.max(10, ...visTotals));
  const y = (v: number) => Y1 - (v / maxV) * (Y1 - Y0);

  // Overlap -- from the existing Sankey buckets, mapped module -> office
  const overlaps = (sankey?.buckets ?? [])
    .filter((b) => b.moduleIds.length >= 2)
    .map((b) => ({ ...b, officeIds: [...new Set(b.moduleIds.map((id) => data.moduleOffice[id]))] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const overlapMax = Math.max(1, ...overlaps.map((b) => b.count));
  const coverage = coverageOrder === 'fewest' ? data.coverage : [...data.coverage].reverse();
  const coverageShown = showAllBrgy ? coverage : coverage.slice(0, 10);
  const reached = data.coverage.filter((b) => b.citizens > 0).length;
  const notReached = data.coverage.length - reached;
  const citizenMax = Math.max(1, ...data.coverage.map((b) => b.citizens));

  const spark = totals.map((v, i) => [i * (110 / Math.max(1, totals.length - 1)), 34 - (v / Math.max(1, ...totals)) * 30]);
  const sparkLine = spark.length ? 'M' + spark.map((p) => p.join(' ')).join(' L') : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>City overview</h1>
        </div>
        {barangay && (
          <button className="ws-chip is-on" onClick={() => setBarangay(null)} aria-label={`Clear barangay filter: ${barangay.name}`}>
            Barangay: {barangay.name} <Icon name="x" size={14} />
          </button>
        )}
        {!viewOnly && (
          <button className="btn btn--ghost btn--lg" onClick={handleExport} disabled={exporting}>
            <Icon name="download" size={16} />
            {exporting ? 'Exporting...' : 'Export masterlist'}
          </button>
        )}
      </div>
      {exportError && (
        <div className="alert danger">
          <div className="body">{exportError}</div>
        </div>
      )}

      <div className="ws-kpis">
        <div className="ws-card ws-kpi">
          <span className="ws-kpi-label">Entries this month</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <span className="ws-kpi-value" title={last.toLocaleString()}>{compact(last)}</span>
            <svg width="110" height="36" viewBox="0 0 110 36" style={{ overflow: 'visible' }} aria-hidden="true">
              {sparkLine && <path d={`${sparkLine} L110 36 L0 36 Z`} fill="var(--primary-soft)" stroke="none" />}
              <path d={sparkLine} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {spark.length > 0 && <circle cx={spark[spark.length - 1]![0]} cy={spark[spark.length - 1]![1]} r={3} fill="var(--primary)" />}
            </svg>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: change >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            <Icon name={change >= 0 ? 'trendUp' : 'trendDown'} size={15} />
            {change >= 0 ? 'Up' : 'Down'} {Math.abs(change).toFixed(1)}% vs {prevMonthName}
          </span>
        </div>
        <div className="ws-card ws-kpi">
          <span className="ws-kpi-label">Citizens in master registry</span>
          <span className="ws-kpi-value" title={summary?.totalCitizens.toLocaleString()}>{summary ? compact(summary.totalCitizens) : summaryError ? 'N/A' : '…'}</span>
          <span className="ws-kpi-sub">{summary ? `in ${compact(summary.totalHouseholds)} households` : ''}</span>
        </div>
        <div className="ws-card ws-kpi">
          <span className="ws-kpi-label">Served by 2+ programs</span>
          <span className="ws-kpi-value" title={summary?.overlapCount.toLocaleString()}>{summary ? compact(summary.overlapCount) : summaryError ? 'N/A' : '…'}</span>
          <span className="ws-kpi-sub">
            {summary && summary.totalCitizens > 0 ? `${((summary.overlapCount / summary.totalCitizens) * 100).toFixed(1)}% of the registry` : ''}
          </span>
        </div>
        {!viewOnly && <div className="ws-card ws-kpi">
          <span className="ws-kpi-label">Awaiting duplicate review</span>
          <span className="ws-kpi-value">{queueCount ?? (queueError ? 'N/A' : '…')}</span>
          {queueCount && onNavigate ? (
            <button type="button" onClick={() => onNavigate('queue')} style={{ marginTop: 'auto', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, background: 'none', padding: 0, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--primary)' }}>
              Open review queue <Icon name="arrowR" size={14} />
            </button>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600, color: queueCount ? 'var(--warning)' : 'var(--success)' }}>{queueCount ? 'Needs a decision' : 'All caught up'}</span>
          )}
        </div>}
      </div>

      <AttentionTiles onNavigate={onNavigate} />

      <section className="ws-card ws-card--pad ws-stack-y">
        <div className="ws-section-head">
          <div className="grow">
            <h2 style={{ margin: 0, fontSize: 18 }}>Barangay coverage</h2>
            <p className="ws-kpi-sub" style={{ margin: '4px 0 0' }}>
              {reached} of {data.coverage.length} barangays have at least one citizen in the registry.
              {notReached > 0 ? ` ${notReached} have none yet.` : ''} All time; select a barangay to filter the charts below.
            </p>
          </div>
          <div className="ws-seg" role="group" aria-label="Sort barangays">
            <button type="button" aria-pressed={coverageOrder === 'fewest'} className={coverageOrder === 'fewest' ? 'is-on' : ''} onClick={() => setCoverageOrder('fewest')}>Fewest first</button>
            <button type="button" aria-pressed={coverageOrder === 'most'} className={coverageOrder === 'most' ? 'is-on' : ''} onClick={() => setCoverageOrder('most')}>Most first</button>
          </div>
        </div>
        <div className="ws-cov-row ws-cov-row--head" aria-hidden="true">
          <span>Barangay</span><span /><span>Citizens</span><span>Records</span><span>Offices</span>
        </div>
        <div>
          {coverageShown.map((b) => {
            const on = barangay?.code === b.code;
            return (
              <button key={b.code} type="button" className={`ws-cov-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setBarangay(on ? null : { code: b.code, name: b.name })}>
                <span className="ws-cov-name">{b.name}</span>
                <span className="ws-cov-bar" aria-hidden="true"><span style={{ width: `${(b.citizens / citizenMax) * 100}%` }} /></span>
                <strong>{b.citizens === 0 ? 'None yet' : b.citizens.toLocaleString()}</strong>
                <span>{b.records.toLocaleString()}</span>
                <span>{b.offices} of {offices.length}</span>
              </button>
            );
          })}
        </div>
        {coverage.length > 10 && (
          <button type="button" className="btn btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAllBrgy((v) => !v)}>
            {showAllBrgy ? 'Show fewer' : `Show all ${coverage.length} barangays`}
          </button>
        )}
      </section>

      <section className="ws-card ws-card--pad" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Entries per month, by office{barangay ? ` in ${barangay.name}` : ''}</h2>
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
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{monthLabel(months[hoverMonth]!.month, true)}</div>
              {[...visible].reverse().map((o) => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: color(o.id) }} />
                  <span style={{ flex: 1 }}>{shortName(o.name)}</span>
                  <strong>{(months[hoverMonth]!.counts[o.id] ?? 0).toLocaleString()}</strong>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-soft)', marginTop: 8, paddingTop: 8 }}><span>Total</span><strong>{(visTotals[hoverMonth] ?? 0).toLocaleString()}</strong></div>
            </div>
          )}
        </div>
      </section>

      <section className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Citizens served by more than one program</h2>
        {overlaps.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)', fontSize: 14 }}>No citizens are enrolled in more than one program yet.</p>}
        {overlaps.map((b) => (
          <div key={b.moduleIds.join(',')} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 64px', gap: 14, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 5 }}>{b.label}</div>
              <div className="ws-cov-bar"><span style={{ width: `${(b.count / overlapMax) * 100}%` }} /></div>
            </div>
            <strong style={{ fontSize: 15, textAlign: 'right' }}>{b.count.toLocaleString()}</strong>
          </div>
        ))}
      </section>
    </div>
  );
}

function niceMax(v: number): number {
  const m = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / m;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * m;
}

// "Needs attention": the follow-up lists from the other pages, as counts
function AttentionTiles({ onNavigate }: { onNavigate?: (tab: AdminTab) => void }) {
  // A view-only account sees every count but can open only Program gaps.
  const viewOnly = useViewOnly();
  const canOpen = (key: AdminTab) => !!onNavigate && (!viewOnly || key === 'gaps');
  const [a, setA] = useState<CityAttention | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError(null);
    api.cityAttention().then(setA).catch((err) => { setA(null); setError(err); });
  }, [attempt]);

  if (error != null) return <LoadError what="the follow-up counts" error={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!a) return null;
  const relief = a.disaster.relief;
  const tiles: Array<{ key: AdminTab; label: string; page?: string; value: number; sub: string; warn: boolean }> = [
    {
      key: 'gaps', label: 'Program gaps', value: a.gaps.notServed,
      sub: `qualify for a program but are not in it${a.gaps.cleanup ? `; ${a.gaps.cleanup} still on a list they should not be on` : ''}`,
      warn: a.gaps.notServed + a.gaps.cleanup > 0,
    },
    relief
      ? { key: 'disaster', label: 'Disaster lists', value: relief.notReached, sub: `of ${relief.households} households not reached by relief: ${relief.label}`, warn: relief.notReached > 0 }
      : { key: 'disaster', label: 'Disaster lists', value: a.disaster.evacuatedNow, sub: 'residents who may need help are in an evacuation center now', warn: a.disaster.evacuatedNow > 0 },
    { key: 'renewals', label: 'Business renewals', value: a.renewals.notRenewed, sub: `businesses not renewed for ${a.renewals.year}`, warn: a.renewals.notRenewed > 0 },
    {
      key: 'privacy', label: 'Data requests', page: 'Privacy', value: a.privacy.open,
      sub: a.privacy.open === 0 ? 'none waiting for an answer' : `waiting for an answer; oldest ${a.privacy.oldestDays} ${a.privacy.oldestDays === 1 ? 'day' : 'days'}`,
      warn: a.privacy.open > 0,
    },
  ];
  return (
    <section aria-labelledby="attention-title" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 id="attention-title" style={{ margin: 0, fontSize: 18 }}>Needs attention</h2>
      <div className="ws-kpis">
        {tiles.map((t) => (
          <button key={t.key} type="button" className="ws-card ws-kpi br-kpi-btn ov-att" disabled={!canOpen(t.key)} onClick={() => onNavigate?.(t.key)}>
            <span className="ws-kpi-label">{t.label}</span>
            <span className={`ws-kpi-value${t.warn ? '' : ' ov-att-ok'}`}>{t.value.toLocaleString()}</span>
            <span className="ws-kpi-sub">{t.sub}</span>
            {canOpen(t.key) && <span className="ov-att-go">Open {t.page ?? t.label} <Icon name="arrowR" size={14} /></span>}
          </button>
        ))}
      </div>
    </section>
  );
}

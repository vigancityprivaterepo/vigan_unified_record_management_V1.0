import { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Icon } from '@/components/Icon';
import { Pagination } from '@/components/Pagination';
import { api, ApiError, type ChartHistory, type ChartModuleProfile, type ChartRecords, type DashboardWidget } from '@/lib/api';
import { axisProps, ChartTooltip, gridProps, legendProps, seriesColor } from '@/lib/chartTheme';

// Under an opened chart: the records it counts, the same numbers month by
// month, and what its programs collect. `label` is the bar, slice or point
// the reader clicked (null = the whole chart).

const DIMENSION: Record<string, string> = { barangay: 'Barangay', sex: 'Sex', month: 'Month', age_bracket: 'Age group', other_programs: 'Other programs' };
const dimensionName = (d: string) => (d.startsWith('field:') ? d.slice(6).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : DIMENSION[d] ?? d);

const TYPE: Record<string, { name: string; kind: string }> = {
  NUMBER: { name: 'Number', kind: 'Number (quantitative)' },
  DATE: { name: 'Date', kind: 'Date' },
  TIME: { name: 'Time', kind: 'Date' },
  BOOLEAN: { name: 'Yes / No', kind: 'Category (qualitative)' },
  SELECT: { name: 'One choice from a list', kind: 'Category (qualitative)' },
  MULTISELECT: { name: 'Several choices from a list', kind: 'Category (qualitative)' },
  TEXT: { name: 'Text', kind: 'Text (qualitative)' },
  TEXTAREA: { name: 'Long text', kind: 'Text (qualitative)' },
  EMAIL: { name: 'Email', kind: 'Text (qualitative)' },
  PHONE: { name: 'Phone number', kind: 'Text (qualitative)' },
};

const num = (n: number | null) => (n == null ? '' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

function show(value: unknown, key: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (value === true || value === 'true') return 'Yes';
  if (value === false || value === 'false') return 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number' && /(_php|_kg|count|amount)/.test(key)) return value.toLocaleString();
  return String(value);
}

type Tab = 'records' | 'history' | 'profile';

export function ChartExplorer({ widget, base, label, onClear }: { widget: DashboardWidget; base: string; label: string | null; onClear: () => void }) {
  const [tab, setTab] = useState<Tab>('records');
  const [moduleId, setModuleId] = useState(widget.sourceModules[0]?.id ?? '');
  const groupName = widget.groupBy.map(dimensionName).join(' / ');

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }} aria-label="Data behind this chart">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="ws-seg" role="tablist" aria-label="What to look at">
          {([['records', 'Records'], ['history', 'History'], ['profile', 'Data used']] as const).map(([key, name]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>{name}</button>
          ))}
        </div>
        {tab !== 'profile' && (label !== null ? (
          <button type="button" className="ws-chip is-on" style={{ height: 34 }} onClick={onClear} aria-label={`Show the whole chart again, not only ${label}`}>
            {groupName}: {label} <Icon name="x" size={14} />
          </button>
        ) : widget.groupBy.length > 0 && widget.chartType !== 'number' ? (
          <span className="ws-kpi-sub">Showing the whole chart. Click a bar, slice or point to see only that part.</span>
        ) : null)}
      </div>

      {tab === 'records' && widget.sourceModules.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {widget.sourceModules.map((m) => (
            <button key={m.id} type="button" className={`ws-chip${m.id === moduleId ? ' is-on' : ''}`} style={{ height: 34 }} onClick={() => setModuleId(m.id)}>{m.name}</button>
          ))}
        </div>
      )}

      {tab === 'records' && <Records key={`${moduleId}|${label ?? ''}`} base={base} moduleId={moduleId} label={label} />}
      {tab === 'history' && <History key={label ?? ''} widget={widget} base={base} label={label} />}
      {tab === 'profile' && <Profile widget={widget} base={base} />}
    </section>
  );
}

const fail = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Records({ base, moduleId, label }: { base: string; moduleId: string; label: string | null }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ChartRecords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let live = true;
    api.chartRecords(base, { moduleId, label: label ?? undefined, page })
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(fail(err, 'Could not load the records')); });
    return () => { live = false; };
  }, [base, moduleId, label, page]);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      await api.exportChartRecords(base, { moduleId, label: label ?? undefined });
    } catch (err) {
      setError(fail(err, 'Could not export the records'));
    } finally {
      setExporting(false);
    }
  }

  if (error) return <div className="field-error">{error}</div>;
  if (!data) return <span className="spinner sm" />;
  if (data.total === 0) return <p className="ws-kpi-sub">No records here.</p>;

  const people = data.items.some((r) => r.person !== null);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>{data.total.toLocaleString()} {data.total === 1 ? 'record' : 'records'}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn--ghost ws-topbar-btn" onClick={handleExport} disabled={exporting}>
          <Icon name="download" size={16} /> {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Date added</th>
              {people && <th>Name</th>}
              {people && <th>Barangay</th>}
              {data.columns.map((c) => <th key={c.key}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{r.addedOn}{r.sample && <span className="ws-sample-tag">Sample</span>}</td>
                {people && <td className="cell-name" style={{ whiteSpace: 'nowrap' }}>{r.person ?? ''}</td>}
                {people && <td style={{ whiteSpace: 'nowrap' }}>{r.barangay ?? ''}</td>}
                {data.columns.map((c) => <td key={c.key}>{show(r.values[c.key], c.key)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
    </div>
  );
}

// Last three full months against the three before, as a percent change.
function recentChange(months: ChartHistory['months'], i: number): string {
  const full = months.slice(0, -1); // the current month is still filling in
  if (full.length < 6) return '';
  const sum = (rows: ChartHistory['months']) => rows.reduce((a, m) => a + (m.values[i] ?? 0), 0);
  const recent = sum(full.slice(-3));
  const before = sum(full.slice(-6, -3));
  if (before === 0) return '';
  const pct = Math.round(((recent - before) / before) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function History({ widget, base, label }: { widget: DashboardWidget; base: string; label: string | null }) {
  const [data, setData] = useState<ChartHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.chartHistory(base, label ?? undefined)
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(fail(err, 'Could not load the history')); });
    return () => { live = false; };
  }, [base, label]);

  if (error) return <div className="field-error">{error}</div>;
  if (!data) return <span className="spinner sm" />;

  const sums = widget.measure.startsWith('sum:');
  const measured = sums ? `Total of ${widget.measure.slice(4).replace(/_/g, ' ')}` : widget.measure === 'people' ? 'People' : 'Records';
  const points = data.months.map((m) => ({ month: m.month, ...Object.fromEntries(widget.sourceModules.map((s, i) => [s.id, m.values[i] ?? 0])) }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {points.length === 0 ? (
        <p className="ws-kpi-sub">No records were added in the last two years, so there is no month-by-month history to draw.</p>
      ) : (
        <div>
          <div className="ws-kpi-sub" style={{ marginBottom: 6 }}>{measured} per month, by the date each record was added</div>
          <div style={{ height: 220 }} role="img" aria-label={`${measured} per month`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
                <YAxis {...axisProps} allowDecimals={false} width={56} domain={[0, 'auto']} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--t-light)', strokeWidth: 1, strokeDasharray: '4 4' }} />
                {widget.sourceModules.length > 1 && <Legend {...legendProps} />}
                {widget.sourceModules.map((m, i) => (
                  <Line key={m.id} type="monotone" dataKey={m.id} name={m.name} stroke={seriesColor(i)} strokeWidth={i === 0 ? 2.5 : 1.75} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Program</th><th>Records</th><th>People</th><th>First record</th><th>Latest record</th>
              <th title="The last three full months compared with the three before them">Last 3 months vs 3 before</th>
              {sums && <><th>Total</th><th>Average</th><th>Middle value</th><th>Smallest</th><th>Largest</th></>}
            </tr>
          </thead>
          <tbody>
            {data.summary.map((s, i) => (
              <tr key={s.moduleId}>
                <td className="cell-name">{widget.sourceModules[i]?.name}</td>
                <td>{s.records.toLocaleString()}</td>
                <td>{s.people > 0 ? s.people.toLocaleString() : ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{s.first ?? ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{s.last ?? ''}</td>
                <td>{recentChange(data.months, i)}</td>
                {sums && <><td>{num(s.sum)}</td><td>{num(s.average)}</td><td>{num(s.median)}</td><td>{num(s.min)}</td><td>{num(s.max)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Profile({ widget, base }: { widget: DashboardWidget; base: string }) {
  const [data, setData] = useState<ChartModuleProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.chartProfile(base)
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(fail(err, 'Could not load the data profile')); });
    return () => { live = false; };
  }, [base]);

  if (error) return <div className="field-error">{error}</div>;
  if (!data) return <span className="spinner sm" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {data.map((p) => {
        const source = widget.sourceModules.find((m) => m.id === p.moduleId);
        const facts = [
          `${p.records.toLocaleString()} ${p.records === 1 ? 'record' : 'records'}`,
          p.first && p.last ? `added ${p.first} to ${p.last}` : null,
          p.aboutPeople ? `${p.people.toLocaleString()} people in the registry` : 'not about people',
          p.aboutPeople && p.notLinked > 0 ? `${p.notLinked.toLocaleString()} not linked to the registry` : null,
          p.sample > 0 ? `${p.sample.toLocaleString()} sample` : null,
        ].filter(Boolean);
        return (
          <div key={p.moduleId}>
            <div style={{ fontWeight: 600 }}>{source?.name} <span className="ws-kpi-sub" style={{ fontWeight: 400 }}>· {source?.officeName}</span></div>
            <div className="ws-kpi-sub" style={{ margin: '2px 0 8px' }}>
              {facts.join(' · ')}
              {p.profiled < p.records && `. The figures below read the latest ${p.profiled.toLocaleString()} records.`}
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr><th>Field</th><th>Kind of data</th><th>Collected as</th><th>Filled in</th><th>Different values</th><th>Smallest to largest</th><th>Average</th></tr>
                </thead>
                <tbody>
                  {p.fields.map((f) => {
                    const t = TYPE[f.type] ?? { name: f.type, kind: '' };
                    return (
                      <tr key={f.key}>
                        <td className="cell-name">{f.label}</td>
                        <td>{t.kind}</td>
                        <td>{t.name}{f.options > 0 ? ` (${f.options})` : ''}</td>
                        <td>{p.profiled > 0 ? `${Math.round((f.filled / p.profiled) * 100)}%` : ''}</td>
                        <td>{f.distinct.toLocaleString()}</td>
                        <td>{f.min != null && f.max != null ? `${num(f.min)} to ${num(f.max)}` : ''}</td>
                        <td>{num(f.average)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { Pagination } from '@/components/Pagination';
import { api, ApiError, type AicsBridgeStatus, type AssistanceFilters, type AssistanceSummary, type AssistanceTimes, type AssistedHousehold, type Paginated } from '@/lib/api';
import { useViewOnly } from '@/lib/viewOnly';

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
const TIMES: Array<[AssistanceTimes, string]> = [
  ['never', 'Not assisted'],
  ['once', 'Assisted once'],
  ['few', 'Assisted 2 or 3 times'],
  ['many', 'Assisted 4 or more times'],
];

// Assistance across offices: every record of a program marked "gives
// assistance" is one release, added up per household. See backend
// services/assistance.ts.
export function AssistancePage() {
  const viewOnly = useViewOnly();
  const [filters, setFilters] = useState<AssistanceFilters>({});
  const [summary, setSummary] = useState<AssistanceSummary | null>(null);
  const [barangays, setBarangays] = useState<Array<{ code: string; name: string }>>([]);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const { from, to, barangayCode } = filters;

  useEffect(() => { api.barangays().then(setBarangays).catch(() => setBarangays([])); }, []);
  useEffect(() => {
    setError(null);
    api.assistanceSummary({ from, to, barangayCode }).then(setSummary).catch((err) => { setSummary(null); setError(err); });
  }, [from, to, barangayCode, attempt]);

  const s = summary;
  const set = (patch: AssistanceFilters) => setFilters((f) => ({ ...f, ...patch }));
  const hh = s?.households;
  const assisted = hh ? hh.total - hh.never : 0;
  const notAssisted = s ? s.byBarangay.filter((b) => b.never > 0).sort((a, b) => b.never - a.never).slice(0, 10) : [];
  const maxNever = Math.max(1, ...notAssisted.map((b) => b.never));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>Assistance</h1>
        </div>
        {s && (
          <>
            <label className="as-date">From <input type="date" className="input" value={from ?? s.from} max={to ?? s.to} onChange={(e) => e.target.value && set({ from: e.target.value })} /></label>
            <label className="as-date">To <input type="date" className="input" value={to ?? s.to} min={from ?? s.from} onChange={(e) => e.target.value && set({ to: e.target.value })} /></label>
          </>
        )}
        <select className="select" style={{ width: 'auto', minWidth: 200 }} aria-label="Filter by barangay" value={barangayCode ?? ''} onChange={(e) => set({ barangayCode: e.target.value || undefined })}>
          <option value="">All barangays</option>
          {barangays.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div>
      {!viewOnly && <AicsConnection />}
      {error != null && <LoadError what="assistance" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {error == null && !s && <span className="spinner" />}

      {s && s.programs.length === 0 && (
        <section className="ws-card ws-card--pad">
          <p style={{ margin: 0, color: 'var(--t-muted)' }}>
            No program is counted as assistance yet. In Offices, open a program&rsquo;s settings and tick &ldquo;Counts as assistance&rdquo; for each program that gives help to people, such as financial aid, farm inputs or relief.
          </p>
        </section>
      )}

      {s && hh && s.programs.length > 0 && (
        <>
          <div className="ws-kpis">
            <Kpi label="Households assisted" value={assisted.toLocaleString()} sub={`of ${hh.total.toLocaleString()} households on record`} />
            <Kpi label="Assisted 4 or more times" value={hh.many.toLocaleString()} sub={`${hh.few.toLocaleString()} assisted 2 or 3 times, ${hh.once.toLocaleString()} once`} onClick={viewOnly ? undefined : () => set({ times: 'many' })} />
            <Kpi label="Households not assisted" value={hh.never.toLocaleString()} sub="no release from any program in this period" onClick={viewOnly ? undefined : () => set({ times: 'never' })} />
            <Kpi label="Value released" value={peso(s.value)} sub={`${s.releases.toLocaleString()} releases${s.releasesOutsideHouseholds ? `, ${s.releasesOutsideHouseholds.toLocaleString()} to people in no household on record` : ''}`} />
          </div>

          <div className="br-grid">
            <section className="ws-card ws-card--pad ws-stack-y">
              <h2 style={{ margin: 0, fontSize: 18 }}>By program</h2>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Program</th><th className="as-num">Releases</th><th className="as-num">Households reached</th><th className="as-num">Value</th></tr></thead>
                  <tbody>
                    {s.programs.map((p) => (
                      <tr key={p.moduleId}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{p.office}</div>
                        </td>
                        <td className="as-num">{p.releases.toLocaleString()}</td>
                        <td className="as-num">{p.recipients.toLocaleString()}</td>
                        <td className="as-num">{p.hasAmount ? peso(p.value) : 'No amount recorded'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ws-card ws-card--pad ws-stack-y">
              <h2 style={{ margin: 0, fontSize: 18 }}>Households not assisted, by barangay</h2>
              {notAssisted.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>None.</p>}
              <div>
                {notAssisted.map((b) => (
                  <button key={b.code ?? 'none'} type="button" className="br-row" disabled={!b.code} onClick={() => b.code && set({ barangayCode: b.code, ...(viewOnly ? {} : { times: 'never' as const }) })}>
                    <span className="br-name">{b.name ?? 'No barangay on record'}</span>
                    <span className="ws-cov-bar" aria-hidden="true"><span style={{ width: `${(b.never / maxNever) * 100}%` }} /></span>
                    <strong>{b.never.toLocaleString()}</strong>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {viewOnly ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t-muted)' }}>For the list of households, ask the administrator.</p>
          ) : (
            <section className="ws-card ws-card--pad ws-stack-y">
              <div className="ws-section-head">
                <div className="grow">
                  <h2 style={{ margin: 0, fontSize: 18 }}>Households</h2>
                  <p className="ws-kpi-sub" style={{ margin: '4px 0 0' }}>Most assisted first. A release is counted on the day it was recorded.</p>
                </div>
                <select className="select" style={{ width: 'auto' }} aria-label="Show households by times assisted" value={filters.times ?? ''} onChange={(e) => set({ times: (e.target.value || undefined) as AssistanceTimes | undefined })}>
                  <option value="">All households</option>
                  {TIMES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
              <HouseholdTable filters={{ ...filters, from: from ?? s.from, to: to ?? s.to }} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

// What the last pull from the AICS system brought (backend
// services/aicsBridge.ts). The server pulls on its own every few minutes.
// Shown only where the connection is set up on the server.
function AicsConnection() {
  const [status, setStatus] = useState<AicsBridgeStatus | null>(null);

  useEffect(() => { api.aicsBridge().then(setStatus).catch(() => setStatus(null)); }, []);
  if (!status?.configured) return null;

  const r = status.lastResult;
  const problem = status.lastError;
  return (
    <section className="ws-card ws-card--pad" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <strong>Connected to AICS</strong>
        <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>
          {status.lastRunAt ? `Last pulled ${new Date(status.lastRunAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Not pulled yet'}
          {r && !problem && `: ${r.added.toLocaleString()} added${r.newCitizens ? ` (${r.newCitizens.toLocaleString()} new citizens)` : ''}${r.citizensFilledIn ? `, ${r.citizensFilledIn.toLocaleString()} citizens' missing details filled in` : ''}${r.updated ? `, ${r.updated.toLocaleString()} corrected` : ''}${r.householdMembersAdded ? `, ${r.householdMembersAdded.toLocaleString()} family members added to households${r.householdMembersToCheck ? ` (${r.householdMembersToCheck.toLocaleString()} to check in Duplicate review)` : ''}` : ''}${r.programRecordsAdded ? `, ${r.programRecordsAdded.toLocaleString()} added to CSWD program lists` : ''}${r.deathsRecorded ? `, ${r.deathsRecorded.toLocaleString()} deaths recorded for Civil Registry` : ''}${r.sentToReview ? `, ${r.sentToReview.toLocaleString()} sent to Duplicate review` : ''}${r.withdrawn ? `, ${r.withdrawn.toLocaleString()} withdrawn` : ''}${r.skippedNoBirthdate ? `, ${r.skippedNoBirthdate.toLocaleString()} skipped (no date of birth in AICS)` : ''}`}
        </div>
        {problem && <div className="field-error">{problem}</div>}
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, onClick }: { label: string; value: string; sub: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="ws-kpi-label">{label}</span>
      <span className="ws-kpi-value">{value}</span>
      <span className="ws-kpi-sub">{sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="ws-card ws-kpi br-kpi-btn" onClick={onClick}>{body}</button>
  ) : (
    <div className="ws-card ws-kpi">{body}</div>
  );
}

function HouseholdTable({ filters }: { filters: AssistanceFilters }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<AssistedHousehold> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const key = JSON.stringify(filters);

  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => {
    setError(null);
    setResult(null);
    api.assistanceList(page, filters).then(setResult).catch((err) => setError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `filters`
  }, [page, key, attempt]);

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      await api.exportAssistance(filters);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong>{result ? `${result.total.toLocaleString()} ${result.total === 1 ? 'household' : 'households'}` : ''}</strong>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn--ghost" onClick={exportCsv} disabled={exporting || !result?.total}>
          <Icon name="download" size={16} /> {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>
      {exportError && <div className="alert danger"><div className="body">{exportError}</div></div>}
      {error != null && <LoadError what="the household list" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {error == null && !result && <span className="spinner" />}
      {result && result.total === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>No households match these filters.</p>}
      {result && result.total > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Household head</th><th>Barangay</th><th className="as-num">Members</th><th className="as-num">Times assisted</th><th className="as-num">Value</th><th>Programs</th><th>Last assisted</th></tr>
            </thead>
            <tbody>
              {result.items.map((h) => (
                <tr key={h.headKey}>
                  <td style={{ fontWeight: 600 }}>{h.head}</td>
                  <td>{h.barangay ?? 'Not recorded'}</td>
                  <td className="as-num">{h.members}</td>
                  <td className="as-num">{h.releases}</td>
                  <td className="as-num">{h.releases ? peso(h.value) : ''}</td>
                  <td>{h.programs ?? ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{h.lastOn ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onPageChange={setPage} />}
    </>
  );
}

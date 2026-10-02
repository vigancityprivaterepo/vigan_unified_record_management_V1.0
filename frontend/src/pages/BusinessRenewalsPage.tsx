import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { Pagination } from '@/components/Pagination';
import { api, ApiError, type Paginated, type RenewalBusiness, type RenewalFilters, type RenewalSummary } from '@/lib/api';

// Business renewals: which businesses have not renewed their permit, from
// BPLO's Business Permits records. Definitions are in
// backend/src/services/businessRenewals.ts and repeated in plain words here.
// officeId set = the office that runs Business Permits (BPLO).
export function BusinessRenewalsPage({ officeId }: { officeId?: string } = {}) {
  const [summary, setSummary] = useState<RenewalSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState<RenewalFilters>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    setError(null);
    api.renewalSummary(officeId).then((s) => {
      setSummary(s);
      // Start on the main follow-up list: last permit was last year.
      setFilters((f) => (Object.keys(f).length ? f : { lastYear: s.year - 1 }));
    }).catch((err) => { setSummary(null); setError(err); });
  }, [officeId, attempt]);

  const s = summary;
  const set = (patch: RenewalFilters) => setFilters((f) => ({ ...f, ...patch }));
  const yearLabel = (y: number | 'none' | undefined) => (y === 'none' ? 'No permit year' : y === undefined ? 'Any year' : String(y));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>Business renewals</h1>
        </div>
      </div>
      {error != null && <LoadError what="business renewals" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {error == null && !s && <span className="spinner" />}

      {s && (
        <>
          <div className="ws-kpis">
            <Kpi label={`Renewed for ${s.year}`} value={s.renewed} sub={`of ${s.total.toLocaleString()} businesses on record`} />
            <Kpi label={`Not renewed for ${s.year}`} value={s.notRenewed} sub={`last permit in ${s.year - 1}; most likely still operating`} onClick={() => setFilters({ lastYear: s.year - 1 })} />
            <Kpi label="Lapsed longer" value={s.lapsedLonger} sub={`last permit in ${s.year - 2} or earlier; many may have closed`} />
            <Kpi label="No permit year on record" value={s.noYear} sub="check these records" onClick={() => setFilters({ lastYear: 'none' })} />
          </div>

          <div className="br-grid">
            <TopList title={`Not renewed for ${s.year}, by barangay`} rows={s.notRenewedByBarangay} onPick={(name) => setFilters({ lastYear: s.year - 1, barangay: name })} />
            <TopList title={`Not renewed for ${s.year}, by line of business`} rows={s.notRenewedByLine} onPick={(name) => setFilters({ lastYear: s.year - 1, line: name })} />
          </div>

          <section className="ws-card ws-card--pad ws-stack-y">
            <div className="ws-section-head">
              <div className="grow">
                <h2 style={{ margin: 0, fontSize: 18 }}>Businesses</h2>
                <p className="ws-kpi-sub" style={{ margin: '4px 0 0' }}>
                  {[yearLabel(filters.lastYear) === 'Any year' ? null : `Last permit: ${yearLabel(filters.lastYear)}`, filters.barangay, filters.line, filters.statusCode ? `BPLS status code ${filters.statusCode}` : null, filters.q ? `"${filters.q}"` : null].filter(Boolean).join(' · ') || 'All businesses'}
                </p>
              </div>
              <select className="select" style={{ width: 'auto' }} aria-label="Last permit year" value={filters.lastYear === undefined ? '' : String(filters.lastYear)}
                onChange={(e) => set({ lastYear: e.target.value === '' ? undefined : e.target.value === 'none' ? 'none' : Number(e.target.value) })}>
                <option value="">Any last permit year</option>
                {s.byYear.map((y) => (
                  <option key={y.year ?? 'none'} value={y.year ?? 'none'}>{y.year ?? 'No permit year'} ({y.count.toLocaleString()})</option>
                ))}
              </select>
              <select className="select" style={{ width: 'auto' }} aria-label="BPLS status code" value={filters.statusCode ?? ''} onChange={(e) => set({ statusCode: e.target.value || undefined })}>
                <option value="">Any status code</option>
                {s.byStatusCode.filter((c) => c.code).map((c) => <option key={c.code} value={c.code!}>Code {c.code} ({c.count.toLocaleString()})</option>)}
              </select>
              <form onSubmit={(e) => { e.preventDefault(); set({ q: search.trim() || undefined }); }} className="ws-list-search" style={{ height: 40, minWidth: 220 }}>
                <Icon name="search" size={16} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Business, trade name or TAN" aria-label="Search businesses" />
              </form>
              {(filters.barangay || filters.line || filters.statusCode || filters.q) && (
                <button type="button" className="btn btn--ghost" onClick={() => { setSearch(''); set({ barangay: undefined, line: undefined, statusCode: undefined, q: undefined }); }}>Clear filters</button>
              )}
            </div>
            <BusinessTable officeId={officeId} filters={filters} />
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t-muted)' }}>
              BPLS status codes are shown as recorded; their meanings have not been confirmed with BPLO yet, so no business is left out because of its code.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, onClick }: { label: string; value: number; sub: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="ws-kpi-label">{label}</span>
      <span className="ws-kpi-value">{value.toLocaleString()}</span>
      <span className="ws-kpi-sub">{sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="ws-card ws-kpi br-kpi-btn" onClick={onClick}>{body}</button>
  ) : (
    <div className="ws-card ws-kpi">{body}</div>
  );
}

function TopList({ title, rows, onPick }: { title: string; rows: Array<{ name: string | null; count: number }>; onPick: (name: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="ws-card ws-card--pad ws-stack-y">
      <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
      {rows.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>None.</p>}
      <div>
        {rows.map((r) => (
          <button key={r.name ?? 'none'} type="button" className="br-row" disabled={!r.name} onClick={() => r.name && onPick(r.name)}>
            <span className="br-name">{r.name ?? 'Not recorded'}</span>
            <span className="ws-cov-bar" aria-hidden="true"><span style={{ width: `${(r.count / max) * 100}%` }} /></span>
            <strong>{r.count.toLocaleString()}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function BusinessTable({ officeId, filters }: { officeId?: string; filters: RenewalFilters }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<RenewalBusiness> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const key = JSON.stringify(filters);

  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => {
    setError(null);
    setResult(null);
    api.renewalList(officeId, page, filters).then(setResult).catch((err) => setError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `filters`
  }, [officeId, page, key, attempt]);

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      await api.exportRenewals(officeId, filters);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong>{result ? `${result.total.toLocaleString()} ${result.total === 1 ? 'business' : 'businesses'}` : ''}</strong>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn--ghost" onClick={exportCsv} disabled={exporting || !result?.total}>
          <Icon name="download" size={16} /> {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>
      {exportError && <div className="alert danger"><div className="body">{exportError}</div></div>}
      {error != null && <LoadError what="the business list" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {error == null && !result && <span className="spinner" />}
      {result && result.total === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>No businesses match these filters.</p>}
      {result && result.total > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Business</th><th>Line of business</th><th>Barangay</th><th>Last permit</th><th>Valid until</th><th>TAN</th><th>Code</th></tr>
            </thead>
            <tbody>
              {result.items.map((b) => (
                <tr key={b.recordId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{b.businessName ?? 'No name on record'}</div>
                    {b.tradeName && b.tradeName !== b.businessName && <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{b.tradeName}</div>}
                  </td>
                  <td>{b.line ?? ''}</td>
                  <td>{b.barangay ?? 'Not recorded'}</td>
                  <td>{b.lastYear ?? 'None'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{b.validUntil ?? ''}</td>
                  <td className="mono" style={{ fontSize: 13 }}>{b.tan ?? ''}</td>
                  <td>{b.statusCode ?? ''}</td>
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
